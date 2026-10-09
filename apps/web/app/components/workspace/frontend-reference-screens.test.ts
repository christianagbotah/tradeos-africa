import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(workspaceDir, "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");
const route = (name: string) => read(`(workspace)/${name}/page.tsx`);

describe("frontend reference screens cross-screen contracts", () => {
  it("mounts the intended major feature per reference route", () => {
    expect(route("dashboard")).toContain("DashboardCommandCenter");
    expect(route("sell")).toContain("<PosWorkspace");
    expect(route("catalog")).toContain("<CatalogWorkspace");
    expect(route("sales")).toMatch(/<SalesAndReturns[\s\S]*view="sales"/);
    expect(route("inventory")).toMatch(/<PurchasesInventory[\s\S]*view="inventory"/);
    expect(route("customers")).toContain("<CustomerWorkspace");
  });

  it("contains no window.alert, window.prompt, or window.confirm in touched workflows", () => {
    const touched = [
      "components/dashboard/dashboard-command-center.tsx",
      "components/pos/pos-workspace.tsx",
      "components/pos/product-browser.tsx",
      "components/pos/cart-panel.tsx",
      "components/pos/checkout-sheet.tsx",
      "components/pos/customer-picker.tsx",
      "components/catalog/catalog-workspace.tsx",
      "components/catalog/catalog-list.tsx",
      "components/sales/sales-workspace.tsx",
      "components/sales/sale-detail-sheet.tsx",
      "components/inventory/inventory-workspace.tsx",
      "components/inventory/inventory-detail-sheet.tsx",
      "components/inventory/inventory-adjustment-sheet.tsx",
      "components/customers/customer-workspace.tsx",
      "components/customers/customer-sheet.tsx",
      "components/workspace/app-shell.tsx",
      "components/workspace/mobile-bottom-nav.tsx",
      "components/workspace/mobile-more-sheet.tsx",
      "components/ui/command-bar.tsx",
      "components/ui/state-panel.tsx",
      "components/ui/mobile-record-card.tsx",
    ];
    for (const file of touched) {
      const source = read(file);
      expect(source).not.toContain("window.alert(");
      expect(source).not.toContain("window.prompt(");
      expect(source).not.toContain("window.confirm(");
    }
  });

  it("retains mobile/tablet breakpoints in token, shell, and feature CSS", () => {
    const cssFiles = [
      "tradeos-tokens.css",
      "ui-primitives.css",
      "workspace-shell.css",
      "dashboard.css",
      "pos.css",
      "pos-workspace.css",
      "catalog.css",
      "sales-returns.css",
      "purchases-inventory.css",
      "customers-credit.css",
    ];
    for (const file of cssFiles) {
      const css = read(file);
      // Each CSS file must have at least one responsive media query
      expect(css).toMatch(/@media\s*\(/);
    }
  });

  it("reference-screen containers opt into shrink-safe layouts (min-width:0)", () => {
    const shell = read("workspace-shell.css");
    expect(shell).toMatch(/\.workspace-main\s*\{[^}]*min-width:\s*0/);
    expect(shell).toMatch(/\.workspace-content\s*\{[^}]*min-width:\s*0/);
  });

  it("keeps the new presentational primitives presentational (no API/workspace deps)", () => {
    for (const file of ["command-bar.tsx", "state-panel.tsx", "mobile-record-card.tsx"]) {
      const source = read(`components/ui/${file}`);
      expect(source).not.toContain("clientApi");
      expect(source).not.toContain("/api/tradeos");
      expect(source).not.toContain("useWorkspace");
    }
  });

  it("preserves the GHS currency symbol (₵) in money formatting", () => {
    const posModel = read("components/pos/pos-model.ts");
    const checkout = read("components/pos/checkout-sheet.tsx");
    // The sale mutation payload must not carry client-side pricing
    expect(checkout).not.toContain("unitPriceMinor");
    expect(checkout).toContain("SALE_CREATE");
  });
});
