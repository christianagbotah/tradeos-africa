import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("Z.ai authenticated composition boundary", () => {
  it("matches the saved Z.ai shell grammar instead of the later ERP shell", () => {
    const shell = read("components/workspace/app-shell.tsx");
    expect(shell).toContain("workspace-business-card");
    expect(shell).toContain("workspace-global-search");
    expect(shell).toContain("workspace-mobile-header");
    expect(shell).toContain("workspace-sidebar-collapse");
    expect(shell).toContain("MobileBottomNav");
    expect(shell).not.toContain("workspace-topbar-title");
  });

  it("matches the saved Z.ai dashboard grammar rather than Today/Pulse cards", () => {
    const dashboard = read("components/dashboard/dashboard-command-center.tsx");
    expect(dashboard).toContain("zai-dashboard-header");
    expect(dashboard).toContain("zai-business-guidance");
    expect(dashboard).toContain("zai-action-rail");
    expect(dashboard).toContain("zai-ai-actions");
    expect(dashboard).toContain("zai-kpi-grid");
    expect(dashboard).toContain("zai-dashboard-lower-grid");
    expect(dashboard).not.toContain("<BusinessPulse");
    expect(dashboard).not.toContain('className="tos-today"');
  });

  it("matches the saved Z.ai POS grammar on desktop and phone", () => {
    const pos = read("components/pos/pos-workspace.tsx");
    const browser = read("components/pos/product-browser.tsx");
    expect(pos).toContain('className="pos-workspace-grid"');
    expect(pos).toContain("pos-cart-customer");
    expect(pos).toContain('className="pos-charge-bar"');
    expect(pos).not.toContain("pos-customer-bar");
    expect(browser).toContain("pos-category-strip");
    expect(browser).toContain('placeholder="Search product, SKU or scan barcode…"');
  });

  it("keeps Z.ai Returns composition instead of the later evidence-card recomposition", () => {
    const workspace = read("components/returns/return-refund-workspace.tsx");
    const refundSheet = read("components/returns/return-refund-sheet.tsx");
    const exchangeSheet = read("components/returns/exchange-sheet.tsx");
    expect(workspace).toContain('className="return-commandbar"');
    expect(workspace).toContain('className={selectedId === sale.id ? "return-sale-row active" : "return-sale-row"}');
    expect(workspace).not.toContain("MobileRecordCard");
    expect(refundSheet).not.toContain("return-original-evidence");
    expect(refundSheet).not.toContain("return-consequence");
    expect(exchangeSheet).not.toContain("exchange-original-evidence");
    expect(exchangeSheet).not.toContain("exchange-flow-step");
    expect(exchangeSheet).not.toContain("exchange-settlement-outcome");
  });
});
