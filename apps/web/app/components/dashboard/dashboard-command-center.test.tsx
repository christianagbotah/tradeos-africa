import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(dir, "../..");
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), "utf8");

describe("TradeOS Z.ai dashboard command center", () => {
  it("orders reference-screen operating guidance, actions, AI evidence, KPIs and lower analytics", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    const start = source.indexOf('className="zai-dashboard"');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start);
    const guidance = body.indexOf("zai-business-guidance");
    const actions = body.indexOf("zai-action-rail");
    const ai = body.indexOf("zai-ai-actions");
    const kpis = body.indexOf("zai-kpi-grid");
    const lower = body.indexOf("zai-dashboard-lower-grid");
    expect(guidance).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(guidance);
    expect(ai).toBeGreaterThan(actions);
    expect(kpis).toBeGreaterThan(ai);
    expect(lower).toBeGreaterThan(kpis);
    expect(source).not.toContain("<BusinessPulse");
    expect(source).not.toContain('className="tos-today"');
  });

  it("keeps the route thin and passes the real business pack into the command center", () => {
    const page = read("(workspace)/dashboard/page.tsx");
    expect(page).toContain("DashboardCommandCenter");
    expect(page).toContain("businessType={context.business.businessType}");
    expect(page).not.toContain("Sellable choices");
    expect(page).not.toContain("Tracked products");
  });

  it("keeps role-aware action and attention policy authoritative", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    expect(source).toContain("dashboardAttentionForRole");
    expect(source).toContain("dashboardQuickActions");
    expect(source).toContain("dashboardCanViewReports");
    expect(source).toContain('canAccessWorkspaceRoute(role, "/sell")');
  });

  it("renders an intentional status region for offline, partial and error evidence", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    expect(source).toContain('role="status"');
    expect(source).toContain("tos-dashboard-message");
  });

  it("renders evidence-safe AI fallback instead of inventing business values", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    expect(source).toContain("aiCards.length === 0");
    expect(source).toContain("No urgent exception right now");
    expect(source).toContain("TradeOS has not received a sale in the current reporting period.");
    expect(source).toContain("model.dataStatus.coverage");
  });

  it("keeps loading and unavailable money states explicit", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    expect(source).toContain("Loading…");
    expect(source).toMatch(/netRevenueMinor == null \? "—"/);
    expect(source).toMatch(/cashMinor == null \? "—"/);
  });

  it("keeps frontline roles out of owner-only momentum guidance", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    expect(source).toContain("frontlineRoles");
    expect(source).toContain("!isFrontline");
    expect(source).toContain("zai-action-rail");
  });

  it("uses real report evidence for all four screenshot-reference KPI cards", () => {
    const source = read("components/dashboard/dashboard-command-center.tsx");
    for (const label of ["Today&apos;s sales", "Gross profit", "Cash position", "Outstanding credit"]) expect(source).toContain(label);
    expect(source).toContain("model.today.netRevenueMinor");
    expect(source).toContain("model.today.grossProfitMinor");
    expect(source).toContain("model.moneyPosition.cashMinor");
    expect(source).toContain("model.moneyPosition.receivablesMinor");
  });

  it("uses the screenshot-parity stylesheet for responsive two-column/one-column composition", () => {
    const css = read("zai-reference.css");
    expect(css).toContain(".zai-ai-actions-grid");
    expect(css).toContain(".zai-kpi-grid");
    expect(css).toContain("grid-template-columns: repeat(3,minmax(0,1fr))");
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    expect(css).toContain("grid-template-columns: 1fr");
  });
});
