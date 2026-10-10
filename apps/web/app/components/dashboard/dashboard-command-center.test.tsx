import fs from "node:fs";import path from "node:path";import {fileURLToPath} from "node:url";import {describe,expect,it} from "vitest";const dir=path.dirname(fileURLToPath(import.meta.url));const appRoot=path.resolve(dir,"../..");const read=(r:string)=>fs.readFileSync(path.join(appRoot,r),"utf8");
describe("TradeOS dashboard command center",()=>{
 it("puts operating state, pulse, actions and attention ahead of deep analytics",()=>{const s=read("components/dashboard/dashboard-command-center.tsx");for(const phrase of ["Today","Quick actions","Needs attention","Money position"])expect(s).toContain(phrase);expect(s).toContain("BusinessPulse");expect(s).toContain("buildDashboardModel");expect(s).toContain("const visibleAttention");expect(s).toContain("visibleAttention.length");});
 it("removes catalog-count first viewport from route page",()=>{const p=read("(workspace)/dashboard/page.tsx");expect(p).toContain("DashboardCommandCenter");expect(p).not.toContain("Sellable choices");expect(p).not.toContain("Tracked products");expect(p).not.toContain("StatCard");});
 it("has phone-safe typography, touch and overflow contracts",()=>{const css=read("dashboard.css");expect(css).toMatch(/min-height:\s*var\(--tos-touch-mobile\)/);expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);expect(css).toContain("minmax(0, 1fr)");expect(css).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)/);expect(css).toContain("prefers-reduced-motion");expect(css).not.toMatch(/font-size:\s*(9|10)px/);});
});

// Task 3: role-aware prioritization + intentional state regions
describe("Dashboard role-aware prioritization", () => {
  it("places business state and exceptions/actions before secondary trends for owners", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    // Search within the JSX return body — find the first JSX element after return
    const bodyStart = s.indexOf('className="tos-dashboard"');
    expect(bodyStart).toBeGreaterThan(-1);
    const body = s.slice(bodyStart);
    const todayIdx = body.indexOf('tos-today');
    const pulseIdx = body.indexOf("<BusinessPulse");
    const quickIdx = body.indexOf("Quick actions");
    const attentionIdx = body.indexOf("Needs attention");
    const moneyIdx = body.indexOf("Money position");
    const momentumIdx = body.indexOf("momentum-title");
    expect(todayIdx).toBeGreaterThan(-1);
    expect(pulseIdx).toBeGreaterThan(todayIdx);
    expect(quickIdx).toBeGreaterThan(pulseIdx);
    expect(attentionIdx).toBeGreaterThan(quickIdx);
    expect(moneyIdx).toBeGreaterThan(attentionIdx);
    expect(momentumIdx).toBeGreaterThan(moneyIdx);
  });

  it("uses dashboardAttentionForRole so frontline roles do not lead with owner-only analytics", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain("dashboardAttentionForRole");
    expect(s).toContain("dashboardQuickActions");
    expect(s).toContain("dashboardCanViewReports");
  });

  it("renders an intentional state region for the dashboard message (offline/partial/error)", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain('role="status"');
    expect(s).toContain("tos-dashboard-message");
  });

  it("renders an intentional empty/placeholder when attention is empty rather than a blank panel", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain("visibleAttention.length");
    expect(s).toMatch(/tos-dashboard-empty|No urgent exception/);
  });

  it("renders a loading placeholder rather than a blank hero when busy and no revenue", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain("Loading");
    expect(s).toContain("tos-today-empty");
  });

  it("promotes Sell CTA for frontline roles instead of leading with owner-only analytics", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain("frontlineRoles");
    expect(s).toContain("tos-dashboard-sell-cta");
  });

  it("hides momentum/trends section for frontline roles", () => {
    const s = read("components/dashboard/dashboard-command-center.tsx");
    expect(s).toContain("!isFrontline");
  });

  it("keeps dashboard CSS mobile-first with 48px touch targets and tabular money", () => {
    const css = read("dashboard.css");
    expect(css).toMatch(/min-height:\s*var\(--tos-touch-mobile\)/);
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)/);
  });
});
