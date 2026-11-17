/** Server-only, unactivated merchant gateway adapters.
 * These clients NEVER post to the TradeOS ledger or issue receipts. Callers
 * must preserve a provider-scoped attempt and settle only after server-side
 * verification of reference, amount, currency, method, and merchant identity.
 */
import {getCurrencyMeta} from "@tradeos/contracts";

export type GatewayTender="MOMO"|"CARD";
export type GatewayRequest={
  reference:string;amountMinor:number;currencyCode:string;
  customerEmail:string;returnUrl:string;method:GatewayTender;
};
export type GatewayCheckout={reference:string;checkoutUrl:string};
export type GatewayVerification={
  status:"PAID"|"UNPAID";reference:string;currencyCode:string;
  amountMinor:number|null;method:GatewayTender|null;transactionId:string|null;
};
export class GatewayAdapterError extends Error{
  constructor(message:string,readonly code:string,readonly statusCode=502){
    super(message);this.name="GatewayAdapterError";
  }
}
const REFERENCE=/^[A-Za-z0-9_-]{4,36}$/;
const CURRENCY=/^[A-Z]{3}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isObject=(x:unknown):x is Record<string,unknown>=>
  typeof x==="object"&&x!==null&&!Array.isArray(x);
function validateRequest(input:GatewayRequest):void{
  if(!REFERENCE.test(input.reference)||!Number.isSafeInteger(input.amountMinor)||
    input.amountMinor<=0||!CURRENCY.test(input.currencyCode)||
    !getCurrencyMeta(input.currencyCode)||
    !EMAIL.test(input.customerEmail)||!["MOMO","CARD"].includes(input.method)){
    throw new GatewayAdapterError("Invalid payment request.","GATEWAY_REQUEST_INVALID",400);
  }
  try{
    const url=new URL(input.returnUrl);
    if(url.protocol!=="https:"||
       url.hostname!=="tradeosafrica.lightworldtech.com"||
       url.username||url.password||url.hash||
       url.port)throw new Error("Unsafe URL");
  }catch{throw new GatewayAdapterError("Invalid return URL.",
    "GATEWAY_RETURN_URL_INVALID",400);}
}
function secretValid(secret:string):boolean{
  return secret.length>=12&&!/[\r\n]/.test(secret);
}
function trustedCheckout(url:unknown,hosts:readonly string[]):string{
  try{
    if(typeof url!=="string")throw new Error("Missing");
    const parsed=new URL(url);
    if(parsed.protocol!=="https:"||!hosts.includes(parsed.hostname)||parsed.port||
       parsed.username||parsed.password||parsed.hash)throw new Error("Unsafe");
    return parsed.toString();
  }catch{throw new GatewayAdapterError("Untrusted payment checkout link.",
    "GATEWAY_CHECKOUT_URL_INVALID");}
}
async function getJson(response:Response):Promise<Record<string,unknown>>{
  if(!response.ok)throw new GatewayAdapterError(
    response.status===401||response.status===403?
      "Payment provider credentials or merchant scope were rejected.":
      "Payment provider is temporarily unavailable.",
    response.status===401||response.status===403?"GATEWAY_NOT_AUTHORIZED":
      "GATEWAY_UNAVAILABLE",503);
  let data:unknown;
  try{data=await response.json();}catch{
    throw new GatewayAdapterError("Unreadable provider response.","GATEWAY_RESPONSE_INVALID");
  }
  if(!isObject(data))throw new GatewayAdapterError(
    "Provider response format was invalid.","GATEWAY_RESPONSE_INVALID");
  return data;
}
async function send(fetchImpl:typeof fetch,url:string,secret:string,
  method:"GET"|"POST",body?:unknown){
  let response:Response;
  try{response=await fetchImpl(url,{
    method,headers:{authorization:"Bearer "+secret,accept:"application/json",
      ...(method==="POST"?{"content-type":"application/json"}:{})},
    ...(method==="POST"?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(12000),
  });}catch{throw new GatewayAdapterError(
    "Could not reach payment provider.","GATEWAY_UNAVAILABLE",503);}
  return getJson(response);
}
function moneyMajor(amount:unknown,currencyCode:string):number|null{
  const exponent=getCurrencyMeta(currencyCode)?.exponent;
  if(exponent===undefined||typeof amount!=="number"||
     !Number.isFinite(amount)||amount<0)return null;
  const raw=amount*(10**exponent);
  const minor=Math.round(raw);
  return Number.isSafeInteger(minor)&&Math.abs(raw-minor)<0.000001?minor:null;
}
function matchPaid(input:GatewayRequest,output:GatewayVerification):GatewayVerification{
  if(output.reference!==input.reference||output.currencyCode!==input.currencyCode||
     output.amountMinor!==input.amountMinor||output.method!==input.method||
     !output.transactionId){
    throw new GatewayAdapterError(
      "Verified transaction differs from the requested sale. Review is required.",
      "GATEWAY_VERIFICATION_MISMATCH",409);
  }
  return output;
}
function safeId(value:unknown):string|null{
  if(typeof value==="number"&&Number.isSafeInteger(value)&&value>0)return String(value);
  if(typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value))return value;
  return null;
}
export class PaystackHostedAdapter{
  constructor(private readonly secret:string,
    private readonly fetchImpl:typeof fetch=fetch){
    if(!secretValid(secret))throw new GatewayAdapterError(
      "Paystack credentials are not configured.","GATEWAY_CONFIG_INVALID",503);
  }
  async initialize(input:GatewayRequest):Promise<GatewayCheckout>{
    validateRequest(input);
    if(getCurrencyMeta(input.currencyCode)?.exponent!==2)
      throw new GatewayAdapterError(
        "This Paystack currency requires a verified subunit policy.",
        "GATEWAY_CURRENCY_UNSUPPORTED",422);
    // Paystack requires an email for hosted checkout and charges in subunits.
    const result=await send(this.fetchImpl,
      "https://api.paystack.co/transaction/initialize",this.secret,"POST",{
        reference:input.reference,amount:input.amountMinor,currency:input.currencyCode,
        email:input.customerEmail,callback_url:input.returnUrl,
        channels:[input.method==="MOMO"?"mobile_money":"card"],
      });
    const data=result.data;
    if(result.status!==true||!isObject(data)||
       data.reference!==input.reference)throw new GatewayAdapterError(
      "Paystack did not acknowledge the expected checkout.",
      "GATEWAY_INITIATION_INVALID");
    return {reference:input.reference,
      checkoutUrl:trustedCheckout(data.authorization_url,["checkout.paystack.com"])};
  }
  async verify(input:GatewayRequest):Promise<GatewayVerification>{
    validateRequest(input);
    if(getCurrencyMeta(input.currencyCode)?.exponent!==2)
      throw new GatewayAdapterError(
        "This Paystack currency requires a verified subunit policy.",
        "GATEWAY_CURRENCY_UNSUPPORTED",422);
    const result=await send(this.fetchImpl,
      "https://api.paystack.co/transaction/verify/"+
        encodeURIComponent(input.reference),this.secret,"GET");
    if(result.status!==true||!isObject(result.data))throw new GatewayAdapterError(
      "Paystack verification was not conclusive.","GATEWAY_VERIFICATION_INVALID");
    const data=result.data;
    if(data.reference!==input.reference)throw new GatewayAdapterError(
      "Paystack reference mismatch.","GATEWAY_VERIFICATION_MISMATCH",409);
    if(data.status!=="success")return {
      status:"UNPAID",reference:input.reference,
      currencyCode:input.currencyCode,amountMinor:null,method:null,transactionId:null};
    const verified:GatewayVerification={
      status:"PAID",reference:input.reference,currencyCode:String(data.currency??""),
      amountMinor:typeof data.amount==="number"&&Number.isSafeInteger(data.amount)?
        data.amount:null,
      method:data.channel==="card"?"CARD":data.channel==="mobile_money"?"MOMO":null,
      transactionId:safeId(data.id),
    };
    return matchPaid(input,verified);
  }
}
const FLUTTERWAVE_MOMO:Readonly<Record<string,string>>={
  GHS:"mobilemoneyghana",KES:"mpesa",UGX:"mobilemoneyuganda",
  RWF:"mobilemoneyrwanda",TZS:"mobilemoneytanzania",
  ZMW:"mobilemoneyzambia",XOF:"mobilemoneyxof",XAF:"mobilemoneyxaf",
};
export class FlutterwaveHostedAdapter{
  constructor(private readonly secret:string,
    private readonly fetchImpl:typeof fetch=fetch){
    if(!secretValid(secret))throw new GatewayAdapterError(
      "Flutterwave credentials are not configured.","GATEWAY_CONFIG_INVALID",503);
  }
  async initialize(input:GatewayRequest):Promise<GatewayCheckout>{
    validateRequest(input);
    const choice=input.method==="CARD"?"card":FLUTTERWAVE_MOMO[input.currencyCode];
    if(!choice)throw new GatewayAdapterError(
      "Mobile money is not configured for that currency.","GATEWAY_METHOD_UNSUPPORTED",422);
    const exponent=getCurrencyMeta(input.currencyCode)!.exponent;
    const result=await send(this.fetchImpl,
      "https://api.flutterwave.com/v3/payments",this.secret,"POST",{
        tx_ref:input.reference,
        amount:(input.amountMinor/(10**exponent)).toFixed(exponent),
        currency:input.currencyCode,redirect_url:input.returnUrl,
        customer:{email:input.customerEmail},payment_options:choice,
      });
    if(result.status!=="success"||!isObject(result.data)){
      throw new GatewayAdapterError("Flutterwave checkout was not confirmed.",
        "GATEWAY_INITIATION_INVALID");
    }
    return {reference:input.reference,
      checkoutUrl:trustedCheckout(result.data.link,["checkout.flutterwave.com"])};
  }
  async verify(input:GatewayRequest,providerTransactionId:string):Promise<GatewayVerification>{
    validateRequest(input);
    if(!/^[1-9][0-9]{0,15}$/.test(providerTransactionId))throw new GatewayAdapterError(
      "Invalid provider transaction reference.","GATEWAY_TRANSACTION_INVALID",400);
    const result=await send(this.fetchImpl,
      "https://api.flutterwave.com/v3/transactions/"+
        encodeURIComponent(providerTransactionId)+"/verify",this.secret,"GET");
    if(result.status!=="success"||!isObject(result.data)){
      throw new GatewayAdapterError("Flutterwave verification was not conclusive.",
        "GATEWAY_VERIFICATION_INVALID");
    }
    const data=result.data;
    if(data.tx_ref!==input.reference)throw new GatewayAdapterError(
      "Flutterwave reference mismatch.","GATEWAY_VERIFICATION_MISMATCH",409);
    if(data.status!=="successful")return {
      status:"UNPAID",reference:input.reference,currencyCode:input.currencyCode,
      amountMinor:null,method:null,transactionId:null};
    const channel=typeof data.payment_type==="string"?
      data.payment_type.toLowerCase():null;
    const verified:GatewayVerification={
      status:"PAID",reference:input.reference,currencyCode:String(data.currency??""),
      amountMinor:moneyMajor(data.amount,input.currencyCode),
      method:channel==="card"?"CARD":
        (channel!==null&&(
          channel.startsWith("mobilemoney")||channel==="mpesa"))?"MOMO":null,
      transactionId:safeId(data.id),
    };
    if(verified.transactionId!==providerTransactionId)throw new GatewayAdapterError(
      "Flutterwave provider transaction ID mismatch.","GATEWAY_VERIFICATION_MISMATCH",409);
    return matchPaid(input,verified);
  }
}
