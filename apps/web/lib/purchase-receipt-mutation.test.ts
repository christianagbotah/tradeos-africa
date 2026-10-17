import { describe, expect, it } from "vitest";
import { buildPurchaseReceivePayload } from "./purchase-receipt-mutation";

describe("purchase receipt mutation contract", () => {
  it("exports a dedicated PURCHASE_RECEIVE_CREATE payload builder", () => {
    expect(buildPurchaseReceivePayload).toBeTypeOf("function");
  });

  it("sends the exact server contract for a paid purchase receipt", () => {
    const payload = buildPurchaseReceivePayload({
      supplierId: "supplier-1",
      settlementMethod: "BANK",
      supplierReference: "INV-0042",
      moneyAccountId: "account-1",
      lines: [
        {
          itemId: "item-1",
          purchaseUnitCode: "carton",
          quantity: 3,
          unitCostMinor: 12500,
        },
      ],
    });

    expect(payload).toEqual({
      supplierId: "supplier-1",
      settlementMethod: "BANK",
      supplierReference: "INV-0042",
      moneyAccountId: "account-1",
      lines: [
        {
          itemId: "item-1",
          purchaseUnitCode: "carton",
          quantity: 3,
          unitCostMinor: 12500,
        },
      ],
    });
    expect(payload).not.toHaveProperty("currencyCode");
    expect((payload.lines as Array<Record<string, unknown>>)[0]).not.toHaveProperty("costMinor");
  });

  it("never sends a money account for supplier credit", () => {
    expect(buildPurchaseReceivePayload({
      supplierId: "supplier-1",
      settlementMethod: "SUPPLIER_CREDIT",
      moneyAccountId: "must-not-leak",
      lines: [
        {
          itemId: "item-1",
          purchaseUnitCode: "bottle",
          quantity: 2,
          unitCostMinor: 15000,
        },
      ],
    })).toEqual({
      supplierId: "supplier-1",
      settlementMethod: "SUPPLIER_CREDIT",
      lines: [
        {
          itemId: "item-1",
          purchaseUnitCode: "bottle",
          quantity: 2,
          unitCostMinor: 15000,
        },
      ],
    });
  });
});
