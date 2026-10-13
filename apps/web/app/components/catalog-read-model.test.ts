/**
 * TradeOS Web — behavioral tests for the catalog read-model mapping layer.
 *
 * These tests lock the contract between the API's canonical catalog shape
 * (active/trackStock/stockUnitCode/units[]/conversions[]) and the web
 * workspace state — the layer whose absence caused the "0 active items /
 * ₵ undefined / POS empty" QA failures. They mirror the mobile client's
 * pos-model.test.ts semantics: one sellable entry per (item, canSell unit
 * with a price), cart keys `${itemId}:${unitCode}`.
 */

import { describe, expect, it } from "vitest";
import {
  filterSellableItems,
  indexInventory,
  mapCatalogItem,
  mapInventoryItem,
  primarySellableUnit,
  projectSellableItems,
  type CatalogItem,
  type InventoryItem,
} from "../../lib/catalog-read-model";

// A canonical API item in the exact shape /v1/catalog/items returns.
const CANONICAL_ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  sku: "DRK-001",
  name: "Club Beer",
  kind: "PRODUCT",
  stockUnitCode: "bottle",
  trackStock: true,
  taxCategory: null,
  active: true,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-10T08:00:00.000Z",
  units: [
    { code: "crate", label: "Crate of 24", canPurchase: true, canSell: true, canStock: false, defaultSalePriceMinor: 9600 },
    { code: "bottle", label: "Bottle", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 400 },
  ],
  conversions: [{ fromUnitCode: "crate", toUnitCode: "bottle", factor: 24 }],
};

const UNPRICED_UNIT_ITEM = {
  ...CANONICAL_ITEM,
  id: "33333333-3333-4333-8333-333333333333",
  sku: "DRK-002",
  name: "Mystery Box",
  units: [
    { code: "box", label: "Box", canPurchase: true, canSell: false, canStock: true, defaultSalePriceMinor: null },
    { code: "piece", label: "Piece", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 250 },
  ],
  conversions: [],
};

const INVENTORY_ROW = {
  id: CANONICAL_ITEM.id,
  sku: "DRK-001",
  name: "Club Beer",
  stockUnitCode: "bottle",
  available: 48,
  quarantine: 2,
  damaged: 1,
  waste: 0,
  inventoryValueMinor: 19200,
  averageStockUnitCostMinor: 300,
  latestStockUnitCostMinor: 320,
};

describe("mapCatalogItem", () => {
  it("maps the canonical API shape field-for-field, keeping units[] and conversions[]", () => {
    const item = mapCatalogItem(CANONICAL_ITEM);
    expect(item.id).toBe(CANONICAL_ITEM.id);
    expect(item.active).toBe(true);
    expect(item.trackStock).toBe(true);
    expect(item.stockUnitCode).toBe("bottle");
    expect(item.units).toHaveLength(2);
    expect(item.units[0]).toEqual({
      code: "crate",
      label: "Crate of 24",
      canPurchase: true,
      canSell: true,
      canStock: false,
      defaultSalePriceMinor: 9600,
    });
    expect(item.conversions).toEqual([{ fromUnitCode: "crate", toUnitCode: "bottle", factor: 24 }]);
  });

  it("drops unknown server fields instead of blindly casting", () => {
    const item = mapCatalogItem({ ...CANONICAL_ITEM, status: "ACTIVE", priceMinor: 400, trackInventory: true });
    expect(item).not.toHaveProperty("status");
    expect(item).not.toHaveProperty("priceMinor");
    expect(item).not.toHaveProperty("trackInventory");
  });

  it("throws on an item without an id — honest failure over silent corruption", () => {
    expect(() => mapCatalogItem({ ...CANONICAL_ITEM, id: undefined })).toThrow(/without an id/);
  });

  it("treats a missing units array as empty rather than crashing", () => {
    const item = mapCatalogItem({ ...CANONICAL_ITEM, units: undefined, conversions: undefined });
    expect(item.units).toEqual([]);
    expect(item.conversions).toEqual([]);
  });
});

describe("mapInventoryItem + indexInventory", () => {
  it("maps a /v1/inventory row with numeric location balances", () => {
    const row = mapInventoryItem(INVENTORY_ROW);
    expect(row.available).toBe(48);
    expect(row.quarantine).toBe(2);
    expect(row.damaged).toBe(1);
    expect(row.waste).toBe(0);
    expect(row.inventoryValueMinor).toBe(19200);
    expect(row.stockUnitCode).toBe("bottle");
  });

  it("accepts stringified numbers defensively", () => {
    const row = mapInventoryItem({ ...INVENTORY_ROW, available: "12", inventoryValueMinor: "4800" });
    expect(row.available).toBe(12);
    expect(row.inventoryValueMinor).toBe(4800);
  });

  it("indexes rows by item id for catalog joins", () => {
    const map = indexInventory([mapInventoryItem(INVENTORY_ROW)]);
    expect(map.get(CANONICAL_ITEM.id)?.available).toBe(48);
    expect(map.size).toBe(1);
  });
});

describe("projectSellableItems", () => {
  const catalog: CatalogItem[] = [
    mapCatalogItem(CANONICAL_ITEM),
    mapCatalogItem(UNPRICED_UNIT_ITEM),
  ];

  it("projects one sellable per (item, canSell unit with a price), keyed itemId:unitCode", () => {
    const sellable = projectSellableItems(catalog, new Map());
    const keys = sellable.map((s) => s.key).sort();
    expect(keys).toEqual([
      "33333333-3333-4333-8333-333333333333:piece",
      "11111111-1111-4111-8111-111111111111:bottle",
      "11111111-1111-4111-8111-111111111111:crate",
    ].sort());
  });

  it("carries the per-unit price so totals never render ₵ undefined", () => {
    const sellable = projectSellableItems(catalog, new Map());
    const crate = sellable.find((s) => s.unitCode === "crate");
    const bottle = sellable.find((s) => s.unitCode === "bottle");
    expect(crate?.priceMinor).toBe(9600);
    expect(bottle?.priceMinor).toBe(400);
  });

  it("skips units without canSell or without a price", () => {
    const sellable = projectSellableItems(catalog, new Map());
    expect(sellable.some((s) => s.unitCode === "box")).toBe(false);
  });

  it("joins last-known branch stock in stock units for tracked items", () => {
    const inventory = new Map<string, InventoryItem>([[CANONICAL_ITEM.id, mapInventoryItem(INVENTORY_ROW)]]);
    const sellable = projectSellableItems(catalog, inventory);
    const crate = sellable.find((s) => s.unitCode === "crate");
    expect(crate?.availableStock).toBe(48);
  });

  it("excludes archived items entirely", () => {
    const archived = mapCatalogItem({ ...CANONICAL_ITEM, active: false });
    const sellable = projectSellableItems([archived], new Map());
    expect(sellable).toEqual([]);
  });

  it("returns null availableStock for untracked items (never a fake 0)", () => {
    const service = mapCatalogItem({
      ...CANONICAL_ITEM,
      id: "44444444-4444-4444-8444-444444444444",
      kind: "SERVICE",
      trackStock: false,
      stockUnitCode: null,
      units: [{ code: "service", label: "Haircut", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 1500 }],
      conversions: [],
    });
    const sellable = projectSellableItems([service], new Map());
    expect(sellable).toHaveLength(1);
    expect(sellable[0]!.availableStock).toBeNull();
  });
});

describe("filterSellableItems", () => {
  const sellable = projectSellableItems(
    [mapCatalogItem(CANONICAL_ITEM), mapCatalogItem(UNPRICED_UNIT_ITEM)],
    new Map(),
  );

  it("matches by name case-insensitively", () => {
    expect(filterSellableItems(sellable, "club beer")).toHaveLength(2);
  });

  it("matches by SKU", () => {
    expect(filterSellableItems(sellable, "drk-001")).toHaveLength(2);
  });

  it("matches by unit label and unit code", () => {
    expect(filterSellableItems(sellable, "bottle")).toHaveLength(1);
    expect(filterSellableItems(sellable, "crate")).toHaveLength(1);
    expect(filterSellableItems(sellable, "piece")).toHaveLength(1);
  });

  it("matches every sellable unit of an item by its name", () => {
    expect(filterSellableItems(sellable, "club")).toHaveLength(2);
  });

  it("returns everything for a blank query", () => {
    expect(filterSellableItems(sellable, "   ")).toHaveLength(sellable.length);
  });
});

describe("primarySellableUnit", () => {
  it("returns the first sellable unit with a price", () => {
    const item = mapCatalogItem(CANONICAL_ITEM);
    expect(primarySellableUnit(item)?.code).toBe("crate");
  });

  it("returns null when no unit is sellable", () => {
    const item = mapCatalogItem({
      ...CANONICAL_ITEM,
      units: [{ code: "box", label: "Box", canPurchase: true, canSell: false, canStock: true, defaultSalePriceMinor: null }],
    });
    expect(primarySellableUnit(item)).toBeNull();
  });
});
