import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => fs.readFileSync(path.join(appRoot, file), "utf8");

describe("canonical Z.ai frontend boundary", () => {
  it("removes obsolete legacy presentation files and components", () => {
    for (const file of ["interactions.css", "real-app.css", "workspace-polish.css", "pos-workspace.css", "components/catalog-starter.tsx"]) {
      expect(fs.existsSync(path.join(appRoot, file)), file).toBe(false);
    }
  });

  it("keeps globals as reset/base only, never as an authenticated workspace skin", () => {
    const css = read("globals.css");
    for (const alias of ["--bg:", "--surface:", "--surface-soft:", "--ink:", "--muted:", "--line:", "--brand:", "--accent:", "--warning:", "--shadow:"]) expect(css).not.toContain(alias);
    for (const selector of [".app-shell", ".sidebar", ".nav-stack", ".nav-item", ".sync-card", ".workspace {", ".topbar", ".primary-button", ".ghost-button", ".text-button", ".metrics-grid", ".metric-card", ".panel {", ".panel-heading", ".quick-item", ".checkout-strip", ".payment-actions", ".return-options", ".pack-grid", ".pack-card"]) expect(css).not.toContain(selector);
    expect(css).toContain("var(--tos-canvas)");
    expect(css).toContain("var(--tos-font-body)");
  });

  it("loads only canonical/shared or explicitly migrated module styles", () => {
    const layout = read("layout.tsx");
    expect(layout).not.toContain('import "./interactions.css";');
    for (const legacy of ["real-app.css", "workspace-polish.css", "pos-workspace.css"]) expect(layout).not.toContain(legacy);
    for (const canonical of ["tradeos-tokens.css", "globals.css", "public-entry.css", "workspace-shell.css", "ui-primitives.css", "dashboard.css", "catalog.css", "pos.css", "sales-returns.css", "returns.css", "purchases-inventory.css", "cashbook.css", "operations.css", "reports.css"]) expect(layout).toContain(canonical);
  });

  it("owns live network/sync presentation in the canonical workspace shell", () => {
    const shell = read("workspace-shell.css");
    expect(shell).toContain(".workspace-shell .sync-card");
    expect(shell).toContain(".workspace-shell .sync-dot");
  });
  it("standardizes pointer affordance and opaque select menus", () => {
    const globals = read("globals.css");
    expect(globals).toContain("a[href]");
    expect(globals).toContain("button:not(:disabled)");
    expect(globals).toContain("select:not(:disabled)");
    expect(globals).toContain("summary");
    expect(globals).toMatch(/select\s+option[\s\S]*background-color:\s*var\(--tos-surface\)/);
    const shell = read("workspace-shell.css");
    expect(shell).toMatch(/\.workspace-context-unit \.workspace-context-field select\s*\{[\s\S]*background-color:\s*var\(--tos-surface\)/);
  });

  it("uses a shared currency-prefixed money input with breathing room", () => {
    expect(fs.existsSync(path.join(appRoot, "components/ui/money-input.tsx"))).toBe(true);
    const uiCss = read("ui-primitives.css");
    expect(uiCss).toMatch(/\.tos-money-input\s*\{[\s\S]*gap:\s*(?:8px|var\(--tos-space-2\))/);
    for (const file of [
      "components/catalog/catalog-item-sheet.tsx",
      "components/customers/customer-sheet.tsx",
      "components/suppliers/supplier-sheet.tsx",
      "components/purchases/purchase-receipt-builder.tsx",
      "components/cashbook/cashbook-entry-form.tsx",
      "components/treasury.tsx",
      "components/operations-reconciliation.tsx",
    ]) expect(read(file), file).toContain("<MoneyInput");
  });

});
