import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {AuthError} from "../auth/security.js";

const MASTER_ENV="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
type Provider="PAYSTACK"|"FLUTTERWAVE";
export type SealedTestSecret={encrypted:Buffer;nonce:Buffer;tag:Buffer;keyVersion:1};

function masterKey():Buffer{
  const raw=process.env[MASTER_ENV]??"";
  if(!/^[A-Za-z0-9+/]{43}=$/.test(raw)){
    throw new AuthError("Secure gateway credential storage is not yet configured.",
      503,"GATEWAY_VAULT_UNAVAILABLE");
  }
  const key=Buffer.from(raw,"base64");
  if(key.length!==32||key.toString("base64")!==raw){
    throw new AuthError("Secure gateway credential storage is not yet configured.",
      503,"GATEWAY_VAULT_UNAVAILABLE");
  }
  return key;
}
export function isGatewayVaultConfigured():boolean{
  try{masterKey();return true;}catch{return false;}
}
function aad(businessId:string,provider:Provider):Buffer{
  return Buffer.from("TradeOS/v1/"+businessId+"/"+provider+"/TEST","utf8");
}
export function sealTestGatewayKey(
  businessId:string,provider:Provider,secret:string,
):SealedTestSecret{
  const key=masterKey();
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(aad(businessId,provider));
  const encrypted=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
  return {encrypted,nonce,tag:cipher.getAuthTag(),keyVersion:1};
}
export function unsealTestGatewayKey(
  businessId:string,provider:Provider,sealed:SealedTestSecret,
):string{
  const key=masterKey();
  if(sealed.keyVersion!==1||sealed.nonce.length!==12||sealed.tag.length!==16)
    throw new AuthError("Stored merchant credential cannot be decrypted.",
      503,"GATEWAY_VAULT_INVALID");
  try{
    const decipher=createDecipheriv("aes-256-gcm",key,sealed.nonce);
    decipher.setAAD(aad(businessId,provider));
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([
      decipher.update(sealed.encrypted),decipher.final(),
    ]).toString("utf8");
  }catch{
    throw new AuthError("Stored merchant credential cannot be decrypted.",
      503,"GATEWAY_VAULT_INVALID");
  }
}


/** Separate authenticated-encryption domain for merchant SMS/API credentials.
 * These credentials are never valid for payment gateway operations.
 */
export type SmsProvider="ARKESEL"|"NALO"|"HUBTEL_SMS"|"TWILIO";
function smsAad(businessId:string,provider:SmsProvider):Buffer{
  return Buffer.from("TradeOS/v1/"+businessId+"/SMS/"+provider,"utf8");
}
export function sealSmsProviderSecret(
  businessId:string,provider:SmsProvider,secret:string,
):SealedTestSecret{
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",masterKey(),nonce);
  cipher.setAAD(smsAad(businessId,provider));
  const encrypted=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
  return {encrypted,nonce,tag:cipher.getAuthTag(),keyVersion:1};
}
export function unsealSmsProviderSecret(
  businessId:string,provider:SmsProvider,sealed:SealedTestSecret,
):string{
  if(sealed.keyVersion!==1||sealed.nonce.length!==12||sealed.tag.length!==16)
    throw new AuthError("Saved messaging credential cannot be decrypted.",
      503,"SMS_VAULT_INVALID");
  try{
    const decipher=createDecipheriv("aes-256-gcm",masterKey(),sealed.nonce);
    decipher.setAAD(smsAad(businessId,provider));
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([decipher.update(sealed.encrypted),
      decipher.final()]).toString("utf8");
  }catch{
    throw new AuthError("Saved messaging credential cannot be decrypted.",
      503,"SMS_VAULT_INVALID");
  }
}


/**
 * Separate payment merchant-connection vault. AAD prevents moving a
 * Paystack/Hubtel credential between businesses, providers or environments.
 * No decryption or credential values are ever exposed through HTTP routes.
 */
export type MerchantProvider=
  "HUBTEL"|"PAYSTACK"|"FLUTTERWAVE"|"STRIPE"|"PESAPAL"|"DPO"|"MPESA";
export type MerchantEnvironment="TEST"|"LIVE";
function merchantAad(businessId:string,provider:MerchantProvider,
  environment:MerchantEnvironment):Buffer{
  return Buffer.from("TradeOS/v2/merchant/"+businessId+"/"+provider+
    "/"+environment,"utf8");
}
export function sealMerchantGatewayCredentials(
  businessId:string,provider:MerchantProvider,
  environment:MerchantEnvironment,credentials:Record<string,string>,
):SealedTestSecret{
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",masterKey(),nonce);
  cipher.setAAD(merchantAad(businessId,provider,environment));
  const encrypted=Buffer.concat([
    cipher.update(JSON.stringify(credentials),"utf8"),cipher.final(),
  ]);
  return {encrypted,nonce,tag:cipher.getAuthTag(),keyVersion:1};
}
export function unsealMerchantGatewayCredentials(
  businessId:string,provider:MerchantProvider,
  environment:MerchantEnvironment,sealed:SealedTestSecret,
):Record<string,string>{
  if(sealed.keyVersion!==1||sealed.nonce.length!==12||sealed.tag.length!==16)
    throw new AuthError("Stored merchant credentials cannot be decrypted.",
      503,"GATEWAY_MERCHANT_VAULT_INVALID");
  try{
    const decipher=createDecipheriv("aes-256-gcm",masterKey(),sealed.nonce);
    decipher.setAAD(merchantAad(businessId,provider,environment));
    decipher.setAuthTag(sealed.tag);
    const data=JSON.parse(Buffer.concat([
      decipher.update(sealed.encrypted),decipher.final(),
    ]).toString("utf8")) as Record<string,string>;
    if(!data||typeof data!=="object"||Array.isArray(data)||
      Object.values(data).some(v=>typeof v!=="string"))
      throw new Error("Malformed credential payload");
    return data;
  }catch{
    throw new AuthError("Stored merchant credentials cannot be decrypted.",
      503,"GATEWAY_MERCHANT_VAULT_INVALID");
  }
}
