import type {DatabasePool} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {gatewayFor,gatewaySupported,type GatewayCode} from "./catalog.js";
import {
  isGatewayVaultConfigured,sealMerchantGatewayCredentials,
  unsealMerchantGatewayCredentials,sealTestGatewayKey,
} from "./vault.js";
import {reauthenticateSensitiveSettings} from "./connections.js";
import {
  gatewayEnvironment,merchantCredentialSchema,
  validateMerchantGatewayCredentials,type GatewayEnvironment,
} from "./merchant-schemas.js";

type Status="SAVED_UNVERIFIED"|"VERIFIED"|"REVOKED";
type Row={
  business_id:string;provider_code:GatewayCode;environment:GatewayEnvironment;
  account_reference:string|null;status:Status;revision:number;
  verified_at:Date|null;activation_requested_at:Date|null;
  updated_at:Date;encrypted_credentials:Buffer|null;nonce:Buffer|null;
  auth_tag:Buffer|null;key_version:1;
};
const SELECT="business_id,provider_code,environment,account_reference,"+
  "status,revision,verified_at,activation_requested_at,updated_at,"+
  "encrypted_credentials,nonce,auth_tag,key_version";
function checkRevision(value:unknown):number{
  if(!Number.isSafeInteger(value)||(value as number)<0)
    throw new AuthError("Refresh the connection before changing it.",
      400,"GATEWAY_MERCHANT_REVISION_INVALID");
  return value as number;
}
function publicView(row:Row){
  return {
    providerCode:row.provider_code,environment:row.environment,
    accountReference:row.account_reference,
    status:row.status,revision:row.revision,collectionEnabled:false,
    verifiedAt:row.verified_at?.toISOString()??null,
    activationRequestedAt:row.activation_requested_at?.toISOString()??null,
    updatedAt:row.updated_at.toISOString(),
  };
}
export async function listMerchantGatewayCredentials(pool:DatabasePool,
  businessId:string){
  const result=await pool.query<Row>(
    "SELECT "+SELECT+" FROM business_merchant_gateway_credentials "+
    "WHERE business_id=$1 ORDER BY provider_code,environment",
    [businessId]);
  return {
    businessId,vaultReady:isGatewayVaultConfigured(),
    schemas:merchantCredentialSchemaList(),
    connections:result.rows.map(publicView),
    collectionEnabled:false,
    notice:"Save your own provider API keys securely, then verify your merchant "+
      "account and request activation. TradeOS will not charge customers or "+
      "issue receipts until the provider-specific collection flow has "+
      "passed its release gates.",
  };
}
function merchantCredentialSchemaList(){
  const codes:GatewayCode[]=[
    "HUBTEL","PAYSTACK","FLUTTERWAVE","STRIPE","PESAPAL","DPO","MPESA"];
  return codes.map(code=>({providerCode:code,
    fields:merchantCredentialSchema(code).fields,
    canVerifyConnection:code==="HUBTEL",
    verificationRequiresLiveKey:code==="HUBTEL",
  }));
}
export async function saveMerchantPaymentCredentials(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  environment:unknown;fields:unknown;currentPassword:unknown;
  expectedRevision:unknown;
}){
  const gateway=gatewayFor(input.providerCode);
  if(!gateway)throw new AuthError("Unknown payment provider.",422,
    "GATEWAY_MERCHANT_PROVIDER_UNSUPPORTED");
  const provider=gateway.code,environment=gatewayEnvironment(input.environment);
  const expected=checkRevision(input.expectedRevision);
  const credentials=validateMerchantGatewayCredentials(provider,environment,input.fields);
  if(provider==="HUBTEL"&&environment==="LIVE"&&
    credentials.collectionAccount===process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT)
    throw new AuthError("A merchant must not collect into TradeOS's platform account.",
      409,"GATEWAY_HUBTEL_PLATFORM_ACCOUNT_FORBIDDEN");
  const sealed=sealMerchantGatewayCredentials(
    input.businessId,provider,environment,credentials);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    const business=(await tx.query<{country_code:string;currency_code:string}>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId])).rows[0];
    if(!business)throw new AuthError("Business not found.",404,"BUSINESS_NOT_FOUND");
    if(!gatewaySupported(gateway,business.country_code.trim(),
      business.currency_code.trim()))
      throw new AuthError("This provider is not available for your business market.",
        422,"GATEWAY_MERCHANT_COUNTRY_UNSUPPORTED");
    const existing=(await tx.query<{revision:number}>(
      "SELECT revision FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment=$3 FOR UPDATE",
      [input.businessId,provider,environment])).rows[0];
    if((existing?.revision??0)!==expected)throw new AuthError(
      "Connection changed. Refresh before editing credentials.",
      409,"GATEWAY_MERCHANT_REVISION_CONFLICT");
    const next=expected+1;
    let stored:Row;
    try{
      const inserted=await tx.query<Row>(
        "INSERT INTO business_merchant_gateway_credentials "+
        "(business_id,provider_code,environment,account_reference,"+
        "encrypted_credentials,nonce,auth_tag,changed_by_user_id,revision) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) "+
        "ON CONFLICT(business_id,provider_code,environment) DO UPDATE SET "+
        "account_reference=$4,encrypted_credentials=$5,nonce=$6,auth_tag=$7,"+
        "status='SAVED_UNVERIFIED',verified_at=NULL,activation_requested_at=NULL,"+
        "collection_enabled=false,revision=$9,changed_by_user_id=$8,updated_at=now() "+
        "RETURNING "+SELECT,
        [input.businessId,provider,environment,
          provider==="HUBTEL"?credentials.collectionAccount:null,
          sealed.encrypted,sealed.nonce,sealed.tag,input.actorUserId,next]);
      stored=inserted.rows[0]!;
    }catch(error){
      if(typeof error==="object"&&error!==null&&"code" in error&&
         error.code==="23505")throw new AuthError(
        "This Hubtel collection account is already connected to another merchant.",
        409,"GATEWAY_HUBTEL_ACCOUNT_ALREADY_CONNECTED");
      throw error;
    }
    // Preserve the existing TEST attempt/reconciliation engine. The new
    // self-service form must not strand PAYSTACK/FLUTTERWAVE TEST credentials
    // in a vault their existing sandbox adapter cannot read.
    if(environment==="TEST"&&(provider==="PAYSTACK"||provider==="FLUTTERWAVE")){
      const old=(await tx.query<{revision:number}>(
        "SELECT revision FROM business_gateway_connections "+
        "WHERE business_id=$1 AND provider_code=$2 FOR UPDATE",
        [input.businessId,provider])).rows[0];
      const legacy=sealTestGatewayKey(input.businessId,provider,
        credentials.secretKey);
      await tx.query(
        "INSERT INTO business_gateway_connections "+
        "(business_id,provider_code,environment,connection_status,"+
        "encrypted_secret,nonce,auth_tag,enabled,revision,changed_by_user_id) "+
        "VALUES($1,$2,'TEST','PENDING_VERIFICATION',$3,$4,$5,false,$6,$7) "+
        "ON CONFLICT(business_id,provider_code) DO UPDATE SET "+
        "encrypted_secret=$3,nonce=$4,auth_tag=$5,enabled=false,"+
        "connection_status='PENDING_VERIFICATION',revision=$6,"+
        "changed_by_user_id=$7,updated_at=now()",
        [input.businessId,provider,legacy.encrypted,legacy.nonce,
          legacy.tag,(old?.revision??0)+1,input.actorUserId]);
    }
    await tx.query(
      "INSERT INTO business_merchant_gateway_credential_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,$3,'CREDENTIAL_SAVED',$4,$5)",
      [input.businessId,provider,environment,next,input.actorUserId]);
    return {connection:publicView(stored),verified:false,collectionEnabled:false};
  });
}

export async function revokeMerchantPaymentCredentials(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  environment:unknown;expectedRevision:unknown;currentPassword:unknown;
}){
  const provider=merchantCredentialSchema(input.providerCode).providerCode;
  const env=gatewayEnvironment(input.environment);
  const expected=checkRevision(input.expectedRevision);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    await tx.query("SELECT id FROM businesses WHERE id=$1 FOR UPDATE",[input.businessId]);
    const previous=(await tx.query<Row>(
      "SELECT "+SELECT+" FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment=$3 FOR UPDATE",
      [input.businessId,provider,env])).rows[0];
    if(!previous)throw new AuthError("No merchant credentials found.",404,
      "GATEWAY_MERCHANT_CONNECTION_NOT_FOUND");
    if(previous.revision!==expected)throw new AuthError(
      "Refresh credentials before revocation.",409,"GATEWAY_MERCHANT_REVISION_CONFLICT");
    if(previous.status==="REVOKED")return {connection:publicView(previous)};
    const next=expected+1;
    const updated=(await tx.query<Row>(
      "UPDATE business_merchant_gateway_credentials SET "+
      "encrypted_credentials=NULL,nonce=NULL,auth_tag=NULL,"+
      "status='REVOKED',verified_at=NULL,activation_requested_at=NULL,"+
      "collection_enabled=false,revision=$4,changed_by_user_id=$5,updated_at=now() "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment=$3 RETURNING "+SELECT,
      [input.businessId,provider,env,next,input.actorUserId])).rows[0]!;
    if(env==="TEST"&&(provider==="PAYSTACK"||provider==="FLUTTERWAVE")){
      await tx.query(
        "UPDATE business_gateway_connections SET "+
        "encrypted_secret=NULL,nonce=NULL,auth_tag=NULL,"+
        "connection_status='REVOKED',enabled=false,"+
        "revision=revision+1,changed_by_user_id=$3,updated_at=now() "+
        "WHERE business_id=$1 AND provider_code=$2",
        [input.businessId,provider,input.actorUserId]);
    }
    await tx.query(
      "INSERT INTO business_merchant_gateway_credential_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,$3,'CREDENTIAL_REVOKED',$4,$5)",
      [input.businessId,provider,env,next,input.actorUserId]);
    return {connection:publicView(updated)};
  });
}

const BALANCE_ORIGIN="https://trnf.hubtel.com";
export class MerchantProbeError extends Error{
  constructor(message:string,readonly code:string,readonly statusCode:number){
    super(message);this.name="MerchantProbeError";
  }
}
export async function checkHubtelCollectionBalance(input:{
  apiId:string;apiKey:string;collectionAccount:string;fetchImpl?:typeof fetch;
}):Promise<{verified:true}>{
  if(!/^[0-9]{3,32}$/.test(input.collectionAccount))
    throw new MerchantProbeError("Invalid Hubtel collection account.",
      "HUBTEL_ACCOUNT_INVALID",400);
  let response:Response;
  try{
    response=await (input.fetchImpl??fetch)(
      BALANCE_ORIGIN+"/api/inter-transfers/"+
        encodeURIComponent(input.collectionAccount),{
          method:"GET",headers:{
            authorization:"Basic "+Buffer.from(input.apiId+":"+input.apiKey).toString("base64"),
            accept:"application/json",
          },
          signal:AbortSignal.timeout(10000),
        });
  }catch{
    throw new MerchantProbeError(
      "Hubtel account verification is unreachable. Confirm server IP allowlisting.",
      "HUBTEL_PROBE_UNAVAILABLE",503);
  }
  if(response.status===401||response.status===403)
    throw new MerchantProbeError(
      "Hubtel rejected the API credentials or collection account. Check access and server IP allowlisting.",
      "HUBTEL_PROBE_ACCESS_REJECTED",409);
  if(!response.ok)throw new MerchantProbeError(
    "Hubtel did not verify access to this collection account.",
    "HUBTEL_PROBE_UNAVAILABLE",503);
  let data:unknown;
  try{data=await response.json();}catch{
    throw new MerchantProbeError("Hubtel returned an invalid verification response.",
      "HUBTEL_PROBE_INVALID",502);
  }
  if(!data||typeof data!=="object"||Array.isArray(data))
    throw new MerchantProbeError("Hubtel verification response was not trusted.",
      "HUBTEL_PROBE_INVALID",502);
  const payload=data as Record<string,unknown>;
  const result=payload.data;
  if(payload.responseCode!=="0000"||!result||typeof result!=="object"||
    Array.isArray(result)||typeof (result as Record<string,unknown>).amount!=="number"||
    !Number.isFinite((result as Record<string,number>).amount)||
    (result as Record<string,number>).amount<0)
    throw new MerchantProbeError("Hubtel did not validate collection-account access.",
      "HUBTEL_PROBE_INVALID",502);
  // Do not return balances to the browser. This confirms read-only account
  // scope, not payment initiation/refunds/payout authority.
  return {verified:true};
}
export async function verifyMerchantHubtelConnection(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;environment:unknown;
  expectedRevision:unknown;currentPassword:unknown;fetchImpl?:typeof fetch;
}){
  const env=gatewayEnvironment(input.environment);
  if(env!=="LIVE")throw new AuthError(
    "Hubtel TEST accounts need sandbox verification; the live balance endpoint is not appropriate.",
    409,"HUBTEL_TEST_PROBE_NOT_AVAILABLE");
  const expected=checkRevision(input.expectedRevision);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  const row=(await pool.query<Row>(
    "SELECT "+SELECT+" FROM business_merchant_gateway_credentials "+
    "WHERE business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE'",
    [input.businessId])).rows[0];
  if(!row||row.status==="REVOKED")throw new AuthError(
    "Save your Hubtel merchant account credentials before verification.",
    409,"HUBTEL_MERCHANT_CREDENTIALS_REQUIRED");
  if(row.revision!==expected)throw new AuthError(
    "Connection changed. Refresh before verifying.",
    409,"GATEWAY_MERCHANT_REVISION_CONFLICT");
  if(!row.encrypted_credentials||!row.nonce||!row.auth_tag)
    throw new AuthError("Merchant credentials are unavailable.",
      503,"GATEWAY_MERCHANT_VAULT_INVALID");
  const creds=unsealMerchantGatewayCredentials(input.businessId,"HUBTEL","LIVE",{
    encrypted:row.encrypted_credentials,nonce:row.nonce,
    tag:row.auth_tag,keyVersion:row.key_version});
  if(creds.collectionAccount!==row.account_reference||
    creds.collectionAccount===process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT)
    throw new AuthError("Collection account is not eligible.",
      409,"HUBTEL_MERCHANT_ACCOUNT_MISMATCH");
  await checkHubtelCollectionBalance({
    apiId:creds.apiId,apiKey:creds.apiKey,
    collectionAccount:creds.collectionAccount,fetchImpl:input.fetchImpl});
  return withTransaction(pool,async tx=>{
    const current=(await tx.query<Row>(
      "SELECT "+SELECT+" FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE' "+
      "FOR UPDATE",[input.businessId])).rows[0];
    if(!current||current.status==="REVOKED"||current.revision!==expected)
      throw new AuthError("Credentials changed during Hubtel verification.",
        409,"GATEWAY_MERCHANT_REVISION_CONFLICT");
    if(current.status==="VERIFIED")
      return {connection:publicView(current),replayed:true};
    const updated=(await tx.query<Row>(
      "UPDATE business_merchant_gateway_credentials SET status='VERIFIED',"+
      "verified_at=now(),updated_at=now() WHERE business_id=$1 "+
      "AND provider_code='HUBTEL' AND environment='LIVE' RETURNING "+SELECT,
      [input.businessId])).rows[0]!;
    await tx.query(
      "INSERT INTO business_merchant_gateway_credential_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,'HUBTEL','LIVE','ACCOUNT_VERIFIED',$2,$3)",
      [input.businessId,expected,input.actorUserId]);
    return {connection:publicView(updated),replayed:false};
  });
}
export async function requestMerchantGatewayActivation(pool:DatabasePool,input:{
  businessId:string;actorUserId:string;providerCode:unknown;
  environment:unknown;expectedRevision:unknown;currentPassword:unknown;
}){
  const provider=merchantCredentialSchema(input.providerCode).providerCode;
  const env=gatewayEnvironment(input.environment);
  const expected=checkRevision(input.expectedRevision);
  await reauthenticateSensitiveSettings(pool,input.actorUserId,input.currentPassword);
  return withTransaction(pool,async tx=>{
    const current=(await tx.query<Row>(
      "SELECT "+SELECT+" FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment=$3 FOR UPDATE",
      [input.businessId,provider,env])).rows[0];
    if(!current||current.status!=="VERIFIED")throw new AuthError(
      "The provider must be independently verified before requesting activation.",
      409,"GATEWAY_MERCHANT_VERIFICATION_REQUIRED");
    if(current.revision!==expected)throw new AuthError(
      "Connection changed. Refresh before requesting activation.",
      409,"GATEWAY_MERCHANT_REVISION_CONFLICT");
    if(current.activation_requested_at)return {
      connection:publicView(current),replayed:true};
    const updated=(await tx.query<Row>(
      "UPDATE business_merchant_gateway_credentials "+
      "SET activation_requested_at=now(),updated_at=now() "+
      "WHERE business_id=$1 AND provider_code=$2 AND environment=$3 RETURNING "+SELECT,
      [input.businessId,provider,env])).rows[0]!;
    await tx.query(
      "INSERT INTO business_merchant_gateway_credential_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,$2,$3,'ACTIVATION_REQUESTED',$4,$5)",
      [input.businessId,provider,env,expected,input.actorUserId]);
    return {connection:publicView(updated),replayed:false};
  });
}
