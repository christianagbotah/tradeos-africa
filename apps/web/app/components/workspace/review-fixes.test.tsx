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
    expect(shell.match(/Sign out/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const moreSheet = read("components/workspace/mobile-more-sheet.tsx");
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
    const css = read("cashbook.css");
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

});
