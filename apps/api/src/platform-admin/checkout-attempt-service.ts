import { randomBytes } from "node:crypto";
import type { DatabaseClient,DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERCHANT_ACCOUNT=/^[0-9]{3,32}$/;

type InvoiceRow={
  id:string;status:string;currency_code:string;
  total_minor:string;amount_paid_minor:string;
};
type AttemptRow={
  id:string;business_id:string;invoice_id:string;client_request_id:string;
  client_reference:string;merchant_account_number:string;
  expected_amount_minor:string;currency_code:string;state:CheckoutAttempt["state"];
  checkout_id:string|null;checkout_url:string|null;checkout_direct_url:string|null;
  checkout_created_at:Date|null;next_verify_at:Date|null;
  created_at:Date;
};

export type CheckoutAttempt={
  id:string;
  businessId:string;
  invoiceId:string;
  clientRequestId:string;
  clientReference:string;
  merchantAccountNumber:string;
  expectedAmountMinor:number;
  currencyCode:"GHS";
  state:"PREPARED"|"READY"|"PENDING_VERIFICATION"|"RECONCILED"|"FAILED"|"CANCELED";
  checkoutId:string|null;
  checkoutUrl:string|null;
  checkoutDirectUrl:string|null;
  checkoutCreatedAt:string|null;
  nextVerifyAt:string|null;
  createdAt:string;
};

export class CheckoutAttemptError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode:number) {
    super(message);
    this.name="CheckoutAttemptError";
  }
}
function minor(s:string):number {
  const n=Number(s);
  if(!Number.isSafeInteger(n))throw new CheckoutAttemptError(
    "Subscription invoice amount is outside the safe monetary range.","CHECKOUT_AMOUNT_INVALID",409);
  return n;
}
function serialize(r:AttemptRow):CheckoutAttempt {
  return {
    id:r.id,businessId:r.business_id,invoiceId:r.invoice_id,
    clientRequestId:r.client_request_id,clientReference:r.client_reference,
    merchantAccountNumber:r.merchant_account_number,
    expectedAmountMinor:minor(r.expected_amount_minor),currencyCode:"GHS",
    state:r.state,checkoutId:r.checkout_id,checkoutUrl:r.checkout_url,
    checkoutDirectUrl:r.checkout_direct_url,
    checkoutCreatedAt:r.checkout_created_at?.toISOString()??null,
    nextVerifyAt:r.next_verify_at?.toISOString()??null,
    createdAt:r.created_at.toISOString(),
  };
}
const COLS="id,business_id,invoice_id,client_request_id,client_reference,"+
  "merchant_account_number,expected_amount_minor::text,currency_code,state,"+
  "checkout_id,checkout_url,checkout_direct_url,checkout_created_at,next_verify_at,created_at";

async function lockInvoice(
  tx:DatabaseClient,businessId:string,invoiceId:string,
):Promise<InvoiceRow> {
  const res=await tx.query<InvoiceRow>(
    "SELECT id,status,currency_code,total_minor::text,amount_paid_minor::text "+
    "FROM subscription_invoices WHERE business_id=$1 AND id=$2 FOR UPDATE",
    [businessId,invoiceId],
  );
  if(!res.rows[0])throw new CheckoutAttemptError(
    "Subscription invoice was not found.","CHECKOUT_INVOICE_NOT_FOUND",404);
  return res.rows[0];
}

/**
 * Prepare the non-economic attempt before any call to the provider.
 * A locked invoice serializes competing attempts. A stable clientRequestId
 * guarantees that a retried request does not create a second checkout.
 */
export async function prepareSubscriptionCheckoutAttempt(
  pool:DatabasePool,input:{
    businessId:string;invoiceId:string;clientRequestId:string;merchantAccountNumber:string;
  },
):Promise<CheckoutAttempt> {
  if(!UUID.test(input.businessId) || !UUID.test(input.invoiceId) ||
      !UUID.test(input.clientRequestId) || !MERCHANT_ACCOUNT.test(input.merchantAccountNumber)) {
    throw new CheckoutAttemptError("Invalid checkout preparation request.",
      "CHECKOUT_PREPARE_INVALID",400);
  }
  return withTransaction(pool,async(tx)=>{
    const invoice=await lockInvoice(tx,input.businessId,input.invoiceId);
    const previous=await tx.query<AttemptRow>(
      "SELECT "+COLS+" FROM subscription_checkout_attempts "+
      "WHERE business_id=$1 AND client_request_id=$2 FOR UPDATE",
      [input.businessId,input.clientRequestId],
    );
    const match=previous.rows[0];
    if(match){
      if(match.invoice_id!==input.invoiceId ||
        match.merchant_account_number!==input.merchantAccountNumber) {
        throw new CheckoutAttemptError(
          "Checkout idempotency key was used for a different invoice.",
          "CHECKOUT_IDEMPOTENCY_CONFLICT",409);
      }
      return serialize(match);
    }
    if(!["OPEN","PARTIALLY_PAID"].includes(invoice.status) || invoice.currency_code!=="GHS") {
      throw new CheckoutAttemptError(
        "Invoice cannot be collected with Hubtel in its current state.",
        "CHECKOUT_INVOICE_UNCOLLECTIBLE",409);
    }
    const outstanding=minor(invoice.total_minor)-minor(invoice.amount_paid_minor);
    if(!Number.isSafeInteger(outstanding)||outstanding<=0) {
      throw new CheckoutAttemptError("Invoice has no valid outstanding balance.",
        "CHECKOUT_AMOUNT_INVALID",409);
    }
    const active=await tx.query(
      "SELECT id FROM subscription_checkout_attempts WHERE invoice_id=$1 "+
      "AND state IN ('PREPARED','READY','PENDING_VERIFICATION') LIMIT 1",
      [input.invoiceId],
    );
    if(active.rows.length) {
      throw new CheckoutAttemptError(
        "An existing checkout must be verified or closed before another is created.",
        "CHECKOUT_ALREADY_OPEN",409);
    }
    const clientReference="TOS-"+randomBytes(12).toString("hex");
    const res=await tx.query<AttemptRow>(
      "INSERT INTO subscription_checkout_attempts "+
      "(business_id,invoice_id,client_request_id,client_reference,"+
      "merchant_account_number,expected_amount_minor,currency_code) "+
      "VALUES($1,$2,$3,$4,$5,$6,'GHS') RETURNING "+COLS,
      [input.businessId,input.invoiceId,input.clientRequestId,
        clientReference,input.merchantAccountNumber,outstanding],
    );
    return serialize(res.rows[0]!);
  });
}

function checkoutUrl(value:string):string {
  let url:URL;
  try{url=new URL(value)}catch{
    throw new CheckoutAttemptError("Provider checkout URL is invalid.",
      "CHECKOUT_PROVIDER_RESPONSE_INVALID",502);
  }
  if(url.protocol!=="https:" || url.hostname!=="pay.hubtel.com" ||
     url.port!=="" || url.username || url.password || url.hash ||
     url.pathname==="/" || url.pathname.startsWith("//")) {
    throw new CheckoutAttemptError("Provider checkout destination was not trusted.",
      "CHECKOUT_PROVIDER_RESPONSE_INVALID",502);
  }
  return url.toString();
}

/**
 * Saves provider-created checkout links without posting a payment.
 * Only call with the separately verified Hubtel checkout adapter response.
 */
export async function recordCreatedSubscriptionCheckout(
  pool:DatabasePool,input:{
    businessId:string;attemptId:string;clientReference:string;
    checkoutId:string;checkoutUrl:string;checkoutDirectUrl:string;
  },
):Promise<CheckoutAttempt> {
  if(!UUID.test(input.businessId)||!UUID.test(input.attemptId)||
    !/^[A-Za-z0-9-]{8,100}$/.test(input.checkoutId)) {
    throw new CheckoutAttemptError("Provider checkout identity is invalid.",
      "CHECKOUT_PROVIDER_RESPONSE_INVALID",400);
  }
  const url=checkoutUrl(input.checkoutUrl);
  const direct=checkoutUrl(input.checkoutDirectUrl);
  return withTransaction(pool,async(tx)=>{
    const found=await tx.query<AttemptRow>(
      "SELECT "+COLS+" FROM subscription_checkout_attempts "+
      "WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [input.businessId,input.attemptId],
    );
    const existing=found.rows[0];
    if(!existing)throw new CheckoutAttemptError(
      "Checkout attempt was not found.","CHECKOUT_NOT_FOUND",404);
    if(existing.client_reference!==input.clientReference){
      throw new CheckoutAttemptError(
        "Provider reference does not match the prepared attempt.",
        "CHECKOUT_PROVIDER_REFERENCE_MISMATCH",409);
    }
    if(existing.state==="READY"){
      if(existing.checkout_id===input.checkoutId && existing.checkout_url===url &&
         existing.checkout_direct_url===direct) return serialize(existing);
      throw new CheckoutAttemptError(
        "This checkout already has different provider information.",
        "CHECKOUT_PROVIDER_IDEMPOTENCY_CONFLICT",409);
    }
    if(existing.state!=="PREPARED"){
      throw new CheckoutAttemptError("Checkout cannot be modified in this state.",
        "CHECKOUT_TRANSITION_FORBIDDEN",409);
    }
    const res=await tx.query<AttemptRow>(
      "UPDATE subscription_checkout_attempts SET state='READY',checkout_id=$3,"+
      "checkout_url=$4,checkout_direct_url=$5,checkout_created_at=now(),"+
      "next_verify_at=now()+interval '5 minutes',updated_at=now() "+
      "WHERE business_id=$1 AND id=$2 RETURNING "+COLS,
      [input.businessId,input.attemptId,input.checkoutId,url,direct],
    );
    return serialize(res.rows[0]!);
  });
}
