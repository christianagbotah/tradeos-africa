import type { DatabasePool } from "../db.js";
import {
  prepareSubscriptionCheckoutAttempt,recordCreatedSubscriptionCheckout,
  type CheckoutAttempt,CheckoutAttemptError,
} from "../platform-admin/checkout-attempt-service.js";
import { HubtelCheckoutClient,HubtelCheckoutError } from "../platform-admin/hubtel-checkout-client.js";
import { HubtelStatusClient,HubtelStatusError } from "../platform-admin/hubtel-status-client.js";
import { recordProviderPayment } from "../platform-admin/billing-service.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN="https://tradeosafrica.lightworldtech.com";
type LockedAttempt={id:string;business_id:string;invoice_id:string;client_reference:string;
  merchant_account_number:string;expected_amount_minor:string;state:CheckoutAttempt["state"];};
export class HubtelCollectionError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode:number){
    super(message);this.name="HubtelCollectionError";
  }
}
function invalid(message:string,code:string,statusCode=400):never{
  throw new HubtelCollectionError(message,code,statusCode);
}
function config(){
  const enabled=process.env.TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED==="true";
  const apiId=process.env.TRADEOS_HUBTEL_API_ID?.trim();
  const apiKey=process.env.TRADEOS_HUBTEL_API_KEY?.trim();
  const account=process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT?.trim();
  if(!enabled||!apiId||!apiKey||!account||!/^[0-9]{3,32}$/.test(account)){
    return null;
  }
  return {apiId,apiKey,account};
}
export function hubtelSubscriptionCollectionEnabled():boolean{
  return config()!==null;
}

export async function createSubscriptionCheckout(
  pool:DatabasePool,input:{businessId:string;invoiceId:string;clientRequestId:string},
):Promise<CheckoutAttempt>{
  const c=config();
  if(!c)invalid("Online collection is not configured for this TradeOS release.",
    "HUBTEL_COLLECTION_DISABLED",503);
  if(!UUID.test(input.businessId)||!UUID.test(input.invoiceId)||!UUID.test(input.clientRequestId)){
    invalid("Valid billing references are required.","HUBTEL_COLLECTION_REQUEST_INVALID");
  }

  // This advisory lock spans the provider HTTP call, avoiding duplicate
  // provider checkouts across API workers (not merely one JS process).
  const lock=await pool.connect();
  const lockKey=input.businessId+":"+input.invoiceId;
  let locked=false;
  try{
    await lock.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))",
      ["HUBTEL_SUBSCRIPTION_CHECKOUT",lockKey]);
    locked=true;
    const existing=await pool.query<{id:string;state:CheckoutAttempt["state"]}>(
      "SELECT id,state FROM subscription_checkout_attempts WHERE business_id=$1 AND client_request_id=$2",
      [input.businessId,input.clientRequestId]);
    const previous=existing.rows[0];
    if(previous?.state==="PREPARED"){
      // A previous network request may have succeeded without a response.
      // Retrying it could duplicate the customer's payment intent.
      invalid("A previous checkout request has an unknown provider outcome. Contact billing support.",
        "HUBTEL_CHECKOUT_REVIEW_REQUIRED",409);
    }
    const prepared=await prepareSubscriptionCheckoutAttempt(pool,{
      ...input,merchantAccountNumber:c.account,
    });
    if(prepared.state==="READY"||prepared.state==="PENDING_VERIFICATION"||
       prepared.state==="RECONCILED") return prepared;
    if(prepared.state!=="PREPARED") {
      invalid("This checkout is not available.","HUBTEL_CHECKOUT_NOT_AVAILABLE",409);
    }
    const provider=new HubtelCheckoutClient({
      apiId:c.apiId,apiKey:c.apiKey,merchantAccountNumber:c.account,
      publicOrigin:ORIGIN,
    });
    // URLs are fixed by the server, not controlled by the customer.
    const checkout=await provider.initiate({
      clientReference:prepared.clientReference,
      amountMinor:prepared.expectedAmountMinor,
      description:"TradeOS subscription invoice "+input.invoiceId.slice(0,8),
      callbackUrl:ORIGIN+"/v1/billing/hubtel/callback",
      returnUrl:ORIGIN+"/settings",
      cancellationUrl:ORIGIN+"/settings",
    });
    return await recordCreatedSubscriptionCheckout(pool,{
      businessId:prepared.businessId,attemptId:prepared.id,
      clientReference:checkout.clientReference,checkoutId:checkout.checkoutId,
      checkoutUrl:checkout.checkoutUrl,checkoutDirectUrl:checkout.checkoutDirectUrl,
    });
  }finally{
    if(locked)await lock.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))",
      ["HUBTEL_SUBSCRIPTION_CHECKOUT",lockKey]).catch(()=>{});
    lock.release();
  }
}

export async function verifySubscriptionCheckout(
  pool:DatabasePool,businessId:string,attemptId:string,
):Promise<{state:string;status:string;verifiedAt:string}>{
  const c=config();
  if(!c)invalid("Hubtel collections are not configured.","HUBTEL_COLLECTION_DISABLED",503);
  if(!UUID.test(businessId)||!UUID.test(attemptId)){
    invalid("Checkout reference is invalid.","HUBTEL_CHECKOUT_INVALID",400);
  }
  const result=await pool.query<LockedAttempt>(
    "SELECT id,business_id,invoice_id,client_reference,merchant_account_number,"+
    "expected_amount_minor::text,state FROM subscription_checkout_attempts "+
    "WHERE business_id=$1 AND id=$2",
    [businessId,attemptId]);
  const attempt=result.rows[0];
  if(!attempt)invalid("Checkout was not found.","HUBTEL_CHECKOUT_NOT_FOUND",404);
  if(attempt.merchant_account_number!==c.account){
    invalid("Checkout belongs to a different configured merchant account.",
      "HUBTEL_ACCOUNT_MISMATCH",409);
  }
  if(!["READY","PENDING_VERIFICATION","RECONCILED"].includes(attempt.state)){
    invalid("Checkout is not ready for verification.","HUBTEL_CHECKOUT_NOT_READY",409);
  }
  const expectedAmountMinor=Number(attempt.expected_amount_minor);
  const provider=new HubtelStatusClient({apiId:c.apiId,apiKey:c.apiKey,collectionAccount:c.account});
  const confirmed=await provider.verifyStatus({
    clientReference:attempt.client_reference,expectedAmountMinor,currencyCode:"GHS",
  });
  if(confirmed.status==="PAID"){
    await recordProviderPayment(pool,{
      businessId,invoiceId:attempt.invoice_id,amountMinor:expectedAmountMinor,
      currencyCode:"GHS",method:"HUBTEL_CHECKOUT",provider:"HUBTEL",
      providerEventReference:attempt.client_reference,
      providerTransactionReference:confirmed.transactionId!,
      status:"SUCCEEDED",receivedAt:confirmed.providerReportedAt??confirmed.verifiedAt,
    });
    await pool.query(
      "UPDATE subscription_checkout_attempts SET state='RECONCILED',"+
      "last_verified_at=now(),next_verify_at=NULL,updated_at=now() "+
      "WHERE id=$1 AND business_id=$2 AND state IN ('READY','PENDING_VERIFICATION','RECONCILED')",
      [attemptId,businessId],
    );
    return {state:"RECONCILED",status:"PAID",verifiedAt:confirmed.verifiedAt};
  }
  if(confirmed.status==="REFUNDED"){
    // Provider refund requires a separately verified, linked refund event.
    // Never silently reverse TradeOS entitlements based on unsigned callback.
    return {state:"REQUIRES_REFUND_RECONCILIATION",status:"REFUNDED",
      verifiedAt:confirmed.verifiedAt};
  }
  await pool.query(
    "UPDATE subscription_checkout_attempts SET state='PENDING_VERIFICATION',"+
    "last_verified_at=now(),next_verify_at=now()+interval '5 minutes',updated_at=now() "+
    "WHERE id=$1 AND business_id=$2 AND state IN ('READY','PENDING_VERIFICATION')",
    [attemptId,businessId],
  );
  return {state:"PENDING_VERIFICATION",status:"UNPAID",verifiedAt:confirmed.verifiedAt};
}
export { HubtelCheckoutError,HubtelStatusError,CheckoutAttemptError };
