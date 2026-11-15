import { randomBytes } from "node:crypto";
import type { DatabasePool,DatabaseClient } from "../db.js";
import { withTransaction } from "../db.js";
import { recordCashbookEntry } from "./cashbook.js";
import {
  hubtelPosConnection,requireHubtelPosConnection,hubtelPosPublicOrigin,posFail,
} from "./hubtel-pos-config.js";
import { HubtelCheckoutClient } from "../platform-admin/hubtel-checkout-client.js";
import { HubtelStatusClient } from "../platform-admin/hubtel-status-client.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SaleRow={id:string;business_id:string;branch_id:string;status:string;
  total_minor:string;currency_code:string;client_mutation_id:string;
  cashier_staff_id:string|null};
type PaymentRow={id:string;business_id:string;branch_id:string;sale_id:string;
  amount_minor:string;currency_code:string;method:string;status:string};
type AttemptRow={id:string;business_id:string;branch_id:string;sale_id:string;
  payment_id:string;client_reference:string;merchant_collection_account:string;
  expected_amount_minor:string;state:string;checkout_id:string|null;
  checkout_url:string|null;checkout_direct_url:string|null;
  verified_provider_transaction_id:string|null};

export interface SaleHubtelCheckout {
  attemptId:string;saleId:string;state:string;
  checkoutUrl:string|null;checkoutDirectUrl:string|null;
  amountMinor:number;
}
export interface SaleHubtelVerification {
  state:"PAID"|"UNPAID"|"REFUND_REVIEW";saleId:string;verifiedAt:string;
}
function requireId(id:string){if(!UUID.test(id))posFail("Invalid sale identifier.","HUBTEL_POS_ID_INVALID");}
export async function getHubtelPosReadiness(pool:DatabasePool,businessId:string){
  return {businessId,enabled:(await hubtelPosConnection(pool,businessId))!==null,
    notice:"Hubtel sales payments require a separately verified merchant collection account. A checkout request is never proof of payment."};
}
async function saleAndPayment(pool:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,
  businessId:string,saleId:string){
  const s=(await pool.query<SaleRow>(
    "SELECT id,business_id,branch_id,status,total_minor::text,currency_code,"+
    "client_mutation_id,cashier_staff_id FROM sales WHERE business_id=$1 AND id=$2",
    [businessId,saleId])).rows[0];
  if(!s)posFail("Sale was not found.","HUBTEL_POS_SALE_NOT_FOUND",404);
  const payments=await pool.query<PaymentRow>(
    "SELECT id,business_id,branch_id,sale_id,amount_minor::text,currency_code,"+
    "method,status FROM payments WHERE business_id=$1 AND sale_id=$2",
    [businessId,saleId]);
  return {sale:s,payments:payments.rows};
}
function assertSaleReady(s:SaleRow,payments:PaymentRow[]){
  if(s.status!=="OPEN"||s.currency_code!=="GHS"||
      !Number.isSafeInteger(Number(s.total_minor))||Number(s.total_minor)<=0||
      payments.length!==1||payments[0]?.status!=="PENDING"||
      payments[0]?.method!=="MOMO"||payments[0]?.currency_code!=="GHS"||
      payments[0]?.branch_id!==s.branch_id||
      payments[0]?.amount_minor!==s.total_minor) {
    posFail("Only a valid unsettled Hubtel MoMo sale can create a checkout.",
      "HUBTEL_POS_SALE_NOT_COLLECTIBLE",409);
  }
}
function asCheckout(r:AttemptRow):SaleHubtelCheckout {
  const openForPayment = r.state==="READY" || r.state==="PENDING_VERIFICATION";
  return {attemptId:r.id,saleId:r.sale_id,state:r.state,
    checkoutUrl:openForPayment?r.checkout_url:null,
    checkoutDirectUrl:openForPayment?r.checkout_direct_url:null,
    amountMinor:Number(r.expected_amount_minor)};
}
async function findAttempt(pool:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,
  businessId:string,saleId:string):Promise<AttemptRow|null>{
  const r=await pool.query<AttemptRow>(
    "SELECT id,business_id,branch_id,sale_id,payment_id,client_reference,"+
    "merchant_collection_account,expected_amount_minor::text,state,checkout_id,"+
    "checkout_url,checkout_direct_url,verified_provider_transaction_id "+
    "FROM hubtel_sale_checkout_attempts WHERE business_id=$1 AND sale_id=$2",
    [businessId,saleId]);
  return r.rows[0]??null;
}
export async function getSaleHubtelCheckout(
  pool:DatabasePool,businessId:string,saleId:string,
):Promise<SaleHubtelCheckout|null>{
  requireId(businessId);requireId(saleId);
  await saleAndPayment(pool,businessId,saleId);
  const attempt=await findAttempt(pool,businessId,saleId);
  return attempt?asCheckout(attempt):null;
}
export async function startSaleHubtelCheckout(
  pool:DatabasePool,input:{businessId:string;saleId:string;clientRequestId:string},
):Promise<SaleHubtelCheckout>{
  for(const value of [input.businessId,input.saleId,input.clientRequestId])requireId(value);
  const connection=await pool.connect();
  const lockKey=input.businessId+":"+input.saleId;
  let locked=false;
  try{
    await connection.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))",
      ["HUBTEL_POS_SALE",lockKey]);locked=true;
    const config=await requireHubtelPosConnection(connection,input.businessId);
    const {sale,payments}=await saleAndPayment(connection,input.businessId,input.saleId);
    const attempt=await findAttempt(connection,input.businessId,input.saleId);
    if(attempt){
      if(attempt.merchant_collection_account!==config.collectionAccount)
        posFail("Merchant account changed; checkout needs manual review.",
          "HUBTEL_POS_ACCOUNT_MISMATCH",409);
      if(attempt.state==="READY"||attempt.state==="PENDING_VERIFICATION"||
         attempt.state==="RECONCILED")return asCheckout(attempt);
      posFail("Prior payment checkout may already exist at Hubtel. Contact support before retrying.",
        "HUBTEL_POS_REVIEW_REQUIRED",409);
    }
    assertSaleReady(sale,payments);
    const reference="TSP-"+randomBytes(12).toString("hex");
    const row=(await connection.query<AttemptRow>(
      "INSERT INTO hubtel_sale_checkout_attempts "+
      "(business_id,branch_id,sale_id,payment_id,client_request_id,client_reference,"+
      "merchant_collection_account,expected_amount_minor,currency_code) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,'GHS') "+
      "RETURNING id,business_id,branch_id,sale_id,payment_id,client_reference,"+
      "merchant_collection_account,expected_amount_minor::text,state,checkout_id,"+
      "checkout_url,checkout_direct_url,verified_provider_transaction_id",
      [input.businessId,sale.branch_id,sale.id,payments[0]!.id,input.clientRequestId,
        reference,config.collectionAccount,sale.total_minor])).rows[0]!;
    const origin=hubtelPosPublicOrigin();
    const checkout=await new HubtelCheckoutClient({
      apiId:config.apiId,apiKey:config.apiKey,
      merchantAccountNumber:config.collectionAccount,publicOrigin:origin,
    }).initiate({
      clientReference:reference,amountMinor:Number(sale.total_minor),
      description:"TradeOS customer sale "+sale.id.slice(0,8),
      callbackUrl:origin+"/v1/payments/hubtel/notifications",
      returnUrl:origin+"/sales",
      cancellationUrl:origin+"/sales",
    });
    const updated=await connection.query<AttemptRow>(
      "UPDATE hubtel_sale_checkout_attempts SET state='READY',checkout_id=$2,"+
      "checkout_url=$3,checkout_direct_url=$4,updated_at=now() WHERE id=$1 "+
      "RETURNING id,business_id,branch_id,sale_id,payment_id,client_reference,"+
      "merchant_collection_account,expected_amount_minor::text,state,checkout_id,"+
      "checkout_url,checkout_direct_url,verified_provider_transaction_id",
      [row.id,checkout.checkoutId,checkout.checkoutUrl,checkout.checkoutDirectUrl],
    );
    return asCheckout(updated.rows[0]!);
  }finally{
    if(locked)await connection.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))",
      ["HUBTEL_POS_SALE",lockKey]).catch(()=>{});
    connection.release();
  }
}

export async function verifySaleHubtelCheckout(
  pool:DatabasePool,input:{businessId:string;saleId:string},
):Promise<SaleHubtelVerification>{
  requireId(input.businessId);requireId(input.saleId);
  const config=await requireHubtelPosConnection(pool,input.businessId);
  const attempt=await findAttempt(pool,input.businessId,input.saleId);
  if(!attempt)posFail("Hubtel checkout was not found.","HUBTEL_POS_CHECKOUT_NOT_FOUND",404);
  if(attempt.merchant_collection_account!==config.collectionAccount)
    posFail("Hubtel checkout account mismatch.","HUBTEL_POS_ACCOUNT_MISMATCH",409);
  if(!["READY","PENDING_VERIFICATION","RECONCILED","REVIEW_REQUIRED"].includes(attempt.state))
    posFail("Checkout needs manual review.","HUBTEL_POS_REVIEW_REQUIRED",409);

  const verified=await new HubtelStatusClient({
    apiId:config.apiId,apiKey:config.apiKey,collectionAccount:config.collectionAccount,
  }).verifyStatus({
    clientReference:attempt.client_reference,
    expectedAmountMinor:Number(attempt.expected_amount_minor),currencyCode:"GHS",
  });
  if(verified.status==="UNPAID"){
    await pool.query(
      "UPDATE hubtel_sale_checkout_attempts SET state='PENDING_VERIFICATION',"+
      "updated_at=now() WHERE id=$1 AND state IN ('READY','PENDING_VERIFICATION')",
      [attempt.id]);
    return {state:"UNPAID",saleId:attempt.sale_id,verifiedAt:verified.verifiedAt};
  }
  if(verified.status==="REFUNDED"){
    // A refund cannot be posted as a new sale payment. Reconcile separately.
    return {state:"REFUND_REVIEW",saleId:attempt.sale_id,verifiedAt:verified.verifiedAt};
  }

  return withTransaction(pool,async tx=>{
    // Lock in a stable order; no cashbook side effects on a second verification.
    const sale=(await tx.query<SaleRow>(
      "SELECT id,business_id,branch_id,status,total_minor::text,currency_code,"+
      "client_mutation_id,cashier_staff_id FROM sales "+
      "WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [input.businessId,input.saleId])).rows[0];
    const payment=(await tx.query<PaymentRow>(
      "SELECT id,business_id,branch_id,sale_id,amount_minor::text,currency_code,"+
      "method,status FROM payments WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [attempt.payment_id,input.businessId])).rows[0];
    const current=(await tx.query<AttemptRow>(
      "SELECT id,business_id,branch_id,sale_id,payment_id,client_reference,"+
      "merchant_collection_account,expected_amount_minor::text,state,checkout_id,"+
      "checkout_url,checkout_direct_url,verified_provider_transaction_id "+
      "FROM hubtel_sale_checkout_attempts WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [attempt.id,input.businessId])).rows[0];
    if(!sale||!payment||!current||current.payment_id!==payment.id||
       payment.sale_id!==sale.id||current.client_reference!==verified.clientReference||
       current.merchant_collection_account!==config.collectionAccount||
       Number(current.expected_amount_minor)!==Number(payment.amount_minor)||
       Number(payment.amount_minor)!==Number(sale.total_minor)||
       payment.branch_id!==sale.branch_id||sale.currency_code!=="GHS"){
      posFail("Hubtel verification does not match the owning sale.",
        "HUBTEL_POS_PAYMENT_MISMATCH",409);
    }
    if(current.state==="RECONCILED"){
      if(current.verified_provider_transaction_id!==verified.transactionId||
         payment.status!=="SUCCEEDED"||sale.status!=="COMPLETED") {
        posFail("Conflicting replay of provider confirmation.",
          "HUBTEL_POS_REPLAY_CONFLICT",409);
      }
      return {state:"PAID",saleId:sale.id,verifiedAt:verified.verifiedAt};
    }
    if(sale.status!=="OPEN"||payment.status!=="PENDING"||
       !["READY","PENDING_VERIFICATION","REVIEW_REQUIRED"].includes(current.state)){
      posFail("Payment cannot be reconciled in its current state.",
        "HUBTEL_POS_STATE_MISMATCH",409);
    }
    const occurredAt=verified.providerReportedAt??verified.verifiedAt;
    await tx.query(
      "UPDATE payments SET status='SUCCEEDED',provider_reference=$2,received_at=$3 WHERE id=$1",
      [payment.id,verified.transactionId,occurredAt],
    );
    await recordCashbookEntry(tx,{
      businessId:input.businessId,branchId:sale.branch_id,
      currencyCode:"GHS",method:"MOMO",amountDeltaMinor:Number(payment.amount_minor),
      entryType:"SALE_RECEIPT",sourceType:"PAYMENT",sourceId:payment.id,
      actorStaffId:sale.cashier_staff_id,idempotencyKey:"sale-payment:"+payment.id,
      occurredAt,
    });
    await tx.query(
      "UPDATE sales SET status='COMPLETED',completed_at=$2 WHERE id=$1",
      [sale.id,occurredAt],
    );
    await tx.query(
      "UPDATE hubtel_sale_checkout_attempts SET state='RECONCILED',"+
      "verified_provider_transaction_id=$2,verified_at=now(),updated_at=now() WHERE id=$1",
      [current.id,verified.transactionId],
    );
    await tx.query(
      "INSERT INTO audit_events(business_id,branch_id,actor_staff_id,event_type,"+
      "entity_type,entity_id,correlation_id,payload,occurred_at) "+
      "VALUES($1,$2,$3,'HUBTEL_SALE_PAYMENT_VERIFIED','SALE',$4,$5,$6::jsonb,$7)",
      [input.businessId,sale.branch_id,sale.cashier_staff_id,sale.id,current.client_reference,
        JSON.stringify({paymentId:payment.id,providerTransactionId:verified.transactionId,
          amountMinor:Number(payment.amount_minor)}),occurredAt],
    );
    await tx.query(
      "INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,"+
      "event_type,payload,occurred_at) VALUES($1,$2,'SALE',$3,'SALE_COMPLETED',$4::jsonb,$5)",
      [input.businessId,sale.branch_id,sale.id,
        JSON.stringify({saleId:sale.id,totalMinor:Number(sale.total_minor),
          verifiedProvider:"HUBTEL"}),occurredAt],
    );
    return {state:"PAID",saleId:sale.id,verifiedAt:verified.verifiedAt};
  });
}
