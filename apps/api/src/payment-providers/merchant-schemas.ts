import type {GatewayCode} from "./catalog.js";
import {AuthError} from "../auth/security.js";

export type GatewayEnvironment="TEST"|"LIVE";
export type CredentialField={
  id:string;label:string;required:boolean;secret:boolean;
  hint?:string;
};
type Schema={providerCode:GatewayCode;fields:readonly CredentialField[]};
export const MERCHANT_GATEWAY_SCHEMAS:readonly Schema[]=[
  {providerCode:"HUBTEL",fields:[
    {id:"apiId",label:"Hubtel Payment API ID",required:true,secret:false},
    {id:"apiKey",label:"Hubtel Payment API Key",required:true,secret:true},
    {id:"collectionAccount",label:"Collection Account Number",required:true,secret:false,
      hint:"Customers pay into this merchant-owned Hubtel collection account"},
    {id:"disbursementAccount",label:"Disbursement Account Number (optional)",required:false,
      secret:false,hint:"Separate payouts account; not used for POS collection"},
  ]},
  {providerCode:"PAYSTACK",fields:[
    {id:"secretKey",label:"Paystack Secret Key",required:true,secret:true},
    {id:"publicKey",label:"Paystack Public Key (optional)",required:false,secret:false},
  ]},
  {providerCode:"FLUTTERWAVE",fields:[
    {id:"secretKey",label:"Flutterwave Secret Key",required:true,secret:true},
    {id:"encryptionKey",label:"Flutterwave Encryption Key (optional)",required:false,secret:true},
    {id:"webhookHash",label:"Flutterwave Webhook Hash (optional)",required:false,secret:true},
  ]},
  {providerCode:"STRIPE",fields:[
    {id:"secretKey",label:"Stripe Secret Key",required:true,secret:true},
    {id:"publishableKey",label:"Stripe Publishable Key (optional)",required:false,secret:false},
    {id:"webhookSecret",label:"Stripe Webhook Signing Secret (optional)",required:false,secret:true},
  ]},
  {providerCode:"PESAPAL",fields:[
    {id:"consumerKey",label:"Pesapal Consumer Key",required:true,secret:true},
    {id:"consumerSecret",label:"Pesapal Consumer Secret",required:true,secret:true},
  ]},
  {providerCode:"DPO",fields:[
    {id:"companyToken",label:"DPO Company Token",required:true,secret:true},
    {id:"serviceType",label:"Service Type (optional)",required:false,secret:false},
  ]},
  {providerCode:"MPESA",fields:[
    {id:"consumerKey",label:"M-Pesa Consumer Key",required:true,secret:true},
    {id:"consumerSecret",label:"M-Pesa Consumer Secret",required:true,secret:true},
    {id:"shortCode",label:"Business Shortcode",required:true,secret:false},
    {id:"passkey",label:"Online Payment Passkey",required:true,secret:true},
  ]},
];
export function merchantCredentialSchema(code:unknown):Schema{
  const schema=MERCHANT_GATEWAY_SCHEMAS.find(p=>p.providerCode===code);
  if(!schema)throw new AuthError("Choose a supported payment provider.",
    422,"GATEWAY_MERCHANT_PROVIDER_UNSUPPORTED");
  return schema;
}
export function gatewayEnvironment(value:unknown):GatewayEnvironment{
  if(value!=="TEST"&&value!=="LIVE")
    throw new AuthError("Choose TEST or LIVE credentials.",
      400,"GATEWAY_MERCHANT_ENV_INVALID");
  return value;
}
export function validateMerchantGatewayCredentials(provider:GatewayCode,
  environment:GatewayEnvironment,value:unknown):Record<string,string>{
  const fields=merchantCredentialSchema(provider).fields;
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new AuthError("Enter the provider credential fields.",
      400,"GATEWAY_MERCHANT_FIELDS_INVALID");
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!fields.some(x=>x.id===key)))
    throw new AuthError("Remove unsupported provider credential fields.",
      400,"GATEWAY_MERCHANT_FIELDS_INVALID");
  const result:Record<string,string>={};
  for(const field of fields){
    const v=raw[field.id];
    if(v===undefined||v===null||v===""){
      if(field.required)throw new AuthError(
        "Provide "+field.label+".",400,"GATEWAY_MERCHANT_FIELD_REQUIRED");
      continue;
    }
    if(typeof v!=="string"||v.length>512||v.length<2||/[^\x20-\x7e]/.test(v))
      throw new AuthError("Invalid "+field.label+".",
        400,"GATEWAY_MERCHANT_FIELD_INVALID");
    result[field.id]=v.trim();
  }
  if(provider==="HUBTEL"){
    for(const field of ["collectionAccount","disbursementAccount"]){
      if(result[field]&&!/^[0-9]{3,32}$/.test(result[field]))
        throw new AuthError("Hubtel account numbers must contain digits only.",
          400,"GATEWAY_HUBTEL_ACCOUNT_INVALID");
    }
    if(result.apiId.includes(":"))
      throw new AuthError("Hubtel API ID cannot contain a colon.",
        400,"GATEWAY_HUBTEL_ID_INVALID");
    if(result.collectionAccount===result.disbursementAccount)
      throw new AuthError("Hubtel collection and disbursement account must differ.",
        400,"GATEWAY_HUBTEL_ACCOUNT_INVALID");
  }
  if(provider==="PAYSTACK"&&
    !result.secretKey.startsWith(environment==="TEST"?"sk_test_":"sk_live_"))
    throw new AuthError("Enter a matching Paystack "+environment+" Secret Key.",
      400,"GATEWAY_MERCHANT_KEY_ENV_MISMATCH");
  if(provider==="FLUTTERWAVE"&&
    !result.secretKey.startsWith(environment==="TEST"?"FLWSECK_TEST-":"FLWSECK-"))
    throw new AuthError("Enter a matching Flutterwave "+environment+" Secret Key.",
      400,"GATEWAY_MERCHANT_KEY_ENV_MISMATCH");
  if(provider==="STRIPE"&&
    !result.secretKey.startsWith(environment==="TEST"?"sk_test_":"sk_live_"))
    throw new AuthError("Enter a matching Stripe "+environment+" Secret Key.",
      400,"GATEWAY_MERCHANT_KEY_ENV_MISMATCH");
  if(provider==="MPESA"&&!/^[0-9]{4,12}$/.test(result.shortCode))
    throw new AuthError("Enter a numeric M-Pesa shortcode.",
      400,"GATEWAY_MERCHANT_FIELD_INVALID");
  return result;
}
