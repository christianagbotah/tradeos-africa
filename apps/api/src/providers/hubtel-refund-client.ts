/**
 * Hubtel order-level MoMo refund adapter, based on the 2026-10-12 reference.
 * No ledger writes: an accepted 0001 refund is PENDING, not successful.
 * The documented endpoint accepts orderId + callbackUrl, NOT partial amount.
 */
export interface HubtelRefundInput {
  orderId: string;
  originalPaidAt: string;
  originalPaymentAmountMinor: number;
  requestedRefundAmountMinor: number;
  verifiedOriginalPayment: boolean;
  callbackUrl: string;
}
export interface HubtelRefundClientOptions {
  apiId: string; apiKey: string; collectionAccount: string;
  publicOrigin: string; fetchImpl?: typeof fetch; now?: () => Date;
}
export interface HubtelRefundPending {
  state: "REFUND_PENDING_UNVERIFIED"; orderId: string;
}
export class HubtelRefundError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message); this.name = "HubtelRefundError";
  }
}
const ORDER = /^[A-Za-z0-9_-]{8,100}$/;
const ACCOUNT = /^[0-9]{3,32}$/;
const HOST = "https://refund-api.hubtel.com";
function fail(message:string,code:string,statusCode=400):never {
  throw new HubtelRefundError(message,code,statusCode);
}
function record(v:unknown):v is Record<string,unknown> {
  return typeof v==="object" && v!==null && !Array.isArray(v);
}
export function validateHubtelRefund(
  input:HubtelRefundInput, account:string, publicOrigin:string, now:Date,
):{orderId:string;callbackUrl:string} {
  if(!ACCOUNT.test(account)) fail("Invalid Hubtel collection account.","HUBTEL_REFUND_CONFIG_INVALID",503);
  if(!ORDER.test(input.orderId)) fail("Verified Hubtel order ID required.","HUBTEL_REFUND_ORDER_INVALID");
  if(input.verifiedOriginalPayment!==true) fail("Original payment must be verified.",
    "HUBTEL_REFUND_PAYMENT_UNVERIFIED",409);
  // Hubtel's full-order endpoint cannot represent a partial refund.
  if(!Number.isSafeInteger(input.originalPaymentAmountMinor) ||
      !Number.isSafeInteger(input.requestedRefundAmountMinor) ||
      input.originalPaymentAmountMinor < 100 ||
      input.originalPaymentAmountMinor !== input.requestedRefundAmountMinor) {
    fail("Hubtel full-order refunds require at least ₵1.00. Partial amounts are unsupported.",
      "HUBTEL_REFUND_FULL_ORDER_ONLY",409);
  }
  const delta=now.getTime()-Date.parse(input.originalPaidAt);
  if(!Number.isFinite(delta)||delta<0||delta>45*86400000) {
    fail("Hubtel refunds are limited to 45 days after the original payment.",
      "HUBTEL_REFUND_WINDOW_EXPIRED",409);
  }
  let origin:URL,callback:URL;
  try{origin=new URL(publicOrigin);callback=new URL(input.callbackUrl);}
  catch{return fail("Invalid refund callback URL.","HUBTEL_REFUND_CALLBACK_INVALID");}
  if(origin.protocol!=="https:"||origin.pathname!=="/"||origin.search||origin.hash||
      origin.username||origin.password||origin.port||origin.hostname==="localhost"||
      callback.protocol!=="https:"||callback.origin!==origin.origin||
      callback.pathname==="/"||callback.pathname.startsWith("//")||
      callback.username||callback.password||callback.hash) {
    fail("Refund callback must be a secure same-origin URL.","HUBTEL_REFUND_CALLBACK_INVALID");
  }
  return {orderId:input.orderId,callbackUrl:callback.toString()};
}
export function parseHubtelRefundPending(
  payload:unknown,orderId:string,
):HubtelRefundPending {
  if(!record(payload)||payload.responseCode!=="0001"||
      !record(payload.data)||payload.data.orderId!==orderId) {
    fail("Refund acceptance could not be verified.","HUBTEL_REFUND_RESPONSE_INVALID",502);
  }
  return {state:"REFUND_PENDING_UNVERIFIED",orderId};
}
export class HubtelRefundClient {
  private readonly fetchImpl:typeof fetch;
  private readonly now:()=>Date;
  constructor(private readonly options:HubtelRefundClientOptions) {
    if(!options.apiId?.trim()||!options.apiKey?.trim()||options.apiId.includes(":")||
        /[\r\n]/.test(options.apiId+options.apiKey)) {
      fail("Hubtel refund credentials are not configured.","HUBTEL_REFUND_CONFIG_INVALID",503);
    }
    this.fetchImpl=options.fetchImpl??fetch;
    this.now=options.now??(()=>new Date());
  }
  /**
   * Caller must independently enforce authenticated owner consent, tenant scope,
   * exclusive order-level idempotency, and original-payment verification.
   * Never call this from a callback or directly from a browser.
   */
  async requestRefund(input:HubtelRefundInput):Promise<HubtelRefundPending> {
    const valid=validateHubtelRefund(input,this.options.collectionAccount,
      this.options.publicOrigin,this.now());
    const url=HOST+"/refund/"+encodeURIComponent(this.options.collectionAccount)+
      "/order/"+encodeURIComponent(valid.orderId);
    let response:Response;
    try{
      response=await this.fetchImpl(url,{
        method:"POST",
        headers:{
          "content-type":"application/json",accept:"application/json",
          authorization:"Basic "+Buffer.from(this.options.apiId+":"+this.options.apiKey).toString("base64"),
        },
        body:JSON.stringify({callbackUrl:valid.callbackUrl}),
        signal:AbortSignal.timeout(10000),
      });
    }catch{
      fail("Refund outcome unknown. Verify the original order before retrying.",
        "HUBTEL_REFUND_OUTCOME_UNKNOWN",503);
    }
    if(!response.ok){
      fail("Hubtel did not accept the refund request. Check the order before retrying.",
        "HUBTEL_REFUND_NOT_ACCEPTED",response.status>=500?503:502);
    }
    let data:unknown;
    try{data=await response.json();}
    catch{return fail("Hubtel returned unreadable refund data.","HUBTEL_REFUND_RESPONSE_INVALID",502);}
    return parseHubtelRefundPending(data,valid.orderId);
  }
}
