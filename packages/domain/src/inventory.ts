export type InventoryLocationType = "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "WASTE";

export type InventoryMovementReason =
  | "OPENING_BALANCE"
  | "PURCHASE_RECEIPT"
  | "SALE"
  | "SALE_RETURN"
  | "TRANSFER"
  | "TRANSFORMATION_INPUT"
  | "TRANSFORMATION_OUTPUT"
  | "SERVICE_CONSUMPTION"
  | "RECIPE_CONSUMPTION"
  | "WASTAGE"
  | "ADJUSTMENT";

export interface InventoryMovement {
  id: string;
  idempotencyKey: string;
  businessId: string;
  branchId: string;
  productId: string;
  stockUnitId: string;
  /** Positive adds stock to the location; negative removes it. */
  quantityDelta: number;
  locationType: InventoryLocationType;
  reason: InventoryMovementReason;
  referenceType: string;
  referenceId: string;
  actorId: string;
  occurredAt: string;
}

export class InventoryError extends Error {}

/** Inventory is derived from immutable movements instead of overwritten balances. */
export function deriveInventoryBalance(
  movements: InventoryMovement[],
  filter: {
    businessId: string;
    branchId: string;
    productId: string;
    stockUnitId: string;
    locationType?: InventoryLocationType;
  },
): number {
  return movements.reduce((balance, movement) => {
    if (
      movement.businessId !== filter.businessId ||
      movement.branchId !== filter.branchId ||
      movement.productId !== filter.productId ||
      movement.stockUnitId !== filter.stockUnitId ||
      (filter.locationType !== undefined && movement.locationType !== filter.locationType)
    ) {
      return balance;
    }
    if (!Number.isFinite(movement.quantityDelta)) {
      throw new InventoryError(`Movement ${movement.id} has an invalid quantity`);
    }
    return balance + movement.quantityDelta;
  }, 0);
}

export function assertUniqueInventoryIdempotencyKeys(movements: InventoryMovement[]): void {
  const seen = new Set<string>();
  for (const movement of movements) {
    if (!movement.idempotencyKey.trim()) {
      throw new InventoryError(`Movement ${movement.id} has no idempotency key`);
    }
    if (seen.has(movement.idempotencyKey)) {
      throw new InventoryError(`Duplicate inventory idempotency key: ${movement.idempotencyKey}`);
    }
    seen.add(movement.idempotencyKey);
  }
}
