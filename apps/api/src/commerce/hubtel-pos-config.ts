import type { DatabasePool,DatabaseClient } from "../db.js";

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
export type HubtelPosConnection={
  businessId:string;collectionAccount:string;credentialAlias:string;
  apiId:string;apiKey:string;
};
type AccountRow={
  business_id:string;collection_account:string;credential_alias:string;
  enabled:boolean;approval_status:string;verified_at:Date|null;
};
type Cred={apiId:string;apiKey:string};
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
  const credentials=loadCredentials(row.credential_alias);
  if(!credentials)return null;
  return {businessId,collectionAccount:row.collection_account,
    credentialAlias:row.credential_alias,...credentials};
}
export async function requireHubtelPosConnection(
  db:Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">,businessId:string,
):Promise<HubtelPosConnection>{
  const connection=await hubtelPosConnection(db,businessId);
  if(!connection)posFail("Hubtel POS collections are not enabled for this business.",
    "HUBTEL_POS_DISABLED",503);
  return connection;
}
export function hubtelPosPublicOrigin():string {
  // Fixed trusted merchant-origin host, never taken from an untrusted request.
  return "https://tradeosafrica.lightworldtech.com";
}
