import type { FinancialSummaryReport } from "@tradeos/contracts";

interface RecentSale {
  totalMinor: number;
  refundTotalMinor: number;
}
export type DashboardRevenueStat = {
  label: string;
  minor: number | null;
  currencyCode: string;
  hint: string;
  source: "CANONICAL_REPORT" | "RECENT_RECEIPTS" | "UNAVAILABLE";
};

/** Never represent the last eight sales as an entire business day's revenue. */
export function deriveDashboardRevenue(input: {
  mayReadFinancialReport: boolean;
  report: FinancialSummaryReport | null;
  recentSales: RecentSale[];
  fallbackCurrencyCode: string;
  online: boolean;
  pendingSync: number;
}): DashboardRevenueStat {
  const { mayReadFinancialReport, report, recentSales,
    fallbackCurrencyCode, online, pendingSync } = input;

  if (mayReadFinancialReport) {
    if (!report || !online) {
      return {
        label: "Today's net revenue",
        minor: null, currencyCode: fallbackCurrencyCode, source: "UNAVAILABLE",
        hint: !online
          ? "Offline: daily report is not current"
          : "Daily revenue report unavailable",
      };
    }
    return {
      label: "Today's net revenue",
      minor: report.flow.netRevenueMinor,
      currencyCode: report.currencyCode,
      source: "CANONICAL_REPORT",
      hint: report.flow.salesCount.toLocaleString("en-GH") + " recorded sale(s)" +
        (pendingSync > 0 ? "; pending offline changes excluded" : ""),
    };
  }

  return {
    label: "Recent receipts (last 8)",
    minor: recentSales.slice(0, 8).reduce(
      (sum, sale) => sum + sale.totalMinor - sale.refundTotalMinor, 0),
    currencyCode: fallbackCurrencyCode,
    source: "RECENT_RECEIPTS",
    hint: "Only recent synced receipts; not today's revenue" +
      (pendingSync > 0 ? "; offline changes pending" : ""),
  };
}
