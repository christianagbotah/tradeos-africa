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

  it("pins sticky mobile Charge and desktop two-pane presentation", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
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

// Task 4: empty-state, totals visibility, accessible status, responsive contracts
describe("POS flagship touch-first contracts", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it("renders an intentional empty state when product search yields no matches", () => {
    const browser = fs.readFileSync(path.join(root, "product-browser.tsx"), "utf8");
    expect(browser).toContain("pos-browser-empty");
  });

  it("keeps the running cart total visible in the sticky mobile charge bar", () => {
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
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

  it("keeps POS CSS mobile-first with 48px touch targets and no tiny control text", () => {
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/min-height:\s*48px|min-height:var\(--tos-touch-mobile\)/);
    expect(css).not.toMatch(/font-size:\s*(9|10)px/);
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*(76[0-9]|7[0-5][0-9])px/);
  });
});


describe("POS mobile cart progression", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));

  it("provides a dedicated mobile cart sheet before checkout", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("mobileCartOpen");
    expect(ws).toContain("pos-mobile-cart-trigger");
    expect(ws).toContain("pos-mobile-cart-sheet");
    expect(ws).toContain('aria-label="Open cart"');
    expect(ws).toContain('aria-labelledby="pos-mobile-cart-title"');
  });

  it("shows the sticky cart flow only on phones while preserving the desktop sticky cart pane", () => {
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/\.pos-mobile-cart-layer\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\(max-width:767px\)[\s\S]*?\.pos-sale-pane--desktop\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\(max-width:767px\)[\s\S]*?\.pos-mobile-cart-layer\s*\{[^}]*display:\s*grid/);
  });

  it("suppresses the bottom nav while the mobile cart dialog is open so payment stays reachable", () => {
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/body:has\(\.pos-mobile-cart-layer\)\s+\.workspace-mobile-bottom-nav\s*\{[^}]*visibility:\s*hidden/);
    expect(css).toMatch(/body:has\(\.pos-mobile-cart-layer\)\s+\.workspace-mobile-bottom-nav\s*\{[^}]*pointer-events:\s*none/);
  });

  it("does not expose the phone cart trigger at tablet widths where the inline cart remains available", () => {
    const css = fs.readFileSync(path.join(root, "../../pos.css"), "utf8");
    expect(css).toMatch(/@media\(min-width:768px\) and \(max-width:1099px\)[\s\S]*?\.pos-mobile-cart-trigger\s*\{[^}]*display:\s*none/);
  });

  it("focuses the first cart control on open so backward tabbing stays inside the modal", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("initialTabbables");
    expect(ws).toMatch(/initialTabbables\[0\]\?\.focus\(\)/);
    expect(ws).not.toContain("sheet?.focus();");
  });

  it("closes the phone cart state when the viewport leaves the phone breakpoint", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain('matchMedia("(max-width: 767px)")');
    expect(ws).toContain('addEventListener("change"');
    expect(ws).toMatch(/if \(!event\.matches\) setMobileCartOpen\(false\)/);
  });

  it("hands checkout a surviving return-focus target when continuing from the mobile cart", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("checkoutReturnFocusRef");
    expect(ws).toContain("returnFocusRef={checkoutReturnFocusRef}");
    expect(ws).toMatch(/openCheckout\(mobileCartTriggerRef\.current\)/);
  });

  it("recovers focus inside the modal when a cart mutation unmounts the focused line", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("focusCartSheetStart");
    expect(ws).toMatch(/!sheet\.contains\(document\.activeElement\)/);
    expect(ws).toMatch(/onRemove=.*removeCartLine[\s\S]*focusCartSheetStart/);
  });

  it("falls back to product search when closing an empty cart disables the trigger", () => {
    const ws = fs.readFileSync(path.join(root, "pos-workspace.tsx"), "utf8");
    expect(ws).toContain("focusProductSearch");
    expect(ws).toMatch(/if \(trigger && !trigger\.disabled && trigger\.isConnected\) trigger\.focus\(\)/);
    expect(ws).toMatch(/else focusProductSearch\(\)/);
  });
});
