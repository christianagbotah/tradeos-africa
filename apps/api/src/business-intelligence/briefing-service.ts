import type { BusinessBriefing, BusinessBriefingRange, FinancialSummaryReport } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { loadFinancialSummary } from "../reports.js";

/**
 * Compose the business briefing from one authoritative reporting snapshot.
 * No language model, estimated cash ledger, background write or fabricated metrics.
 */
export function composeBusinessBriefing(
  report: FinancialSummaryReport,
  range: BusinessBriefingRange,
  generatedAt = new Date(),
): BusinessBriefing {
  const status = report.health.status;
  const dataQuality: BusinessBriefing["dataQuality"] =
    status === "INSUFFICIENT_DATA"
      ? "INSUFFICIENT"
      : report.health.confidence === "LOW"
        ? "LIMITED"
        : "ESTABLISHED";
  const dataQualityMessage =
    dataQuality === "INSUFFICIENT"
      ? "There is not enough recorded trading activity to assess trends. Continue recording sales and expenses before relying on recommendations."
      : dataQuality === "LIMITED"
        ? "These are early indications based on limited history. Review the supporting figures before deciding."
        : "Insights are calculated from recorded TradeOS transactions. They are not guarantees or forecasts.";

  // Low-data businesses must never receive confident-looking inferred recommendations.
  const signals = dataQuality === "INSUFFICIENT"
    ? []
    : report.health.insights.slice(0, 8).map((insight) => ({
        code: insight.code,
        severity: insight.severity,
        title: insight.title,
        message: insight.message,
        evidence: insight.evidence,
      }));
  const actions = dataQuality === "INSUFFICIENT"
    ? []
    : report.health.actions
        .filter((item) => item.href.startsWith("/") && !item.href.startsWith("//"))
        .slice(0, 5)
        .map((item) => ({
          code: item.code,
          priority: item.priority,
          area: item.area,
          title: item.title,
          reason: item.reason,
          action: item.action,
          href: item.href,
          evidence: item.evidence,
        }));

  return {
    businessId: report.businessId,
    branchId: report.branchId,
    currencyCode: report.currencyCode,
    generatedAt: generatedAt.toISOString(),
    period: report.period,
    range,
    engine: "DETERMINISTIC_HEALTH_V1",
    dataQuality,
    dataQualityMessage,
    health: {
      status,
      score: report.health.score,
      confidence: report.health.confidence,
      headline: report.health.headline,
    },
    metrics: {
      salesCount: report.flow.salesCount,
      returnCount: report.flow.returnCount,
      netRevenueMinor: report.flow.netRevenueMinor,
      grossProfitMinor: report.flow.grossProfitMinor,
      expenseMinor: report.flow.expenseMinor,
      operatingProfitMinor: report.flow.operatingProfitMinor,
      netCashMovementMinor: report.flow.netCashMovementMinor,
      cashBalanceMinor: report.position.cashBalanceMinor,
      receivablesMinor: report.position.receivablesMinor,
      payablesMinor: report.position.payablesMinor,
    },
    inventorySnapshotAt: report.position.inventorySnapshotAt,
    inventorySnapshotAligned: report.health.workingCapital.inventorySnapshotAligned,
    signals,
    actions,
  };
}

export async function buildBusinessBriefing(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  range: BusinessBriefingRange,
): Promise<BusinessBriefing> {
  const report = await loadFinancialSummary(pool, businessId, branchId, { range });
  return composeBusinessBriefing(report, range);
}
