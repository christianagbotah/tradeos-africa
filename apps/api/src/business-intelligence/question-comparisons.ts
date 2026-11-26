import type {
  BusinessQuestionIntent,
  BusinessQuestionResponse,
  FinancialSummaryReport,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { loadFinancialSummary } from "../reports.js";
import { PERIOD_NAMES, questionComparisonPlan } from "./question-periods.js";
import { recordedChangeDrivers } from "./question-drivers.js";

type ComparableIntent = Extract<BusinessQuestionIntent, "SALES" | "PROFIT">;

function amount(minor: number, currency: string): string {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
  return (minor < 0 ? "−" : "") + (currency === "GHS" ? "₵" : currency + " ") + formatted;
}

function localDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function periodLabel(report: FinancialSummaryReport): string {
  // All report windows are half-open; subtract a millisecond to label the
  // actual final local calendar day, not the next period's first day.
  return localDate(report.period.from, report.period.timezone) + " – " +
    localDate(new Date(new Date(report.period.to).getTime() - 1).toISOString(),
      report.period.timezone);
}

function reportQuality(current: FinancialSummaryReport, previous: FinancialSummaryReport):
  BusinessQuestionResponse["dataQuality"] {
  const a = current.health, b = previous.health;
  if (a.status === "INSUFFICIENT_DATA" || b.status === "INSUFFICIENT_DATA") return "INSUFFICIENT";
  if (a.confidence === "LOW" || b.confidence === "LOW") return "LIMITED";
  return "ESTABLISHED";
}

export async function answerFinancialComparison(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  asked: string,
  intent: ComparableIntent,
  base: BusinessQuestionResponse,
): Promise<BusinessQuestionResponse> {
  const plan = questionComparisonPlan(asked);
  if (!plan) return base;
  // Both calls use the same authenticated tenant/branch scope and canonical,
  // read-only report engine. The question cannot alter a SQL identifier.
  const current = await loadFinancialSummary(pool, businessId, branchId, { range: plan.current });
  const previous = await loadFinancialSummary(pool, businessId, branchId, { range: plan.previous });
  const sales = intent === "SALES";
  const a = sales ? current.flow.netRevenueMinor : current.flow.operatingProfitMinor;
  const b = sales ? previous.flow.netRevenueMinor : previous.flow.operatingProfitMinor;
  const aCount = current.flow.salesCount, bCount = previous.flow.salesCount;
  const metric = sales ? "net sales excluding tax, after returns" : "recorded operating profit";
  const currentLabel = PERIOD_NAMES[plan.current], previousLabel = PERIOD_NAMES[plan.previous];
  const unfinished = plan.current === "today" || plan.current === "week" || plan.current === "month";
  const difference = a - b;
  const differenceText = difference === 0
    ? "The recorded totals are equal."
    : "The recorded difference is " + amount(Math.abs(difference), current.currencyCode) +
      (difference > 0 ? " higher" : " lower") + " in " + currentLabel.toLowerCase() + ".";
  // Never claim a percentage decrease when comparing an incomplete current
  // period to the *entire* preceding period. Explanations are not causal.
  const percentText = !unfinished && b > 0
    ? " That is a " + (Math.abs(difference / b) * 100).toFixed(1) +
      "% " + (difference > 0 ? "increase" : difference < 0 ? "decrease" : "change") + " from the previous period." : "";
  const asksWhy = /\b(why|reason|cause|explain|drivers?|factors?|breakdown)\b/i.test(asked);
  const drivers = asksWhy ? recordedChangeDrivers(current.flow, previous.flow, intent, current.currencyCode) : null;
  const limitations = [
    "Only completed and refunded transactions recorded in TradeOS are included.",
    ...(unfinished ? [
      "The current period is incomplete and the earlier period is complete. This is not an equal-duration performance comparison.",
    ] : []),
    ...(asksWhy ? [
      "A change in reported totals alone does not identify its cause. Review individual sales, returns and stock records before attributing a reason.",
    ] : []),
    ...(reportQuality(current, previous) !== "ESTABLISHED"
      ? ["Trading history is limited; these are recorded amounts, not predictions."] : []),
    ...(drivers?.limitations ?? []),
  ];

  return {
    ...base,
    currencyCode: current.currencyCode,
    sourcePage: "/reports",
    dataQuality: reportQuality(current, previous),
    evidence: [
      { key: "currentValueMinor", label: currentLabel + " " + metric,
        value: a, unit: "MINOR", source: "FINANCIAL_REPORT" },
      { key: "previousValueMinor", label: previousLabel + " " + metric,
        value: b, unit: "MINOR", source: "FINANCIAL_REPORT" },
      { key: "differenceMinor", label: "Change in " + metric,
        value: difference, unit: "MINOR", source: "FINANCIAL_REPORT" },
      { key: "currentSalesCount", label: currentLabel + " recorded sales",
        value: aCount, unit: "COUNT", source: "FINANCIAL_REPORT" },
      { key: "previousSalesCount", label: previousLabel + " recorded sales",
        value: bCount, unit: "COUNT", source: "FINANCIAL_REPORT" },
      ...(drivers?.evidence ?? []),
    ],
    items: [
      { id: "current", label: currentLabel,
        detail: periodLabel(current) + ": " + amount(a, current.currencyCode) +
          " " + metric + " from " + aCount + " sale(s)" },
      { id: "previous", label: previousLabel,
        detail: periodLabel(previous) + ": " + amount(b, previous.currencyCode) +
          " " + metric + " from " + bCount + " sale(s)" },
      ...(drivers?.items ?? []),
    ],
    answer: currentLabel + " recorded " + amount(a, current.currencyCode) +
      " in " + metric + " from " + aCount + " sale(s). " +
      previousLabel + " recorded " + amount(b, previous.currencyCode) +
      " from " + bCount + " sale(s). " + differenceText + percentText +
      (unfinished ? " The current period is still in progress; these periods cover different lengths." : "") +
      (asksWhy ? " The figures do not establish why the change occurred. " + (drivers?.text ?? "") : ""),
    limitations,
  };
}
