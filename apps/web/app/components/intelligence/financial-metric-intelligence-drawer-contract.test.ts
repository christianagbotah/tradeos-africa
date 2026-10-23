import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const drawerPath = resolve(ROOT, "app/components/intelligence/financial-metric-intelligence-drawer.tsx");
const cssPath = resolve(ROOT, "app/intelligence.css");

function source(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("financial metric intelligence drawer contract", () => {
  it("ships one lazy online-only metric intelligence GET keyed by selected metric and range", () => {
    expect(existsSync(drawerPath)).toBe(true);
    const drawer = source(drawerPath);
    expect(drawer).toContain("/v1/intelligence/metric");
    expect(drawer).toContain("metricKey=${encodeURIComponent(metricKey)}");
    expect(drawer).toContain("range=${encodeURIComponent(range)}");
    expect(drawer).toMatch(/open\s*&&\s*session\s*&&\s*queue\.online/);
    expect(drawer).toContain("useApiFetch<BusinessFinancialMetricIntelligence>");
  });

  it("rejects stale response data after a metric or range switch", () => {
    const drawer = source(drawerPath);
    expect(drawer).toMatch(/data\?\.metric\.metricKey\s*===\s*metricKey/);
    expect(drawer).toMatch(/data\.range\s*===\s*range/);
    expect(drawer).toContain("currentData");
  });

  it("renders current, prior, delta, summary, evidence and attention with explicit inventory snapshot semantics", () => {
    const drawer = source(drawerPath);
    expect(drawer).toContain("currentMinor");
    expect(drawer).toContain("previousMinor");
    expect(drawer).toContain("deltaMinor");
    expect(drawer).toContain("changePercent");
    expect(drawer).toMatch(/Snapshot only|snapshot only|No prior inventory/i);
    expect(drawer).toMatch(/Evidence|evidence/);
    expect(drawer).toMatch(/Attention|attention/);
    expect(drawer).toContain("currentData.summary");
  });

  it("dispatches exact structured metric context to Ask TradeOS from a non-submitting button", () => {
    const drawer = source(drawerPath);
    expect(drawer).toContain('type="button"');
    expect(drawer).toContain('CustomEvent("tradeos:ask"');
    expect(drawer).toMatch(/context:\s*\{\s*metricKey,\s*range\s*\}/);
    expect(drawer).toMatch(/disabled=\{!queue\.online\}/);
  });

  it("is read-only and keeps recommendations navigation-only", () => {
    const drawer = source(drawerPath);
    expect(drawer).toContain("contextualWorkflowHref");
    expect(drawer).toContain("<Link");
    expect(drawer).not.toMatch(/method:\s*["'](?:POST|PATCH|DELETE)["']/);
    expect(drawer).not.toMatch(/\/v1\/(?:sales|payments|refunds|returns|purchases|inventory|cashbook|staff|memberships)\b/);
    expect(drawer).toMatch(/read-only|read only/i);
  });

  it("renders explicit offline/loading/error states and responsive styling", () => {
    const drawer = source(drawerPath);
    const css = source(cssPath);
    expect(drawer).toMatch(/offline/i);
    expect(drawer).toMatch(/loading/i);
    expect(drawer).toMatch(/Could not load financial metric intelligence/i);
    expect(css).toContain(".tos-metric-ai");
    expect(css).toMatch(/@media[^{]*\([^)]*max-width/i);
  });
});
