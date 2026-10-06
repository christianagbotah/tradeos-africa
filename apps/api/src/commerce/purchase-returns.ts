import { recordCashbookEntry, isCashMethod } from "./cashbook.js";
import type { DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { reduceSupplierObligationForPurchase } from "./credit-obligations.js";
import { PurchaseMutationError, type PurchaseReceiveContext } from "./purchases.js";
import { addSignedMinor, consumeValuation, cumulativeMinor, proportionalQuantity, quantityFromUnits, quantityUnits, safeMinor, signedMinor } from "./valuation.js";

export const recoveryMethods = ["CREDIT_NOTE", "CASH", "MOMO", "CARD", "BANK", "OTHER"] as const;
export interface PurchaseReturnPayload {
 moneyAccountId?:string;
 originalPurchaseId: string;
 supplierId: string;
 returnedByStaffId?: string;
 recoveryMethod: typeof recoveryMethods[number];
 lines: Array<{ purchaseLineId: string; quantity: number; sourceLocation: "AVAILABLE" | "QUARANTINE" }>;
}
export async function applyPurchaseReturnMutation(pool: DatabasePool, context: PurchaseReceiveContext, payload: PurchaseReturnPayload) {
 if (!context.branchId || !context.clientMutationId || Number.isNaN(Date.parse(context.occurredAt)) || !payload.originalPurchaseId || !payload.supplierId || !payload.returnedByStaffId || !recoveryMethods.includes(payload.recoveryMethod) || !Array.isArray(payload.lines) || !payload.lines.length) throw new PurchaseMutationError("Invalid purchase return");
 if(payload.recoveryMethod=== "CREDIT_NOTE" && payload.moneyAccountId !== undefined) throw new PurchaseMutationError("Credit cannot have money account IDs");
 const seen = new Set<string>();
 for (const line of payload.lines) {
  if (!line.purchaseLineId || seen.has(line.purchaseLineId) || quantityUnits(line.quantity) <= 0n || !["AVAILABLE","QUARANTINE"].includes(line.sourceLocation)) throw new PurchaseMutationError("Invalid or duplicate return line");
  seen.add(line.purchaseLineId);
 }
 return withTransaction(pool, async client => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${context.businessId}:${context.clientMutationId}`]);
  const prior = await client.query(`SELECT * FROM purchase_return_cases WHERE business_id=$1 AND client_mutation_id=$2`,[context.businessId,context.clientMutationId]);
  if (prior.rows[0]) {
   const row = prior.rows[0];
   if (row.branch_id !== context.branchId || row.supplier_id !== payload.supplierId || row.original_purchase_id !== payload.originalPurchaseId) throw new PurchaseMutationError("Return replay context differs", "RETURN_REPLAY_INVALID");
   return {returnCaseId:row.id,supplierRecoveryMinor:Number(row.supplier_recovery_minor),inventoryValueRemovedMinor:Number(row.inventory_value_removed_minor),purchasePriceVarianceMinor:Number(row.purchase_price_variance_minor),idempotentReplay:true};
  }
  const actor = await client.query(`SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND is_active=true`,[payload.returnedByStaffId,context.businessId]);
  if (!actor.rowCount) throw new PurchaseMutationError("Staff actor unavailable", "STAFF_ACTOR_REQUIRED");
  const branch = await client.query(`SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true FOR SHARE`,[context.branchId,context.businessId]);
  if (!branch.rowCount) throw new PurchaseMutationError("Branch unavailable", "BRANCH_NOT_FOUND");
  const supplier = await client.query(`SELECT id FROM suppliers WHERE id=$1 AND business_id=$2 FOR UPDATE`,[payload.supplierId,context.businessId]);
  if (!supplier.rowCount) throw new PurchaseMutationError("Supplier unavailable", "SUPPLIER_NOT_FOUND");
  const purchase = (await client.query(`SELECT * FROM purchases WHERE id=$1 AND business_id=$2 AND branch_id=$3 AND supplier_id=$4 AND status='RECEIVED' FOR UPDATE`,[payload.originalPurchaseId,context.businessId,context.branchId,payload.supplierId])).rows[0];
  if (!purchase) throw new PurchaseMutationError("Original purchase unavailable", "PURCHASE_NOT_FOUND");
  const requestedLineIds = [...new Set(payload.lines.map((line) => line.purchaseLineId))].sort();
  const lockedLines = await client.query(
   `SELECT * FROM purchase_lines WHERE purchase_id=$1 AND business_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR UPDATE`,
   [purchase.id, context.businessId, requestedLineIds],
  );
  if (lockedLines.rows.length !== requestedLineIds.length) {
   throw new PurchaseMutationError("Original purchase line unavailable", "PURCHASE_LINE_NOT_FOUND");
  }
  const purchaseLineById = new Map(lockedLines.rows.map((line) => [line.id as string, line]));
  const returnItemIds = [...new Set(lockedLines.rows.map((line) => line.item_id as string))].sort();
  if (returnItemIds.length > 0) {
   await client.query(
    `SELECT id FROM catalog_items WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [context.businessId, returnItemIds],
   );
  }

  const returnCaseId = (await client.query<{id:string}>(`INSERT INTO purchase_return_cases (business_id,branch_id,supplier_id,original_purchase_id,returned_by_staff_id,currency_code,recovery_method,client_mutation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[context.businessId,context.branchId,payload.supplierId,purchase.id,payload.returnedByStaffId,purchase.currency_code,payload.recoveryMethod,context.clientMutationId,context.occurredAt])).rows[0]!.id;
  let recovery = 0, removed = 0;
  for (const requested of [...payload.lines].sort((a,b)=>a.purchaseLineId.localeCompare(b.purchaseLineId))) {
   const line = purchaseLineById.get(requested.purchaseLineId);
   if (!line) throw new PurchaseMutationError("Original purchase line unavailable", "PURCHASE_LINE_NOT_FOUND");
   const previous = (await client.query(`SELECT COALESCE(SUM(purchase_quantity),0) AS quantity FROM purchase_return_lines WHERE purchase_line_id=$1`,[line.id])).rows[0];
   const before = quantityUnits(Number(previous.quantity)), original = quantityUnits(Number(line.purchase_quantity));
   const after = before + quantityUnits(requested.quantity);
   if (after > original) throw new PurchaseMutationError("Return exceeds remaining purchased quantity", "PURCHASE_OVER_RETURN");
   const stockUnits = proportionalQuantity(Number(line.stock_quantity),after,original) - proportionalQuantity(Number(line.stock_quantity),before,original);
   if (stockUnits <= 0n) throw new PurchaseMutationError("Return stock quantity rounds to zero");
   const stock = quantityFromUnits(stockUnits);
   const amount = cumulativeMinor(Number(line.line_cost_minor),after,original) - cumulativeMinor(Number(line.line_cost_minor),before,original);
   let value: number;
   try {
    value = await consumeValuation(client,context,line.item_id,stock,requested.sourceLocation);
   } catch (error) {
    const message = error instanceof Error ? error.message : "Stock is unavailable";
    throw new PurchaseMutationError(`Cannot return ${stock} ${line.stock_unit_code} from ${requested.sourceLocation}: ${message}`, "PURCHASE_RETURN_STOCK_UNAVAILABLE");
   }
   const variance = addSignedMinor(amount,-value);
   const returnLineId = (await client.query<{id:string}>(`INSERT INTO purchase_return_lines (return_case_id,purchase_line_id,purchase_quantity,stock_quantity,source_location,supplier_recovery_minor,inventory_value_removed_minor,purchase_price_variance_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[returnCaseId,line.id,requested.quantity,stock,requested.sourceLocation,amount,value,variance])).rows[0]!.id;
   await client.query(`INSERT INTO inventory_movements (business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,'PURCHASE_RETURN','PURCHASE_RETURN_LINE',$7,$8,$9,$10)`,[context.businessId,context.branchId,line.item_id,line.stock_unit_code,-stock,requested.sourceLocation,returnLineId,payload.returnedByStaffId,`${context.clientMutationId}:stock:${line.id}`,context.occurredAt]);
   recovery = safeMinor(addSignedMinor(recovery,amount)); removed = safeMinor(addSignedMinor(removed,value));
  }
  const variance = addSignedMinor(recovery,-removed);
  await client.query(`UPDATE purchase_return_cases SET supplier_recovery_minor=$2,inventory_value_removed_minor=$3,purchase_price_variance_minor=$4 WHERE id=$1`,[returnCaseId,recovery,removed,variance]);
  if (payload.recoveryMethod === "CREDIT_NOTE" && recovery > 0) {
   const balance = (await client.query(`SELECT COALESCE(SUM(balance_delta_minor),0) AS balance FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2 AND currency_code=$3`,[context.businessId,payload.supplierId,purchase.currency_code])).rows[0];
   addSignedMinor(signedMinor(Number(balance.balance)),-recovery);
   await client.query(`INSERT INTO supplier_payable_ledger (business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,'CREDIT_NOTE','RETURN',$6,$7,$8,$9)`,[context.businessId,context.branchId,payload.supplierId,purchase.currency_code,-recovery,returnCaseId,payload.returnedByStaffId,context.clientMutationId,context.occurredAt]);
   await reduceSupplierObligationForPurchase(client,{businessId:context.businessId,purchaseId:purchase.id,sourceId:returnCaseId,amountMinor:recovery,occurredAt:context.occurredAt});
  }
  if (recovery > 0 && isCashMethod(payload.recoveryMethod)) await recordCashbookEntry(client,{...context,moneyAccountId:payload.moneyAccountId,currencyCode:purchase.currency_code,method:payload.recoveryMethod,amountDeltaMinor:recovery,entryType:"PURCHASE_RETURN_RECOVERY",sourceType:"PURCHASE_RETURN",sourceId:returnCaseId,actorStaffId:payload.returnedByStaffId,idempotencyKey:`purchase-return:${returnCaseId}`});
  const event = JSON.stringify({originalPurchaseId:purchase.id,supplierId:payload.supplierId,recoveryMethod:payload.recoveryMethod,supplierRecoveryMinor:recovery,inventoryValueRemovedMinor:removed,purchasePriceVarianceMinor:variance});
  await client.query(`INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at) VALUES ($1,$2,$3,'PURCHASE_RETURN_CREATED','PURCHASE_RETURN',$4,$5,$6::jsonb,$7)`,[context.businessId,context.branchId,payload.returnedByStaffId,returnCaseId,context.clientMutationId,event,context.occurredAt]);
  await client.query(`INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at) VALUES ($1,$2,'PURCHASE_RETURN',$3,'PURCHASE_RETURN_CREATED',$4::jsonb,$5)`,[context.businessId,context.branchId,returnCaseId,event,context.occurredAt]);
  return {returnCaseId,supplierRecoveryMinor:recovery,inventoryValueRemovedMinor:removed,purchasePriceVarianceMinor:variance,idempotentReplay:false};
 });
}
