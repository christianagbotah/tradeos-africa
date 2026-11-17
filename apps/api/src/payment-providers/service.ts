import type {DatabasePool,DatabaseClient} from "../db.js";
import {withTransaction} from "../db.js";
import {AuthError} from "../auth/security.js";
import {availableGateways,gatewayFor,gatewaySupported,type GatewayCode} from "./catalog.js";
import {hubtelPosConnection} from "../commerce/hubtel-pos-config.js";

type PreferenceRow={provider_code:GatewayCode;revision:number;updated_at:Date};
type BusinessRow={country_code:string;currency_code:string};
type Queryable=Pick<DatabasePool,"query">|Pick<DatabaseClient,"query">;

export async function selectedGateway(db:Queryable,businessId:string):Promise<GatewayCode>{
  const row=await db.query<{provider_code:GatewayCode}>(
    "SELECT provider_code FROM business_payment_gateway_preferences WHERE business_id=$1",
    [businessId]);
  // No existing merchant changes behavior: Hubtel remains the legacy default.
  return row.rows[0]?.provider_code??"HUBTEL";
}
export async function requireHubtelPreference(db:Queryable,businessId:string):Promise<void>{
  if(await selectedGateway(db,businessId)!=="HUBTEL"){
    throw new AuthError("This business selected another payment provider. "+
      "Electronic sales must use its approved provider; no fallback checkout was started.",
      409,"PAYMENT_PROVIDER_NOT_SELECTED");
  }
}

export async function paymentGatewayOptions(pool:DatabasePool,businessId:string){
  const [business,preference]=await Promise.all([
    pool.query<BusinessRow>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1",[businessId]),
    pool.query<PreferenceRow>(
      "SELECT provider_code,revision,updated_at FROM business_payment_gateway_preferences "+
      "WHERE business_id=$1",[businessId]),
  ]);
  const b=business.rows[0];
  if(!b)throw new AuthError("Business not found",404,"BUSINESS_NOT_FOUND");
  const current=preference.rows[0];
  const market=availableGateways(b.country_code.trim(),b.currency_code.trim());
  const legacyEligible=market.some(x=>x.code==="HUBTEL"&&x.eligible);
  const hubtelActive=legacyEligible &&
    (current?.provider_code??"HUBTEL")==="HUBTEL" &&
    (await hubtelPosConnection(pool,businessId))!==null;
  return {
    businessId,countryCode:b.country_code.trim(),currencyCode:b.currency_code.trim(),
    preferredProvider:current?.provider_code??null,
    effectiveLegacyProvider:current||!legacyEligible?null:"HUBTEL",
    revision:current?.revision??0,
    updatedAt:current?.updated_at?.toISOString()??null,
    // Readiness is distinct from selecting a preferred gateway.
    providers:market,
    collectionReady:hubtelActive,
    notice:"Saving a preference does not connect an account or enable collection. "+
      "Only verified merchant credentials and independently checked settlement can activate a gateway.",
  };
}
export async function savePreferredGateway(pool:DatabasePool,input:{
  businessId:string;providerCode:unknown;expectedRevision:unknown;actorUserId:string;
}){
  const gateway=gatewayFor(input.providerCode);
  if(!gateway)throw new AuthError("Choose a listed payment provider.",400,"PAYMENT_PROVIDER_INVALID");
  if(!Number.isSafeInteger(input.expectedRevision)||
     (input.expectedRevision as number)<0){
    throw new AuthError("Refresh the payment options before saving.",400,
      "PAYMENT_PROVIDER_REVISION_REQUIRED");
  }
  return withTransaction(pool,async tx=>{
    // Business row lock serializes concurrent first preference writes too.
    const business=(await tx.query<BusinessRow>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1 FOR UPDATE",
      [input.businessId])).rows[0];
    if(!business)throw new AuthError("Business not found",404,"BUSINESS_NOT_FOUND");
    if(!gatewaySupported(gateway,business.country_code.trim(),business.currency_code.trim())){
      throw new AuthError("This provider is not listed for your business country and currency.",
        422,"PAYMENT_PROVIDER_MARKET_UNAVAILABLE");
    }
    const previous=(await tx.query<PreferenceRow>(
      "SELECT provider_code,revision,updated_at FROM business_payment_gateway_preferences "+
      "WHERE business_id=$1 FOR UPDATE",[input.businessId])).rows[0];
    const revision=previous?.revision??0;
    if(revision!==input.expectedRevision)throw new AuthError(
      "Payment provider selection changed. Refresh before trying again.",
      409,"PAYMENT_PROVIDER_REVISION_CONFLICT");
    if(previous?.provider_code===gateway.code){
      return {providerCode:gateway.code,revision,changed:false};
    }
    const nextRevision=revision+1;
    await tx.query(
      "INSERT INTO business_payment_gateway_preferences "+
      "(business_id,provider_code,revision,changed_by_user_id) VALUES($1,$2,$3,$4) "+
      "ON CONFLICT (business_id) DO UPDATE SET provider_code=$2,revision=$3,"+
      "changed_by_user_id=$4,updated_at=now()",
      [input.businessId,gateway.code,nextRevision,input.actorUserId]);
    await tx.query(
      "INSERT INTO business_payment_gateway_preference_audit "+
      "(business_id,previous_provider_code,provider_code,actor_user_id,revision) "+
      "VALUES($1,$2,$3,$4,$5)",
      [input.businessId,previous?.provider_code??null,gateway.code,
        input.actorUserId,nextRevision]);
    return {providerCode:gateway.code,revision:nextRevision,changed:true};
  });
}
