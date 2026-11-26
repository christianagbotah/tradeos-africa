import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError,verifyPassword} from "../auth/security.js";
import {gatewayFor,gatewaySupported} from "./catalog.js";
import {isGatewayVaultConfigured,sealTestGatewayKey} from "./vault.js";

export type ConnectableProvider="PAYSTACK"|"FLUTTERWAVE";
const validProvider=(x:unknown):x is ConnectableProvider=>
  x==="PAYSTACK"||x==="FLUTTERWAVE";
type Stored={provider_code:ConnectableProvider;environment:"TEST";
  connection_status:"PENDING_VERIFICATION"|"REVOKED";
  revision:number;updated_at:Date};
type Market={country_code:string;currency_code:string};
const KEY_RULES={
  PAYSTACK:/^sk_test_[A-Za-z0-9_-]{8,200}$/,
  FLUTTERWAVE:/^FLWSECK_TEST-[A-Za-z0-9_-]{8,200}$/,
} as const;

function checkProvider(value:unknown):ConnectableProvider{
  if(!validProvider(value))throw new AuthError(
    "Test-key connections are currently supported for Paystack and Flutterwave.",
    422,"GATEWAY_CONNECTION_UNSUPPORTED");
  return value;
}
function checkRevision(value:unknown):number{
  if(!Number.isSafeInteger(value)||(value as number)<0)
    throw new AuthError("Refresh the connection before modifying it.",
      400,"GATEWAY_CONNECTION_REVISION_REQUIRED");
  return value as number;
}
export async function reauthenticateSensitiveSettings(pool:DatabasePool,userId:string,password:unknown){
  if(typeof password!=="string"||!password||password.length>200){
    throw new AuthError("Enter your current sign-in password.",
      400,"GATEWAY_REAUTH_REQUIRED");
  }
  const result=await pool.query<{password_hash:string;status:string}>(
    "SELECT password_hash,status FROM app_users WHERE id=$1",[userId]);
  const user=result.rows[0];
  if(!user||user.status!=="ACTIVE"||
    !(await verifyPassword(password,user.password_hash))){
    throw new AuthError("Password verification failed.",
      403,"GATEWAY_REAUTH_FAILED");
  }
}
export async function listMerchantGatewayConnections(
  pool:DatabasePool,businessId:string,
){
  const res=await pool.query<Stored>(
    "SELECT provider_code,environment,connection_status,revision,updated_at "+
    "FROM business_gateway_connections WHERE business_id=$1 ORDER BY provider_code",
    [businessId]);
  return {businessId,vaultReady:isGatewayVaultConfigured(),
    connections:res.rows.map(row=>({
      providerCode:row.provider_code,environment:row.environment,
      status:row.connection_status,revision:row.revision,
      enabled:false,updatedAt:row.updated_at.toISOString(),
    })),
    notice:"Only test credentials may be securely stored here. "+
      "Credentials remain disabled until independent merchant/account validation "+
      "and provider-neutral transaction reconciliation are approved."};
}
export async function saveMerchantGatewayTestKey(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  secretKey:unknown;expectedRevision:unknown;currentPassword:unknown;
}){
  const provider=checkProvider(input.providerCode);
  const expected=checkRevision(input.expectedRevision);
  if(typeof input.secretKey!=="string"||
     !KEY_RULES[provider].test(input.secretKey)){
    throw new AuthError(
      "Enter a supported TEST secret key. Live and public keys are not accepted.",
      400,"GATEWAY_TEST_KEY_INVALID");
  }
  const sealed=sealTestGatewayKey(input.businessId,provider,input.secretKey);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    const business=(await tx.query<Market>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId])).rows[0];
    if(!business)throw new AuthError("Business not found",404,"BUSINESS_NOT_FOUND");
    const gateway=gatewayFor(provider)!;
    if(!gatewaySupported(gateway,business.country_code.trim(),
      business.currency_code.trim())){
      throw new AuthError("This gateway is not supported in your business market.",
        422,"GATEWAY_CONNECTION_MARKET_UNAVAILABLE");
    }
    const existing=(await tx.query<{revision:number}>(
      "SELECT revision FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code=$2 FOR UPDATE",
      [input.businessId,provider])).rows[0];
    if((existing?.revision??0)!==expected)
      throw new AuthError("The connection changed. Refresh and try again.",
        409,"GATEWAY_CONNECTION_REVISION_CONFLICT");
    const next=expected+1;
    await tx.query(
      "INSERT INTO business_gateway_connections "+
      "(business_id,provider_code,environment,connection_status,encrypted_secret,"+
      "nonce,auth_tag,vault_key_version,enabled,revision,changed_by_user_id) "+
      "VALUES($1,$2,'TEST','PENDING_VERIFICATION',$3,$4,$5,1,false,$6,$7) "+
      "ON CONFLICT(business_id,provider_code) DO UPDATE SET "+
      "environment='TEST',connection_status='PENDING_VERIFICATION',"+
      "encrypted_secret=$3,nonce=$4,auth_tag=$5,vault_key_version=1,enabled=false,"+
      "revision=$6,changed_by_user_id=$7,updated_at=now()",
      [input.businessId,provider,sealed.encrypted,sealed.nonce,sealed.tag,
        next,input.actorUserId]);
    await tx.query(
      "INSERT INTO business_gateway_connection_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,'TEST','TEST_KEY_SAVED',$3,$4)",
      [input.businessId,provider,next,input.actorUserId]);
    return {providerCode:provider,environment:"TEST" as const,
      status:"PENDING_VERIFICATION" as const,enabled:false,revision:next};
  });
}

export async function revokeMerchantGatewayConnection(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  expectedRevision:unknown;currentPassword:unknown;
}){
  const provider=checkProvider(input.providerCode);
  const expected=checkRevision(input.expectedRevision);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId]);
    const current=(await tx.query<{revision:number;connection_status:string}>(
      "SELECT revision,connection_status FROM business_gateway_connections "+
      "WHERE business_id=$1 AND provider_code=$2 FOR UPDATE",
      [input.businessId,provider])).rows[0];
    if(!current)throw new AuthError("No saved connection exists.",404,
      "GATEWAY_CONNECTION_NOT_FOUND");
    if(current.revision!==expected)throw new AuthError(
      "The connection changed. Refresh and try again.",
      409,"GATEWAY_CONNECTION_REVISION_CONFLICT");
    if(current.connection_status==="REVOKED")return {
      providerCode:provider,status:"REVOKED" as const,
      enabled:false,revision:expected};
    const next=expected+1;
    await tx.query(
      "UPDATE business_gateway_connections SET encrypted_secret=NULL,nonce=NULL,"+
      "auth_tag=NULL,connection_status='REVOKED',enabled=false,revision=$3,"+
      "changed_by_user_id=$4,updated_at=now() "+
      "WHERE business_id=$1 AND provider_code=$2",
      [input.businessId,provider,next,input.actorUserId]);
    await tx.query(
      "INSERT INTO business_gateway_connection_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,'TEST','CONNECTION_REVOKED',$3,$4)",
      [input.businessId,provider,next,input.actorUserId]);
    return {providerCode:provider,status:"REVOKED" as const,
      enabled:false,revision:next};
  });
}
