import { describe, expect, it } from "vitest";
import {
  assertUniqueInventoryIdempotencyKeys,
  deriveInventoryBalance,
  InventoryError,
  type InventoryMovement,
} from "../src/index.js";

const base: Omit<InventoryMovement, "id" | "idempotencyKey" | "quantityDelta" | "locationType" | "reason"> = {
  businessId: "biz-1",
  branchId: "branch-1",
  productId: "malt",
  stockUnitId: "bottle",
  referenceType: "test",
  referenceId: "ref-1",
  actorId: "user-1",
  occurredAt: "2026-10-06T00:00:00Z",
};

describe("inventory movements", () => {
  it("derives available and quarantine stock independently", () => {
    const movements: InventoryMovement[] = [
      {
        ...base,
        id: "m1",
        idempotencyKey: "k1",
        quantityDelta: 24,
        locationType: "AVAILABLE",
        reason: "PURCHASE_RECEIPT",
      },
      {
        ...base,
        id: "m2",
        idempotencyKey: "k2",
        quantityDelta: -3,
        locationType: "AVAILABLE",
        reason: "SALE",
      },
      {
        ...base,
        id: "m3",
        idempotencyKey: "k3",
        quantityDelta: 1,
        locationType: "QUARANTINE",
        reason: "SALE_RETURN",
      },
    ];

    expect(
      deriveInventoryBalance(movements, {
        businessId: "biz-1",
        branchId: "branch-1",
        productId: "malt",
        stockUnitId: "bottle",
        locationType: "AVAILABLE",
      }),
    ).toBe(21);

    expect(
      deriveInventoryBalance(movements, {
        businessId: "biz-1",
        branchId: "branch-1",
        productId: "malt",
        stockUnitId: "bottle",
        locationType: "QUARANTINE",
      }),
    ).toBe(1);
  });

  it("rejects duplicate idempotency keys", () => {
    const movements: InventoryMovement[] = [
      {
        ...base,
        id: "m1",
        idempotencyKey: "same-key",
        quantityDelta: 1,
        locationType: "AVAILABLE",
        reason: "ADJUSTMENT",
      },
      {
        ...base,
        id: "m2",
        idempotencyKey: "same-key",
        quantityDelta: 1,
        locationType: "AVAILABLE",
        reason: "ADJUSTMENT",
      },
    ];

    expect(() => assertUniqueInventoryIdempotencyKeys(movements)).toThrow(InventoryError);
  });
});
