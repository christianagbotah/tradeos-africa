import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {
  isGatewayVaultConfigured,sealSmsProviderSecret,
  type SmsProvider,
} from "../payment-providers/vault.js";
import {reauthenticateSensitiveSettings} from "../payment-providers/connections.js";

type Status="SAVED_UNVERIFIED"|"REVOKED";
type Stored={
  provider_code:SmsProvider;account_id:string|null;
  sender_id:string;credential_status:Status;revision:number;updated_at:Date;
};
const supported=new Set(["ARKESEL","NALO","HUBTEL_SMS","TWILIO"]);
function provider(value:unknown):SmsProvider{
  if(typeof value!=="string"||!supported.has(value))throw new AuthError(
    "Unsupported messaging provider.",422,"SMS_PROVIDER_UNSUPPORTED");
  return value as SmsProvider;
}
function revision(value:unknown):number{
  if(!Number.isSafeInteger(value)||(value as number)<0)
    throw new AuthError("Refresh your connection before changing it.",400,
      "SMS_REVISION_INVALID");
  return value as number;
}
function validateDetails(p:SmsProvider,senderId:unknown,accountId:unknown){
  if(typeof senderId!=="string"||!senderId.trim()||
    !/^[A-Za-z0-9+_-]{1,40}$/.test(senderId.trim()))
    throw new AuthError("Enter a valid registered sender name or phone number.",
      400,"SMS_SENDER_INVALID");
  const sender=senderId.trim();
  if(p==="TWILIO"){
    if(!/^\+[1-9][0-9]{7,14}$/.test(sender))
      throw new AuthError("Twilio requires a valid E.164 sender phone number.",
        400,"SMS_SENDER_INVALID");
    if(typeof accountId!=="string"||!/^AC[a-fA-F0-9]{32}$/.test(accountId))
      throw new AuthError("Enter your Twilio account SID.",
        400,"SMS_ACCOUNT_ID_INVALID");
    return {senderId:sender,accountId};
  }
  if(!/^[A-Za-z0-9]{1,11}$/.test(sender))throw new AuthError(
    "This provider's sender ID should have no more than 11 letters or digits.",
    400,"SMS_SENDER_INVALID");
  if(p==="HUBTEL_SMS"){
    if(typeof accountId!=="string"||!accountId.trim()||
       accountId.trim().length>128||/[\r\n]/.test(accountId))
      throw new AuthError("Enter your Hubtel SMS Client ID.",
        400,"SMS_ACCOUNT_ID_INVALID");
    return {senderId:sender,accountId:accountId.trim()};
  }
  if(accountId!==null&&accountId!==undefined&&accountId!=="")
    throw new AuthError("This provider only requires an API key and Sender ID.",
      400,"SMS_ACCOUNT_ID_UNEXPECTED");
  return {senderId:sender,accountId:null};
}
function publicView(row:Stored){
  return {
    providerCode:row.provider_code,accountId:row.account_id,
    senderId:row.sender_id,status:row.credential_status,
    revision:row.revision,enabled:false,updatedAt:row.updated_at.toISOString(),
  };
}
export async function listMerchantSmsConnections(pool:DatabasePool,businessId:string){
  const rows=await pool.query<Stored>(
    "SELECT provider_code,account_id,sender_id,credential_status,revision,updated_at "+
    "FROM business_sms_provider_connections WHERE business_id=$1 ORDER BY provider_code",
    [businessId]);
  return {
    businessId,vaultReady:isGatewayVaultConfigured(),
    connections:rows.rows.map(publicView),
    sendingEnabled:false,
    notice:"SMS credentials are encrypted on the TradeOS server. "+
      "Saving does not enable sending. Account ownership, approved sender IDs, "+
      "delivery controls and provider API verification are still required.",
  };
}
export async function saveMerchantSmsConnection(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  apiSecret:unknown;senderId:unknown;accountId:unknown;
  currentPassword:unknown;expectedRevision:unknown;
}){
  const p=provider(input.providerCode),expected=revision(input.expectedRevision);
  const details=validateDetails(p,input.senderId,input.accountId);
  if(typeof input.apiSecret!=="string"||
     input.apiSecret.length<8||input.apiSecret.length>256||
     /[\r\n]/.test(input.apiSecret))throw new AuthError(
    "Enter the provider's API key or secret token.",
    400,"SMS_API_SECRET_INVALID");
  // Business/provider-specific authenticated encryption; no key is returned.
  const sealed=sealSmsProviderSecret(input.businessId,p,input.apiSecret);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    const business=(await tx.query<{id:string}>(
      "SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId])).rows[0];
    if(!business)throw new AuthError("Business not found.",404,
      "SMS_BUSINESS_NOT_FOUND");
    const old=(await tx.query<{revision:number}>(
      "SELECT revision FROM business_sms_provider_connections "+
      "WHERE business_id=$1 AND provider_code=$2 FOR UPDATE",
      [input.businessId,p])).rows[0];
    if((old?.revision??0)!==expected)throw new AuthError(
      "This connection changed. Refresh and try again.",
      409,"SMS_CONNECTION_REVISION_CONFLICT");
    const next=expected+1;
    await tx.query(
      "INSERT INTO business_sms_provider_connections "+
      "(business_id,provider_code,account_id,sender_id,credential_status,"+
      "encrypted_secret,nonce,auth_tag,revision,enabled,changed_by_user_id) "+
      "VALUES($1,$2,$3,$4,'SAVED_UNVERIFIED',$5,$6,$7,$8,false,$9) "+
      "ON CONFLICT(business_id,provider_code) DO UPDATE SET "+
      "account_id=$3,sender_id=$4,credential_status='SAVED_UNVERIFIED',"+
      "encrypted_secret=$5,nonce=$6,auth_tag=$7,vault_key_version=1,"+
      "revision=$8,enabled=false,changed_by_user_id=$9,updated_at=now()",
      [input.businessId,p,details.accountId,details.senderId,
        sealed.encrypted,sealed.nonce,sealed.tag,next,input.actorUserId]);
    await tx.query(
      "INSERT INTO business_sms_provider_connection_audit "+
      "(business_id,provider_code,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,'CREDENTIAL_SAVED',$3,$4)",
      [input.businessId,p,next,input.actorUserId]);
    return {providerCode:p,senderId:details.senderId,accountId:details.accountId,
      status:"SAVED_UNVERIFIED" as const,revision:next,enabled:false};
  });
}
export async function revokeMerchantSmsConnection(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  currentPassword:unknown;expectedRevision:unknown;
}){
  const p=provider(input.providerCode),expected=revision(input.expectedRevision);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId]);
    const old=(await tx.query<{revision:number;credential_status:Status}>(
      "SELECT revision,credential_status FROM business_sms_provider_connections "+
      "WHERE business_id=$1 AND provider_code=$2 FOR UPDATE",
      [input.businessId,p])).rows[0];
    if(!old)throw new AuthError("No SMS connection was saved.",404,
      "SMS_CONNECTION_NOT_FOUND");
    if(old.revision!==expected)throw new AuthError(
      "This connection changed. Refresh and try again.",
      409,"SMS_CONNECTION_REVISION_CONFLICT");
    if(old.credential_status==="REVOKED")return {
      providerCode:p,revision:expected,enabled:false,status:"REVOKED" as const,
    };
    const next=expected+1;
    await tx.query(
      "UPDATE business_sms_provider_connections SET "+
      "encrypted_secret=NULL,nonce=NULL,auth_tag=NULL,"+
      "credential_status='REVOKED',enabled=false,revision=$3,"+
      "changed_by_user_id=$4,updated_at=now() "+
      "WHERE business_id=$1 AND provider_code=$2",
      [input.businessId,p,next,input.actorUserId]);
    await tx.query(
      "INSERT INTO business_sms_provider_connection_audit "+
      "(business_id,provider_code,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,'CREDENTIAL_REVOKED',$3,$4)",
      [input.businessId,p,next,input.actorUserId]);
    return {providerCode:p,revision:next,enabled:false,status:"REVOKED" as const};
  });
}
