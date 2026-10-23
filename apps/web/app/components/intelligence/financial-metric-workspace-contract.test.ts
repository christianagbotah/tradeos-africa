import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const reportsPath = resolve(ROOT, "app/components/reports/financial-reports.tsx");

function source(): string {
  return readFileSync(reportsPath, "utf8");
}

describe("financial metric workspace contract", () => {
  it("wires exactly the nine supported report metrics to Explain controls", () => {
    const reports = source();
    for (const metricKey of [
      "NET_REVENUE",
      "GROSS_PROFIT",
      "OPERATING_PROFIT",
      "EXPENSES",
      "NET_CASH_MOVEMENT",
      "CASH_BALANCE",
      "RECEIVABLES",
      "PAYABLES",
      "INVENTORY_VALUE",
    ]) {
      expect(reports.match(new RegExp(`setSelectedMetric\\(\\\"${metricKey}\\\"\\)`, "g")) ?? []).toHaveLength(1);
    }
    expect(reports).not.toContain('setSelectedMetric("AVERAGE_NET_SALE")');
  });

  it("owns one selected metric state and mounts exactly one shared drawer", () => {
    const reports = source();
    expect(reports).toContain("BusinessFinancialMetricKey");
    expect(reports).toMatch(/useState<BusinessFinancialMetricKey\s*\|\s*null>\(null\)/);
    expect(reports.match(/<FinancialMetricIntelligenceDrawer\b/g) ?? []).toHaveLength(1);
    expect(reports).toMatch(/metricKey=\{selectedMetric\}/);
    expect(reports).toMatch(/range=\{range\}/);
    expect(reports).toMatch(/open=\{selectedMetric\s*!==\s*null\}/);
    expect(reports).toMatch(/onClose=\{\(\)\s*=>\s*setSelectedMetric\(null\)\}/);
  });

  it("keeps metric intelligence lazy and outside report render/list fetch paths", () => {
    const reports = source();
    expect(reports).not.toContain("/v1/intelligence/metric");
    expect(reports).toContain("onExplain");
    expect(reports).toContain('type="button"');
    expect(reports).toMatch(/onClick=\{onExplain\}/);
  });

  it("keeps an open metric drawer on the live report range", () => {
    const reports = source();
    expect(reports).toMatch(/range=\{range\}/);
    expect(reports).toMatch(/onClick=\{\(\)\s*=>\s*setRange\(r\.value\)\}/);
  });
});
