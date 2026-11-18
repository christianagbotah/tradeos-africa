import type {DatabasePool} from "../db.js";
import {AuthError} from "../auth/security.js";
import {gatewayFor,gatewaySupported} from "./catalog.js";
import {selectedGateway} from "./service.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type EligibleSaleRow={
  id:string;branch_id:string;branch_name:string;opened_at:Date;
  amount_minor:string;currency_code:string;payment_method:"MOMO"|"CARD";
};
type MarketRow={country_code:string;currency_code:string};
type ConnectionRow={revision:number};

/** Read-only picker, never a substitute for transactional preparation gates.
 * Does not expose customers, payment references or full sale contents. */
export async function listEligibleGatewayTestSales(pool:DatabasePool,input:{
  businessId:string;branchId?:string;limit?:number;
}){
  if(!UUID.test(input.businessId)||(input.branchId&&!UUID.test(input.branchId)))
    throw new AuthError("Invalid business or branch ID.",400,
      "GATEWAY_TEST_PICKER_INVALID_ID");
  const limit=Math.min(60,Math.max(1,
    Number.isSafeInteger(input.limit)?input.limit!:30));
  const [marketResult,provider]=await Promise.all([
    pool.query<MarketRow>(
      "SELECT country_code,currency_code FROM businesses WHERE id=$1",
      [input.businessId]),
    selectedGateway(pool,input.businessId),
  ]);
  const market=marketResult.rows[0];
  if(!market)throw new AuthError("Business not found.",404,
    "BUSINESS_NOT_FOUND");
  const host=provider==="PAYSTACK"||provider==="FLUTTERWAVE";
  const supported=host&&gatewaySupported(gatewayFor(provider)!,
    market.country_code.trim(),market.currency_code.trim());
  const connection=supported?(await pool.query<ConnectionRow>(
    "SELECT revision FROM business_gateway_connections "+
    "WHERE business_id=$1 AND provider_code=$2 AND environment='TEST' "+
    "AND connection_status='PENDING_VERIFICATION' AND enabled=false",
    [input.businessId,provider])).rows[0]:null;
  const ready=Boolean(supported&&connection);
  const reason=!host?"SELECT_PAYSTACK_OR_FLUTTERWAVE":
    !supported?"GATEWAY_NOT_SUPPORTED_FOR_MARKET":
    !connection?"SAVE_MERCHANT_TEST_KEY":null;
  if(!ready)return {
    businessId:input.businessId,providerCode:provider,ready:false,
    reason,eligibleSales:[],collectionEnabled:false,
  };
  const result=await pool.query<EligibleSaleRow>(
    "SELECT s.id,s.branch_id,b.name AS branch_name,s.opened_at,"+
    "s.total_minor::text AS amount_minor,s.currency_code,"+
    "p.method AS payment_method FROM sales s "+
    "JOIN branches b ON b.id=s.branch_id AND b.business_id=s.business_id "+
    "JOIN payments p ON p.sale_id=s.id AND p.business_id=s.business_id "+
    "AND p.branch_id=s.branch_id "+
    "WHERE s.business_id=$1 AND ($2::uuid IS NULL OR s.branch_id=$2::uuid) "+
    "AND b.is_active=true AND s.status='OPEN' AND s.total_minor>0 "+
    "AND s.currency_code=$3 AND p.status='PENDING' "+
    "AND p.amount_minor=s.total_minor AND p.currency_code=s.currency_code "+
    "AND p.method IN ('MOMO','CARD') "+
    "AND NOT EXISTS(SELECT 1 FROM payments p2 "+
    "WHERE p2.business_id=s.business_id AND p2.sale_id=s.id AND p2.id<>p.id) "+
    "AND NOT EXISTS(SELECT 1 FROM gateway_collection_attempts a "+
    "WHERE a.business_id=s.business_id AND a.sale_id=s.id) "+
    "AND NOT EXISTS(SELECT 1 FROM hubtel_sale_checkout_attempts h "+
    "WHERE h.business_id=s.business_id AND h.sale_id=s.id) "+
    "ORDER BY s.opened_at DESC,s.id DESC LIMIT $4::int",
    [input.businessId,input.branchId??null,market.currency_code.trim(),limit]);
  return {
    businessId:input.businessId,providerCode:provider,
    ready:true as const,reason:null,collectionEnabled:false as const,
    eligibleSales:result.rows.map(s=>({
      saleId:s.id,branchId:s.branch_id,branchName:s.branch_name,
      openedAt:s.opened_at.toISOString(),amountMinor:s.amount_minor,
      currencyCode:s.currency_code.trim(),paymentMethod:s.payment_method,
    })),
  };
}
