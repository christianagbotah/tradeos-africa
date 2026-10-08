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
    expect(html).toContain("Walk-in customer");
    expect(html).toContain("Choose customer");
    expect(html).toContain("Charge ₵0.00");
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

  it("pins sticky mobile Charge and desktop two-pane presentation", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(root, "../../pos-workspace.css"), "utf8");
    expect(css).toContain(".pos-workspace-grid");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) minmax(340px,420px)");
    expect(css).toContain(".pos-charge-bar");
    expect(css).toContain("position:fixed");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });

  it("pins sale status feedback for synchronized, pending and needs-review outcomes", async () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(root, "pos-workspace.tsx");
    expect(fs.existsSync(file)).toBe(true);
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain('tone: "success" | "pending" | "error"');
    expect(source).toContain("pos-sale-status");
    expect(source).toContain("onStatus");
  });
});
