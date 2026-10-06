import { adjustValuation, signedMinor, addSignedMinor, safeMinor, proportionalMinor, quantityUnits } from "./valuation.js";
import { UnitConverter } from "@tradeos/domain";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";

export interface PurchaseReceiveMutationPayload {
  supplierId: string;
  settlementMethod: SettlementMethod;
  supplierReference?: string;
  receivedByStaffId?: string;
  lines: Array<{
    itemId: string;
    purchaseUnitCode: string;
    quantity: number;
    unitCostMinor: number;
  }>;
}

export interface PurchaseReceiveContext {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  occurredAt: string;
}

export interface PurchaseReceiveResult {
  purchaseId: string;
  status: "RECEIVED";
  totalMinor: number;
  lineCount: number;
  idempotentReplay: boolean;
}

type PurchaseItemRow = {
  id: string;
  name: string;
  stock_unit_code: string;
};
type ConversionRow = { from_unit_code: string; to_unit_code: string; factor: string | number };

export class PurchaseMutationError extends Error {
  constructor(message: string, readonly code = "PURCHASE_INVALID") { super(message); }
}

export async function applyPurchaseReceiveMutation(
  pool: DatabasePool,
  context: PurchaseReceiveContext,
  payload: PurchaseReceiveMutationPayload,
): Promise<PurchaseReceiveResult> {
  validate(context, payload);

  return withTransaction(pool, async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${context.businessId}:${context.clientMutationId}`]);
    const prior = await client.query<{ id: string; total_minor: string | number; status: string; branch_id: string }>(
      `SELECT id,total_minor,status,branch_id FROM purchases WHERE business_id=$1 AND client_mutation_id=$2`,
      [context.businessId, context.clientMutationId],
    );
    const replay = prior.rows[0];
    if (replay) {
      if (replay.branch_id !== context.branchId) throw new PurchaseMutationError("Purchase belongs to another branch", "BRANCH_MISMATCH");
      if (replay.status !== "RECEIVED") throw new PurchaseMutationError("Existing purchase receipt is not active", "PURCHASE_REPLAY_INVALID");
      return {
        purchaseId: replay.id,
        status: "RECEIVED",
        totalMinor: Number(replay.total_minor),
        lineCount: Number((await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM purchase_lines WHERE purchase_id=$1`, [replay.id])).rows[0]?.count ?? 0),
        idempotentReplay: true,
      };
    }

    const actor = await client.query(`SELECT id FROM staff WHERE id=$1 AND business_id=$2 AND is_active=true`,[payload.receivedByStaffId,context.businessId]);
    if (!actor.rowCount) throw new PurchaseMutationError("Staff actor unavailable", "STAFF_ACTOR_REQUIRED");
    const branch = await client.query<{ currency_code: string }>(
      `SELECT b.currency_code FROM businesses b
       JOIN branches br ON br.business_id=b.id
       WHERE b.id=$1 AND br.id=$2 AND br.is_active=true FOR SHARE OF b,br`,
      [context.businessId, context.branchId],
    );
    const currencyCode = branch.rows[0]?.currency_code;
    if (!currencyCode) throw new PurchaseMutationError("Branch was not found for this business", "BRANCH_NOT_FOUND");

    const supplier = await client.query<{ id: string; name: string }>(
      `SELECT id,name FROM suppliers WHERE id=$1 AND business_id=$2 AND is_active=true FOR UPDATE`,
      [payload.supplierId, context.businessId],
    );
    if (!supplier.rows[0]) throw new PurchaseMutationError("Supplier is not active for this business", "SUPPLIER_NOT_FOUND");

    const purchaseItemIds = [...new Set(payload.lines.map((line) => line.itemId))].sort();
    if (purchaseItemIds.length > 0) {
      await client.query(
        `SELECT id FROM catalog_items WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
        [context.businessId, purchaseItemIds],
      );
    }

    const purchaseInsert = await client.query<{ id: string }>(
      `INSERT INTO purchases (
         business_id,branch_id,supplier_id,received_by_staff_id,status,currency_code,
         supplier_reference,total_minor,client_mutation_id,received_at,settlement_method
       ) VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6,0,$7,$8,$9) RETURNING id`,
      [
        context.businessId,context.branchId,payload.supplierId,payload.receivedByStaffId ?? null,currencyCode,
        payload.supplierReference?.trim() || null,context.clientMutationId,context.occurredAt,payload.settlementMethod,
      ],
    );
    const purchaseId = purchaseInsert.rows[0]?.id;
    if (!purchaseId) throw new PurchaseMutationError("Purchase receipt could not be created", "PURCHASE_CREATE_FAILED");

    let totalMinor = 0;
    for (let index = 0; index < payload.lines.length; index += 1) {
      const requested = payload.lines[index]!;
      const item = await loadPurchaseItem(client, context.businessId, requested.itemId, requested.purchaseUnitCode);
      const stockQuantity = await convertToStockQuantity(client, item, requested.purchaseUnitCode, requested.quantity);
      quantityUnits(stockQuantity);
      const lineCostMinor = proportionalMinor(requested.unitCostMinor, requested.quantity, 1);
      if (!Number.isSafeInteger(lineCostMinor) || lineCostMinor < 0) {
        throw new PurchaseMutationError(`Purchase cost is too large for ${item.name}`, "PURCHASE_COST_INVALID");
      }

      const lineInsert = await client.query<{ id: string }>(
        `INSERT INTO purchase_lines (
           purchase_id,business_id,item_id,item_name_snapshot,purchase_unit_code,purchase_quantity,
           stock_unit_code,stock_quantity,unit_cost_minor,line_cost_minor
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          purchaseId,context.businessId,item.id,item.name,requested.purchaseUnitCode,requested.quantity,
          item.stock_unit_code,stockQuantity,requested.unitCostMinor,lineCostMinor,
        ],
      );
      const purchaseLineId = lineInsert.rows[0]?.id;
      if (!purchaseLineId) throw new PurchaseMutationError("Purchase line could not be created", "PURCHASE_LINE_CREATE_FAILED");

      await adjustValuation(client, context, item.id, "AVAILABLE", stockQuantity, lineCostMinor);
      await client.query(
        `INSERT INTO inventory_movements (
           business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,
           reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'AVAILABLE','PURCHASE_RECEIPT','PURCHASE_LINE',$6,$7,$8,$9)`,
        [
          context.businessId,context.branchId,item.id,item.stock_unit_code,stockQuantity,purchaseLineId,
          payload.receivedByStaffId ?? null,`${context.clientMutationId}:stock:${index}`,context.occurredAt,
        ],
      );
      totalMinor = safeMinor(totalMinor + lineCostMinor);
    }

    await client.query(`UPDATE purchases SET total_minor=$2 WHERE id=$1`, [purchaseId, totalMinor]);
    if (payload.settlementMethod === "SUPPLIER_CREDIT" && totalMinor > 0) {
      const balance = await client.query<{balance:string}>(`SELECT COALESCE(SUM(balance_delta_minor),0) AS balance FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2 AND currency_code=$3`,[context.businessId,payload.supplierId,currencyCode]);
      addSignedMinor(signedMinor(Number(balance.rows[0]?.balance ?? 0)), totalMinor);
      await client.query(
      `INSERT INTO supplier_payable_ledger (business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PURCHASE',$7,$8,$9,$10)`,
      [context.businessId,context.branchId,payload.supplierId,currencyCode,totalMinor,payload.settlementMethod,purchaseId,payload.receivedByStaffId,context.clientMutationId,context.occurredAt]);
    }
    await writeEvents(client, context, payload, purchaseId, totalMinor);
    return { purchaseId, status: "RECEIVED", totalMinor, lineCount: payload.lines.length, idempotentReplay: false };
  });
}

async function loadPurchaseItem(
  client: DatabaseClient,
  businessId: string,
  itemId: string,
  purchaseUnitCode: string,
): Promise<PurchaseItemRow> {
  const result = await client.query<PurchaseItemRow>(
    `SELECT ci.id,ci.name,ci.stock_unit_code
     FROM catalog_items ci
     JOIN catalog_item_units u ON u.business_id=ci.business_id AND u.item_id=ci.id
     WHERE ci.id=$1 AND ci.business_id=$2 AND ci.is_active=true AND ci.kind='PRODUCT'
       AND ci.track_stock=true AND ci.stock_unit_code IS NOT NULL
       AND u.unit_code=$3 AND u.can_purchase=true
     FOR UPDATE OF ci`,
    [itemId,businessId,purchaseUnitCode],
  );
  const item = result.rows[0];
  if (!item) throw new PurchaseMutationError("Item/unit is not configured for purchasing", "ITEM_NOT_PURCHASABLE");
  return item;
}

async function convertToStockQuantity(
  client: DatabaseClient,
  item: PurchaseItemRow,
  purchaseUnitCode: string,
  quantity: number,
): Promise<number> {
  if (purchaseUnitCode === item.stock_unit_code) return quantity;
  const conversions = await client.query<ConversionRow>(
    `SELECT from_unit_code,to_unit_code,factor FROM item_unit_conversions WHERE item_id=$1`, [item.id],
  );
  const converter = new UnitConverter(conversions.rows.map((row) => ({
    from: row.from_unit_code,
    to: row.to_unit_code,
    factor: Number(row.factor),
  })));
  try {
    const converted = converter.convert(quantity, purchaseUnitCode, item.stock_unit_code);
    if (!Number.isFinite(converted) || converted <= 0 || converted > Number.MAX_SAFE_INTEGER) throw new Error("Invalid converted quantity");
    return converted;
  } catch {
    throw new PurchaseMutationError(
      `No conversion from ${purchaseUnitCode} to ${item.stock_unit_code} for ${item.name}`,
      "PURCHASE_UNIT_CONVERSION_MISSING",
    );
  }
}

function validate(context: PurchaseReceiveContext, payload: PurchaseReceiveMutationPayload): void {
  if (!context.branchId || !context.clientMutationId) throw new PurchaseMutationError("branchId and clientMutationId are required");
  if (Number.isNaN(Date.parse(context.occurredAt))) throw new PurchaseMutationError("occurredAt must be an ISO date-time");
  if (!settlementMethods.includes(payload.settlementMethod)) throw new PurchaseMutationError("Invalid settlement method");
  if (!payload.receivedByStaffId) throw new PurchaseMutationError("Authenticated staff actor required", "STAFF_ACTOR_REQUIRED");
  if (!payload.supplierId) throw new PurchaseMutationError("supplierId is required", "SUPPLIER_REQUIRED");
  if (payload.supplierReference && payload.supplierReference.trim().length > 160) throw new PurchaseMutationError("Supplier reference is too long");
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) throw new PurchaseMutationError("At least one purchase line is required");
  for (const line of payload.lines) {
    if (!line.itemId || !line.purchaseUnitCode?.trim()) throw new PurchaseMutationError("Purchase lines need an item and purchase unit");
    quantityUnits(line.quantity);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new PurchaseMutationError("Purchase quantity must be positive");
    if (!Number.isSafeInteger(line.unitCostMinor) || line.unitCostMinor < 0) throw new PurchaseMutationError("Unit cost must be a non-negative minor-unit integer");
  }
}

async function writeEvents(
  client: DatabaseClient,
  context: PurchaseReceiveContext,
  payload: PurchaseReceiveMutationPayload,
  purchaseId: string,
  totalMinor: number,
): Promise<void> {
  const eventPayload = JSON.stringify({ supplierId: payload.supplierId, totalMinor, lineCount: payload.lines.length });
  await client.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at)
     VALUES ($1,$2,$3,'PURCHASE_RECEIVED','PURCHASE',$4,$5,$6::jsonb,$7)`,
    [context.businessId,context.branchId,payload.receivedByStaffId ?? null,purchaseId,context.clientMutationId,eventPayload,context.occurredAt],
  );
  await client.query(
    `INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at)
     VALUES ($1,$2,'PURCHASE',$3,'PURCHASE_RECEIVED',$4::jsonb,$5)`,
    [context.businessId,context.branchId,purchaseId,eventPayload,context.occurredAt],
  );
}

export const settlementMethods = ["CASH","MOMO","CARD","BANK","OTHER","SUPPLIER_CREDIT"] as const;
export type SettlementMethod = typeof settlementMethods[number];
export interface SupplierPaymentPayload { supplierId: string; amountMinor: number; method: Exclude<SettlementMethod,"SUPPLIER_CREDIT">; paidByStaffId?: string }
export async function applySupplierPaymentMutation(pool: DatabasePool, context: PurchaseReceiveContext, payload: SupplierPaymentPayload) {
 if (!context.branchId || !context.clientMutationId || Number.isNaN(Date.parse(context.occurredAt))) throw new PurchaseMutationError("Invalid payment context");
 if (!payload.supplierId || !payload.paidByStaffId || !Number.isSafeInteger(payload.amountMinor) || payload.amountMinor <= 0 || !settlementMethods.includes(payload.method) || (payload.method as string) === "SUPPLIER_CREDIT") throw new PurchaseMutationError("Invalid supplier payment");
 return withTransaction(pool, async client => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${context.businessId}:${context.clientMutationId}`]);
  const branch = await client.query<{currency_code:string}>(`SELECT b.currency_code FROM businesses b JOIN branches br ON br.business_id=b.id WHERE b.id=$1 AND br.id=$2 AND br.is_active=true`,[context.businessId,context.branchId]);
  if (!branch.rows[0]) throw new PurchaseMutationError("Branch not found", "BRANCH_NOT_FOUND");
  const actor = await client.query(`SELECT id FROM staff WHERE business_id=$1 AND id=$2 AND is_active=true`,[context.businessId,payload.paidByStaffId]);
  if (!actor.rowCount) throw new PurchaseMutationError("Staff actor unavailable", "STAFF_ACTOR_REQUIRED");
  const supplier = await client.query(`SELECT id FROM suppliers WHERE business_id=$1 AND id=$2 FOR UPDATE`,[context.businessId,payload.supplierId]);
  if (!supplier.rowCount) throw new PurchaseMutationError("Supplier not found", "SUPPLIER_NOT_FOUND");
  const prior = await client.query<{id:string;branch_id:string;supplier_id:string;source_type:string}>(`SELECT id,branch_id,supplier_id,source_type FROM supplier_payable_ledger WHERE business_id=$1 AND client_mutation_id=$2`,[context.businessId,context.clientMutationId]);
  if (prior.rows[0]) {
   if (prior.rows[0].branch_id !== context.branchId || prior.rows[0].supplier_id !== payload.supplierId || prior.rows[0].source_type !== "PAYMENT") throw new PurchaseMutationError("Payment replay context differs", "PAYMENT_REPLAY_INVALID");
   return {paymentId:prior.rows[0].id,idempotentReplay:true};
  }
  const balance = await client.query<{balance:string}>(`SELECT COALESCE(SUM(balance_delta_minor),0) AS balance FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2 AND currency_code=$3`,[context.businessId,payload.supplierId,branch.rows[0].currency_code]);
  const outstanding = signedMinor(Number(balance.rows[0]?.balance ?? 0));
  if (outstanding <= 0 || payload.amountMinor > outstanding) throw new PurchaseMutationError("Payment exceeds positive supplier payable", "SUPPLIER_OVERPAYMENT");
  const result = await client.query<{id:string}>(`INSERT INTO supplier_payable_ledger (business_id,branch_id,supplier_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,client_mutation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,'PAYMENT',gen_random_uuid(),$7,$8,$9) RETURNING id`,[context.businessId,context.branchId,payload.supplierId,branch.rows[0].currency_code,-payload.amountMinor,payload.method,payload.paidByStaffId,context.clientMutationId,context.occurredAt]);
  const paymentId = result.rows[0]!.id;
  const eventPayload = JSON.stringify({supplierId:payload.supplierId,amountMinor:payload.amountMinor,method:payload.method});
  await client.query(`INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at) VALUES ($1,$2,$3,'SUPPLIER_PAYMENT_CREATED','SUPPLIER_PAYMENT',$4,$5,$6::jsonb,$7)`,[context.businessId,context.branchId,payload.paidByStaffId,paymentId,context.clientMutationId,eventPayload,context.occurredAt]);
  await client.query(`INSERT INTO outbox_events (business_id,branch_id,aggregate_type,aggregate_id,event_type,payload,occurred_at) VALUES ($1,$2,'SUPPLIER',$3,'SUPPLIER_PAYMENT_CREATED',$4::jsonb,$5)`,[context.businessId,context.branchId,payload.supplierId,eventPayload,context.occurredAt]);
  return {paymentId,balanceMinor:addSignedMinor(outstanding,-payload.amountMinor),idempotentReplay:false};
 });
}
