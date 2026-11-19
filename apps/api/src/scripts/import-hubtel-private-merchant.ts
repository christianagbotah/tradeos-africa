/**
 * Privileged, local-only migration of an owner-approved Hubtel merchant account
 * into a SPECIFIC TradeOS business vault. Never exposed as an HTTP endpoint.
 * No production payment or SMS delivery is activated by this script.
 */
import {readFileSync} from "node:fs";
import {Pool} from "pg";
import {sealMerchantGatewayCredentials,sealSmsProviderSecret} from
  "../payment-providers/vault.js";
import {validateMerchantGatewayCredentials} from
  "../payment-providers/merchant-schemas.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function envFile(path:string):Record<string,string>{
  const found:Record<string,string>={};
  for(const row of readFileSync(path,"utf8").split(/\r?\n/)){
    if(!/^HUBTEL_[A-Z0-9_]+=/.test(row))continue;
    const pos=row.indexOf("=");
    const value=row.slice(pos+1).trim().replace(/^("|')|("|')$/g,"");
    found[row.slice(0,pos)]=value;
  }
  return found;
}
export function hubtelPrivateImportFields(file:string){
  const values=envFile(file);
  const required=["HUBTEL_SALES_API_ID","HUBTEL_SALES_API_KEY",
    "HUBTEL_COLLECTION_ACCOUNT_NUMBER","HUBTEL_SMS_CLIENT_ID",
    "HUBTEL_SMS_CLIENT_SECRET","HUBTEL_SMS_SENDER_ID"];
  if(required.some(k=>!values[k]))throw new Error(
    "Hubtel private file is incomplete. No credentials were imported.");
  const fields=validateMerchantGatewayCredentials("HUBTEL","LIVE",{
    apiId:values.HUBTEL_SALES_API_ID,
    apiKey:values.HUBTEL_SALES_API_KEY,
    collectionAccount:values.HUBTEL_COLLECTION_ACCOUNT_NUMBER,
  });
  if(!/^[A-Za-z0-9]{1,11}$/.test(values.HUBTEL_SMS_SENDER_ID!)||
     !values.HUBTEL_SMS_CLIENT_ID||
     /[\r\n:]/.test(values.HUBTEL_SMS_CLIENT_ID)||
     !values.HUBTEL_SMS_CLIENT_SECRET||
     values.HUBTEL_SMS_CLIENT_SECRET.length<8||
     /[\r\n]/.test(values.HUBTEL_SMS_CLIENT_SECRET))
    throw new Error("Hubtel SMS credentials do not match supported format.");
  return {fields,smsClientId:values.HUBTEL_SMS_CLIENT_ID!,
    smsSecret:values.HUBTEL_SMS_CLIENT_SECRET!,
    smsSenderId:values.HUBTEL_SMS_SENDER_ID!};
}

async function main(){
  const args=process.argv.slice(2);
  const arg=(name:string)=>{
    const at=args.indexOf(name);return at>=0?args[at+1]:undefined;
  };
  const businessId=arg("--business-id");
  const expectedName=arg("--expected-business-name");
  const sourceFile=arg("--private-file");
  const apply=args.includes("--apply");
  if(!businessId||!UUID.test(businessId)||
     !expectedName||!sourceFile||!sourceFile.startsWith("/"))
    throw new Error("Supply exact business ID, exact business name, and absolute private file path.");
  const source=hubtelPrivateImportFields(sourceFile);
  if(source.fields.collectionAccount===process.env.TRADEOS_HUBTEL_COLLECTION_ACCOUNT)
    throw new Error("Merchant account cannot be TradeOS platform subscription account.");
  const pool=new Pool({
    host:process.env.TRADEOS_IMPORT_PG_SOCKET,
    port:Number(process.env.TRADEOS_IMPORT_PG_PORT),
    user:process.env.TRADEOS_IMPORT_PG_USER,
    database:process.env.TRADEOS_IMPORT_PG_DB,
    max:1,
  });
  const tx=await pool.connect();
  try{
    await tx.query("BEGIN");
    const business=(await tx.query<{name:string;country_code:string;
      currency_code:string;status:string}>(
      "SELECT name,country_code,currency_code,status FROM businesses "+
      "WHERE id=$1 FOR UPDATE",[businessId])).rows[0];
    if(!business||business.name!==expectedName||business.status!=="ACTIVE"||
       business.country_code.trim()!=="GH"||business.currency_code.trim()!=="GHS")
      throw new Error("Wrong tenant or market. Refusing to import merchant keys.");
    const owners=(await tx.query<{user_id:string}>(
      "SELECT user_id FROM business_memberships WHERE business_id=$1 "+
      "AND role='OWNER' AND status='ACTIVE'",[businessId])).rows;
    if(owners.length!==1)throw new Error(
      "Merchant must have exactly one active owning user to import credentials.");
    const existing=await tx.query(
      "SELECT 1 FROM business_merchant_gateway_credentials WHERE "+
      "business_id=$1 AND provider_code='HUBTEL' AND environment='LIVE'",
      [businessId]);
    const existingSms=await tx.query(
      "SELECT 1 FROM business_sms_provider_connections "+
      "WHERE business_id=$1 AND provider_code='HUBTEL_SMS'",[businessId]);
    if(existing.rowCount||existingSms.rowCount)throw new Error(
      "Hubtel keys are already saved. Use the authenticated portal to rotate them.");
    const other=await tx.query(
      "SELECT 1 FROM business_merchant_gateway_credentials "+
      "WHERE provider_code='HUBTEL' AND environment='LIVE' "+
      "AND account_reference=$1 AND status<>'REVOKED'",
      [source.fields.collectionAccount]);
    if(other.rowCount)throw new Error("Hubtel account belongs to another TradeOS tenant.");
    if(!apply){
      await tx.query("ROLLBACK");
      console.log("DRY RUN: Lightworld business and two empty credential vaults verified. No changes.");
      return;
    }
    const payment=sealMerchantGatewayCredentials(businessId,"HUBTEL","LIVE",source.fields);
    const sms=sealSmsProviderSecret(businessId,"HUBTEL_SMS",source.smsSecret);
    await tx.query(
      "INSERT INTO business_merchant_gateway_credentials "+
      "(business_id,provider_code,environment,account_reference,"+
      "encrypted_credentials,nonce,auth_tag,changed_by_user_id) "+
      "VALUES($1,'HUBTEL','LIVE',$2,$3,$4,$5,$6)",
      [businessId,source.fields.collectionAccount,
        payment.encrypted,payment.nonce,payment.tag,owners[0]!.user_id]);
    await tx.query(
      "INSERT INTO business_merchant_gateway_credential_audit "+
      "(business_id,provider_code,environment,event_type,revision,actor_user_id) "+
      "VALUES($1,'HUBTEL','LIVE','CREDENTIAL_SAVED',1,$2)",
      [businessId,owners[0]!.user_id]);
    await tx.query(
      "INSERT INTO business_sms_provider_connections "+
      "(business_id,provider_code,account_id,sender_id,credential_status,"+
      "encrypted_secret,nonce,auth_tag,revision,enabled,changed_by_user_id) "+
      "VALUES($1,'HUBTEL_SMS',$2,$3,'SAVED_UNVERIFIED',$4,$5,$6,1,false,$7)",
      [businessId,source.smsClientId,source.smsSenderId,
        sms.encrypted,sms.nonce,sms.tag,owners[0]!.user_id]);
    await tx.query(
      "INSERT INTO business_sms_provider_connection_audit "+
      "(business_id,provider_code,event_type,revision,actor_user_id) "+
      "VALUES($1,'HUBTEL_SMS','CREDENTIAL_SAVED',1,$2)",
      [businessId,owners[0]!.user_id]);
    await tx.query("COMMIT");
    console.log("Merchant-owned Hubtel payment and SMS credentials encrypted for chosen business. LIVE collection and bulk SMS remain disabled.");
  }catch(error){
    await tx.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{tx.release();await pool.end();}
}
if(process.argv[1]?.endsWith("import-hubtel-private-merchant.ts")){
  main().catch(()=>{console.error("Hubtel credential import stopped safely without disclosing secrets.");
    process.exitCode=1;});
}
