import { describe, expect, it } from "vitest";
import { money, planSaleReturn, SaleReturnError, type SaleLineSnapshot } from "../src/index.js";

const currency = "GHS";

function productLine(overrides: Partial<SaleLineSnapshot> = {}): SaleLineSnapshot {
  return {
    id: "line-1",
    kind: "PRODUCT",
    quantitySold: 10,
    quantityPreviouslyReturned: 0,
    unitNet: money(currency, 1000),
    unitTax: money(currency, 150),
    unitCost: money(currency, 600),
    stockUnitId: "piece",
    stockQuantityPerSaleUnit: 1,
    ...overrides,
  };
}

describe("planSaleReturn", () => {
  it("plans a partial restockable return", () => {
    const plan = planSaleReturn([productLine()], {
      idempotencyKey: "return-001",
      reason: "Customer changed mind",
      refundMethod: "MOMO",
      lines: [{ saleLineId: "line-1", quantity: 2, disposition: "RESTOCK" }],
    });

    expect(plan.refundTotal.minor).toBe(2300);
    expect(plan.netRevenueReversalTotal.minor).toBe(2000);
    expect(plan.taxReversalTotal.minor).toBe(300);
    expect(plan.cogsReversalTotal.minor).toBe(1200);
    expect(plan.lines[0]?.inventoryEffect).toEqual({
      saleLineId: "line-1",
      quantity: 2,
      stockUnitId: "piece",
      destination: "AVAILABLE",
    });
  });

  it("restores the stock-unit quantity captured on the original sale", () => {
    const plan = planSaleReturn(
      [
        productLine({
          id: "whisky-glass",
          quantitySold: 15,
          unitNet: money(currency, 1800),
          unitTax: money(currency, 0),
          unitCost: money(currency, 1000),
          stockUnitId: "ml",
          stockQuantityPerSaleUnit: 50,
        }),
      ],
      {
        idempotencyKey: "return-glass-001",
        reason: "Wrong order",
        refundMethod: "CASH",
        lines: [{ saleLineId: "whisky-glass", quantity: 2, disposition: "RESTOCK" }],
      },
    );

    expect(plan.lines[0]?.inventoryEffect).toEqual({
      saleLineId: "whisky-glass",
      quantity: 100,
      stockUnitId: "ml",
      destination: "AVAILABLE",
    });
    expect(plan.refundTotal.minor).toBe(3600);
  });

  it("quarantines a returned product without making it saleable", () => {
    const plan = planSaleReturn([productLine()], {
      idempotencyKey: "return-002",
      reason: "Possible defect",
      refundMethod: "ORIGINAL_METHOD",
      lines: [{ saleLineId: "line-1", quantity: 1, disposition: "QUARANTINE" }],
    });

    expect(plan.lines[0]?.inventoryEffect?.destination).toBe("QUARANTINE");
  });

  it("does not recreate inventory when a returned product is discarded", () => {
    const plan = planSaleReturn([productLine()], {
      idempotencyKey: "return-003",
      reason: "Opened and unusable",
      refundMethod: "CASH",
      lines: [{ saleLineId: "line-1", quantity: 1, disposition: "DISCARD" }],
    });

    expect(plan.lines[0]?.inventoryEffect).toBeUndefined();
    expect(plan.cogsReversalTotal.minor).toBe(0);
    expect(plan.discardedCostTotal.minor).toBe(600);
  });

  it("supports a service refund without stock return", () => {
    const service: SaleLineSnapshot = {
      id: "service-1",
      kind: "SERVICE",
      quantitySold: 1,
      quantityPreviouslyReturned: 0,
      unitNet: money(currency, 5000),
      unitTax: money(currency, 0),
      unitCost: money(currency, 1200),
    };

    const plan = planSaleReturn([service], {
      idempotencyKey: "refund-haircut-001",
      reason: "Service complaint",
      refundMethod: "CASH",
      lines: [{ saleLineId: "service-1", quantity: 1, disposition: "NOT_APPLICABLE" }],
    });

    expect(plan.refundTotal.minor).toBe(5000);
    expect(plan.cogsReversalTotal.minor).toBe(0);
    expect(plan.lines[0]?.inventoryEffect).toBeUndefined();
  });

  it("does not reconstruct ingredients for a prepared-food refund", () => {
    const prepared: SaleLineSnapshot = {
      id: "waakye-medium",
      kind: "PREPARED_PRODUCT",
      quantitySold: 3,
      quantityPreviouslyReturned: 0,
      unitNet: money(currency, 3000),
      unitTax: money(currency, 0),
      unitCost: money(currency, 1340),
    };

    const plan = planSaleReturn([prepared], {
      idempotencyKey: "refund-waakye-001",
      reason: "Order rejected after serving",
      refundMethod: "CASH",
      lines: [{ saleLineId: "waakye-medium", quantity: 1, disposition: "DISCARD" }],
    });

    expect(plan.refundTotal.minor).toBe(3000);
    expect(plan.cogsReversalTotal.minor).toBe(0);
    expect(plan.discardedCostTotal.minor).toBe(1340);
    expect(plan.lines[0]?.inventoryEffect).toBeUndefined();
  });

  it("blocks returning more than the unreturned quantity", () => {
    expect(() =>
      planSaleReturn([productLine({ quantityPreviouslyReturned: 8 })], {
        idempotencyKey: "return-004",
        reason: "Too many",
        refundMethod: "CASH",
        lines: [{ saleLineId: "line-1", quantity: 3, disposition: "RESTOCK" }],
      }),
    ).toThrow(SaleReturnError);
  });
});
