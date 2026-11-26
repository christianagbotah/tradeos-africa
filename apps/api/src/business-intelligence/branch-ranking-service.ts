import type {
  BusinessQuestionResponse, BusinessQuestionIntent, BranchFinancialRow,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { loadFinancialSummary } from "../reports.js";
import { PERIOD_NAMES, questionPeriod } from "./question-periods.js";

type RankingMetric = Extract<BusinessQuestionIntent, "SALES" | "PROFIT">;

function money(minor: number, currencyCode: string): string {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
  return (minor < 0 ? "−" : "") + (currencyCode === "GHS" ? "₵" : currencyCode + " ") + formatted;
}

export function rankFinancialBranches(
  rows: readonly BranchFinancialRow[],
  intent: RankingMetric,
): BranchFinancialRow[] {
  const metric = intent === "SALES" ? "netRevenueMinor" : "operatingProfitMinor";
  return [...rows].sort((a, b) =>
    b[metric] - a[metric] || a.branchName.localeCompare(b.branchName) || a.branchId.localeCompare(b.branchId));
}

/**
 * Read-only, owner/admin-only cross-branch question, enforced in the route
 * before this function is called. Preserve the currently selected branch
 * in the response so the UI can present the answer within the same session.
 */
export async function answerBranchRanking(
  pool: DatabasePool,
  businessId: string,
  selectedBranchId: string | null,
  question: string,
  intent: BusinessQuestionIntent,
  base: BusinessQuestionResponse,
): Promise<BusinessQuestionResponse> {
  if (intent !== "SALES" && intent !== "PROFIT") {
    return {
      ...base, intent: "UNSUPPORTED",
      answer: "To compare branches, ask which branch had the highest sales or operating profit for today, yesterday, this week or last month.",
      limitations: ["Branch rankings currently support sales and operating profit, not all performance measures."],
    };
  }
  const range = questionPeriod(question);
  const report = await loadFinancialSummary(pool, businessId, null, { range });
  const activeBranches = report.branches.length;
  // A branch with no recorded activity must not win simply because its total
  // is zero while active branches recorded losses or returns.
  const withActivity = report.branches.filter((row) =>
    row.salesCount > 0 || row.returnCount > 0 || row.expenseMinor !== 0);
  const ranked = rankFinancialBranches(withActivity, intent);
  const metric = intent === "SALES" ? "netRevenueMinor" : "operatingProfitMinor";
  const metricName = intent === "SALES" ? "net sales excluding tax, after returns" : "recorded operating profit";
  const periodName = PERIOD_NAMES[range];
  const valid = ranked.length > 0 && withActivity.length > 0;
  const leading = valid ? ranked[0] : undefined;
  const isTie = Boolean(leading && ranked.filter((row) => row[metric] === leading[metric]).length > 1);
  const insufficient = !valid || report.health.status === "INSUFFICIENT_DATA";
  return {
    ...base,
    businessId,
    branchId: selectedBranchId,
    intent,
    currencyCode: report.currencyCode,
    dataQuality: insufficient ? "INSUFFICIENT" : report.health.confidence === "LOW" ? "LIMITED" : "ESTABLISHED",
    sourcePage: "/reports",
    evidence: [
      { key: "activeBranches", label: "Active branches included",
        value: activeBranches, unit: "COUNT", source: "FINANCIAL_REPORT" },
      { key: "branchesWithActivity", label: "Branches with recorded period activity",
        value: withActivity.length, unit: "COUNT", source: "FINANCIAL_REPORT" },
      ...(leading ? [{
        key: "leadingValueMinor", label: "Leading branch " + metricName,
        value: leading[metric], unit: "MINOR" as const, source: "FINANCIAL_REPORT" as const,
      }] : []),
    ],
    items: valid
      ? ranked.slice(0, 5).map((row) => ({
        id: row.branchId,
        label: row.branchName,
        detail: money(row[metric], report.currencyCode) + " " + metricName +
          " · " + row.salesCount.toLocaleString("en-GH") + " sale(s)",
      }))
      : [],
    answer: !activeBranches
      ? "No active branches were found for this business."
      : !valid
      ? "There are no recorded transactions or expenses in " + periodName.toLowerCase() +
        " across " + activeBranches + " active branches. A meaningful branch ranking is not available yet."
      : (isTie ? "There is a tie for the highest " : "The leading branch by ") +
        metricName + " in " + periodName.toLowerCase() + " is " +
        leading!.branchName + ", with " + money(leading![metric], report.currencyCode) +
        " from " + leading!.salesCount + " recorded sale(s). " +
        "The ranking covers " + activeBranches + " active branches.",
    limitations: [
      "This is a comparison of recorded TradeOS data only, not a prediction of future performance.",
      "The list shows up to five branches; use Reports for the full breakdown.",
      ...(range === "today" || range === "week" || range === "month"
        ? ["The reporting period is still in progress."] : []),
      ...(insufficient ? ["There is limited trading history. A ranking may not reflect typical performance."] : []),
      ...(isTie ? ["Two or more branches share the highest recorded total."] : []),
    ],
  };
}
