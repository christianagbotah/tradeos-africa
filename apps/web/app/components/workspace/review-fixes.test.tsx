import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("multi-page review regressions", () => {
  it("keeps authenticated APIs network-only and purges previously cached API responses", () => {
    const sw = fs.readFileSync(path.resolve(appRoot, "../public/sw.js"), "utf8");
    expect(sw).toMatch(/pathname\.startsWith\(["']\/api\/["']\)/);
    expect(sw).toMatch(/cache\.keys\(\)[\s\S]*\/api\//);
  });

  it("ignores stale business loads and commits active business only for the latest request", () => {
    const provider = read("components/workspace/workspace-provider.tsx");
    expect(provider).toContain("useRef");
    expect(provider).toMatch(/requestGenerationRef/);
    expect(provider).toMatch(/generation !== requestGenerationRef\.current/);
    expect(provider).toMatch(/const loaded = await loadBusiness/);
    expect(provider).toMatch(/if \(loaded\)[\s\S]*setActiveBusinessId/);
    expect(provider).toContain("writeWorkspaceBootstrap");
  });

  it("remounts route features when business or branch changes so drafts cannot cross scopes", () => {
    const shell = read("components/workspace/app-shell.tsx");
    expect(shell).toMatch(/key=\{`\$\{context\.business\.id\}:\$\{branchId\}`\}/);
  });

  it("keeps business, branch, sync and sign-out controls available in the responsive More sheet", () => {
    const shell = read("components/workspace/app-shell.tsx");
    expect(shell).toContain("MobileMoreSheet");
    expect(read("components/workspace/mobile-more-sheet.tsx")).toContain("workspace-more-context");
    expect(shell.match(/<NetworkStatus/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const moreSheet = read("components/workspace/mobile-more-sheet.tsx");
    expect(shell).toContain("Sign out");
    expect(moreSheet).toContain("Sign out");
    expect(moreSheet).toContain('role="dialog"');
    expect(moreSheet).toContain('aria-modal="true"');
    expect(moreSheet).toContain('e.key==="Escape"');
    expect(moreSheet).toContain('e.key!=="Tab"');
    expect(moreSheet).toContain("data-more-trigger");
  });

  it("aligns returns and operations navigation with backend read/write roles", () => {
    const nav = read("components/workspace/workspace-navigation.ts");
    expect(nav).toMatch(/href: "\/returns"[^\n]+roles: \["OWNER", "ADMIN", "MANAGER", "CASHIER"\]/);
    expect(nav).toMatch(/href: "\/operations"[^\n]+roles: \["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"\]/);
  });

  it("normalizes CFO destinations to real route URLs instead of deleted hash anchors", () => {
    const source = read("components/cfo-action-center.tsx");
    expect(source).toContain("normalizeCfoActionHref");
    expect(source).not.toMatch(/href:\s*"#(cashbook|customers|purchases)"/);
    expect(source).toMatch(/INVENTORY[\s\S]*\/inventory/);
  });

  it("keeps Treasury minimum table width inside a local horizontal scroll wrapper", () => {
    const treasury = read("components/treasury.tsx");
    const css = read("tradeos-app.css");
    expect(treasury).toContain('className="treasury-table-scroll"');
    expect(css).toMatch(/\.treasury-table-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.treasury-table-scroll\s+table\s*\{[^}]*min-width:\s*680px/);
    expect(css).not.toMatch(/\.treasury-section\s+table\s*\{[^}]*min-width:\s*680px/);
  });

  it("contains every financial report and forecast table with the shared responsive wrapper", () => {
    const reports = read("components/financial-reports.tsx");
    const forecast = read("components/cash-forecast.tsx");
    expect(reports).toContain("ResponsiveTable");
    expect((reports.match(/<ResponsiveTable/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(forecast).toContain("ResponsiveTable");
    expect(forecast).not.toContain('className="table-scroll"');
  });

  it("exposes every report endpoint used by Dashboard and Reports through the authenticated web proxy", () => {
    const proxy = read("api/tradeos/[...path]/route.ts");
    expect(proxy).toContain('"v1/reports/financial-summary"');
    expect(proxy).toContain('"v1/reports/credit-aging"');
    expect(proxy).toContain('"v1/reports/cash-forecast"');
  });

  it("preserves purchase, inventory, sales and return read data in business/branch-scoped feature caches", () => {
    const purchases = read("components/purchases-inventory.tsx");
    const sales = read("components/sales-returns.tsx");
    expect(purchases).toContain("readFeatureCache");
    expect(purchases).toContain("writeFeatureCache");
    expect(purchases).toContain('"purchases-inventory"');
    expect(purchases).toContain('"purchase-detail"');
    expect(sales).toContain("readFeatureCache");
    expect(sales).toContain("writeFeatureCache");
    expect(sales).toContain('"sales-list"');
    expect(sales).toContain('"sale-detail"');
  });
  it("guards late private-cache writes with the shared session epoch", () => {
    const purchases = read("components/purchases-inventory.tsx");
    const sales = read("components/sales-returns.tsx");
    expect(purchases).toContain("captureSessionEpoch");
    expect(purchases).toContain("isSessionEpochCurrent");
    expect(sales.match(/captureSessionEpoch/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sales.match(/isSessionEpochCurrent/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves the latest branch intent while same-business refreshes are in flight", () => {
    const provider = read("components/workspace/workspace-provider.tsx");
    expect(provider).toContain("branchIntentRef");
    expect(provider).toMatch(/branchIntentRef\.current = branchId/);
    expect(provider).toMatch(/selectInitialBranch\(business, branchIntentRef\.current \?\? preferredBranchId\)/);
  });

  it("offers retry, business recovery and sign-out when workspace loading fails", () => {
    const provider = read("components/workspace/workspace-provider.tsx");
    const boundary = read("components/workspace/workspace-boundary.tsx");
    expect(provider).toContain("retryWorkspace");
    expect(boundary).toContain("Try again");
    expect(boundary).toContain("Switch business");
    expect(boundary).toContain("Sign out");
  });


  it("keeps consolidated application CSS comments balanced so migrated styles remain active", () => {
    const css = read("tradeos-app.css");
    expect(css.match(/\/\*/g)?.length ?? 0).toBe(css.match(/\*\//g)?.length ?? 0);
    expect(css).toContain("/* === Migrated feature styles (from deleted legacy CSS files) === */");
  });

  it("keeps frontend source free of batch-rewrite control-character artifacts", () => {
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(tsx?|css)$/.test(entry.name) && fs.readFileSync(full, "utf8").includes(String.fromCharCode(12))) offenders.push(full);
      }
    };
    visit(appRoot);
    expect(offenders).toEqual([]);
  });

  it("makes the Treasury resolution dialog keyboard-safe and touch-safe", () => {
    const treasury = read("components/treasury.tsx");
    const css = read("tradeos-app.css");
    expect(treasury).toContain('aria-labelledby="treasury-resolution-title"');
    expect(treasury).toContain('id="treasury-resolution-title"');
    expect(treasury).toContain("resolutionInputRef");
    expect(treasury).toMatch(/e\.key === "Escape"/);
    expect(treasury).toContain(".focus()");
    expect(css).toMatch(/\.treasury-resolution-actions button\s*\{[^}]*min-height:\s*48px/);
  });

  it("keeps currency-entry fields on the shared spaced money input", () => {
    for (const file of [
      "components/catalog/catalog-item-sheet.tsx",
      "components/customers/customer-sheet.tsx",
      "components/suppliers/supplier-sheet.tsx",
      "components/purchases/purchase-receipt-builder.tsx",
      "components/cashbook/cashbook-entry-form.tsx",
      "components/treasury.tsx",
      "components/operations-reconciliation.tsx",
    ]) {
      expect(read(file), file).toContain("<MoneyInput");
    }
    expect((read("components/treasury.tsx").match(/<MoneyInput/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((read("components/operations-reconciliation.tsx").match(/<MoneyInput/g) ?? []).length).toBeGreaterThanOrEqual(1);
    const ui = read("ui-primitives.css");
    expect(ui).toMatch(/\.tos-money-input\{[^}]*gap:\s*8px/);
  });

  it("keeps clickable controls pointer-aware and every native select surface opaque", () => {
    const css = read("tradeos-app.css");
    const shell = read("workspace-shell.css");
    expect(css).toMatch(/select:not\(:disabled\)[^\{]*\{[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/select option,?\s*select optgroup|select option[\s\S]*select optgroup/);
    expect(css).toMatch(/select option[\s\S]*background(?:-color)?:\s*var\(--tos-surface\)/);
    expect(shell).toMatch(/\.workspace-context-unit \.workspace-context-field select\s*\{[^}]*background(?:-color)?:\s*var\(--tos-surface\)/);
  });

  it("enforces 48px touch targets for buttons and selects through the 768px tablet boundary", () => {
    const shell = read("workspace-shell.css");
    expect(shell).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.workspace-shell button:not\(:disabled\)[\s\S]*min-height:\s*var\(--tos-touch-mobile\)/);
    expect(shell).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*\.workspace-shell select:not\(:disabled\)[\s\S]*min-height:\s*var\(--tos-touch-mobile\)/);
  });

  it("does not use browser prompt, confirm or alert flows in application source", () => {
    const offenders: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
          const source = fs.readFileSync(full, "utf8");
          if (/window\.(prompt|confirm|alert)\(/.test(source)) offenders.push(full);
        }
      }
    };
    visit(appRoot);
    expect(offenders).toEqual([]);
  });

  it("recomposes Purchases, Operations and Reports around dedicated page patterns", () => {
    const purchases = read("components/purchases-inventory.tsx");
    const operations = read("components/operations-reconciliation.tsx");
    const reports = read("components/financial-reports.tsx");
    expect(purchases).toContain("PageHeader");
    expect(purchases).toContain('className="purchase-inventory-workspace"');
    expect(operations).toContain("PageHeader");
    expect(operations).toContain('className="operations-workspace"');
    expect(reports).toContain("PageHeader");
    expect(reports).toContain("CommandBar");
    expect(reports).toContain('className="reports-workspace"');
    expect(reports).not.toContain("ai-tradeos-card");
    expect(reports).not.toContain("working-capital-tradeos-card");
    expect(purchases).not.toContain("purchase-inventory-tradeos-card");
  });
});
