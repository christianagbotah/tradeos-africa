import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {describe,expect,it} from "vitest";const dir=path.dirname(fileURLToPath(import.meta.url));const appRoot=path.resolve(dir,"../..");const read=(r:string)=>fs.readFileSync(path.join(appRoot,r),"utf8");

describe("TradeOS dashboard command center",()=>{
 it("keeps the evidence-driven dashboard model and role-aware access",()=>{const s=read("components/dashboard/dashboard-command-center.tsx");expect(s).toContain("buildDashboardModel");expect(s).toContain("dashboardAttentionForRole");expect(s).toContain("dashboardCanViewReports");expect(s).toContain("canAccessWorkspaceRoute");});
 it("keeps the route wired to live business, branch, business type and currency context",()=>{const p=read("(workspace)/dashboard/page.tsx");expect(p).toContain("DashboardCommandCenter");expect(p).toContain("businessType={context.business.businessType}");expect(p).toContain("currencyCode={context.business.currencyCode}");});
 it("renders an intentional status region and loading state",()=>{const s=read("components/dashboard/dashboard-command-center.tsx");expect(s).toContain('role="status"');expect(s).toContain("Loading…");expect(s).toContain("visibleAttention.length");});
 it("keeps frontline selling priority without weakening route permissions",()=>{const s=read("components/dashboard/dashboard-command-center.tsx");expect(s).toContain("frontlineRoles");expect(s).toContain("isFrontline && canSell");expect(s).toContain("tos-zai-mobile-sell");});
 it("has phone-safe touch, tabular money, overflow and reduced-motion contracts",()=>{const css=read("dashboard.css");expect(css).toMatch(/min-height:\s*var\(--tos-touch-mobile\)/);expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);expect(css).toContain("minmax(0,1fr)");expect(css).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)/);expect(css).toContain("prefers-reduced-motion");});
});

describe("Z.ai dashboard visual grammar", () => {
  const source = read("components/dashboard/dashboard-command-center.tsx");
  it("uses the Z.ai page header and action rail", () => { expect(source).toContain("tos-zai-dashboard-header"); expect(source).toContain("tos-zai-dashboard-actions"); for (const label of ["New sale", "Receive stock", "Record expense", "Send reminders"]) expect(source).toContain(label); });
  it("renders AI action cards instead of the later pulse hero", () => { expect(source).toContain("AI actions for today"); expect(source).toContain("tos-zai-ai-actions"); expect(source).toContain("tos-zai-ai-card"); expect(source).not.toContain("<BusinessPulse"); });
  it("renders the four Z.ai business KPI cards", () => { for (const label of ["Today's sales", "Gross profit", "Cash position", "Outstanding credit"]) expect(source).toContain(label); expect(source).toContain("tos-zai-kpi-grid"); });
  it("keeps guidance adaptive to the configured business type", () => { expect(source).toContain("businessGuidance"); expect(source).toContain("Retail / Provisions"); expect(source).toContain("Food / Hospitality"); });
});
