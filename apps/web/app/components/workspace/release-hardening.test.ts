import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCurrentWorkspaceRequest } from "./workspace-provider";
import { workspaceNavigation } from "./workspace-navigation";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(workspaceDir, "../..");
const webRoot = path.resolve(appRoot, "..");

function read(relative: string) {
  return fs.readFileSync(path.join(webRoot, relative), "utf8");
}

describe("multi-page release hardening", () => {
  it("never serves authenticated APIs from the service-worker cache and evicts the old cache generation", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('const CACHE_NAME = "tradeos-shell-v4-true-zai"');
    expect(sw).toMatch(/url\.pathname\.startsWith\("\/api\/"\)[\s\S]*return/);
    expect(sw).toMatch(/keys\.filter\(\(key\) => key !== CACHE_NAME\)[\s\S]*caches\.delete/);
  });

  it("commits only the newest workspace business request", () => {
    expect(isCurrentWorkspaceRequest(4, 4)).toBe(true);
    expect(isCurrentWorkspaceRequest(3, 4)).toBe(false);
    const provider = read("app/components/workspace/workspace-provider.tsx");
    expect(provider).toContain("requestGenerationRef");
    expect(provider).toMatch(/generation !== requestGenerationRef\.current/);
    expect(provider).toMatch(/const loaded = await loadBusiness\(businessId\)[\s\S]*if \(loaded\)[\s\S]*setActiveBusinessId\(businessId\)[\s\S]*writeWorkspaceBootstrap/);
  });

  it("keeps authenticated APIs network-only while restoring a sanitized device-local workspace offline", () => {
    const provider = read("app/components/workspace/workspace-provider.tsx");
    const bootstrap = read("app/lib/workspace-bootstrap.ts");
    expect(provider).toContain("!navigator.onLine");
    expect(provider).toContain("readWorkspaceBootstrap");
    expect(provider).toContain("clearWorkspaceBootstrap");
    expect(bootstrap).toContain('email: null');
    expect(bootstrap).toContain('phoneE164: null');
    expect(bootstrap).toContain('deviceKey: ""');
  });

  it("restores the displayed business intent after a failed business switch without clobbering newer switches", () => {
    const provider = read("app/components/workspace/workspace-provider.tsx");
    expect(provider).toMatch(/catch \(reason\)[\s\S]*businessIntent\.current === businessId[\s\S]*context\?\.business\.id/);
  });

  it("remounts route-local drafts when business or branch context changes", () => {
    const shell = read("app/components/workspace/app-shell.tsx");
    expect(shell).toContain('key={`${context.business.id}:${branchId}`}');
  });

  it("keeps context, sync and sign-out available in the responsive More sheet with keyboard semantics", () => {
    const shell = read("app/components/workspace/app-shell.tsx");
    expect(shell).toContain("MobileMoreSheet");
    expect(read("app/components/workspace/mobile-more-sheet.tsx")).toContain('className="workspace-more-context"');
    expect(shell.match(/<NetworkStatus \/>/g)?.length).toBeGreaterThanOrEqual(2);
    const moreSheet = read("app/components/workspace/mobile-more-sheet.tsx");
    expect(shell).toContain("Sign out");
    expect(moreSheet).toContain("Sign out");
    expect(moreSheet).toContain('role="dialog"');
    expect(moreSheet).toContain('aria-modal="true"');
    expect(moreSheet).toContain('e.key==="Escape"');
    expect(moreSheet).toContain('e.key!=="Tab"');
    expect(moreSheet).toContain("data-more-trigger");
    expect(shell).toContain("businessBranchSelectors");
    expect(shell).toContain("Business");
    expect(shell).toContain("Branch");
  });

  it("aligns Returns mutation access and Operations read access with backend authorization", () => {
    const returns = workspaceNavigation.find((item) => item.href === "/returns");
    const operations = workspaceNavigation.find((item) => item.href === "/operations");
    expect(returns?.roles).toEqual(["OWNER", "ADMIN", "MANAGER", "CASHIER"]);
    expect(operations?.roles).toEqual(["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"]);
  });

  it("contains Treasury and financial-report tables inside local responsive scrollers", () => {
    const treasury = read("app/components/treasury.tsx");
    const cashbookCss = read("app/tradeos-app.css");
    const reports = read("app/components/financial-reports.tsx");
    const forecast = read("app/components/cash-forecast.tsx");
    expect(treasury).toContain('className="treasury-table-scroll"');
    expect(cashbookCss).toMatch(/\.treasury-table-scroll\s*\{[\s\S]*overflow-x:\s*auto/);
    expect(reports.match(/<ResponsiveTable>/g)?.length).toBeGreaterThanOrEqual(3);
    expect(forecast).toContain("<ResponsiveTable>");
    expect(forecast).not.toContain('className="table-scroll"');
  });
});
