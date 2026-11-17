import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {unsealTestGatewayKey} from "./vault.js";
import {
  PaystackHostedAdapter,FlutterwaveHostedAdapter,GatewayAdapterError,
  type GatewayVerificationRequest,
} from "./hosted-adapters.js";
import {closeTestGatewayAttempt} from "./attempts.js";

// Internal-only TEST provider observation: an observed sandbox response never
// completes the canonical payment, issues a receipt or changes cashbook/stock.
// No POST/PUT route calls this function in this release.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Provider="PAYSTACK"|"FLUTTERWAVE";
type Snapshot={
  id:string;business_id:string;provider_code:Provider;
  client_reference:string;merchant_connection_revision:number;
  expected_amount_minor:string;currency_code:string;
  payment_method:"MOMO"|"CARD";state:string;environment:string;
};
type VaultRow={
  revision:number;encrypted_secret:Buffer;nonce:Buffer;auth_tag:Buffer;
  vault_key_version:1;
};
type Evidence={
  id:string;attempt_id:string;business_id:string;provider_code:Provider;
  observation_kind:"SANDBOX_PAID"|"SANDBOX_UNPAID";
  provider_transaction_id:string|null;observed_at:Date;
};
const COLUMNS="id,attempt_id,business_id,provider_code,observation_kind,"+
  "provider_transaction_id,observed_at";
function checkId(id:unknown):asserts id is string{
  if(typeof id!=="string"||!UUID.test(id))throw new AuthError(
    "Valid sandbox payment identifiers are required.",
    400,"GATEWAY_SANDBOX_ID_INVALID");
}
function view(row:Evidence){
  return {observationId:row.id,attemptId:row.attempt_id,
    providerCode:row.provider_code,
    status:row.observation_kind==="SANDBOX_PAID"?
      "TEST_PAID_OBSERVED" as const:"TEST_UNPAID_OBSERVED" as const,
    observedAt:row.observed_at.toISOString(),
    posted:false,collectionEnabled:false};
}
const PROVIDER_TX=/^[1-9][0-9]{0,15}$/;

/**
 * Independently polls the original provider using the SAME merchant's
 * encrypted test key revision. Flutterwave needs a candidate transaction ID;
 * this is never trusted as proof until the provider independently confirms
 * the reference, amount, currency, method and ID.
 */
export async function observeSandboxGatewayVerification(pool:DatabasePool,input:{
  businessId:string;attemptId:string;providerTransactionId?:string;
  fetchImpl?:typeof fetch;
}){
  checkId(input.businessId);checkId(input.attemptId);
  const attempt=(await pool.query<Snapshot>(
    "SELECT id,business_id,provider_code,client_reference,"+
    "merchant_connection_revision,expected_amount_minor::text,currency_code,"+
    "payment_method,state,environment "+
    "FROM gateway_collection_attempts WHERE id=$1 AND business_id=$2",
    [input.attemptId,input.businessId])).rows[0];
  if(!attempt)throw new AuthError("Sandbox attempt was not found.",
    404,"GATEWAY_SANDBOX_ATTEMPT_NOT_FOUND");
  if(attempt.environment!=="TEST"||attempt.state!=="PREPARED")
    throw new AuthError("This TEST attempt is not open for verification.",
      409,"GATEWAY_SANDBOX_ATTEMPT_CLOSED");
  if(attempt.provider_code==="FLUTTERWAVE"){
    if(typeof input.providerTransactionId!=="string"||
      !PROVIDER_TX.test(input.providerTransactionId))
      throw new AuthError("Flutterwave requires a numeric transaction ID.",
        400,"GATEWAY_SANDBOX_PROVIDER_TX_REQUIRED");
  }else if(input.providerTransactionId!==undefined){
    throw new AuthError("Paystack verifies using the original client reference.",
      400,"GATEWAY_SANDBOX_PROVIDER_TX_UNEXPECTED");
  }

  const already=(await pool.query<Evidence>(
    "SELECT "+COLUMNS+" FROM gateway_sandbox_verification_observations "+
    "WHERE business_id=$1 AND attempt_id=$2 AND observation_kind='SANDBOX_PAID'",
    [input.businessId,input.attemptId])).rows[0];
  if(already){
    if(input.providerTransactionId!==undefined&&
       input.providerTransactionId!==already.provider_transaction_id)
      throw new AuthError("Another sandbox transaction was already observed.",
        409,"GATEWAY_SANDBOX_PROVIDER_TX_CONFLICT");
    return {evidence:view(already),replayed:true};
  }

  // Vault is selected by the immutable merchant snapshot, never by today's
  // preferred gateway or platform subscription credentials.
  const connection=(await pool.query<VaultRow>(
    "SELECT revision,encrypted_secret,nonce,auth_tag,vault_key_version "+
    "FROM business_gateway_connections WHERE business_id=$1 "+
    "AND provider_code=$2 AND environment='TEST' "+
    "AND connection_status='PENDING_VERIFICATION' AND enabled=false "+
    "AND revision=$3",
    [input.businessId,attempt.provider_code,
      attempt.merchant_connection_revision])).rows[0];
  if(!connection)throw new AuthError(
    "The original merchant TEST key was rotated or revoked. Manual review is required.",
    409,"GATEWAY_SANDBOX_CONNECTION_CHANGED");
  const amountMinor=Number(attempt.expected_amount_minor);
  if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)
    throw new AuthError("The expected sandbox amount cannot be represented safely.",
      409,"GATEWAY_SANDBOX_AMOUNT_INVALID");
  const request:GatewayVerificationRequest={
    reference:attempt.client_reference,amountMinor,
    currencyCode:attempt.currency_code.trim(),
    method:attempt.payment_method,
  };
  const secret=unsealTestGatewayKey(input.businessId,attempt.provider_code,{
    encrypted:connection.encrypted_secret,nonce:connection.nonce,
    tag:connection.auth_tag,keyVersion:connection.vault_key_version,
  });
  let checked:Awaited<ReturnType<PaystackHostedAdapter["verify"]>>;
  try{
    if(attempt.provider_code==="PAYSTACK"){
      checked=await new PaystackHostedAdapter(secret,input.fetchImpl).verify(request);
    }else{
      checked=await new FlutterwaveHostedAdapter(secret,input.fetchImpl)
        .verify(request,input.providerTransactionId!);
    }
  }catch(error){
    if(error instanceof GatewayAdapterError&&
       error.code==="GATEWAY_VERIFICATION_MISMATCH"){
      // A mismatched transaction must not be retried silently or booked.
      await closeTestGatewayAttempt(pool,{businessId:input.businessId,
        attemptId:input.attemptId,decision:"REVIEW_REQUIRED",
        reasonCode:"SANDBOX_PROVIDER_MISMATCH"});
    }
    throw error;
  }

  return withTransaction(pool,async tx=>{
    // Race-safe final check: account status, key version and original attempt
    // must still agree AFTER the external provider returns.
    const original=(await tx.query<Snapshot>(
      "SELECT id,business_id,provider_code,client_reference,"+
      "merchant_connection_revision,expected_amount_minor::text,currency_code,"+
      "payment_method,state,environment FROM gateway_collection_attempts "+
      "WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [input.attemptId,input.businessId])).rows[0];
    if(!original||original.state!=="PREPARED"||
      original.environment!=="TEST"||
      original.provider_code!==attempt.provider_code||
      original.merchant_connection_revision!==attempt.merchant_connection_revision)
      throw new AuthError("Attempt changed during sandbox verification.",
        409,"GATEWAY_SANDBOX_ATTEMPT_CHANGED");
    const stillValid=(await tx.query<{revision:number}>(
      "SELECT revision FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment='TEST' "+
      "AND connection_status='PENDING_VERIFICATION' AND enabled=false "+
      "AND revision=$3 FOR UPDATE",
      [input.businessId,attempt.provider_code,
        attempt.merchant_connection_revision])).rows[0];
    if(!stillValid)throw new AuthError(
      "Merchant test credentials changed during verification.",
      409,"GATEWAY_SANDBOX_CONNECTION_CHANGED");

    const kind=checked.status==="PAID"?"SANDBOX_PAID":"SANDBOX_UNPAID";
    // The adapter independently checked the canonical reference, amount,
    // currency, tender and provider transaction ID before returning PAID.
    if(kind==="SANDBOX_PAID"&&!checked.transactionId)
      throw new AuthError("Provider did not supply a verifiable transaction ID.",
        409,"GATEWAY_SANDBOX_TX_UNVERIFIED");
    let saved:Evidence;
    try{
      const written=await tx.query<Evidence>(
        "INSERT INTO gateway_sandbox_verification_observations "+
        "(attempt_id,business_id,provider_code,merchant_connection_revision,"+
        "observation_kind,provider_transaction_id,amount_minor,currency_code,"+
        "payment_method) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) "+
        "ON CONFLICT(attempt_id,observation_kind) DO NOTHING RETURNING "+COLUMNS,
        [attempt.id,input.businessId,attempt.provider_code,
          attempt.merchant_connection_revision,kind,
          kind==="SANDBOX_PAID"?checked.transactionId:null,
          kind==="SANDBOX_PAID"?amountMinor:null,
          kind==="SANDBOX_PAID"?request.currencyCode:null,
          kind==="SANDBOX_PAID"?request.method:null]);
      if(written.rows[0])saved=written.rows[0];
      else{
        const prior=(await tx.query<Evidence>(
          "SELECT "+COLUMNS+" FROM gateway_sandbox_verification_observations "+
          "WHERE attempt_id=$1 AND business_id=$2 AND observation_kind=$3",
          [attempt.id,input.businessId,kind])).rows[0];
        if(!prior||kind==="SANDBOX_PAID"&&
           prior.provider_transaction_id!==checked.transactionId)
          throw new AuthError(
            "Conflicting sandbox payment evidence requires manual review.",
            409,"GATEWAY_SANDBOX_EVIDENCE_CONFLICT");
        return {evidence:view(prior),replayed:true};
      }
    }catch(error){
      if(typeof error==="object"&&error!==null&&"code" in error&&
         error.code==="23505")throw new AuthError(
        "This provider transaction was observed for another payment.",
        409,"GATEWAY_SANDBOX_PROVIDER_TX_REUSED");
      throw error;
    }
    // No writes to sales, payments, cashbook, inventory, returns or receipts.
    return {evidence:view(saved),replayed:false};
  });
}
