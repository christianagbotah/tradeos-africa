import type { DatabaseClient } from "../db.js";
import {pricingFail,pricingUuid} from "./price-rules.js";

/**
 * An approved discount is NOT a capability bearer token. It is bound to
 * business, branch, original requester, customer, item, unit, quantity,
 * base price, expiry, and one successful sale (atomic UPDATE in transaction).
 */
export async function consumeApprovedDiscount(
  client:DatabaseClient,input:{
    businessId:string;branchId:string;customerId:string|null;
    cashierMembershipId:string|undefined;itemId:string;unitCode:string;
    quantity:number;basePriceMinor:number;approvalId:string;saleId:string;
  },
):Promise<number>{
  if(!input.cashierMembershipId)pricingFail(
    "A signed-in cashier identity is required",
    "PRICING_ACTOR_REQUIRED",403);
  const approvalId=pricingUuid(input.approvalId,"priceApprovalId");
  const q=await client.query<{
    status:string;branch_id:string;customer_id:string|null;item_id:string;
    sale_unit_code:string;quantity:string;base_unit_price_minor:string;
    requested_unit_price_minor:string;requested_by_membership_id:string;
    reviewed_by_membership_id:string|null;expires_at:Date|null;
  }>(
    `SELECT status,branch_id,customer_id,item_id,sale_unit_code,quantity,
      base_unit_price_minor,requested_unit_price_minor,
      requested_by_membership_id,reviewed_by_membership_id,expires_at
      FROM sale_price_approval_requests
      WHERE business_id=$1 AND id=$2 FOR UPDATE`,
    [input.businessId,approvalId]);
  const r=q.rows[0];
  if(!r||r.status!=="APPROVED"||r.expires_at===null||
    r.expires_at.getTime()<=Date.now())
    pricingFail("Discount approval is missing, expired or already used",
      "PRICING_APPROVAL_INACTIVE",409);
  if(r.branch_id!==input.branchId||r.customer_id!==input.customerId||
    r.item_id!==input.itemId||r.sale_unit_code!==input.unitCode||
    Number(r.quantity)!==input.quantity||
    r.requested_by_membership_id!==input.cashierMembershipId||
    r.reviewed_by_membership_id===input.cashierMembershipId||
    Number(r.base_unit_price_minor)!==input.basePriceMinor)
    pricingFail("Approval does not match this exact sale line",
      "PRICING_APPROVAL_SCOPE_MISMATCH",409);
  const special=Number(r.requested_unit_price_minor);
  if(!Number.isSafeInteger(special)||special<0||special>=input.basePriceMinor)
    pricingFail("Discount price is invalid","PRICING_APPROVAL_INVALID",409);
  await client.query(
    `UPDATE sale_price_approval_requests
      SET status='USED',used_sale_id=$3,used_at=now(),updated_at=now()
      WHERE business_id=$1 AND id=$2 AND status='APPROVED'`,
    [input.businessId,approvalId,input.saleId]);
  await client.query(
    `INSERT INTO audit_events(business_id,branch_id,event_type,entity_type,
      entity_id,payload)
      VALUES($1,$2,'SALE_DISCOUNT_USED','SALE_PRICE_APPROVAL',$3,$4::jsonb)`,
    [input.businessId,input.branchId,approvalId,JSON.stringify({
      saleId:input.saleId,itemId:input.itemId,
      unitCode:input.unitCode,quantity:input.quantity,
      priceMinor:special,basePriceMinor:input.basePriceMinor,
    })]);
  return special;
}
