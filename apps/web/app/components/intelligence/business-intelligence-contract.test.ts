import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const paths = {
  dashboard: resolve(ROOT, "app/components/dashboard/dashboard-command-center.tsx"),
  briefing: resolve(ROOT, "app/components/intelligence/business-briefing.tsx"),
  drawer: resolve(ROOT, "app/components/intelligence/ask-tradeos-drawer.tsx"),
  cache: resolve(ROOT, "app/components/intelligence/business-intelligence-cache.ts"),
  shell: resolve(ROOT, "app/components/workspace/app-shell.tsx"),
};

function source(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("tenant intelligence experience contract", () => {
  it("ships the briefing, Ask TradeOS drawer, and scoped cache modules", () => {
    expect(existsSync(paths.briefing)).toBe(true);
    expect(existsSync(paths.drawer)).toBe(true);
    expect(existsSync(paths.cache)).toBe(true);
  });

  it("places the business briefing before secondary dashboard KPI content", () => {
    const dashboard = source(paths.dashboard);
    expect(dashboard).toContain("BusinessBriefing");
    const briefingIndex = dashboard.indexOf("<BusinessBriefing");
    const statsIndex = dashboard.indexOf('className="tos-dashboard-stats');
    expect(briefingIndex).toBeGreaterThan(-1);
    expect(statsIndex).toBeGreaterThan(-1);
    expect(briefingIndex).toBeLessThan(statsIndex);
  });

  it("loads briefing and action items with a visible offline cached state", () => {
    const briefing = source(paths.briefing);
    expect(briefing).toContain("/v1/intelligence/briefing");
    expect(briefing).toContain("/v1/intelligence/action-items");
    expect(briefing).toContain("businessIntelligenceCacheKey");
    expect(briefing).toMatch(/queue\.online|online/);
    expect(briefing).toMatch(/Cached|cached|offline/i);
    expect(briefing).toMatch(/generatedAt|Generated/);
  });

  it("provides global Ask TradeOS access and separates answer, evidence, and recommendations", () => {
    const shell = source(paths.shell);
    const drawer = source(paths.drawer);
    expect(shell).toContain("Ask TradeOS");
    expect(shell).toContain("AskTradeOSDrawer");
    expect(drawer).toContain("/v1/intelligence/query");
    expect(drawer).toMatch(/Answer|answer/);
    expect(drawer).toMatch(/Evidence|evidence/);
    expect(drawer).toMatch(/Recommendation|recommendations/);
  });

  it("does not allow AI economic recommendations to auto-submit while offline", () => {
    const drawer = source(paths.drawer);
    const briefing = source(paths.briefing);
    const combined = `${drawer}\n${briefing}`;
    expect(combined).toMatch(/queue\.online|online/);
    expect(combined).toMatch(/Open workflow|open workflow|Go to|Review in/);
    expect(combined).not.toMatch(/\/v1\/intelligence\/(payment|refund|sale|stock-write-off)/);
    expect(combined).not.toMatch(/autoSubmit\s*\(|autonomousPayment\s*\(/i);
  });

  it("lets online users complete or snooze AI action items without leaving the briefing", () => {
    const briefing = source(paths.briefing);
    expect(briefing).toContain("mutateBusinessActionItem");
    expect(briefing).toMatch(/Mark done|Done/);
    expect(briefing).toMatch(/Snooze/);
    expect(briefing).toContain("actionQuery.refetch");
    expect(briefing).toMatch(/queue\.online/);
  });

  it("opens Ask TradeOS with a contextual prompt while preserving the normal topbar entry", () => {
    const shell = source(paths.shell);
    const drawer = source(paths.drawer);
    expect(shell).toContain('"tradeos:ask"');
    expect(shell).toContain("askTradeOSInitialQuestion");
    expect(shell).toContain("initialQuestion={askTradeOSInitialQuestion}");
    expect(drawer).toContain("initialQuestion?: string");
    expect(drawer).toMatch(/setQuestion\(initialQuestion/);
    expect(shell).toMatch(/setAskTradeOSInitialQuestion\(null\)[^]*setAskTradeOSOpen\(true\)/);
  });

});
