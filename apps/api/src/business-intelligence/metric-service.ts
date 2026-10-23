import type {
  BusinessAttentionItem,
  BusinessFinancialMetricIntelligence,
  BusinessFinancialMetricKey,
  BusinessFinancialMetricRange,
  BusinessEvidenceReference,
  BusinessRecommendation,
  FinancialSummaryReport,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { getFinancialSummaryReport } from "../reports.js";
import { listBusinessAttention } from "./attention-service.js";

export class BusinessMetricIntelligenceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BUSINESS_METRIC_INTELLIGENCE_INVALID",
  ) {
    super(message);
    this.name = "BusinessMetricIntelligenceError";
  }
}

type MetricInput = {
  businessId: string;
  branchId: string | null;
  metricKey: BusinessFinancialMetricKey;
  range: BusinessFinancialMetricRange;
};

type MetricDefinition = {
  label: string;
  actionType: string;
  actionLabel: string;
  attentionCodes: readonly string[];
  current: (report: FinancialSummaryReport) => number;
  previous: (report: FinancialSummaryReport) => number | null;
  related: (report: FinancialSummaryReport) => Array<[label: string, value: string | number | boolean | null, money?: boolean]>;
};

const METRICS: Record<BusinessFinancialMetricKey, MetricDefinition> = {
  NET_REVENUE: {
    label: "Net revenue",
    actionType: "OPEN_SALES",
    actionLabel: "Open Sales",
    attentionCodes: ["SALES_DROP"],
    current: (report) => report.flow.netRevenueMinor,
    previous: (report) => report.previousFlow.netRevenueMinor,
    related: (report) => [
      ["salesCount", report.flow.salesCount],
      ["returnCount", report.flow.returnCount],
      ["averageNetSaleMinor", report.flow.averageNetSaleMinor, true],
    ],
  },
  GROSS_PROFIT: {
    label: "Gross profit",
    actionType: "OPEN_REPORTS",
    actionLabel: "Open Reports",
    attentionCodes: ["MARGIN_PRESSURE", "SALES_DROP"],
    current: (report) => report.flow.grossProfitMinor,
    previous: (report) => report.previousFlow.grossProfitMinor,
    related: (report) => [
      ["netRevenueMinor", report.flow.netRevenueMinor, true],
      ["netCogsMinor", report.flow.netCogsMinor, true],
    ],
  },
  OPERATING_PROFIT: {
    label: "Operating profit",
    actionType: "OPEN_REPORTS",
    actionLabel: "Open Reports",
    attentionCodes: ["MARGIN_PRESSURE", "SALES_DROP"],
    current: (report) => report.flow.operatingProfitMinor,
    previous: (report) => report.previousFlow.operatingProfitMinor,
    related: (report) => [
      ["grossProfitMinor", report.flow.grossProfitMinor, true],
      ["expenseMinor", report.flow.expenseMinor, true],
      ["purchaseReturnVarianceMinor", report.flow.purchaseReturnVarianceMinor, true],
    ],
  },
  EXPENSES: {
    label: "Expenses",
    actionType: "OPEN_CASHBOOK",
    actionLabel: "Open Cashbook",
    attentionCodes: ["MARGIN_PRESSURE"],
    current: (report) => report.flow.expenseMinor,
    previous: (report) => report.previousFlow.expenseMinor,
    related: (report) => [
      ["operatingProfitMinor", report.flow.operatingProfitMinor, true],
      ["grossProfitMinor", report.flow.grossProfitMinor, true],
    ],
  },
  NET_CASH_MOVEMENT: {
    label: "Net cash movement",
    actionType: "OPEN_CASHBOOK",
    actionLabel: "Open Cashbook",
    attentionCodes: ["CASH_PRESSURE_FORECAST"],
    current: (report) => report.flow.netCashMovementMinor,
    previous: (report) => report.previousFlow.netCashMovementMinor,
    related: (report) => [
      ["cashInflowMinor", report.flow.cashInflowMinor, true],
      ["cashOutflowMinor", report.flow.cashOutflowMinor, true],
      ["operatingCashNetMinor", report.flow.operatingCashNetMinor, true],
    ],
  },
  CASH_BALANCE: {
    label: "Cash balance",
    actionType: "OPEN_CASHBOOK",
    actionLabel: "Open Cashbook",
    attentionCodes: ["CASH_PRESSURE_FORECAST"],
    current: (report) => report.position.cashBalanceMinor,
    previous: (report) => report.previousPosition.cashBalanceMinor,
    related: (report) => [["netCashMovementMinor", report.flow.netCashMovementMinor, true]],
  },
  RECEIVABLES: {
    label: "Receivables",
    actionType: "OPEN_CUSTOMERS",
    actionLabel: "Open Customers",
    attentionCodes: ["RECEIVABLES_OVERDUE"],
    current: (report) => report.position.receivablesMinor,
    previous: (report) => report.previousPosition.receivablesMinor,
    related: (report) => [["customerCreditBalanceMinor", report.position.customerCreditBalanceMinor, true]],
  },
  PAYABLES: {
    label: "Payables",
    actionType: "OPEN_PURCHASES",
    actionLabel: "Open Purchases",
    attentionCodes: ["PAYABLES_OVERDUE", "SUPPLIER_BILL_DUE"],
    current: (report) => report.position.payablesMinor,
    previous: (report) => report.previousPosition.payablesMinor,
    related: (report) => [["supplierCreditBalanceMinor", report.position.supplierCreditBalanceMinor, true]],
  },
  INVENTORY_VALUE: {
    label: "Inventory value",
    actionType: "OPEN_INVENTORY",
    actionLabel: "Open Inventory",
    attentionCodes: ["STOCKOUT_RISK", "SLOW_STOCK", "WASTAGE_SPIKE", "WASTAGE_LOSS"],
    current: (report) => report.position.inventoryValueMinor,
    previous: () => null,
    related: (report) => [
      ["inventoryAvailableValueMinor", report.position.inventoryAvailableValueMinor, true],
      ["inventoryQuarantineValueMinor", report.position.inventoryQuarantineValueMinor, true],
      ["inventoryOtherValueMinor", report.position.inventoryOtherValueMinor, true],
      ["inventorySnapshotAt", report.position.inventorySnapshotAt],
    ],
  },
};

export async function getBusinessFinancialMetricIntelligence(
  pool: DatabasePool,
  input: MetricInput,
): Promise<BusinessFinancialMetricIntelligence> {
  let report: FinancialSummaryReport;
  try {
    report = await getFinancialSummaryReport(pool, {
      businessId: input.businessId,
      branchId: input.branchId,
      range: input.range,
    });
  } catch (error) {
    if (isReportError(error)) {
      throw new BusinessMetricIntelligenceError(error.message, error.statusCode, error.code);
    }
    throw error;
  }

  const definition = METRICS[input.metricKey];
  if (!definition) {
    throw new BusinessMetricIntelligenceError("Unsupported financial metric.", 400, "BUSINESS_METRIC_UNSUPPORTED");
  }

  const currentMinor = definition.current(report);
  const previousMinor = definition.previous(report);
  const deltaMinor = previousMinor === null ? null : currentMinor - previousMinor;
  const changePercent = previousMinor === null || previousMinor === 0
    ? null
    : ((currentMinor - previousMinor) / Math.abs(previousMinor)) * 100;
  const generatedAt = new Date().toISOString();
  const evidence = metricEvidence(report, input.metricKey, definition, currentMinor, previousMinor, deltaMinor, changePercent, generatedAt);
  const attentionItems = (await listBusinessAttention(pool, {
    businessId: input.businessId,
    branchId: input.branchId,
    includeFinancial: true,
  })).filter((item) => definition.attentionCodes.includes(item.ruleCode));

  return {
    businessId: input.businessId,
    branchId: input.branchId,
    metric: { metricKey: input.metricKey, label: definition.label },
    range: input.range,
    period: report.period,
    currencyCode: report.currencyCode,
    generatedAt,
    currentMinor,
    previousMinor,
    deltaMinor,
    changePercent,
    summary: summary(definition.label, previousMinor, deltaMinor),
    evidence,
    attentionItems: attentionItems.slice(0, 6),
    recommendations: [recommendation(input, definition, evidence, attentionItems)],
    askPrompt: `Explain my ${definition.label.toLowerCase()} for this ${rangeLabel(input.range)} period, what changed, and what should I review next?`,
  };
}

function metricEvidence(
  report: FinancialSummaryReport,
  metricKey: BusinessFinancialMetricKey,
  definition: MetricDefinition,
  currentMinor: number,
  previousMinor: number | null,
  deltaMinor: number | null,
  changePercent: number | null,
  observedAt: string,
): BusinessEvidenceReference[] {
  const base: BusinessEvidenceReference[] = [
    moneyRef(metricKey, "currentMinor", currentMinor, report.currencyCode, observedAt),
    { source: "financial_summary", entityType: "FINANCIAL_METRIC", entityId: metricKey, label: "range", value: report.period.from, observedAt },
    { source: "financial_summary", entityType: "FINANCIAL_METRIC", entityId: metricKey, label: "periodTo", value: report.period.to, observedAt },
  ];
  if (previousMinor !== null) base.push(moneyRef(metricKey, "previousMinor", previousMinor, report.currencyCode, observedAt));
  if (deltaMinor !== null) base.push(moneyRef(metricKey, "deltaMinor", deltaMinor, report.currencyCode, observedAt));
  if (changePercent !== null) base.push({ source: "financial_summary", entityType: "FINANCIAL_METRIC", entityId: metricKey, label: "changePercent", value: changePercent, observedAt });
  for (const [label, value, money] of definition.related(report)) {
    base.push(money
      ? moneyRef(metricKey, label, Number(value ?? 0), report.currencyCode, observedAt)
      : { source: "financial_summary", entityType: "FINANCIAL_METRIC", entityId: metricKey, label, value, observedAt });
  }
  return base.slice(0, 12);
}

function moneyRef(
  metricKey: BusinessFinancialMetricKey,
  label: string,
  value: number,
  currencyCode: string,
  observedAt: string,
): BusinessEvidenceReference {
  return {
    source: "financial_summary",
    entityType: "FINANCIAL_METRIC",
    entityId: metricKey,
    label,
    value,
    observedAt,
    metadata: { kind: "money_minor", currencyCode },
  };
}

function summary(label: string, previousMinor: number | null, deltaMinor: number | null): string {
  if (previousMinor === null || deltaMinor === null) return `${label} is a current recorded snapshot; no historical inventory snapshot is available for a comparable prior value.`;
  if (deltaMinor > 0) return `${label} is higher than the prior comparable period.`;
  if (deltaMinor < 0) return `${label} is lower than the prior comparable period.`;
  return `${label} is unchanged from the prior comparable period.`;
}

function recommendation(
  input: MetricInput,
  definition: MetricDefinition,
  evidence: BusinessEvidenceReference[],
  attentionItems: BusinessAttentionItem[],
): BusinessRecommendation {
  const priority = attentionItems.some((item) => item.severity === "CRITICAL") ? "CRITICAL"
    : attentionItems.some((item) => item.severity === "HIGH") ? "HIGH"
      : attentionItems.some((item) => item.severity === "MEDIUM") ? "MEDIUM"
        : "INFO";
  return {
    businessId: input.businessId,
    branchId: input.branchId,
    code: `METRIC_${input.metricKey}_REVIEW`,
    title: `Review ${definition.label.toLowerCase()}`,
    summary: `Open the canonical TradeOS workflow to review the records behind ${definition.label.toLowerCase()}.`,
    rationale: attentionItems.length > 0 ? "This metric has related open attention signals." : "Use the canonical workflow for any follow-up or change.",
    priority,
    evidence: evidence.slice(0, 6),
    suggestedActionType: definition.actionType,
    suggestedActionLabel: definition.actionLabel,
  };
}

function rangeLabel(range: BusinessFinancialMetricRange): string {
  switch (range) {
    case "today": return "day-to-date";
    case "week": return "week";
    case "month": return "month";
    case "quarter": return "quarter";
  }
}

function isReportError(error: unknown): error is { message: string; statusCode: number; code: string } {
  return error instanceof Error
    && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
    && "code" in error && typeof (error as { code?: unknown }).code === "string";
}
