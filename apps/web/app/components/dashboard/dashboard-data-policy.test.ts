import { describe, expect, it } from "vitest";
import { DASHBOARD_COMPARISON_BASELINE, dashboardFinancialCacheKey } from "./dashboard-data-policy";

describe("dashboard daily evidence policy", () => {
  it("date-scopes Today financial cache so yesterday cannot masquerade as today", () => {
    expect(dashboardFinancialCacheKey("b1", "br1", "2026-10-08")).not.toBe(dashboardFinancialCacheKey("b1", "br1", "2026-10-07"));
    expect(dashboardFinancialCacheKey("b1", "br1", "2026-10-08")).toContain("2026-10-08");
  });
  it("names the daily comparison baseline explicitly", () => {
    expect(DASHBOARD_COMPARISON_BASELINE).toBe("yesterday");
  });
});
