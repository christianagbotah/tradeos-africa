import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const items = [
  { key: "malt:bottle", itemId: "malt", name: "Malt", sku: "MALT-01", kind: "PRODUCT", unitCode: "bottle", unitLabel: "Bottle", priceMinor: 1200, trackStock: true, stockUnitCode: "bottle" },
];

async function loadWorkspace() {
  const modulePath = "./pos-workspace";
  try { return await import(/* @vite-ignore */ modulePath); }
  catch { return null; }
}

describe("professional POS workspace", () => {
  it("renders Walk-in as the default customer and a clear empty-cart Charge action", async () => {
    const module = await loadWorkspace();
    expect(module?.PosWorkspace).toBeTypeOf("function");
    if (!module?.PosWorkspace) return;
    const html = renderToStaticMarkup(React.createElement(module.PosWorkspace, {
      businessId: "b1",
      branchId: "branch-1",
      currencyCode: "GHS",
      role: "CASHIER",
      items,
    }));
    expect(html).toContain("Walk-in Customer");
    expect(html).toContain("Cart is empty");
    expect(html).toContain("Charge ₵ 0.00");
    expect(html).toContain("disabled");
  });

  it("pins the customer, browser, cart and checkout building blocks in one composition", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, "pos-workspace.tsx");
    expect(fs.existsSync(file)).toBe(true);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("<CustomerPicker");
    expect(source).toContain("<ProductBrowser");
    expect(source).toContain("<CartPanel");
    expect(source).toContain("<CheckoutSheet");
    expect(source).toContain("addCartItem");
    expect(source).toContain("setCartQuantity");
    expect(source).toContain("changeCartUnit");
    expect(source).toContain("removeCartLine");
    expect(source).toContain("setSelectedCustomer(null)");
  });

  it("pins the Z.ai desktop cart rail and mobile sticky Charge presentation", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(root, "../../pos-zai-reference.css"), "utf8");
    expect(css).toContain(".pos-zai-layout");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) minmax(330px,380px)");
    expect(css).toContain(".pos-zai-cart-rail");
    expect(css).toContain(".pos-charge-bar");
    expect(css).toContain("position:fixed");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("pins sale status feedback for synchronized, pending and needs-review outcomes", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(source).toContain('tone: "success" | "pending" | "error"');
    expect(source).toContain("pos-sale-status");
    expect(source).toContain("onStatus");
  });
});

describe("POS flagship touch-first contracts", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it("renders an intentional empty state when product search yields no matches", () => {
    const browser = fs.readFileSync(path.join(root, "product-browser.tsx"), "utf8");
    expect(browser).toContain("pos-browser-empty");
  });

  it("keeps the running cart total visible in the sticky mobile charge bar when a cart exists", () => {
    const css = fs.readFileSync(path.join(root, "../../pos-zai-reference.css"), "utf8");
    expect(css).toContain(".pos-charge-bar");
    expect(css).toMatch(/position:\s*fixed|position:fixed/);
  });

  it("uses an accessible status region for sale sync/pending/error feedback", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("pos-sale-status");
    expect(ws).toMatch(/role="status"|aria-live/);
  });

  it("preserves the server-authoritative sale mutation payload (no client-side pricing)", () => {
    const checkout = fs.readFileSync(path.join(root, "checkout-sheet.tsx"), "utf8");
    expect(checkout).toContain("SALE_CREATE");
    expect(checkout).not.toContain("unitPriceMinor");
    expect(checkout).toContain("enqueueMutation");
  });

  it("keeps POS CSS mobile-first with touch-safe controls", () => {
    const css = fs.readFileSync(path.join(root, "../../pos-zai-reference.css"), "utf8");
    expect(css).toMatch(/min-height:\s*(44|48|50|52)px|min-height:var\(--tos-touch-mobile\)/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*(76[0-9]|7[0-5][0-9])px/);
  });
});

describe("Z.ai POS visual grammar", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const workspace = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
  const browser = fs.readFileSync(path.join(root, "product-browser.tsx"), "utf8");
  it("keeps product discovery first and uses the Z.ai search copy", () => { expect(browser).toContain("Search product, SKU or scan barcode"); expect(browser).toContain("pos-category-chips"); });
  it("uses the compact Z.ai customer selector and desktop cart rail", () => { expect(workspace).toContain("pos-zai-customer-select"); expect(workspace).toContain("pos-zai-cart-rail"); });
  it("retains multi-unit selling rather than flattening products to one unit", () => { expect(browser).toContain("pos-alt-units"); expect(browser).toContain("alternates.map"); });
});
