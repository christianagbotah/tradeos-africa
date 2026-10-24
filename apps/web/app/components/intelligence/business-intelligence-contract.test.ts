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

  it("routes action-queue reviews to their canonical workflow, including data readiness and payables", () => {
    const briefing = source(paths.briefing);
    expect(briefing).toContain("actionItemWorkflowHref");
    expect(briefing).toContain('href={actionItemWorkflowHref(item)}');
    expect(briefing).toContain('item.actionType === "CREATE_DATA_READINESS_REVIEW"');
    expect(briefing).toContain('return "/settings?section=business"');
    expect(briefing).toContain('item.actionType === "CREATE_PAYABLES_REVIEW"');
    expect(briefing).toContain('item.sourceEntityType === "SUPPLIER" || item.sourceEntityType === "PURCHASE"');
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

  it("carries validated entity context through record-level Ask TradeOS without contaminating normal Ask", () => {
    const shell = source(paths.shell);
    const drawer = source(paths.drawer);
    expect(shell).toContain("askTradeOSInitialContext");
    expect(shell).toContain("initialContext={askTradeOSInitialContext}");
    expect(shell).toContain("isBusinessEntityContext");
    for (const entityType of ["CATALOG_ITEM", "CUSTOMER", "SUPPLIER", "PURCHASE"]) {
      expect(shell).toContain(entityType);
    }
    expect(shell).toMatch(/UUID|[0-9a-f].*\{8\}/i);
    expect(drawer).toContain("BusinessAssistantContext");
    expect(drawer).toContain("initialContext?: BusinessAssistantContext | null");
    expect(drawer).toMatch(/context:\s*initialContext\s*\?\?\s*null/);
    expect(shell).toMatch(/setAskTradeOSInitialQuestion\(null\)[^]*setAskTradeOSInitialContext\(null\)[^]*setAskTradeOSOpen\(true\)/);
  });

  it("carries exact allow-listed financial metric context through Ask TradeOS and rejects mixed browser context", () => {
    const shell = source(paths.shell);
    const drawer = source(paths.drawer);
    expect(shell).toContain("BusinessAssistantContext");
    expect(shell).toContain("isBusinessMetricContext");
    for (const metricKey of [
      "NET_REVENUE", "GROSS_PROFIT", "OPERATING_PROFIT", "EXPENSES", "NET_CASH_MOVEMENT",
      "CASH_BALANCE", "RECEIVABLES", "PAYABLES", "INVENTORY_VALUE",
    ]) expect(shell).toContain(metricKey);
    for (const range of ["today", "week", "month", "quarter"]) expect(shell).toContain(`"${range}"`);
    expect(shell).toContain("isBusinessAssistantContext");
    expect(drawer).toContain("BusinessAssistantContext");
    expect(drawer).toContain("initialContext?: BusinessAssistantContext | null");
    expect(drawer).toMatch(/context:\s*initialContext\s*\?\?\s*null/);
  });

});
