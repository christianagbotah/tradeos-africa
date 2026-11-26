import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { requireHubtelPosConnection,posFail } from "./hubtel-pos-config.js";
import { HubtelStatusClient,type HubtelStatusVerification } from "../platform-admin/hubtel-status-client.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOLDOWN_MINUTES=5;

export type HubtelSettlementExceptionKind=
  "REFUND_REPORTED"|"STATUS_CONFLICT"|"TRANSACTION_CONFLICT"|"METHOD_CONFLICT";
export interface HubtelSettlementRecheck {
  saleId:string;
  state:"UNCHANGED"|"REVIEW_REQUIRED";
  exceptionKind:HubtelSettlementExceptionKind|null;
  verifiedAt:string;
}
type SettledAttempt={
  id:string;business_id:string;branch_id:string;sale_id:string;payment_id:string;
  state:string;client_reference:string;merchant_collection_account:string;
  expected_amount_minor:string;currency_code:string;
  verified_provider_transaction_id:string|null;
  credential_source:"PLATFORM_ALIAS"|"MERCHANT_VAULT";
  merchant_credential_revision:number|null;
};
type Sale={id:string;status:string;business_id:string;branch_id:string;
  total_minor:string;currency_code:string};
type Payment={id:string;status:string;business_id:string;branch_id:string;
  sale_id:string;amount_minor:string;currency_code:string;method:string;
  provider_reference:string|null};

export function classifySettledHubtelObservation(
  verified:Pick<HubtelStatusVerification,"status"|"transactionId"|"paymentMethod">,
  originalTransactionId:string,expectedPaymentMethod:string,
):HubtelSettlementExceptionKind|null{
  if(verified.status==="UNPAID")return "STATUS_CONFLICT";
  if(verified.transactionId!==originalTransactionId)return "TRANSACTION_CONFLICT";
  if(verified.status==="REFUNDED")return "REFUND_REPORTED";
  if(verified.paymentMethod!==expectedPaymentMethod)return "METHOD_CONFLICT";
  return null;
}

/**
 * A separate, manually invoked 5-minute-throttled recheck of an ALREADY paid
 * sale. Hubtel status comes from the ORIGINAL merchant account/reference
 * and original credential source. No refund, reversal, receipt, stock,
 * fulfilled state or payment status is mutated by this operation.
 */
export async function reviewSettledHubtelSale(
  pool:DatabasePool,input:{businessId:string;saleId:string},
):Promise<HubtelSettlementRecheck>{
  if(!UUID.test(input.businessId)||!UUID.test(input.saleId))
    posFail("Valid business and sale IDs are required.","HUBTEL_POS_ID_INVALID",400);
  const attempt=(await pool.query<SettledAttempt>(
    "SELECT id,business_id,branch_id,sale_id,payment_id,state,client_reference,"+
    "merchant_collection_account,expected_amount_minor::text,currency_code,"+
    "verified_provider_transaction_id,credential_source,merchant_credential_revision "+
    "FROM hubtel_sale_checkout_attempts WHERE business_id=$1 AND sale_id=$2",
    [input.businessId,input.saleId])).rows[0];
  if(!attempt||attempt.state!=="RECONCILED"||
      !attempt.verified_provider_transaction_id)
    posFail("Only a previously confirmed Hubtel sale can be rechecked.",
      "HUBTEL_POST_SETTLEMENT_NOT_RECONCILED",409);
  const config=await requireHubtelPosConnection(
    pool,input.businessId,attempt.credential_source);
  if(config.credentialSource!==attempt.credential_source||
      config.merchantCredentialRevision!==attempt.merchant_credential_revision||
      config.collectionAccount!==attempt.merchant_collection_account)
    posFail("Original merchant status credentials have changed; manual provider review required.",
      "HUBTEL_POST_SETTLEMENT_ORIGINAL_ACCOUNT_MISMATCH",409);

  // Atomic cooldown claim: concurrency cannot multiply provider requests,
  // including when the remote lookup fails or times out.
  const claimed=await pool.query<{id:string}>(
    "UPDATE hubtel_sale_checkout_attempts SET "+
    "last_post_settlement_checked_at=now(),"+
    "post_settlement_status_checks=post_settlement_status_checks+1 "+
    "WHERE id=$1 AND business_id=$2 AND state='RECONCILED' "+
    "AND (last_post_settlement_checked_at IS NULL OR "+
    "last_post_settlement_checked_at <= now() - "+
    "($3::integer * interval '1 minute')) RETURNING id",
    [attempt.id,input.businessId,COOLDOWN_MINUTES],
  );
  if(!claimed.rows[0])
    posFail("This paid transaction was checked recently. Retry later.",
      "HUBTEL_POST_SETTLEMENT_CHECK_COOLDOWN",429);

  // The authenticated provider status API is the only source of evidence.
  // A callback/redirect/status hint never reaches this function.
  const verified=await new HubtelStatusClient({
    apiId:config.apiId,apiKey:config.apiKey,
    collectionAccount:config.collectionAccount,
  }).verifyStatus({
    clientReference:attempt.client_reference,
    expectedAmountMinor:Number(attempt.expected_amount_minor),
    currencyCode:attempt.currency_code,
  });

  return withTransaction(pool,async tx=>{
    // Keep the existing sale -> payment -> attempt lock order used by
    // ordinary settlement, avoiding deadlock with payment finality.
    const sale=(await tx.query<Sale>(
      "SELECT id,status,business_id,branch_id,total_minor::text,currency_code "+
      "FROM sales WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [attempt.sale_id,input.businessId])).rows[0];
    const payment=(await tx.query<Payment>(
      "SELECT id,status,business_id,branch_id,sale_id,amount_minor::text,"+
      "currency_code,method,provider_reference FROM payments "+
      "WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [attempt.payment_id,input.businessId])).rows[0];
    const current=(await tx.query<SettledAttempt>(
      "SELECT id,business_id,branch_id,sale_id,payment_id,state,client_reference,"+
      "merchant_collection_account,expected_amount_minor::text,currency_code,"+
      "verified_provider_transaction_id,credential_source,merchant_credential_revision "+
      "FROM hubtel_sale_checkout_attempts WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [attempt.id,input.businessId])).rows[0];
    if(!sale||!payment||!current||current.state!=="RECONCILED"||
       sale.status!=="COMPLETED"||payment.status!=="SUCCEEDED"||
       payment.sale_id!==sale.id||current.sale_id!==sale.id||
       current.payment_id!==payment.id||
       payment.provider_reference!==current.verified_provider_transaction_id||
       current.verified_provider_transaction_id!==attempt.verified_provider_transaction_id||
       current.client_reference!==verified.clientReference||
       current.merchant_collection_account!==config.collectionAccount||
       current.credential_source!==config.credentialSource||
       current.merchant_credential_revision!==config.merchantCredentialRevision||
       sale.branch_id!==current.branch_id||payment.branch_id!==current.branch_id||
       current.business_id!==input.businessId||
       sale.currency_code!==current.currency_code||
       payment.currency_code!==current.currency_code||
       sale.total_minor!==current.expected_amount_minor||
       payment.amount_minor!==current.expected_amount_minor)
      posFail("The original paid transaction changed; no status review was posted.",
        "HUBTEL_POST_SETTLEMENT_SCOPE_MISMATCH",409);
    const kind=classifySettledHubtelObservation(
      verified,current.verified_provider_transaction_id!,payment.method);
    if(!kind)return {saleId:sale.id,state:"UNCHANGED" as const,
      exceptionKind:null,verifiedAt:verified.verifiedAt};

    const inserted=(await tx.query<{id:string}>(
      "INSERT INTO hubtel_pos_settlement_exceptions "+
      "(attempt_id,business_id,branch_id,sale_id,payment_id,exception_kind,"+
      "client_reference,original_provider_transaction_id,verified_at) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) "+
      "ON CONFLICT(attempt_id,exception_kind) DO NOTHING RETURNING id",
      [current.id,input.businessId,current.branch_id,sale.id,payment.id,kind,
        current.client_reference,current.verified_provider_transaction_id,
        verified.verifiedAt])).rows[0];
    if(inserted)await tx.query(
      "INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,"+
      "entity_type,entity_id,payload,occurred_at) "+
      "VALUES($1,$2,NULL,'HUBTEL_POS_SETTLEMENT_EXCEPTION_OBSERVED',"+
      "'SALE',$3,$4::jsonb,now())",
      [input.businessId,current.branch_id,sale.id,
        JSON.stringify({attemptId:current.id,exceptionKind:kind})]);
    return {saleId:sale.id,state:"REVIEW_REQUIRED" as const,
      exceptionKind:kind,verifiedAt:verified.verifiedAt};
  });
}
