import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {reauthenticateSensitiveSettings} from "./connections.js";
import {unsealTestGatewayKey} from "./vault.js";
import {PaystackHostedAdapter,FlutterwaveHostedAdapter} from "./hosted-adapters.js";

// Hosted checkout is ONLY possible for the original merchant's immutable
// TEST snapshot. No LIVE credentials or ledger writes are reachable here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;
type Provider="PAYSTACK"|"FLUTTERWAVE";
type State="INITIATING"|"READY"|"OUTCOME_UNKNOWN";
type Attempt={
  id:string;business_id:string;sale_id:string;payment_id:string;
  provider_code:Provider;environment:string;state:string;
  client_reference:string;merchant_connection_revision:number;
  expected_amount_minor:string;currency_code:string;payment_method:"CARD"|"MOMO";
};
type HostedRow={attempt_id:string;business_id:string;provider_code:Provider;
  merchant_connection_revision:number;state:State;checkout_url:string|null;
  initiated_at:Date;updated_at:Date};
const FIELDS="attempt_id,business_id,provider_code,merchant_connection_revision,"+
  "state,checkout_url,initiated_at,updated_at";
function fail(message:string,code:string,status=409):never {
  throw new AuthError(message,status,code);
}
function view(r:HostedRow){
  return {
    attemptId:r.attempt_id,providerCode:r.provider_code,
    environment:"TEST" as const,state:r.state,
    checkoutUrl:r.state==="READY"?r.checkout_url:null,
    initiatedAt:r.initiated_at.toISOString(),
    updatedAt:r.updated_at.toISOString(),charged:false,settled:false,
  };
}
async function event(tx:{query:DatabasePool["query"]},r:HostedRow,
  actorUserId:string,verb:"INITIATED"|"READY"|"OUTCOME_UNKNOWN"){
  await tx.query("INSERT INTO gateway_sandbox_hosted_checkout_events "+
    "(attempt_id,business_id,event_type,actor_user_id) VALUES($1,$2,$3,$4)",
    [r.attempt_id,r.business_id,verb,actorUserId]);
}
const RETURN_URL="https://tradeosafrica.lightworldtech.com/settings?section=payments";

export async function initializeGatewaySandboxCheckout(pool:DatabasePool,input:{
  businessId:string;attemptId:string;actorUserId:string;
  currentPassword:unknown;customerEmail:unknown;fetchImpl?:typeof fetch;
}){
  if(!UUID.test(input.businessId)||!UUID.test(input.attemptId)||
     !UUID.test(input.actorUserId))
    fail("Valid business and TEST attempt IDs are required.",
      "GATEWAY_TEST_CHECKOUT_ID_INVALID",400);
  if(typeof input.customerEmail!=="string"||
     input.customerEmail.length>254||!EMAIL.test(input.customerEmail))
    fail("Provide a valid email for the provider TEST checkout.",
      "GATEWAY_TEST_CHECKOUT_EMAIL_INVALID",400);
  const email=input.customerEmail.trim();
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  const claim=await withTransaction(pool,async tx=>{
    const attempt=(await tx.query<Attempt>(
      "SELECT id,business_id,sale_id,payment_id,provider_code,environment,"+
      "state,client_reference,merchant_connection_revision,"+
      "expected_amount_minor::text,currency_code,payment_method "+
      "FROM gateway_collection_attempts "+
      "WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [input.attemptId,input.businessId])).rows[0];
    if(!attempt)fail("The original merchant TEST attempt was not found.",
      "GATEWAY_TEST_CHECKOUT_NOT_FOUND",404);
    const existing=(await tx.query<HostedRow>(
      "SELECT "+FIELDS+" FROM gateway_sandbox_hosted_checkouts "+
      "WHERE attempt_id=$1 AND business_id=$2 FOR UPDATE",
      [input.attemptId,input.businessId])).rows[0];
    // An initiation is never replayed against a provider; a pending or
    // indeterminate external request needs review, not a second POST.
    if(existing)return {newlyClaimed:false as const,row:existing};
    if(attempt.environment!=="TEST"||attempt.state!=="PREPARED")
      fail("Only an open merchant TEST attempt can initiate checkout.",
        "GATEWAY_TEST_CHECKOUT_CLOSED");
    const paid=(await tx.query<{id:string}>(
      "SELECT id FROM gateway_sandbox_verification_observations "+
      "WHERE attempt_id=$1 AND business_id=$2 "+
      "AND observation_kind='SANDBOX_PAID' LIMIT 1",
      [input.attemptId,input.businessId])).rows[0];
    if(paid)fail("A TEST paid observation is already recorded for this attempt.",
      "GATEWAY_TEST_CHECKOUT_PAID_EVIDENCE_EXISTS");
    const approved=(await tx.query<{sale_status:string;payment_status:string;
      total_minor:string;amount_minor:string}>(
      "SELECT s.status AS sale_status,p.status AS payment_status,"+
      "s.total_minor::text,p.amount_minor::text "+
      "FROM sales s JOIN payments p "+
      "ON p.id=$3 AND p.business_id=s.business_id AND p.sale_id=s.id "+
      "WHERE s.business_id=$1 AND s.id=$2 FOR UPDATE OF s,p",
      [input.businessId,attempt.sale_id,attempt.payment_id])).rows[0];
    if(!approved||approved.sale_status!=="OPEN"||
       approved.payment_status!=="PENDING"||
       approved.total_minor!==attempt.expected_amount_minor||
       approved.amount_minor!==attempt.expected_amount_minor)
      fail("Original sale and electronic payment must remain open and unchanged.",
        "GATEWAY_TEST_CHECKOUT_SALE_CHANGED");
    const connection=(await tx.query<{
      revision:number;encrypted_secret:Buffer|null;nonce:Buffer|null;
      auth_tag:Buffer|null;vault_key_version:1;
    }>(
      "SELECT revision,encrypted_secret,nonce,auth_tag,vault_key_version "+
      "FROM business_gateway_connections WHERE business_id=$1 "+
      "AND provider_code=$2 AND environment='TEST' "+
      "AND connection_status='PENDING_VERIFICATION' AND enabled=false "+
      "AND revision=$3 FOR UPDATE",
      [input.businessId,attempt.provider_code,
        attempt.merchant_connection_revision])).rows[0];
    if(!connection||!connection.encrypted_secret||!connection.nonce||
       !connection.auth_tag)
      fail("Original TEST credentials were revoked or rotated; manual review is required.",
        "GATEWAY_TEST_CHECKOUT_CREDENTIALS_CHANGED");
    const secret=unsealTestGatewayKey(input.businessId,attempt.provider_code,{
      encrypted:connection.encrypted_secret,nonce:connection.nonce,
      tag:connection.auth_tag,keyVersion:connection.vault_key_version,
    });
    const prefix=attempt.provider_code==="PAYSTACK"?"sk_test_":"FLWSECK_TEST-";
    if(!secret.startsWith(prefix))
      fail("A LIVE payment credential cannot initiate a TEST checkout.",
        "GATEWAY_TEST_CHECKOUT_LIVE_KEY_BLOCKED",403);
    const amount=Number(attempt.expected_amount_minor);
    if(!Number.isSafeInteger(amount)||amount<=0)
      fail("Invalid original TEST payment amount.",
        "GATEWAY_TEST_CHECKOUT_AMOUNT_INVALID");
    const row=(await tx.query<HostedRow>(
      "INSERT INTO gateway_sandbox_hosted_checkouts "+
      "(attempt_id,business_id,provider_code,merchant_connection_revision) "+
      "VALUES($1,$2,$3,$4) RETURNING "+FIELDS,
      [attempt.id,input.businessId,attempt.provider_code,
        attempt.merchant_connection_revision])).rows[0]!;
    await event(tx,row,input.actorUserId,"INITIATED");
    return {newlyClaimed:true as const,row,attempt,amount,secret};
  });
  if(!claim.newlyClaimed)return {checkout:view(claim.row),replayed:true};
  const {attempt,row,secret,amount}=claim;
  let checkoutUrl:string|null=null;
  try{
    const req={
      reference:attempt.client_reference,amountMinor:amount,
      currencyCode:attempt.currency_code.trim(),
      method:attempt.payment_method,customerEmail:email,
      returnUrl:RETURN_URL,
    };
    const result=attempt.provider_code==="PAYSTACK"
      ?await new PaystackHostedAdapter(secret,input.fetchImpl).initialize(req)
      :await new FlutterwaveHostedAdapter(secret,input.fetchImpl).initialize(req);
    if(result.reference!==attempt.client_reference)
      throw new Error("Provider checkout reference mismatch");
    checkoutUrl=result.checkoutUrl;
  }catch{
    // An API timeout or malformed link may have created an external checkout.
    // Record uncertainty; NEVER reissue, even if a response was lost.
    checkoutUrl=null;
  }
  return withTransaction(pool,async tx=>{
    const pending=(await tx.query<HostedRow>(
      "SELECT "+FIELDS+" FROM gateway_sandbox_hosted_checkouts "+
      "WHERE attempt_id=$1 AND business_id=$2 FOR UPDATE",
      [input.attemptId,input.businessId])).rows[0];
    if(!pending||pending.state!=="INITIATING")
      fail("The TEST checkout status changed; manual review is required.",
        "GATEWAY_TEST_CHECKOUT_CHANGED");
    const still=(await tx.query<{id:string}>(
      "SELECT a.id FROM gateway_collection_attempts a "+
      "JOIN sales s ON s.id=a.sale_id AND s.business_id=a.business_id "+
      "JOIN payments p ON p.id=a.payment_id AND p.business_id=a.business_id "+
      "JOIN business_gateway_connections c "+
      "ON c.business_id=a.business_id AND c.provider_code=a.provider_code "+
      "WHERE a.id=$1 AND a.business_id=$2 AND a.state='PREPARED' "+
      "AND a.environment='TEST' AND s.status='OPEN' AND p.status='PENDING' "+
      "AND c.environment='TEST' AND c.connection_status='PENDING_VERIFICATION' "+
      "AND c.enabled=false AND c.revision=a.merchant_connection_revision "+
      "AND NOT EXISTS(SELECT 1 FROM gateway_sandbox_verification_observations o "+
      "WHERE o.attempt_id=a.id AND o.observation_kind='SANDBOX_PAID') LIMIT 1",
      [input.attemptId,input.businessId])).rows[0];
    const next=checkoutUrl&&still?"READY":"OUTCOME_UNKNOWN";
    const updated=(await tx.query<HostedRow>(
      "UPDATE gateway_sandbox_hosted_checkouts SET state=$3,"+
      "checkout_url=$4,updated_at=now() "+
      "WHERE attempt_id=$1 AND business_id=$2 RETURNING "+FIELDS,
      [input.attemptId,input.businessId,next,next==="READY"?checkoutUrl:null]))
      .rows[0]!;
    await event(tx,updated,input.actorUserId,next);
    return {checkout:view(updated),replayed:false};
  });
}

export async function listGatewaySandboxHostedCheckouts(pool:DatabasePool,input:{
  businessId:string;attemptIds:string[];
}){
  if(!UUID.test(input.businessId)||input.attemptIds.some(id=>!UUID.test(id)))
    fail("Invalid merchant TEST checkout identifiers.",
      "GATEWAY_TEST_CHECKOUT_ID_INVALID",400);
  if(!input.attemptIds.length)return new Map<string,ReturnType<typeof view>>();
  const result=await pool.query<HostedRow>(
    "SELECT "+FIELDS+" FROM gateway_sandbox_hosted_checkouts "+
    "WHERE business_id=$1 AND attempt_id=ANY($2::uuid[])",
    [input.businessId,input.attemptIds]);
  return new Map(result.rows.map(r=>[r.attempt_id,view(r)]));
}
