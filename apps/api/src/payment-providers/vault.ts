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
