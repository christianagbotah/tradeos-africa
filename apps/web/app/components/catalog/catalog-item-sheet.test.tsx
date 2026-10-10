import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../../lib/workspace-types";

async function loadSheet() {
  const modulePath = "./catalog-item-sheet";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

const item: CatalogItem = {
  id: "malt",
  sku: "MALT-01",
  name: "Malt",
  kind: "PRODUCT",
  stockUnitCode: "bottle",
  trackStock: true,
  taxCategory: "STANDARD",
  active: true,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T09:00:00.000Z",
  units: [{ code: "bottle", label: "Bottle", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1200 }],
  conversions: [],
};

describe("CatalogItemSheet", () => {
  it("builds create, edit and duplicate drafts without reusing an existing revision for a duplicate", async () => {
    const module = await loadSheet();
    expect(module?.catalogDraftFor).toBeTypeOf("function");
    if (!module?.catalogDraftFor) return;

    const create = module.catalogDraftFor("create", null, "GHS");
    expect(create.itemId).toBeNull();
    expect(create.expectedUpdatedAt).toBeNull();
    expect(create.kind).toBe("PRODUCT");

    const edit = module.catalogDraftFor("edit", item, "GHS");
    expect(edit.itemId).toBe("malt");
    expect(edit.expectedUpdatedAt).toBe(item.updatedAt);
    expect(edit.name).toBe("Malt");
    expect(edit.units[0]?.label).toBe("Bottle");

    const duplicate = module.catalogDraftFor("duplicate", item, "GHS");
    expect(duplicate.itemId).toBeNull();
    expect(duplicate.expectedUpdatedAt).toBeNull();
    expect(duplicate.name).toContain("Malt");
    expect(duplicate.active).toBe(true);
  });

  it("renders an accessible modal sheet with populated edit fields", async () => {
    const module = await loadSheet();
    expect(module?.CatalogItemSheet).toBeTypeOf("function");
    if (!module?.CatalogItemSheet) return;

    const html = renderToStaticMarkup(React.createElement(module.CatalogItemSheet, {
      mode: "edit",
      item,
      open: true,
      businessId: "b1",
      branchId: "br1",
      currencyCode: "GHS",
      role: "OWNER",
      onClose: () => undefined,
      onChanged: async () => undefined,
    }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Edit Malt");
    expect(html).toContain('value="Malt"');
    expect(html).toContain("Bottle");
    expect(html).toContain("Save changes");
  });

  it("maps lifecycle conflicts to business-readable guidance", async () => {
    const module = await loadSheet();
    expect(module?.catalogSheetMessage).toBeTypeOf("function");
    if (!module?.catalogSheetMessage) return;

    expect(module.catalogSheetMessage("STALE_VERSION")).toMatch(/changed|latest|refresh/i);
    expect(module.catalogSheetMessage("CATALOG_STRUCTURE_LOCKED")).toMatch(/history|sales|stock|duplicate/i);
    expect(module.catalogSheetMessage("OFFLINE_STRUCTURE_EDIT")).toMatch(/connection|online/i);
  });

  it("pins keyboard focus management, durable queue use and revision-aware submission", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const sheetPath = path.join(root, "catalog-item-sheet.tsx");
    expect(fs.existsSync(sheetPath)).toBe(true);
    if (!fs.existsSync(sheetPath)) return;
    const source = fs.readFileSync(sheetPath, "utf8");
    expect(source).toContain("Escape");
    expect(source).toContain("Tab");
    expect(source).toMatch(/focus\(/);
    expect(source).toMatch(/previous.*active|active.*element/i);
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("CATALOG_ITEM_UPDATE");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("flushPendingMutations");
    expect(source).toContain("navigator.onLine");
  });

  it("keeps phone primary controls touch-sized and integrates the sheet into the workspace", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const css = fs.readFileSync(path.join(appRoot, "catalog.css"), "utf8");
    const workspace = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "catalog-workspace.tsx"), "utf8");
    expect(css).toMatch(/catalog-sheet[\s\S]*min-height:\s*48px/);
    expect(workspace).toContain("CatalogItemSheet");
  });
});
