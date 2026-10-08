import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CatalogItem } from "../../lib/workspace-types";

async function loadActions() {
  const modulePath = "./catalog-actions";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

const active: CatalogItem = {
  id: "malt",
  sku: "MALT-01",
  name: "Malt",
  kind: "PRODUCT",
  stockUnitCode: "bottle",
  trackStock: true,
  taxCategory: null,
  active: true,
  createdAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-08T09:00:00.000Z",
  units: [{ code: "bottle", label: "Bottle", canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: 1200 }],
  conversions: [],
};

function render(role: string, item: CatalogItem = active) {
  return loadActions().then((module) => {
    expect(module?.CatalogActions).toBeTypeOf("function");
    if (!module?.CatalogActions) return "";
    return renderToStaticMarkup(React.createElement(module.CatalogActions, {
      item,
      role,
      businessId: "b1",
      onEdit: () => undefined,
      onDuplicate: () => undefined,
      onChanged: async () => undefined,
    }));
  });
}

describe("CatalogActions", () => {
  it("lets INVENTORY edit, duplicate and archive without permanent delete", async () => {
    const html = await render("INVENTORY");
    expect(html).toContain("Edit");
    expect(html).toContain("Duplicate");
    expect(html).toContain("Archive");
    expect(html).not.toContain("Delete unused");
  });

  it("offers OWNER safe permanent deletion and names the item in confirmation copy", async () => {
    const html = await render("OWNER");
    expect(html).toContain("Delete unused");
    const module = await loadActions();
    expect(module?.catalogDeleteConfirmation).toBeTypeOf("function");
    if (!module?.catalogDeleteConfirmation) return;
    expect(module.catalogDeleteConfirmation(active)).toContain("Malt");
    expect(module.catalogDeleteConfirmation(active)).toMatch(/permanent|delete/i);
  });

  it("offers Reactivate instead of Archive for an archived item", async () => {
    const html = await render("OWNER", { ...active, active: false });
    expect(html).toContain("Reactivate");
    expect(html).not.toContain(">Archive<");
  });

  it("maps in-use and stale lifecycle failures to actionable business guidance", async () => {
    const module = await loadActions();
    expect(module?.catalogActionMessage).toBeTypeOf("function");
    if (!module?.catalogActionMessage) return;
    expect(module.catalogActionMessage("CATALOG_ITEM_IN_USE", "fallback")).toMatch(/archive/i);
    expect(module.catalogActionMessage("STALE_VERSION", "fallback")).toMatch(/changed|latest|refresh/i);
  });

  it("uses revision-aware queued archive/reactivate and online-only DELETE", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const actionPath = path.join(root, "catalog-actions.tsx");
    expect(fs.existsSync(actionPath)).toBe(true);
    if (!fs.existsSync(actionPath)) return;
    const source = fs.readFileSync(actionPath, "utf8");
    expect(source).toContain("CATALOG_ITEM_ARCHIVE");
    expect(source).toContain("CATALOG_ITEM_REACTIVATE");
    expect(source).toContain("expectedUpdatedAt");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("navigator.onLine");
  });
});
