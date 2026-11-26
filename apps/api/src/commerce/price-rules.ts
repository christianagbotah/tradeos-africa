import type { DatabaseClient,DatabasePool } from "../db.js";

type DB=Pick<DatabaseClient,"query">|Pick<DatabasePool,"query">;
export class PriceRuleError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode=400){
    super(message);this.name="PriceRuleError";
  }
}
export function pricingFail(message:string,code:string,statusCode=400):never {
  throw new PriceRuleError(message,code,statusCode);
}
export const PRICING_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pricingUuid(v:unknown,name:string):string {
  if(typeof v!=="string"||!PRICING_UUID.test(v))pricingFail(
    "Valid "+name+" is required","PRICING_ID_INVALID");
  return v;
}
export function pricingUnit(v:unknown):string {
  if(typeof v!=="string"||!/^[A-Za-z0-9_.-]{1,45}$/.test(v))
    pricingFail("Sale unit is invalid","PRICING_UNIT_INVALID");
  return v;
}
export function pricingMinor(v:unknown):number {
  if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||
    v>9_000_000_000_000) pricingFail("Price must be a nonnegative integer in minor units",
    "PRICING_MINOR_INVALID");
  return v;
}
export function pricingQty(v:unknown):number {
  if(typeof v!=="number"||!Number.isFinite(v)||v<=0||
    v>100000||Math.abs(v*1e8-Math.round(v*1e8))>0.0001)
    pricingFail("Quantity is not supported","PRICING_QUANTITY_INVALID");
  return v;
}
export async function priceCatalogBase(
  client:DatabaseClient,businessId:string,itemId:string,unitCode:string,
):Promise<{name:string,minor:number}> {
  const q=await client.query<{name:string;default_sale_price_minor:string|null}>(
    `SELECT ci.name,u.default_sale_price_minor FROM catalog_items ci
      JOIN catalog_item_units u ON u.item_id=ci.id AND u.business_id=ci.business_id
      WHERE ci.business_id=$1 AND ci.id=$2 AND ci.is_active=true
        AND u.unit_code=$3 AND u.can_sell=true`,[businessId,itemId,unitCode]);
  const row=q.rows[0];const price=Number(row?.default_sale_price_minor);
  if(!row||row.default_sale_price_minor===null||
    !Number.isSafeInteger(price)||price<0)pricingFail(
      "Sellable item and catalog price were not found","PRICING_ITEM_NOT_FOUND",404);
  return {name:row.name,minor:price};
}
export async function ensureCustomer(
  client:DatabaseClient,businessId:string,customerId:string|null){
  if(!customerId)return;
  const q=await client.query(
    "SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND is_active=true",
    [businessId,customerId]);
  if(!q.rows[0])pricingFail("Customer is not active in this business",
    "PRICING_CUSTOMER_UNAVAILABLE",404);
}
export async function resolveCustomerPrice(
  client:DatabaseClient,input:{
    businessId:string;customerId:string|null;itemId:string;unitCode:string;
    catalogMinor:number;
  },
):Promise<{unitPriceMinor:number;source:"CATALOG"|"CUSTOMER"}>{
  if(!input.customerId)return {unitPriceMinor:input.catalogMinor,source:"CATALOG"};
  const q=await client.query<{unit_price_minor:string}>(
    `SELECT unit_price_minor FROM customer_special_prices
      WHERE business_id=$1 AND customer_id=$2 AND item_id=$3 AND sale_unit_code=$4
      AND active=true AND effective_from<=now()
      AND (effective_until IS NULL OR effective_until>now())
      LIMIT 1`,
    [input.businessId,input.customerId,input.itemId,input.unitCode]);
  const special=q.rows[0]?Number(q.rows[0].unit_price_minor):null;
  if(special===null||!Number.isSafeInteger(special)||special<0||
    special>input.catalogMinor)
    return {unitPriceMinor:input.catalogMinor,source:"CATALOG"};
  return {unitPriceMinor:special,source:"CUSTOMER"};
}
