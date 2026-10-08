import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../../lib/workspace-types";

async function loadCatalogWorkspace() {
  const modulePath = "./catalog-workspace";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

const items: CatalogItem[] = [
  {
    id: "malt",
    sku: "MALT-01",
    name: "Malt",
    kind: "PRODUCT",
    stockUnitCode: "bottle",
    trackStock: true,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T08:00:00.000Z",
    units: [{ code: "bottle", label: "Bottle", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1200 }],
    conversions: [],
  },
  {
    id: "haircut",
    sku: null,
    name: "Standard haircut",
    kind: "SERVICE",
    stockUnitCode: null,
    trackStock: false,
    taxCategory: null,
    active: true,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T08:00:00.000Z",
    units: [{ code: "service", label: "Service", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 3500 }],
    conversions: [],
  },
  {
    id: "old",
    sku: null,
    name: "Old service",
    kind: "SERVICE",
    stockUnitCode: null,
    trackStock: false,
    taxCategory: null,
    active: false,
    createdAt: "2026-10-08T08:00:00.000Z",
    updatedAt: "2026-10-08T08:00:00.000Z",
    units: [{ code: "service", label: "Service", canPurchase: false, canSell: true, canStock: false, defaultSalePriceMinor: 1000 }],
    conversions: [],
  },
];

describe("CatalogWorkspace", () => {
  it("exposes professional search and lifecycle filters", async () => {
    const module = await loadCatalogWorkspace();
    expect(module?.CatalogWorkspace).toBeTypeOf("function");
    if (!module?.CatalogWorkspace) return;

    const html = renderToStaticMarkup(React.createElement(module.CatalogWorkspace, {
      businessId: "b1",
      branchId: "br1",
      currencyCode: "GHS",
      role: "OWNER",
      items,
      onRefresh: async () => undefined,
    }));
    expect(html).toContain("Search products or services");
    expect(html).toContain("All");
    expect(html).toContain("Products");
    expect(html).toContain("Services");
    expect(html).toContain("Archived");
    expect(html).toContain("Add item");
    expect(html).toContain("Malt");
    expect(html).toContain("Bottle");
    expect(html).toContain("₵12.00");
    expect(html).not.toContain("Old service");
  });

  it("filters active product/service records and isolates archived items", async () => {
    const module = await loadCatalogWorkspace();
    expect(module?.filterCatalogItems).toBeTypeOf("function");
    if (!module?.filterCatalogItems) return;

    expect(module.filterCatalogItems(items, "ALL", "").map((item: CatalogItem) => item.id)).toEqual(["malt", "haircut"]);
    expect(module.filterCatalogItems(items, "PRODUCT", "").map((item: CatalogItem) => item.id)).toEqual(["malt"]);
    expect(module.filterCatalogItems(items, "SERVICE", "hair").map((item: CatalogItem) => item.id)).toEqual(["haircut"]);
    expect(module.filterCatalogItems(items, "ARCHIVED", "").map((item: CatalogItem) => item.id)).toEqual(["old"]);
  });

  it("never renders catalog write controls for an unauthorized role", async () => {
    const module = await loadCatalogWorkspace();
    expect(module?.CatalogWorkspace).toBeTypeOf("function");
    if (!module?.CatalogWorkspace) return;

    const html = renderToStaticMarkup(React.createElement(module.CatalogWorkspace, {
      businessId: "b1",
      branchId: "br1",
      currencyCode: "GHS",
      role: "VIEWER",
      items,
      onRefresh: async () => undefined,
    }));
    expect(html).not.toContain("Add item");
    expect(html).not.toContain("Manage");
  });
});
