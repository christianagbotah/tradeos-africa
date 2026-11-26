import type {
  BusinessQuestionFact, BusinessQuestionResponse, CashForecastResponse,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { loadCashForecast } from "../cash-forecast.js";

function cash(minor: number, currencyCode: string): string {
  const formatted = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Math.abs(minor) / 100);
  return (minor < 0 ? "−" : "") +
    (currencyCode === "GHS" ? "₵" : currencyCode + " ") + formatted;
}

export function cashForecastHorizon(question: string): number | null {
  const normalized = question.toLowerCase();
  // Any explicit numeric horizon takes precedence; never substitute the
  // default seven days for an unsupported number or a different time unit.
  const numeric = normalized.match(/\b(\d+)\s*[- ]\s*(days?|weeks?|months?|years?)\b/);
  if (numeric) {
    const quantity = Number(numeric[1]);
    const unit = numeric[2] ?? "";
    const count = unit.startsWith("day") ? quantity :
      unit.startsWith("week") ? quantity * 7 : NaN;
    return Number.isInteger(count) && count >= 1 && count <= 30 ? count : null;
  }
  if (/\b(?:next|in|for|within)\s+(?:the\s+)?(?:next\s+)?(?:two|three|four)\s+weeks?\b/.test(normalized)) {
    return /\btwo\b/.test(normalized) ? 14 : /\bthree\b/.test(normalized) ? 21 : 28;
  }
  if (/\b(?:next|this)\s+month\b/.test(normalized)) return 30;
  if (/\b(?:next|this)\s+week\b/.test(normalized)) return 7;
  if (/\b(?:tomorrow|next day)\b/.test(normalized)) return 2;
  if (/\btoday\b/.test(normalized)) return 1;
  return 7;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return year && month && day ? day + "-" + month + "-" + year : date;
}

function fact(key: string, label: string, value: number): BusinessQuestionFact {
  return { key, label, value, unit: "MINOR", source: "CASH_FORECAST" };
}

export function summarizeCashForecast(
  forecast: CashForecastResponse,
  base: BusinessQuestionResponse,
): BusinessQuestionResponse {
  const { summary, confidence, currencyCode, horizonDays, days } = forecast;
  const noHistory = confidence.historyDaysAvailable < 14;
  const noObligations = confidence.openCustomerObligationCount === 0 &&
    confidence.openSupplierObligationCount === 0;
  const noUsefulForecast = noHistory && noObligations;
  const firstDate = days[0]?.date ?? "";
  const lastDate = days.at(-1)?.date ?? "";
  const range = firstDate && lastDate ?
    formatDate(firstDate) + " to " + formatDate(lastDate) : horizonDays + " days";
  const firstNegative = summary.firstNegativeCashDate;
  const insufficientNotice =
    "There is not enough recorded operating history or open credit obligations for a meaningful cash-flow forecast. " +
    "TradeOS will not present an unchanged balance as a reliable prediction.";
  const confidenceText = confidence.level.toLowerCase() + "-confidence";
  const scenario = noUsefulForecast
    ? insufficientNotice
    : "The " + confidenceText + " cash-flow scenario for " + range +
      " has a projected closing balance of " + cash(summary.projectedClosingCashMinor, currencyCode) +
      " and a lowest projected daily closing balance of " +
      cash(summary.lowestProjectedCashMinor, currencyCode) +
      " on " + formatDate(summary.lowestProjectedCashDate) + ". " +
      (firstNegative
        ? "The first modeled negative closing balance falls on " + formatDate(firstNegative) + "."
        : "No negative daily closing balance appears in this scenario; this does not guarantee sufficient real cash.");
  const limitations = [
    "These are modeled scenarios, not guaranteed balances or an independent bank reconciliation.",
    "Opening cash is the recorded cashbook balance at the start of the first forecast day; current-day transactions are not a live bank balance.",
    "Recorded customer obligations are not guaranteed collections; supplier due dates may differ from actual payments.",
    "Only completed TradeOS operating cashbook history and currently open obligations are considered.",
    ...confidence.assumptions,
  ];
  return {
    ...base,
    intent: "CASH_FORECAST",
    currencyCode,
    sourcePage: "/reports",
    dataQuality: noUsefulForecast ? "INSUFFICIENT" :
      confidence.level === "HIGH" ? "ESTABLISHED" : "LIMITED",
    answer: scenario,
    evidence: [
      fact("openingCashMinor", "Cashbook balance at start of forecast", summary.openingCashMinor),
      ...(!noUsefulForecast ? [
        fact("projectedClosingCashMinor", "Modeled closing cash", summary.projectedClosingCashMinor),
        fact("lowestProjectedCashMinor", "Lowest modeled daily closing cash", summary.lowestProjectedCashMinor),
        fact("contractualInflowsMinor", "Recorded customer obligations within horizon",
          summary.totalContractualInflowsMinor),
        fact("contractualOutflowsMinor", "Recorded supplier obligations within horizon",
          summary.totalContractualOutflowsMinor),
        fact("baselineInflowsMinor", "Modeled operating inflows", summary.totalBaselineInflowsMinor),
        fact("baselineOutflowsMinor", "Modeled operating outflows", summary.totalBaselineOutflowsMinor),
      ] : []),
      { key: "historyDaysAvailable", label: "Completed days of operating history",
        value: confidence.historyDaysAvailable, unit: "COUNT", source: "CASH_FORECAST" },
      { key: "horizonDays", label: "Scenario horizon in days",
        value: horizonDays, unit: "COUNT", source: "CASH_FORECAST" },
    ],
    items: noUsefulForecast ? [] : [
      { id: "period", label: "Forecast period", detail: range + " · " + confidenceText },
      { id: "lowest", label: "Lowest projected cash",
        detail: cash(summary.lowestProjectedCashMinor, currencyCode) +
          " on " + formatDate(summary.lowestProjectedCashDate) },
      ...(firstNegative ? [{
        id: "risk", label: "Possible negative closing balance",
        detail: "First modeled for " + formatDate(firstNegative) + "; check recorded commitments and actual cash",
      }] : []),
    ],
    limitations,
  };
}

export async function answerCashForecastQuestion(
  pool: DatabasePool,
  businessId: string,
  branchId: string | null,
  question: string,
  base: BusinessQuestionResponse,
): Promise<BusinessQuestionResponse> {
  const horizon = cashForecastHorizon(question);
  if (horizon === null) {
    return {
      ...base, intent: "UNSUPPORTED",
      answer: "I can model cash flow for 1 to 30 days. Ask for 7, 14 or 30 days.",
      limitations: ["No forecast was generated for the requested unsupported horizon."],
    };
  }
  const forecast = await loadCashForecast(pool, businessId, branchId, horizon);
  return summarizeCashForecast(forecast, base);
}
