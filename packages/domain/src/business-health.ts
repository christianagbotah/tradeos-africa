import type {
  BusinessHealthDimension,
  BusinessHealthSummary,
  BusinessInsight,
  BusinessInsightEvidence,
  BusinessInsightSeverity,
  CfoAction,
  CfoActionArea,
  CfoActionPriority,
  FinancialSummaryReport,
  WorkingCapitalSummary,
} from "@tradeos/contracts";

type ReportBasis = Omit<FinancialSummaryReport, "health">;

const clamp = (value: number, low = 0, high = 100) => Math.min(high, Math.max(low, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const percent = (numerator: number, denominator: number) => {
  const value = ratio(numerator, denominator);
  return value === null ? null : round(value * 100);
};

function profitScore(margin: number | null, revenue: number, profit: number) {
  if (margin === null) return profit < 0 ? 20 : 50;
  if (margin < 0) return clamp(35 + margin * 1.5);
  if (margin < 5) return 45 + margin * 3;
  if (margin < 15) return 60 + (margin - 5) * 2;
  if (margin < 25) return 80 + (margin - 15);
  return clamp(90 + (margin - 25) * 0.5);
}
function operatingCashScore(cashRatio: number | null, operatingCash: number) {
  if (cashRatio === null) return operatingCash >= 0 ? 70 : 30;
  if (cashRatio < -20) return 10;
  if (cashRatio < 0) return 10 + (cashRatio + 20) * 2;
  if (cashRatio < 10) return 50 + cashRatio * 2.5;
  return clamp(75 + (cashRatio - 10));
}
function coverageScore(cash: number, payables: number) {
  if (payables <= 0) return 95;
  if (cash <= 0) return 20;
  const coverage = cash / payables;
  if (coverage < 0.5) return 40;
  if (coverage < 1) return 60;
  if (coverage < 1.5) return 80;
  return 95;
}
function receivableScore(months: number | null, receivables: number) {
  if (receivables <= 0) return 100;
  if (months === null) return 25;
  if (months <= 0.5) return 90;
  if (months <= 1) return 75;
  if (months <= 2) return 50;
  return 25;
}
function inventoryCoverageScore(months: number | null) {
  if (months === null) return 30;
  if (months <= 1) return 90;
  if (months <= 2) return 75;
  if (months <= 3) return 60;
  return 35;
}
function quarantineScore(rate: number | null) {
  if (rate === null || rate === 0) return 100;
  if (rate <= 2) return 90;
  if (rate <= 5) return 75;
  if (rate <= 10) return 55;
  return 25;
}
function returnsScore(rate: number | null) {
  if (rate === null || rate <= 2) return 95;
  if (rate <= 5) return 85;
  if (rate <= 10) return 65;
  if (rate <= 20) return 40;
  return 20;
}
function trendScore(change: number | null) {
  if (change === null) return 60;
  if (change >= 10) return 90;
  if (change >= -5) return 75;
  if (change >= -15) return 60;
  if (change >= -30) return 40;
  return 20;
}
function dimension(input: Omit<BusinessHealthDimension, "score"> & { score: number | null }): BusinessHealthDimension {
  return { ...input, score: input.score === null ? null : Math.round(clamp(input.score)) };
}
function evidence(key: string, label: string, value: number, unit: BusinessInsightEvidence["unit"]): BusinessInsightEvidence {
  return { key, label, value: round(value), unit };
}
function insight(code: string, severity: BusinessInsightSeverity, title: string, message: string, action: string, evidenceRows: BusinessInsightEvidence[]): BusinessInsight {
  return { code, severity, title, message, action, evidence: evidenceRows };
}

const actionRouteByInsight: Record<string, { area: CfoActionArea; href: string; navigationLabel: string }> = {
  OPERATING_LOSS: { area: "PRICING", href: "/catalog", navigationLabel: "Review catalog & prices" },
  THIN_MARGIN: { area: "PRICING", href: "/catalog", navigationLabel: "Review catalog & prices" },
  NEGATIVE_OPERATING_CASH: { area: "CASH", href: "/cashbook", navigationLabel: "Open cashbook" },
  NON_OPERATING_CASH_SUPPORT: { area: "CASH", href: "/cashbook", navigationLabel: "Open cashbook" },
  LOW_CASH_CONVERSION: { area: "CUSTOMERS", href: "/customers", navigationLabel: "Review customer credit" },
  PAYABLE_COVERAGE: { area: "CASH", href: "/purchases", navigationLabel: "Review supplier balances" },
  RECEIVABLE_PRESSURE: { area: "CUSTOMERS", href: "/customers", navigationLabel: "Collect customer balances" },
  PRODUCT_STOCK_VALUE_MISSING: { area: "INVENTORY", href: "/inventory", navigationLabel: "Review inventory" },
  INVENTORY_TIEUP: { area: "INVENTORY", href: "/inventory", navigationLabel: "Review inventory" },
  QUARANTINE_PRESSURE: { area: "INVENTORY", href: "/inventory", navigationLabel: "Review quarantined stock" },
  RETURN_WASTE: { area: "SALES", href: "/returns", navigationLabel: "Review returns" },
  HIGH_RETURNS: { area: "SALES", href: "/returns", navigationLabel: "Review returns" },
  REVENUE_DECLINE: { area: "SALES", href: "/reports", navigationLabel: "Inspect performance" },
  EXPENSE_PRESSURE: { area: "EXPENSES", href: "/cashbook", navigationLabel: "Review expenses" },
  BRANCH_MARGIN_GAP: { area: "BRANCHES", href: "/reports", navigationLabel: "Compare branches" },
};

function actionPriority(severity: BusinessInsightSeverity): CfoActionPriority {
  if (severity === "CRITICAL") return "URGENT";
  if (severity === "WARNING") return "HIGH";
  if (severity === "OPPORTUNITY") return "MEDIUM";
  return "LOW";
}

const cfoActionImpactRank: Record<string, number> = {
  NEGATIVE_OPERATING_CASH: 0,
  OPERATING_LOSS: 1,
  PAYABLE_COVERAGE: 2,
  RECEIVABLE_PRESSURE: 3,
  NON_OPERATING_CASH_SUPPORT: 4,
  LOW_CASH_CONVERSION: 5,
  INVENTORY_TIEUP: 6,
  EXPENSE_PRESSURE: 7,
  REVENUE_DECLINE: 8,
  HIGH_RETURNS: 9,
  QUARANTINE_PRESSURE: 10,
  RETURN_WASTE: 11,
  THIN_MARGIN: 12,
  PRODUCT_STOCK_VALUE_MISSING: 13,
  BRANCH_MARGIN_GAP: 14,
};
const cfoSeverityRank: Record<BusinessInsightSeverity, number> = { CRITICAL: 0, WARNING: 1, OPPORTUNITY: 2, INFO: 3, POSITIVE: 4 };

function buildCfoActions(insights: BusinessInsight[], hasScore: boolean): CfoAction[] {
  const actionable = insights
    .filter((item) => item.severity !== "POSITIVE" && item.code !== "NO_MAJOR_FLAGS")
    .sort((a,b) => cfoSeverityRank[a.severity] - cfoSeverityRank[b.severity] || (cfoActionImpactRank[a.code] ?? 99) - (cfoActionImpactRank[b.code] ?? 99) || a.code.localeCompare(b.code))
    .slice(0, 5)
    .map((item) => {
    const route = actionRouteByInsight[item.code] ?? { area: "REPORTS" as const, href: "/reports", navigationLabel: "Review financial report" };
    return {
      code: `ACTION_${item.code}`,
      sourceInsightCode: item.code,
      priority: actionPriority(item.severity),
      area: route.area,
      title: item.title,
      reason: item.message,
      action: item.action,
      href: route.href,
      navigationLabel: route.navigationLabel,
      evidence: item.evidence,
    };
  });
  if (actionable.length || !hasScore) return actionable;
  return [{
    code: "ACTION_MAINTAIN_RECORDING",
    sourceInsightCode: "NO_MAJOR_FLAGS",
    priority: "LOW",
    area: "REPORTS",
    title: "Keep the financial signal complete",
    reason: "No first-generation CFO warning currently requires intervention.",
    action: "Keep sales, purchases, expenses, customer collections and supplier payments fully recorded so TradeOS can detect changes early.",
    href: "/reports",
    navigationLabel: "Review financial report",
    evidence: [],
  }];
}

export function evaluateBusinessHealth(report: ReportBasis): BusinessHealthSummary {
  const periodMs = Date.parse(report.period.to) - Date.parse(report.period.from);
  const periodDays = Math.max(1, Math.round((periodMs / 86_400_000) * 100) / 100);
  const monthlyRevenue = report.flow.netRevenueMinor > 0 ? report.flow.netRevenueMinor / periodDays * 30.4375 : 0;
  // Inventory valuation is recorded at cost, so compare it to COGS (also cost basis), not selling-price revenue.
  const monthlyCogs = report.flow.netCogsMinor > 0 ? report.flow.netCogsMinor / periodDays * 30.4375 : 0;
  const operatingMargin = percent(report.flow.operatingProfitMinor, report.flow.netRevenueMinor);
  const operatingCashRatio = percent(report.flow.operatingCashNetMinor, report.flow.netRevenueMinor);
  const payableCoverage = report.position.payablesMinor > 0 ? round(report.position.cashBalanceMinor / report.position.payablesMinor) : null;
  const receivableMonths = monthlyRevenue > 0 ? round(report.position.receivablesMinor / monthlyRevenue) : null;
  const hasProductActivity = report.topItems.some((item) => item.itemKind === "PRODUCT");
  const inventorySnapshotDistanceMs = Math.abs(Date.parse(report.position.inventorySnapshotAt) - Date.parse(report.period.to));
  // Inventory valuations are current snapshots, not historical balances. Only score inventory when
  // that snapshot is close enough to the selected period end to describe the same operating point.
  const inventorySnapshotAligned = Number.isFinite(inventorySnapshotDistanceMs) && inventorySnapshotDistanceMs <= 48 * 60 * 60 * 1000;
  const inventoryMonths = report.position.inventoryValueMinor > 0 && monthlyCogs > 0 ? round(report.position.inventoryValueMinor / monthlyCogs) : report.position.inventoryValueMinor > 0 ? null : 0;
  const quarantineRate = percent(report.position.inventoryQuarantineValueMinor, report.position.inventoryValueMinor);
  const returnRate = percent(report.flow.returnsRevenueMinor, report.flow.grossRevenueMinor);
  const discardedRate = percent(report.flow.discardedReturnCostMinor, report.flow.netRevenueMinor);
  const expenseRate = percent(report.flow.expenseMinor, report.flow.netRevenueMinor);

  const profitabilityApplicable = report.flow.netRevenueMinor !== 0 || report.flow.expenseMinor !== 0 || report.flow.operatingProfitMinor !== 0;
  const inventoryApplicable = inventorySnapshotAligned && (report.position.inventoryValueMinor > 0 || hasProductActivity);
  const salesQualityApplicable = report.flow.grossRevenueMinor > 0;

  const dimensions: BusinessHealthDimension[] = [
    dimension({ key: "PROFITABILITY", label: "Profitability", weight: 30, applicable: profitabilityApplicable, score: profitabilityApplicable ? profitScore(operatingMargin, report.flow.netRevenueMinor, report.flow.operatingProfitMinor) : null, summary: operatingMargin === null ? "Not enough revenue to calculate an operating margin." : `Operating margin is ${operatingMargin}%.`, metrics: [{ key: "operatingMargin", label: "Operating margin", value: operatingMargin, unit: "PERCENT" }, { key: "operatingProfit", label: "Operating profit", value: report.flow.operatingProfitMinor, unit: "MINOR" }] }),
    dimension({ key: "CASH_FLOW", label: "Operating cash", weight: 25, applicable: report.flow.netRevenueMinor > 0 || report.flow.netCashMovementMinor !== 0 || report.flow.operatingCashNetMinor !== 0 || report.position.payablesMinor > 0, score: Math.round(operatingCashScore(operatingCashRatio, report.flow.operatingCashNetMinor) * 0.65 + coverageScore(report.position.cashBalanceMinor, report.position.payablesMinor) * 0.35), summary: `Operations generated ${report.flow.operatingCashNetMinor >= 0 ? "positive" : "negative"} cash in the selected period.`, metrics: [{ key: "operatingCashRatio", label: "Operating cash / revenue", value: operatingCashRatio, unit: "PERCENT" }, { key: "payableCoverage", label: "Cash / supplier payables", value: payableCoverage, unit: "RATIO" }] }),
    dimension({ key: "CREDIT", label: "Customer credit", weight: 15, applicable: report.flow.salesCount > 0 || report.position.receivablesMinor > 0, score: receivableScore(receivableMonths, report.position.receivablesMinor), summary: report.position.receivablesMinor > 0 ? "Some working capital is tied up in customer balances." : "No customer receivables are currently outstanding.", metrics: [{ key: "receivableMonths", label: "Receivables / monthly revenue", value: receivableMonths, unit: "MONTHS" }, { key: "receivables", label: "Customer receivables", value: report.position.receivablesMinor, unit: "MINOR" }] }),
    dimension({ key: "INVENTORY", label: "Inventory health", weight: 15, applicable: inventoryApplicable, score: inventoryApplicable ? (report.position.inventoryValueMinor === 0 && hasProductActivity ? 60 : inventoryCoverageScore(inventoryMonths) * 0.6 + quarantineScore(quarantineRate) * 0.4) : null, summary: !inventorySnapshotAligned ? "Inventory is a current snapshot and is not scored against this historical period." : !inventoryApplicable ? "No product inventory activity is recorded for this scope." : report.position.inventoryValueMinor === 0 && hasProductActivity ? "Products were sold, but no current inventory value is recorded; confirm stock availability and valuation." : "Stock health combines capital tied up at cost and quarantine exposure.", metrics: [{ key: "inventoryMonths", label: "Inventory / monthly COGS", value: inventoryMonths, unit: "MONTHS" }, { key: "quarantineRate", label: "Quarantined inventory", value: quarantineRate, unit: "PERCENT" }] }),
    dimension({ key: "SALES_QUALITY", label: "Sales & returns", weight: 15, applicable: salesQualityApplicable, score: salesQualityApplicable ? returnsScore(returnRate) * 0.55 + trendScore(report.comparison.netRevenueChangePercent) * 0.45 : null, summary: salesQualityApplicable ? "This dimension combines return pressure and revenue trend." : "No sales revenue was recorded in the selected period.", metrics: [{ key: "returnRate", label: "Revenue returned", value: returnRate, unit: "PERCENT" }, { key: "revenueChange", label: "Revenue change", value: report.comparison.netRevenueChangePercent, unit: "PERCENT" }] }),
  ];

  const active = dimensions.filter((item) => item.applicable && item.score !== null);
  const meaningfulActivity = report.flow.salesCount > 0 || report.flow.expenseMinor > 0 || report.flow.netCashMovementMinor !== 0 || report.position.receivablesMinor > 0 || report.position.payablesMinor > 0 || report.position.inventoryValueMinor > 0;
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0);
  const score = meaningfulActivity && totalWeight > 0 ? Math.round(active.reduce((sum, item) => sum + item.score! * item.weight, 0) / totalWeight) : null;
  const confidence: BusinessHealthSummary["confidence"] = !meaningfulActivity ? "LOW" : report.flow.salesCount >= 10 && periodDays >= 14 ? "HIGH" : report.flow.salesCount >= 3 || periodDays >= 14 ? "MEDIUM" : "LOW";
  const status: BusinessHealthSummary["status"] = score === null ? "INSUFFICIENT_DATA" : score >= 85 ? "EXCELLENT" : score >= 70 ? "GOOD" : score >= 50 ? "WATCH" : "AT_RISK";

  const insights: BusinessInsight[] = [];
  const add = (...args: Parameters<typeof insight>) => insights.push(insight(...args));
  if (report.flow.operatingProfitMinor < 0) add("OPERATING_LOSS", "CRITICAL", "The business lost money in this period", "Operating profit is negative after COGS, expenses and purchase-return price variance.", "Review selling prices, high-cost items and discretionary expenses before increasing stock commitments.", [evidence("operatingProfit", "Operating profit", report.flow.operatingProfitMinor, "MINOR"), ...(operatingMargin === null ? [] : [evidence("operatingMargin", "Operating margin", operatingMargin, "PERCENT")])]);
  else if (operatingMargin !== null && operatingMargin < 5) add("THIN_MARGIN", "WARNING", "Profit margin is thin", "The business is profitable, but a small cost or price change could erase the current operating margin.", "Review the lowest-margin products/services and verify that prices still cover current purchase and consumable costs.", [evidence("operatingMargin", "Operating margin", operatingMargin, "PERCENT")]);
  else if (operatingMargin !== null && operatingMargin >= 15) add("HEALTHY_MARGIN", "POSITIVE", "Operating margin is healthy", "The selected period is producing a solid operating margin after recorded expenses.", "Protect the margin by watching purchase-cost changes and discounting.", [evidence("operatingMargin", "Operating margin", operatingMargin, "PERCENT")]);

  if (report.flow.operatingCashNetMinor < 0) add("NEGATIVE_OPERATING_CASH", operatingCashRatio !== null && operatingCashRatio < -20 ? "CRITICAL" : "WARNING", "Day-to-day operations consumed cash", "Operating cash flow is negative even before owner injections, withdrawals or account transfers are considered.", "Check slow customer collections, supplier payment timing, purchasing levels and expenses.", [evidence("operatingCash", "Operating cash", report.flow.operatingCashNetMinor, "MINOR"), ...(operatingCashRatio === null ? [] : [evidence("operatingCashRatio", "Operating cash / revenue", operatingCashRatio, "PERCENT")])]);
  if (report.flow.netCashMovementMinor > 0 && report.flow.operatingCashNetMinor < 0) add("NON_OPERATING_CASH_SUPPORT", "WARNING", "Cash increased, but operations still used cash", "The cash balance improved because non-operating movements such as owner funding or transfers outweighed negative operating cash.", "Do not treat the higher cash balance as operating profit; fix the underlying cash conversion gap.", [evidence("netCash", "Net cash movement", report.flow.netCashMovementMinor, "MINOR"), evidence("operatingCash", "Operating cash", report.flow.operatingCashNetMinor, "MINOR")]);
  if (report.flow.netRevenueMinor > 0 && report.flow.operatingCashNetMinor >= 0 && operatingCashRatio !== null && operatingCashRatio < 5) add("LOW_CASH_CONVERSION", "OPPORTUNITY", "Sales are not converting strongly into operating cash", "Revenue is being recorded, but little of it is becoming operating cash in the selected period.", "Check customer-credit collections, purchasing timing and whether stock is growing faster than sales.", [evidence("operatingCashRatio", "Operating cash / revenue", operatingCashRatio, "PERCENT"), evidence("receivables", "Customer receivables", report.position.receivablesMinor, "MINOR")]);
  if (report.position.payablesMinor > 0 && (payableCoverage === null || payableCoverage < 1)) add("PAYABLE_COVERAGE", payableCoverage !== null && payableCoverage < 0.5 ? "CRITICAL" : "WARNING", "Current cash does not cover supplier payables", "Recorded cash is below current positive supplier balances due.", "Prioritize collections and payment scheduling before making non-essential cash purchases.", [evidence("cashBalance", "Cash balance", report.position.cashBalanceMinor, "MINOR"), evidence("payables", "Supplier payables", report.position.payablesMinor, "MINOR"), ...(payableCoverage === null ? [] : [evidence("coverage", "Cash / payables", payableCoverage, "RATIO")])]);

  if (receivableMonths !== null && receivableMonths > 1) add("RECEIVABLE_PRESSURE", receivableMonths > 2 ? "CRITICAL" : "WARNING", "Too much working capital is tied up in customer debt", `Current receivables equal about ${receivableMonths} months of revenue at the selected-period run rate.`, "Follow up overdue customers, tighten limits for repeat late payers and use payment reminders/links.", [evidence("receivableMonths", "Receivables / monthly revenue", receivableMonths, "MONTHS"), evidence("receivables", "Customer receivables", report.position.receivablesMinor, "MINOR")]);

  if (inventorySnapshotAligned && hasProductActivity && report.position.inventoryValueMinor === 0) add("PRODUCT_STOCK_VALUE_MISSING", "OPPORTUNITY", "Product sales have no current inventory value", "Products were sold in this period, but the current inventory valuation is zero.", "Confirm whether stock is genuinely exhausted; if stock remains, receive or correct it so reorder and profit decisions use a complete valuation.", [evidence("inventoryValue", "Inventory value", report.position.inventoryValueMinor, "MINOR"), evidence("productSales", "Product rows in top items", report.topItems.filter((item) => item.itemKind === "PRODUCT").length, "COUNT")]);
  if (inventoryApplicable && inventoryMonths !== null && inventoryMonths > 2) add("INVENTORY_TIEUP", inventoryMonths > 3 ? "WARNING" : "OPPORTUNITY", "Inventory is tying up substantial capital", `Current inventory value is about ${inventoryMonths} months of COGS at the selected-period run rate.`, "Identify slow-moving items and reduce the next purchase quantity before adding more stock.", [evidence("inventoryMonths", "Inventory / monthly COGS", inventoryMonths, "MONTHS"), evidence("inventoryValue", "Inventory value", report.position.inventoryValueMinor, "MINOR")]);
  if (quarantineRate !== null && quarantineRate > 5) add("QUARANTINE_PRESSURE", quarantineRate > 10 ? "CRITICAL" : "WARNING", "Too much stock is quarantined", "A meaningful share of inventory value is unavailable for normal sale because it is quarantined.", "Resolve inspections, supplier returns, repairs or write-offs so unavailable stock does not remain hidden in working capital.", [evidence("quarantineRate", "Quarantined inventory", quarantineRate, "PERCENT"), evidence("quarantineValue", "Quarantine value", report.position.inventoryQuarantineValueMinor, "MINOR")]);
  if (discardedRate !== null && discardedRate > 2) add("RETURN_WASTE", "WARNING", "Returned goods are creating unrecoverable cost", "Discarded return cost is material relative to current revenue.", "Review product quality, handling, portioning and return reasons to reduce avoidable loss.", [evidence("discardedRate", "Discarded return cost / revenue", discardedRate, "PERCENT"), evidence("discardedCost", "Discarded return cost", report.flow.discardedReturnCostMinor, "MINOR")]);

  if (returnRate !== null && returnRate > 10) add("HIGH_RETURNS", returnRate > 20 ? "CRITICAL" : "WARNING", "Return/refund pressure is high", "A large share of gross revenue is being reversed through accepted returns/refunds.", "Review the top return reasons and the products, services, staff or suppliers associated with them.", [evidence("returnRate", "Revenue returned", returnRate, "PERCENT"), evidence("returnsRevenue", "Revenue reversed", report.flow.returnsRevenueMinor, "MINOR")]);
  const revenueChange = report.comparison.netRevenueChangePercent;
  if (revenueChange !== null && revenueChange < -20) add("REVENUE_DECLINE", revenueChange < -35 ? "CRITICAL" : "WARNING", "Revenue has fallen sharply", "Net revenue is materially below the previous comparable period.", "Check customer traffic, pricing, stock availability and branch/item performance before assuming the decline is seasonal.", [evidence("revenueChange", "Revenue change", revenueChange, "PERCENT"), evidence("netRevenue", "Net revenue", report.flow.netRevenueMinor, "MINOR")]);
  else if (revenueChange !== null && revenueChange > 15) add("REVENUE_GROWTH", "POSITIVE", "Revenue is growing", "Net revenue is meaningfully above the previous comparable period.", "Confirm that margins and operating cash are keeping pace with the higher sales volume.", [evidence("revenueChange", "Revenue change", revenueChange, "PERCENT")]);
  if (expenseRate !== null && expenseRate > 35 && report.flow.netRevenueMinor > 0) add("EXPENSE_PRESSURE", "WARNING", "Expenses are absorbing a large share of revenue", "Recorded operating expenses are high relative to net revenue in this period.", "Review the largest expense categories and separate recurring essentials from discretionary spend.", [evidence("expenseRate", "Expenses / revenue", expenseRate, "PERCENT"), evidence("expenses", "Expenses", report.flow.expenseMinor, "MINOR")]);

  if (report.branches.length >= 2) {
    const withRevenue = report.branches.filter((branch) => branch.netRevenueMinor > 0).map((branch) => ({ ...branch, margin: branch.operatingProfitMinor / branch.netRevenueMinor * 100 }));
    if (withRevenue.length >= 2) {
      const best = [...withRevenue].sort((a,b) => b.margin-a.margin)[0]!;
      const worst = [...withRevenue].sort((a,b) => a.margin-b.margin)[0]!;
      if (best.branchId !== worst.branchId && best.margin - worst.margin >= 15) add("BRANCH_MARGIN_GAP", "OPPORTUNITY", `${worst.branchName} is trailing the strongest branch on margin`, `Its operating margin is ${round(worst.margin)}% versus ${round(best.margin)}% at ${best.branchName}.`, "Compare product mix, discounting, staffing, wastage and local expenses before copying the stronger branch's practices.", [evidence("weakMargin", `${worst.branchName} margin`, worst.margin, "PERCENT"), evidence("bestMargin", `${best.branchName} margin`, best.margin, "PERCENT")]);
    }
  }

  const severityOrder: Record<BusinessInsightSeverity, number> = { CRITICAL: 0, WARNING: 1, OPPORTUNITY: 2, POSITIVE: 3, INFO: 4 };
  insights.sort((a,b) => severityOrder[a.severity] - severityOrder[b.severity] || a.code.localeCompare(b.code));
  const limited = insights.slice(0, 8);
  if (score !== null && limited.length === 0) limited.push(insight("NO_MAJOR_FLAGS", "INFO", "No major financial warning is visible", "The selected period does not currently trigger the first-generation TradeOS health rules.", "Keep recording sales, purchases, expenses and collections so the signal remains reliable.", []));

  const headline = status === "EXCELLENT" ? "The business is financially strong in this period."
    : status === "GOOD" ? "The business is in good shape, with a few areas to watch."
    : status === "WATCH" ? "The business needs attention in one or more operating areas."
    : status === "AT_RISK" ? "The business has material financial pressure that needs action."
    : "TradeOS needs more operating activity before the health score is reliable.";

  const cashAfterPayablesMinor = report.position.cashBalanceMinor - report.position.payablesMinor;
  const netTradeCreditMinor = report.position.receivablesMinor - report.position.payablesMinor;
  const operatingWorkingCapitalMinor = inventorySnapshotAligned
    ? report.position.receivablesMinor + report.position.inventoryValueMinor - report.position.payablesMinor
    : null;
  const workingCapitalPressure = meaningfulActivity && (
    (report.position.payablesMinor > 0 && cashAfterPayablesMinor < 0 && report.flow.operatingCashNetMinor < 0)
    || (receivableMonths !== null && receivableMonths > 2)
    || (inventorySnapshotAligned && inventoryMonths !== null && inventoryMonths > 3)
    || (operatingCashRatio !== null && operatingCashRatio < -10)
  );
  const workingCapitalWatch = meaningfulActivity && !workingCapitalPressure && (
    cashAfterPayablesMinor < 0
    || (receivableMonths !== null && receivableMonths > 1)
    || (inventorySnapshotAligned && inventoryMonths !== null && inventoryMonths > 2)
    || (operatingCashRatio !== null && operatingCashRatio < 5)
  );
  const workingCapitalStatus: WorkingCapitalSummary["status"] = !meaningfulActivity ? "INSUFFICIENT_DATA" : workingCapitalPressure ? "PRESSURED" : workingCapitalWatch ? "WATCH" : "HEALTHY";
  const workingCapital: WorkingCapitalSummary = {
    status: workingCapitalStatus,
    headline: workingCapitalStatus === "PRESSURED" ? "Working capital is under material pressure; collections, supplier obligations or stock need attention."
      : workingCapitalStatus === "WATCH" ? "Working capital is usable but one or more cash-conversion signals should be watched."
      : workingCapitalStatus === "HEALTHY" ? "Current cash conversion and trade-credit signals do not show material working-capital pressure."
      : "TradeOS needs more operating activity before working-capital signals are meaningful.",
    inventorySnapshotAligned,
    cashAfterPayablesMinor,
    netTradeCreditMinor,
    operatingWorkingCapitalMinor,
    payableCoverageRatio: payableCoverage,
    receivableMonths,
    inventoryMonths: inventorySnapshotAligned ? inventoryMonths : null,
    operatingCashConversionPercent: operatingCashRatio,
  };
  // Rank owner tasks from the full rule set; the explanatory insight feed is capped separately for readability.
  const actions = buildCfoActions(insights, score !== null);

  return { algorithmVersion: "health-v1", score, status, confidence, headline, periodDays, dimensions, insights: limited, workingCapital, actions };
}
