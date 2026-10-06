import type { DatabaseClient } from "../db.js";

type Context = { businessId: string; branchId: string };
export type ValuationLocation = "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "WASTE";

export function signedMinor(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("Invalid or unsafe signed minor-unit amount");
  return value;
}
export function addSignedMinor(left: number, right: number): number {
  const result = BigInt(signedMinor(left)) + BigInt(signedMinor(right));
  return signedMinor(Number(result));
}
export function quantityFromUnits(value: bigint): number { return Number(value) / 1e8; }
export function proportionalQuantity(total: number, numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Invalid quantity denominator");
  return (quantityUnits(total) * numerator + denominator / 2n) / denominator;
}
export function cumulativeMinor(total: number, numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error("Invalid cost denominator");
  return safeMinor(Number((BigInt(safeMinor(total)) * numerator + denominator / 2n) / denominator));
}

export function safeMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid or unsafe minor-unit amount");
  return value;
}

/** Quantities use the database's eight decimal places; scaled arithmetic avoids float money multiplication. */
export function quantityUnits(quantity: number): bigint {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > Number.MAX_SAFE_INTEGER / 1e8) {
    throw new Error("Unsafe stock quantity");
  }
  return BigInt(Math.round(quantity * 1e8));
}

export function proportionalMinor(amount: number, numerator: number, denominator: number): number {
  safeMinor(amount);
  const n = quantityUnits(numerator);
  const d = quantityUnits(denominator);
  if (d <= 0n) throw new Error("Invalid cost denominator");
  const value = (BigInt(amount) * n + d / 2n) / d;
  const asNumber = Number(value);
  return safeMinor(asNumber);
}

async function ensureValuationRow(
  client: DatabaseClient,
  context: Context,
  itemId: string,
  location: ValuationLocation,
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_valuations (business_id,branch_id,item_id,location_type,quantity)
     SELECT $1,$2,$3,$4,GREATEST(COALESCE(SUM(quantity_delta),0),0)
     FROM inventory_movements
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4
     ON CONFLICT DO NOTHING`,
    [context.businessId, context.branchId, itemId, location],
  );
}

export async function adjustValuation(
  client: DatabaseClient,
  context: Context,
  itemId: string,
  location: ValuationLocation,
  quantityDelta: number,
  valueDelta: number,
): Promise<void> {
  quantityUnits(Math.abs(quantityDelta));
  if (!Number.isSafeInteger(valueDelta)) throw new Error("Unsafe valuation amount");
  await ensureValuationRow(client, context, itemId, location);
  const result = await client.query<{ quantity: string; value_minor: string }>(
    `SELECT quantity,value_minor FROM inventory_valuations
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4 FOR UPDATE`,
    [context.businessId, context.branchId, itemId, location],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inventory valuation row could not be loaded");
  const quantityScaled = quantityUnits(Number(row.quantity)) + (quantityDelta < 0 ? -quantityUnits(-quantityDelta) : quantityUnits(quantityDelta));
  if (quantityScaled < 0n) throw new Error("Invalid valuation quantity");
  const quantity = quantityFromUnits(quantityScaled);
  const value = addSignedMinor(Number(row.value_minor), valueDelta);
  if (!Number.isFinite(quantity) || quantity < -Number.EPSILON) throw new Error("Invalid valuation quantity");
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid valuation amount");
  await client.query(
    `UPDATE inventory_valuations SET quantity=$5,value_minor=$6
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4`,
    [context.businessId, context.branchId, itemId, location, Math.max(0, quantity), value],
  );
}

export async function consumeValuation(
  client: DatabaseClient,
  context: Context,
  itemId: string,
  quantity: number,
  location: ValuationLocation = "AVAILABLE",
): Promise<number> {
  quantityUnits(quantity);
  await ensureValuationRow(client, context, itemId, location);
  const result = await client.query<{ quantity: string; value_minor: string }>(
    `SELECT quantity,value_minor FROM inventory_valuations
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4 FOR UPDATE`,
    [context.businessId, context.branchId, itemId, location],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Inventory valuation row could not be loaded");
  const available = Number(row.quantity);
  const currentValue = safeMinor(Number(row.value_minor));
  if (quantityUnits(available) < quantityUnits(quantity)) throw new Error("Inventory valuation is below the requested stock quantity");
  if (available <= 0 || quantity === 0) return 0;
  const cost = proportionalMinor(currentValue, quantity, available);
  await client.query(
    `UPDATE inventory_valuations SET quantity=$5,value_minor=$6
     WHERE business_id=$1 AND branch_id=$2 AND item_id=$3 AND location_type=$4`,
    [context.businessId, context.branchId, itemId, location, quantityFromUnits(quantityUnits(available) - quantityUnits(quantity)), currentValue - cost],
  );
  return cost;
}
