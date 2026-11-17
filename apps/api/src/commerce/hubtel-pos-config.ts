import type { DatabasePool,DatabaseClient } from "../db.js";
import {unsealMerchantGatewayCredentials} from "../payment-providers/vault.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[0-9]{3,32}$/;
const ALIAS=/^[A-Za-z0-9_-]{3,80}$/;

export class HubtelPosError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode:number){
    super(message);this.name="HubtelPosError";
  }
}
export function posFail(message:string,code:string,statusCode=400):never {
  throw new HubtelPosError(message,code,statusCode);
}
export type HubtelCredentialSource="PLATFORM_ALIAS"|"MERCHANT_VAULT";
export type HubtelPosConnection={
  businessId:string;collectionAccount:string;credentialAlias:string;
  apiId:string;apiKey:string;
  credentialSource:HubtelCredentialSource;
  merchantCredentialRevision:number|null;
};
type AccountRow={
  business_id:string;collection_account:string;credential_alias:string;
  enabled:boolean;approval_status:string;verified_at:Date|null;
};
type Cred={apiId:string;apiKey:string};
type MerchantCredRow={
  account_reference:string|null;status:string;verified_at:Date|null;
  activation_requested_at:Date|null;collection_enabled:boolean;
  revision:number;encrypted_credentials:Buffer|null;nonce:Buffer|null;
  auth_tag:Buffer|null;key_version:1;
};
export function hubtelPosGloballyEnabled():boolean {
  return process.env.TRADEOS_HUBTEL_POS_ENABLED==="true";
}
function loadCredentials(alias:string):Cred|null {
  if(!ALIAS.test(alias))return null;
  const raw=process.env.TRADEOS_HUBTEL_POS_CREDENTIALS_JSON;
  if(!raw)return null;
  let json:unknown;
  try{json=JSON.parse(raw);}catch{return null;}
  if(!json||typeof json!=="object"||Array.isArray(json))return null;
  const item=(json as Record<string,unknown>)[alias];
  if(!item||typeof item!=="object"||Array.isArray(item))return null;
  const {apiId,apiKey}=item as Record<string,unknown>;
  if(typeof apiId!=="string"||typeof apiKey!=="string"||!apiId.trim()||
     !apiKey.trim()||apiId.includes(":")||/[\r\n]/.test(apiId+apiKey))return null;
  return {apiId,apiKey};
}
export async function hubtelPosConnection(
  db:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,businessId:string,
  requiredSource:"AUTO"|HubtelCredentialSource="AUTO",
):Promise<HubtelPosConnection|null>{
  if(!hubtelPosGloballyEnabled()||!UUID.test(businessId))return null;
  const res=await db.query<AccountRow>(
    "SELECT business_id,collection_account,credential_alias,enabled,approval_status,verified_at "+
    "FROM business_hubtel_sales_accounts WHERE business_id=$1",
    [businessId],
  );
  const row=res.rows[0];
  if(!row||!row.enabled||row.approval_status!=="VERIFIED"||
      row.verified_at===null||!ACCOUNT.test(row.collection_account)||
      !ALIAS.test(row.credential_alias))return null;
  // Subscription revenue and merchant sales must never settle into the same account.
  if(row.collection_account===process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT)return null;
  // The new merchant credential source is deliberately gated THREE ways:
  // platform-approved EXACT collection account, a separate private rollout
  // flag, and an explicit DB collection_enabled authorization. Migration
  // 0046 currently CHECKs collection_enabled=false, so merchant-owned LIVE
  // checkout cannot turn on merely from entering/validating credentials.
  if(requiredSource!=="PLATFORM_ALIAS"&&
     process.env.TRADEOS_HUBTEL_MERCHANT_POS_ENABLED==="true"){
    const rowResult=await db.query<MerchantCredRow>(
      "SELECT account_reference,status,verified_at,activation_requested_at,"+
      "collection_enabled,revision,encrypted_credentials,nonce,auth_tag,"+
      "key_version FROM business_merchant_gateway_credentials "+
      "WHERE business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE'",
      [businessId]);
    const record=rowResult.rows[0];
    if(record&&record.status==="VERIFIED"&&record.verified_at&&
       record.activation_requested_at&&record.collection_enabled&&
       record.account_reference===row.collection_account&&
       record.encrypted_credentials&&record.nonce&&record.auth_tag){
      const secrets=unsealMerchantGatewayCredentials(
        businessId,"HUBTEL","LIVE",{
          encrypted:record.encrypted_credentials,nonce:record.nonce,
          tag:record.auth_tag,keyVersion:record.key_version,
        });
      if(typeof secrets.apiId!=="string"||!secrets.apiId||
         secrets.apiId.includes(":")||
         typeof secrets.apiKey!=="string"||!secrets.apiKey||
         /[\\r\\n]/.test(secrets.apiId+secrets.apiKey)||
         secrets.collectionAccount!==row.collection_account)
        posFail("Merchant Hubtel credentials do not match the approved account.",
          "HUBTEL_POS_MERCHANT_SCOPE_INVALID",503);
      return {businessId,collectionAccount:row.collection_account,
        credentialAlias:row.credential_alias,
        apiId:secrets.apiId,apiKey:secrets.apiKey,
        credentialSource:"MERCHANT_VAULT",merchantCredentialRevision:record.revision};
    }
  }
  if(requiredSource==="MERCHANT_VAULT")return null;
  const credentials=loadCredentials(row.credential_alias);
  if(!credentials)return null;
  return {businessId,collectionAccount:row.collection_account,
    credentialAlias:row.credential_alias,...credentials,
    credentialSource:"PLATFORM_ALIAS",merchantCredentialRevision:null};
}
export async function requireHubtelPosConnection(
  db:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,businessId:string,
  requiredSource:"AUTO"|HubtelCredentialSource="AUTO",
):Promise<HubtelPosConnection>{
  const connection=await hubtelPosConnection(db,businessId,requiredSource);
  if(!connection)posFail("Hubtel POS collections are not enabled for this business.",
    "HUBTEL_POS_DISABLED",503);
  return connection;
}
export function hubtelPosPublicOrigin():string {
  // Fixed trusted merchant-origin host, never taken from an untrusted request.
  return "https://tradeosafrica.lightworldtech.com";
}
