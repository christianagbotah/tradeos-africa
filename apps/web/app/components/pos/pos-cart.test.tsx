import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CartLine } from "./pos-model";

const items = [
  { key: "malt:bottle", itemId: "malt", name: "Malt", sku: "MALT-01", kind: "PRODUCT", unitCode: "bottle", unitLabel: "Bottle", priceMinor: 1200, trackStock: true, stockUnitCode: "bottle" },
  { key: "malt:crate", itemId: "malt", name: "Malt", sku: "MALT-01", kind: "PRODUCT", unitCode: "crate", unitLabel: "Crate", priceMinor: 28800, trackStock: true, stockUnitCode: "bottle" },
  { key: "haircut:service", itemId: "haircut", name: "Haircut", sku: null, kind: "SERVICE", unitCode: "service", unitLabel: "Service", priceMinor: 3500, trackStock: false, stockUnitCode: null },
];

async function loadBrowser() {
  const modulePath = "./product-browser";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

async function loadCart() {
  const modulePath = "./cart-panel";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

describe("professional POS product browser and cart", () => {
  it("searches products/services by name, SKU and sale-unit label", async () => {
    const module = await loadBrowser();
    expect(module?.filterPosSellables).toBeTypeOf("function");
    if (!module?.filterPosSellables) return;
    expect(module.filterPosSellables(items, "malt").map((item: { key: string }) => item.key)).toEqual(["malt:bottle", "malt:crate"]);
    expect(module.filterPosSellables(items, "MALT-01").length).toBe(2);
    expect(module.filterPosSellables(items, "crate").map((item: { key: string }) => item.key)).toEqual(["malt:crate"]);
    expect(module.filterPosSellables(items, "haircut").map((item: { key: string }) => item.key)).toEqual(["haircut:service"]);
  });

  it("renders each sell unit as a clear add-to-sale choice", async () => {
    const module = await loadBrowser();
    expect(module?.ProductBrowser).toBeTypeOf("function");
    if (!module?.ProductBrowser) return;
    const html = renderToStaticMarkup(React.createElement(module.ProductBrowser, {
      items,
      query: "",
      currencyCode: "GHS",
      onQueryChange: () => undefined,
      onAdd: () => undefined,
    }));
    expect(html).toContain("Search product, SKU or scan barcode…");
    expect(html).toContain("pos-category-strip");
    expect(html).toContain("Malt");
    expect(html).toContain("Bottle");
    expect(html).toContain("Crate");
    expect(html).toContain("Haircut");
    expect(html).toMatch(/Add Malt · Bottle/);
  });

  it("renders minus, direct quantity, plus, unit change and remove controls for every cart line", async () => {
    const module = await loadCart();
    expect(module?.CartPanel).toBeTypeOf("function");
    if (!module?.CartPanel) return;
    const cart: CartLine[] = [{
      key: "malt:bottle",
      itemId: "malt",
      name: "Malt",
      saleUnitCode: "bottle",
      saleUnitLabel: "Bottle",
      priceMinor: 1200,
      quantity: 2,
    }];
    const html = renderToStaticMarkup(React.createElement(module.CartPanel, {
      cart,
      items,
      currencyCode: "GHS",
      onIncrease: () => undefined,
      onDecrease: () => undefined,
      onSetQuantity: () => undefined,
      onRemove: () => undefined,
      onChangeUnit: () => undefined,
    }));
    expect(html).toContain('aria-label="Decrease Malt quantity"');
    expect(html).toContain('aria-label="Malt quantity"');
    expect(html).toContain('aria-label="Increase Malt quantity"');
    expect(html).toContain('aria-label="Change Malt selling unit"');
    expect(html).toContain('aria-label="Remove Malt from sale"');
    expect(html).toContain("Crate");
  });

  it("does not invent stock conversion quantities in the client cart", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const cartPath = path.join(root, "cart-panel.tsx");
    expect(fs.existsSync(cartPath)).toBe(true);
    if (!fs.existsSync(cartPath)) return;
    const source = fs.readFileSync(cartPath, "utf8");
    expect(source).not.toContain("UnitConverter");
    expect(source).not.toContain("quantityInStockUnit");
    expect(source).toContain("trackStock");
  });

  it("pins accessible phone targets and responsive product/cart presentation", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/\.pos-product-search[\s\S]*min-height:\s*48px/);
    expect(css).toMatch(/\.pos-qty-button[\s\S]*min-width:\s*44px/);
    expect(css).toContain(".pos-product-grid");
    expect(css).toContain(".pos-cart-panel");
  });
});
