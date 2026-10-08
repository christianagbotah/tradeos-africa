import { randomUUID } from "node:crypto";
import type {
  InventoryAdjustmentInput,
  InventoryAdjustmentLocation,
  InventoryAdjustmentReasonCode,
  InventoryAdjustmentResult,
} from "@tradeos/contracts";
import type { DatabaseClient, DatabasePool } from "../db.js";
import { withTransaction } from "../db.js";
import { adjustValuation, proportionalMinor, quantityUnits, valuationSnapshotForUpdate } from "./valuation.js";

export type InventoryAdjustmentMutationPayload = InventoryAdjustmentInput & { actorStaffId?: string };
export type InventoryAdjustmentContext = {
  businessId: string;
  branchId: string;
  clientMutationId: string;
  occurredAt: string;
};

const locations: readonly InventoryAdjustmentLocation[] = ["AVAILABLE", "QUARANTINE", "DAMAGED", "WASTE"];
const reasonCodes: readonly InventoryAdjustmentReasonCode[] = ["COUNT_CORRECTION", "QUARANTINE", "DAMAGE", "WASTE", "OTHER"];

type ItemRow = { id: string; stock_unit_code: string | null; track_stock: boolean };

export class InventoryAdjustmentError extends Error {
  constructor(message: string, readonly code = "INVENTORY_ADJUSTMENT_INVALID", readonly statusCode = 400) {
    super(message);
  }
}

export async function applyInventoryAdjustmentMutation(
  pool: DatabasePool,
  context: InventoryAdjustmentContext,
  payload: InventoryAdjustmentMutationPayload,
): Promise<InventoryAdjustmentResult> {
  const input = validate(payload);
  return withTransaction(pool, async (client) => {
    const branch = await client.query(
      `SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`,
      [context.branchId, context.businessId],
    );
    if (branch.rowCount !== 1) throw new InventoryAdjustmentError("Inventory branch was not found", "INVENTORY_BRANCH_NOT_FOUND", 404);

    const itemResult = await client.query<ItemRow>(
      `SELECT id,stock_unit_code,track_stock FROM catalog_items
       WHERE id=$1 AND business_id=$2 FOR UPDATE`,
      [input.itemId, context.businessId],
    );
    const item = itemResult.rows[0];
    if (!item) throw new InventoryAdjustmentError("Inventory item was not found", "INVENTORY_ITEM_NOT_FOUND", 404);
    if (!item.track_stock || !item.stock_unit_code) {
      throw new InventoryAdjustmentError("This item does not use tracked stock", "INVENTORY_ITEM_NOT_TRACKED", 409);
    }

    let movedValueMinor = 0;
    if (input.sourceLocation) {
      const source = await valuationSnapshotForUpdate(client, context, input.itemId, input.sourceLocation);
      if (quantityUnits(source.quantity) < quantityUnits(input.quantity)) {
        throw new InventoryAdjustmentError(
          `Only ${source.quantity} stock units are available in ${input.sourceLocation.toLowerCase()}`,
          "INVENTORY_INSUFFICIENT_STOCK",
          409,
        );
      }
      movedValueMinor = source.quantity > 0
        ? proportionalMinor(source.valueMinor, input.quantity, source.quantity)
        : 0;
      await adjustValuation(client, context, input.itemId, input.sourceLocation, -input.quantity, -movedValueMinor);
    } else if (input.destinationLocation) {
      movedValueMinor = await valueForCountIncrease(client, context, input.itemId, input.destinationLocation, input.quantity);
    }

    if (input.destinationLocation) {
      await adjustValuation(client, context, input.itemId, input.destinationLocation, input.quantity, movedValueMinor);
    }

    const adjustmentId = randomUUID();
    if (input.sourceLocation) {
      await insertMovement(client, context, input, adjustmentId, item.stock_unit_code, input.sourceLocation, -input.quantity, payload.actorStaffId ?? null, "source");
    }
    if (input.destinationLocation) {
      await insertMovement(client, context, input, adjustmentId, item.stock_unit_code, input.destinationLocation, input.quantity, payload.actorStaffId ?? null, "destination");
    }

    const balances = await loadBalances(client, context, input.itemId);
    const inventoryValueMinor = await loadInventoryValue(client, context, input.itemId);
    await client.query(
      `INSERT INTO audit_events (
         business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,correlation_id,payload,occurred_at
       ) VALUES ($1,$2,$3,'INVENTORY_ADJUSTMENT_CREATED','INVENTORY_ADJUSTMENT',$4,$5,$6::jsonb,$7)`,
      [
        context.businessId, context.branchId, payload.actorStaffId ?? null, adjustmentId, context.clientMutationId,
        JSON.stringify({
          itemId: input.itemId,
          sourceLocation: input.sourceLocation ?? null,
          destinationLocation: input.destinationLocation ?? null,
          quantity: input.quantity,
          movedValueMinor,
          reasonCode: input.reasonCode,
          note: input.note,
          balances,
          inventoryValueMinor,
        }),
        context.occurredAt,
      ],
    );

    return {
      adjustmentId,
      itemId: input.itemId,
      sourceLocation: input.sourceLocation ?? null,
      destinationLocation: input.destinationLocation ?? null,
      quantity: input.quantity,
      movedValueMinor,
      reasonCode: input.reasonCode,
      balances,
      inventoryValueMinor,
    };
  });
}

async function valueForCountIncrease(
  client: DatabaseClient,
  context: InventoryAdjustmentContext,
  itemId: string,
  destination: InventoryAdjustmentLocation,
  quantity: number,
): Promise<number> {
  const destinationSnapshot = await valuationSnapshotForUpdate(client, context, itemId, destination);
  if (destinationSnapshot.quantity > 0) {
    return proportionalMinor(destinationSnapshot.valueMinor, quantity, destinationSnapshot.quantity);
  }
  const totals = await client.query<{ quantity: string; value_minor: string }>(
    `SELECT COALESCE(SUM(quantity),0) AS quantity,COALESCE(SUM(value_minor),0) AS value_minor
     FROM inventory_valuations WHERE business_id=$1 AND branch_id=$2 AND item_id=$3`,
    [context.businessId, context.branchId, itemId],
  );
  const totalQuantity = Number(totals.rows[0]?.quantity ?? 0);
  const totalValueMinor = Number(totals.rows[0]?.value_minor ?? 0);
  return totalQuantity > 0 ? proportionalMinor(totalValueMinor, quantity, totalQuantity) : 0;
}

async function insertMovement(
  client: DatabaseClient,
  context: InventoryAdjustmentContext,
  input: ReturnType<typeof validate>,
  adjustmentId: string,
  stockUnitCode: string,
  location: InventoryAdjustmentLocation,
  quantityDelta: number,
  actorStaffId: string | null,
  suffix: string,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_movements (
       business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,reason,
       reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'ADJUSTMENT','INVENTORY_ADJUSTMENT',$7,$8,$9,$10)`,
    [
      context.businessId, context.branchId, input.itemId, stockUnitCode, quantityDelta, location,
      adjustmentId, actorStaffId, `${context.clientMutationId}:inventory-adjustment:${suffix}`, context.occurredAt,
    ],
  );
}

async function loadBalances(
  client: DatabaseClient,
  context: InventoryAdjustmentContext,
  itemId: string,
): Promise<Record<InventoryAdjustmentLocation, number>> {
  const result = await client.query<{ location_type: InventoryAdjustmentLocation; quantity: string }>(
    `SELECT location_type,COALESCE(SUM(quantity_delta),0) AS quantity FROM inventory_movements
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 GROUP BY location_type`,
    [context.businessId, context.branchId, itemId],
  );
  const balances: Record<InventoryAdjustmentLocation, number> = { AVAILABLE: 0, QUARANTINE: 0, DAMAGED: 0, WASTE: 0 };
  for (const row of result.rows) balances[row.location_type] = Number(row.quantity);
  return balances;
}

async function loadInventoryValue(client: DatabaseClient, context: InventoryAdjustmentContext, itemId: string): Promise<number> {
  const result = await client.query<{ value_minor: string }>(
    `SELECT COALESCE(SUM(value_minor),0) AS value_minor FROM inventory_valuations
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3`,
    [context.businessId, context.branchId, itemId],
  );
  return Number(result.rows[0]?.value_minor ?? 0);
}

function validate(payload: InventoryAdjustmentMutationPayload) {
  const itemId = requiredString(payload.itemId, "itemId");
  const sourceLocation = optionalLocation(payload.sourceLocation, "sourceLocation");
  const destinationLocation = optionalLocation(payload.destinationLocation, "destinationLocation");
  if (!sourceLocation && !destinationLocation) {
    throw new InventoryAdjustmentError("Choose a source or destination stock location");
  }
  if (sourceLocation && destinationLocation && sourceLocation === destinationLocation) {
    throw new InventoryAdjustmentError("Source and destination stock locations must be different");
  }
  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    throw new InventoryAdjustmentError("Adjustment quantity must be greater than zero");
  }
  quantityUnits(payload.quantity);
  if (!reasonCodes.includes(payload.reasonCode)) throw new InventoryAdjustmentError("A valid adjustment reason is required");
  if (payload.reasonCode === "COUNT_CORRECTION" && Boolean(sourceLocation) === Boolean(destinationLocation)) {
    throw new InventoryAdjustmentError("Count correction must either add or remove stock, not reclassify it");
  }
  if (payload.reasonCode === "QUARANTINE" && destinationLocation !== "QUARANTINE") {
    throw new InventoryAdjustmentError("Quarantine adjustments must move stock to quarantine");
  }
  if (payload.reasonCode === "DAMAGE" && destinationLocation !== "DAMAGED") {
    throw new InventoryAdjustmentError("Damage adjustments must move stock to damaged stock");
  }
  if (payload.reasonCode === "WASTE" && destinationLocation !== "WASTE") {
    throw new InventoryAdjustmentError("Waste adjustments must move stock to waste");
  }
  const note = payload.note?.trim() || null;
  if (note && note.length > 1000) throw new InventoryAdjustmentError("Adjustment note must be at most 1000 characters");
  return { itemId, sourceLocation, destinationLocation, quantity: payload.quantity, reasonCode: payload.reasonCode, note };
}

function optionalLocation(value: unknown, name: string): InventoryAdjustmentLocation | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !locations.includes(value as InventoryAdjustmentLocation)) {
    throw new InventoryAdjustmentError(`${name} is invalid`);
  }
  return value as InventoryAdjustmentLocation;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new InventoryAdjustmentError(`${name} is required`);
  return value.trim();
}
