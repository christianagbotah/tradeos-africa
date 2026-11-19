import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../../../lib/catalog-read-model";
import {
  registerConfirmedCatalogUpdate, registerConfirmedCatalogDeletion,
  reconcileConfirmedCatalog, type ConfirmedCatalogRevision,
  type ConfirmedCatalogDeletion,
} from "./catalog-reconciliation";

const item: CatalogItem = {
  id: "item-1", sku: "ABC", name: "Old Product", kind: "PRODUCT", stockUnitCode: "each",
  trackStock: true, taxCategory: null, active: true,
  createdAt: "2026-11-01T08:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
  units: [{ code: "each", label: "Each", canSell: true, canPurchase: true,
    canStock: true, defaultSalePriceMinor: 2000 }],
  conversions: [],
};
const now = Date.parse("2026-11-19T10:00:00.000Z");

describe("confirmed catalog CRUD remains visible across stale read responses", () => {
  it("retains edited names, SKUs and unit prices until the server catches up", () => {
    const guards = new Map<string, ConfirmedCatalogRevision>();
    const fields = { name: "New Product", sku: "NEW", units: [
      { ...item.units[0]!, defaultSalePriceMinor: 4500 },
    ] };
    registerConfirmedCatalogUpdate(guards, "biz-one", item, fields, now);
    const result = reconcileConfirmedCatalog([item], "biz-one", guards, now + 200);
    expect(result[0]?.name).toBe("New Product");
    expect(result[0]?.sku).toBe("NEW");
    expect(result[0]?.units[0]?.defaultSalePriceMinor).toBe(4500);
    expect(item.name).toBe("Old Product");
    expect(guards.size).toBe(1);
    const current = { ...item, ...fields, updatedAt: "2026-11-19T10:00:04.000Z" };
    expect(reconcileConfirmedCatalog([current], "biz-one", guards, now + 800)).toEqual([current]);
    expect(guards.size).toBe(0);
  });
  it("does not allow old refetch responses to re-activate an archived item", () => {
    const guards = new Map<string, ConfirmedCatalogRevision>();
    registerConfirmedCatalogUpdate(guards, "biz-one", item, { active: false }, now);
    expect(reconcileConfirmedCatalog([item], "biz-one", guards, now + 100)[0]?.active).toBe(false);
  });
  it("hides server-confirmed deletion until the stale GET stops returning the item", () => {
    const deletes = new Map<string, ConfirmedCatalogDeletion>();
    registerConfirmedCatalogDeletion(deletes, "biz-one", item.id, now);
    expect(reconcileConfirmedCatalog([item], "biz-one", new Map(), now + 100, deletes)).toEqual([]);
    expect(deletes.size).toBe(1);
    expect(reconcileConfirmedCatalog([], "biz-one", new Map(), now + 200, deletes)).toEqual([]);
    expect(deletes.size).toBe(0);
  });
  it("keeps scopes isolated and expires obsolete guards", () => {
    const guards = new Map<string, ConfirmedCatalogRevision>();
    registerConfirmedCatalogUpdate(guards, "biz-one", item, { name: "Biz One Name" }, now);
    expect(reconcileConfirmedCatalog([item], "biz-two", guards, now + 200)[0]?.name).toBe("Old Product");
    expect(reconcileConfirmedCatalog([item], "biz-one", guards, now + 160000)[0]?.name).toBe("Old Product");
    expect(guards.size).toBe(0);
  });
});
