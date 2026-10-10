import { describe, expect, it } from "vitest";
import {
  addCartItem,
  buildSaleMutation,
  displayCartTotalMinor,
  filterSellableItems,
  projectSellableItems,
  removeCartLine,
  setCartQuantity,
  type MobileCartLine,
} from "./pos-model";
import type { MobileCatalogItem, MobileInventoryItem } from "./api-client";

const catalog: MobileCatalogItem[] = [
  {
    id: "item-1",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: "CEM-50",
    name: "Cement 50kg",
    kind: "PRODUCT",
    stockUnitCode: "bag",
    trackStock: true,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [
      { code: "bag", label: "Bag", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 12000 },
      { code: "ton", label: "Tonne", canPurchase: true, canSell: true, canStock: false, defaultSalePriceMinor: 240000 },
      { code: "pallet", label: "Pallet", canPurchase: true, canSell: false, canStock: false, defaultSalePriceMinor: 500000 },
    ],
    conversions: [{ fromUnitCode: "ton", toUnitCode: "bag", factor: 20 }],
  },
  {
    id: "item-2",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: null,
    name: "Delivery service",
    kind: "SERVICE",
    stockUnitCode: null,
    trackStock: false,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [{ code: "trip", label: "Trip", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 3500 }],
    conversions: [],
  },
  {
    id: "item-3",
    businessId: "11111111-1111-4111-8111-111111111111",
    sku: "OLD",
    name: "Archived product",
    kind: "PRODUCT",
    stockUnitCode: "piece",
    trackStock: true,
    taxCategory: null,
    active: false,
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    units: [{ code: "piece", label: "Piece", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1000 }],
    conversions: [],
  },
];

const inventory: MobileInventoryItem[] = [
  {
    id: "item-1", sku: "CEM-50", name: "Cement 50kg", stockUnitCode: "bag",
    available: 28, quarantine: 1, damaged: 0, waste: 0,
    inventoryValueMinor: 280000, averageStockUnitCostMinor: 10000, latestStockUnitCostMinor: 10000,
  },
];

describe("mobile POS sellable projection", () => {
  it("projects only active sellable priced units and joins last-known inventory for display", () => {
    const items = projectSellableItems(catalog, inventory);

    expect(items.map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton", "item-2:trip"]);
    expect(items[0]).toMatchObject({ name: "Cement 50kg", unitLabel: "Bag", priceMinor: 12000, availableStock: 28, stockUnitCode: "bag" });
    expect(items[1]).toMatchObject({ unitLabel: "Tonne", availableStock: 28 });
    expect(items[2]).toMatchObject({ name: "Delivery service", trackStock: false, availableStock: null });
  });

  it("searches by name, SKU and unit label case-insensitively", () => {
    const items = projectSellableItems(catalog, inventory);
    expect(filterSellableItems(items, "cem").map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton"]);
    expect(filterSellableItems(items, "CEM-50").map((item) => item.key)).toEqual(["item-1:bag", "item-1:ton"]);
    expect(filterSellableItems(items, "tonne").map((item) => item.key)).toEqual(["item-1:ton"]);
  });
});

describe("mobile POS cart", () => {
  it("adds and increments the same item/unit, supports positive quantity changes and removal", () => {
    const [bag] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, bag!);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ key: "item-1:bag", quantity: 2 });

    cart = setCartQuantity(cart, "item-1:bag", 1.5);
    expect(cart[0]!.quantity).toBe(1.5);
    expect(() => setCartQuantity(cart, "item-1:bag", 0)).toThrow(/greater than zero/i);
    expect(() => setCartQuantity(cart, "item-1:bag", Number.NaN)).toThrow(/finite/i);

    cart = removeCartLine(cart, "item-1:bag");
    expect(cart).toEqual([]);
  });

  it("computes a display-only total from cached catalog prices", () => {
    const [bag, tonne, trip] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, tonne!);
    cart = addCartItem(cart, trip!);
    cart = setCartQuantity(cart, "item-2:trip", 2);
    expect(displayCartTotalMinor(cart)).toBe(12000 + 240000 + 7000);
  });
});

describe("mobile POS SALE_CREATE mutation", () => {
  it("builds the server-authoritative sale shape without client prices or totals", () => {
    const [bag, , trip] = projectSellableItems(catalog, inventory);
    let cart: MobileCartLine[] = [];
    cart = addCartItem(cart, bag!);
    cart = addCartItem(cart, trip!);
    cart = setCartQuantity(cart, "item-2:trip", 2);

    const mutation = buildSaleMutation({
      clientId: "mobile-device-1",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS",
      paymentMethod: "MOMO",
      occurredAt: "2026-10-10T23:50:00.000Z",
      cart,
    });

    expect(mutation).toEqual({
      clientId: "mobile-device-1",
      clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      mutationType: "SALE_CREATE",
      occurredAt: "2026-10-10T23:50:00.000Z",
      payload: {
        currencyCode: "GHS",
        paymentMethod: "MOMO",
        lines: [
          { itemId: "item-1", saleUnitCode: "bag", quantity: 1 },
          { itemId: "item-2", saleUnitCode: "trip", quantity: 2 },
        ],
      },
    });
    const serialized = JSON.stringify(mutation);
    expect(serialized).not.toContain("priceMinor");
    expect(serialized).not.toContain("totalMinor");
  });

  it("rejects empty carts, invalid quantities and unsupported payment methods", () => {
    const base = {
      clientId: "mobile-device-1", clientMutationId: "mutation-1",
      businessId: "11111111-1111-4111-8111-111111111111",
      branchId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "GHS", occurredAt: "2026-10-10T23:50:00.000Z",
    };
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CASH", cart: [] })).toThrow(/at least one/i);
    const [bag] = projectSellableItems(catalog, inventory);
    const badCart = [{ ...addCartItem([], bag!)[0]!, quantity: -1 }];
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CASH", cart: badCart })).toThrow(/greater than zero/i);
    expect(() => buildSaleMutation({ ...base, paymentMethod: "CUSTOMER_CREDIT" as never, cart: addCartItem([], bag!) })).toThrow(/payment method/i);
  });
});
