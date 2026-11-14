import { describe, expect, it } from "vitest";
import type { FinancialSummaryReport } from "@tradeos/contracts";
import { deriveDashboardRevenue } from "./dashboard-revenue";

const report = {
  businessId:"business-a",branchId:"branch-a",currencyCode:"GHS",
  flow: { netRevenueMinor: 252500, salesCount: 25 },
} as unknown as FinancialSummaryReport;
const receipts = Array.from({length:8}, () => ({totalMinor:12000,refundTotalMinor:1000}));

describe("dashboard money truthfulness", () => {
  it("uses all posted daily revenue and counts instead of eight recent sales", () => {
    const summary=deriveDashboardRevenue({
      mayReadFinancialReport:true,report,recentSales:receipts,
      fallbackCurrencyCode:"GHS",online:true,pendingSync:0,
    });
    expect(summary).toMatchObject({
      source:"CANONICAL_REPORT",label:"Today's net revenue",
      minor:252500,currencyCode:"GHS",hint:"25 recorded sale(s)",
    });
    expect(summary.minor).not.toBe(88000);
  });

  it("labels restricted cashier sales as recent receipts, never today's totals", () => {
    const summary=deriveDashboardRevenue({
      mayReadFinancialReport:false,report:null,recentSales:receipts,
      fallbackCurrencyCode:"GHS",online:true,pendingSync:2,
    });
    expect(summary).toMatchObject({
      source:"RECENT_RECEIPTS",label:"Recent receipts (last 8)",minor:88000,
    });
    expect(summary.hint).toMatch(/not today's revenue/i);
    expect(summary.hint).toMatch(/offline changes pending/i);
  });

  it("does not show a made-up revenue value on a failed or offline report", () => {
    for (const online of [true,false]) {
      const summary=deriveDashboardRevenue({
        mayReadFinancialReport:true,report:null,recentSales:receipts,
        fallbackCurrencyCode:"GHS",online,pendingSync:3,
      });
      expect(summary).toMatchObject({source:"UNAVAILABLE",minor:null});
      expect(summary.label).toBe("Today's net revenue");
    }
  });

  it("treats genuine zero posted revenue as zero, not unavailable", () => {
    const zeroReport = {
      ...report, flow: { netRevenueMinor: 0, salesCount: 0 },
    } as FinancialSummaryReport;
    const result=deriveDashboardRevenue({
      mayReadFinancialReport: true,
      report: zeroReport,
      recentSales: receipts,
      fallbackCurrencyCode: "GHS",
      online: true, pendingSync: 0,
    });
    expect(result).toMatchObject({ source: "CANONICAL_REPORT", minor: 0 });
    expect(result.hint).toBe("0 recorded sale(s)");
  });

  it("labels pending offline sync explicitly when canonical report is available", () => {
    const summary=deriveDashboardRevenue({
      mayReadFinancialReport:true,report,recentSales:receipts,
      fallbackCurrencyCode:"GHS",online:true,pendingSync:4,
    });
    expect(summary.minor).toBe(252500);
    expect(summary.hint).toMatch(/pending offline changes excluded/i);
  });
});
