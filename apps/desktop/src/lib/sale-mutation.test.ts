/**
 * Test: buildSaleMutation produces the canonical server-authoritative
 * SALE_CREATE shape — only itemId, saleUnitCode, quantity per line; no
 * client-side prices/totals.
 */
import { describe, expect, it } from "vitest";
import { buildSaleMutation } from "./sale-mutation.js";
import type { DesktopCartLine, DesktopPaymentMethod } from "./types.js";

function makeLine(overrides: Partial<DesktopCartLine> = {}): DesktopCartLine {
  return {
    key: "item-1:bag",
    itemId: "item-1",
    saleUnitCode: "bag",
    quantity: 2,
    displayName: "Cement 50kg",
    displaySku: "CEM-50",
    displayUnitLabel: "Bag",
    displayPriceMinor: 12000,
    ...overrides,
  };
}

const baseInput = {
  clientId: "desktop-device-1",
  clientMutationId: "mutation-1",
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  currencyCode: "GHS",
  paymentMethod: "CASH" as DesktopPaymentMethod,
  occurredAt: "2026-10-10T22:00:00.000Z",
};

describe("buildSaleMutation — server-authoritative shape", () => {
  it("returns a SALE_CREATE mutation with only itemId/saleUnitCode/quantity per line", () => {
    const mutation = buildSaleMutation({
      ...baseInput,
      cart: [makeLine(), makeLine({ key: "item-2:tin", itemId: "item-2", saleUnitCode: "tin", quantity: 1 })],
    });

    expect(mutation.mutationType).toBe("SALE_CREATE");
    expect(mutation.businessId).toBe(baseInput.businessId);
    expect(mutation.branchId).toBe(baseInput.branchId);
    expect(mutation.clientId).toBe(baseInput.clientId);
    expect(mutation.clientMutationId).toBe(baseInput.clientMutationId);
    expect(mutation.occurredAt).toBe(baseInput.occurredAt);

    // Payload contains only the canonical fields.
    expect(mutation.payload.currencyCode).toBe("GHS");
    expect(mutation.payload.paymentMethod).toBe("CASH");
    expect(mutation.payload.lines).toEqual([
      { itemId: "item-1", saleUnitCode: "bag", quantity: 2 },
      { itemId: "item-2", saleUnitCode: "tin", quantity: 1 },
    ]);
  });

  it("does NOT include any price or total field in the payload", () => {
    const mutation = buildSaleMutation({
      ...baseInput,
      cart: [makeLine()],
    });

    const payload = mutation.payload as Record<string, unknown>;
    const line = (payload.lines as Array<Record<string, unknown>>)[0]!;

    // Forbidden client-side price fields.
    expect(payload.priceMinor).toBeUndefined();
    expect(payload.totalMinor).toBeUndefined();
    expect(payload.unitPriceMinor).toBeUndefined();
    expect(payload.subtotalMinor).toBeUndefined();
    expect(line.priceMinor).toBeUndefined();
    expect(line.unitPrice).toBeUndefined();
    expect(line.total).toBeUndefined();
    expect(line.displayPriceMinor).toBeUndefined();
    expect(line.displayName).toBeUndefined();
    expect(line.displaySku).toBeUndefined();

    // Allowed canonical fields.
    expect(line.itemId).toBe("item-1");
    expect(line.saleUnitCode).toBe("bag");
    expect(line.quantity).toBe(2);
  });

  it("includes customerId only when provided (walk-in is the default)", () => {
    const withCustomer = buildSaleMutation({
      ...baseInput,
      cart: [makeLine()],
      customerId: "cust-1",
    });
    const walkIn = buildSaleMutation({
      ...baseInput,
      cart: [makeLine()],
    });

    expect((withCustomer.payload as { customerId?: string }).customerId).toBe("cust-1");
    expect((walkIn.payload as { customerId?: string }).customerId).toBeUndefined();
  });

  it("uppercases the currency code", () => {
    const mutation = buildSaleMutation({
      ...baseInput,
      currencyCode: "ghs",
      cart: [makeLine()],
    });
    expect(mutation.payload.currencyCode).toBe("GHS");
  });

  it("rejects an empty cart", () => {
    expect(() => buildSaleMutation({ ...baseInput, cart: [] })).toThrow(/at least one item/i);
  });

  it("rejects non-positive quantities", () => {
    expect(() =>
      buildSaleMutation({ ...baseInput, cart: [makeLine({ quantity: 0 })] }),
    ).toThrow(/greater than zero/i);
    expect(() =>
      buildSaleMutation({ ...baseInput, cart: [makeLine({ quantity: -1 })] }),
    ).toThrow(/greater than zero/i);
  });

  it("rejects an unsupported payment method", () => {
    expect(() =>
      buildSaleMutation({
        ...baseInput,
        paymentMethod: "CUSTOMER_CREDIT" as DesktopPaymentMethod,
        cart: [makeLine()],
      }),
    ).toThrow(/payment method/i);
  });

  it("rejects a non-three-letter currency code", () => {
    expect(() =>
      buildSaleMutation({ ...baseInput, currencyCode: "GHANA", cart: [makeLine()] }),
    ).toThrow(/currency/i);
  });

  it("rejects lines missing itemId or saleUnitCode", () => {
    expect(() =>
      buildSaleMutation({ ...baseInput, cart: [makeLine({ itemId: "" })] }),
    ).toThrow(/item and sale unit/i);
    expect(() =>
      buildSaleMutation({ ...baseInput, cart: [makeLine({ saleUnitCode: "  " })] }),
    ).toThrow(/item and sale unit/i);
  });
});
