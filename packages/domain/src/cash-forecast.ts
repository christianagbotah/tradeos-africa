import type { CashForecastBaselineMethod, CashForecastResponse } from "@tradeos/contracts";

export interface CashForecastHistoryDay {
  date: string;
  inflowMinor: number;
  outflowMinor: number;
}

export interface CashForecastObligationDay {
  date: string;
  customerInflowsMinor: number;
  overdueCustomerInflowsMinor: number;
  customerObligationCount: number;
  supplierOutflowsMinor: number;
  overdueSupplierOutflowsMinor: number;
  supplierObligationCount: number;
}

export interface CashForecastInput {
  generatedAt: string;
  businessId: string;
  branchId: string | null;
  timezone: string;
  currencyCode: string;
  forecastStartDate: string;
  horizonDays: number;
  openingCashMinor: number;
  history: CashForecastHistoryDay[];
  obligations: CashForecastObligationDay[];
  openCustomerObligationCount: number;
  openSupplierObligationCount: number;
}

export class CashForecastOverflowError extends Error {
  constructor(message = "Cash forecast amount exceeds safe integer range") {
    super(message);
    this.name = "CashForecastOverflowError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new CashForecastOverflowError(`${label} exceeds safe integer range`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  safeInteger(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
  return value;
}

function addMinor(...values: number[]): number {
  let total = 0;
  for (const value of values) {
    safeInteger(value, "Cash forecast amount");
    total += value;
    safeInteger(total, "Cash forecast total");
  }
  return total;
}

function validateDate(date: string, label: string): string {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) throw new RangeError(`${label} must be YYYY-MM-DD`);
  return date;
}

function addLocalDays(date: string, days: number): string {
  validateDate(date, "date");
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return next.toISOString().slice(0, 10);
}

function weekday(date: string): number {
  validateDate(date, "date");
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function medianMinor(values: number[]): number {
  if (values.length === 0) throw new RangeError("median requires at least one value");
  const sorted = values.map((value) => safeInteger(value, "Median value")).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  const low = BigInt(sorted[middle - 1]!);
  const high = BigInt(sorted[middle]!);
  const sum = low + high;
  const quotient = sum / 2n;
  const remainder = sum % 2n;
  const rounded = remainder === 0n ? quotient : sum > 0n ? quotient + 1n : quotient;
  const value = Number(rounded);
  return safeInteger(value, "Median result");
}

function assumptions(historyDays: number): string[] {
  const rows = [
    "Opening cash is the recorded cashbook balance at the start of the first forecast day.",
    "Recorded customer and supplier obligations use their current open balances and due dates; overdue balances are placed on day 1.",
  ];
  if (historyDays < 14) {
    rows.push("Fewer than 14 completed operating-history days are available, so TradeOS does not project a behavioral operating baseline.");
  } else {
    rows.push("Estimated operating inflows and outflows use medians from recent settled operating cashbook behavior; owner funding, withdrawals, opening balances and manual adjustments are excluded from that baseline.");
  }
  rows.push("Estimated operating behavior is not a promise of future sales, collections, purchases, refunds or expenses; dated obligations come from recorded terms.");
  return rows;
}

export function buildCashForecast(input: CashForecastInput): CashForecastResponse {
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 30) throw new RangeError("horizonDays must be an integer from 1 to 30");
  validateDate(input.forecastStartDate, "forecastStartDate");
  safeInteger(input.openingCashMinor, "openingCashMinor");
  nonNegativeInteger(input.openCustomerObligationCount, "openCustomerObligationCount");
  nonNegativeInteger(input.openSupplierObligationCount, "openSupplierObligationCount");

  const history = input.history.map((row) => ({
    date: validateDate(row.date, "history date"),
    inflowMinor: nonNegativeInteger(row.inflowMinor, "history inflowMinor"),
    outflowMinor: nonNegativeInteger(row.outflowMinor, "history outflowMinor"),
  }));
  const byWeekday = new Map<number, CashForecastHistoryDay[]>();
  for (const row of history) {
    const key = weekday(row.date);
    const existing = byWeekday.get(key) ?? [];
    existing.push(row);
    byWeekday.set(key, existing);
  }

  const obligationByDate = new Map<string, CashForecastObligationDay>();
  for (const row of input.obligations) {
    const date = validateDate(row.date, "obligation date");
    const existing = obligationByDate.get(date) ?? {
      date,
      customerInflowsMinor: 0,
      overdueCustomerInflowsMinor: 0,
      customerObligationCount: 0,
      supplierOutflowsMinor: 0,
      overdueSupplierOutflowsMinor: 0,
      supplierObligationCount: 0,
    };
    existing.customerInflowsMinor = addMinor(existing.customerInflowsMinor, nonNegativeInteger(row.customerInflowsMinor, "customerInflowsMinor"));
    existing.overdueCustomerInflowsMinor = addMinor(existing.overdueCustomerInflowsMinor, nonNegativeInteger(row.overdueCustomerInflowsMinor, "overdueCustomerInflowsMinor"));
    existing.customerObligationCount = addMinor(existing.customerObligationCount, nonNegativeInteger(row.customerObligationCount, "customerObligationCount"));
    existing.supplierOutflowsMinor = addMinor(existing.supplierOutflowsMinor, nonNegativeInteger(row.supplierOutflowsMinor, "supplierOutflowsMinor"));
    existing.overdueSupplierOutflowsMinor = addMinor(existing.overdueSupplierOutflowsMinor, nonNegativeInteger(row.overdueSupplierOutflowsMinor, "overdueSupplierOutflowsMinor"));
    existing.supplierObligationCount = addMinor(existing.supplierObligationCount, nonNegativeInteger(row.supplierObligationCount, "supplierObligationCount"));
    obligationByDate.set(date, existing);
  }

  const horizonDates = Array.from({ length: input.horizonDays }, (_, index) => addLocalDays(input.forecastStartDate, index));
  const uniqueHorizonWeekdays = [...new Set(horizonDates.map(weekday))];
  const sameWeekdayCoverageDays = uniqueHorizonWeekdays.length
    ? Math.min(...uniqueHorizonWeekdays.map((key) => byWeekday.get(key)?.length ?? 0))
    : 0;
  const confidenceLevel = history.length >= 42 && sameWeekdayCoverageDays >= 4 ? "HIGH" : history.length >= 14 ? "MEDIUM" : "LOW";
  const overallInflowMedian = history.length >= 14 ? medianMinor(history.map((row) => row.inflowMinor)) : 0;
  const overallOutflowMedian = history.length >= 14 ? medianMinor(history.map((row) => row.outflowMinor)) : 0;

  let openingCashMinor = input.openingCashMinor;
  let totalContractualInflowsMinor = 0;
  let totalContractualOutflowsMinor = 0;
  let totalBaselineInflowsMinor = 0;
  let totalBaselineOutflowsMinor = 0;
  let overdueReceivablesMinor = 0;
  let overduePayablesMinor = 0;
  let firstNegativeCashDate: string | null = null;
  let lowestProjectedCashMinor: number | null = null;
  let lowestProjectedCashDate = input.forecastStartDate;

  const days = horizonDates.map((date) => {
    const obligation = obligationByDate.get(date);
    const contractualInflowsMinor = obligation?.customerInflowsMinor ?? 0;
    const overdueContractualInflowsMinor = obligation?.overdueCustomerInflowsMinor ?? 0;
    const contractualOutflowsMinor = obligation?.supplierOutflowsMinor ?? 0;
    const overdueContractualOutflowsMinor = obligation?.overdueSupplierOutflowsMinor ?? 0;
    const matchingHistory = byWeekday.get(weekday(date)) ?? [];
    let baselineMethod: CashForecastBaselineMethod = "NONE";
    let baselineInflowsMinor = 0;
    let baselineOutflowsMinor = 0;
    if (matchingHistory.length >= 4) {
      baselineMethod = "WEEKDAY_MEDIAN";
      baselineInflowsMinor = medianMinor(matchingHistory.map((row) => row.inflowMinor));
      baselineOutflowsMinor = medianMinor(matchingHistory.map((row) => row.outflowMinor));
    } else if (history.length >= 14) {
      baselineMethod = "OVERALL_MEDIAN";
      baselineInflowsMinor = overallInflowMedian;
      baselineOutflowsMinor = overallOutflowMedian;
    }

    const netMovementMinor = addMinor(contractualInflowsMinor, -contractualOutflowsMinor, baselineInflowsMinor, -baselineOutflowsMinor);
    const closingCashMinor = addMinor(openingCashMinor, netMovementMinor);
    totalContractualInflowsMinor = addMinor(totalContractualInflowsMinor, contractualInflowsMinor);
    totalContractualOutflowsMinor = addMinor(totalContractualOutflowsMinor, contractualOutflowsMinor);
    totalBaselineInflowsMinor = addMinor(totalBaselineInflowsMinor, baselineInflowsMinor);
    totalBaselineOutflowsMinor = addMinor(totalBaselineOutflowsMinor, baselineOutflowsMinor);
    overdueReceivablesMinor = addMinor(overdueReceivablesMinor, overdueContractualInflowsMinor);
    overduePayablesMinor = addMinor(overduePayablesMinor, overdueContractualOutflowsMinor);
    if (firstNegativeCashDate === null && closingCashMinor < 0) firstNegativeCashDate = date;
    if (lowestProjectedCashMinor === null || closingCashMinor < lowestProjectedCashMinor) {
      lowestProjectedCashMinor = closingCashMinor;
      lowestProjectedCashDate = date;
    }
    const day = {
      date,
      openingCashMinor,
      contractualInflowsMinor,
      overdueContractualInflowsMinor,
      contractualOutflowsMinor,
      overdueContractualOutflowsMinor,
      baselineInflowsMinor,
      baselineOutflowsMinor,
      netMovementMinor,
      closingCashMinor,
      customerObligationCount: obligation?.customerObligationCount ?? 0,
      supplierObligationCount: obligation?.supplierObligationCount ?? 0,
      baselineMethod,
    };
    openingCashMinor = closingCashMinor;
    return day;
  });

  const projectedClosingCashMinor = days.at(-1)!.closingCashMinor;
  return {
    generatedAt: input.generatedAt,
    businessId: input.businessId,
    branchId: input.branchId,
    timezone: input.timezone,
    currencyCode: input.currencyCode,
    horizonDays: input.horizonDays,
    summary: {
      openingCashMinor: input.openingCashMinor,
      projectedClosingCashMinor,
      lowestProjectedCashMinor: lowestProjectedCashMinor!,
      lowestProjectedCashDate,
      firstNegativeCashDate,
      totalContractualInflowsMinor,
      totalContractualOutflowsMinor,
      totalBaselineInflowsMinor,
      totalBaselineOutflowsMinor,
      overdueReceivablesMinor,
      overduePayablesMinor,
    },
    confidence: {
      level: confidenceLevel,
      historyDaysAvailable: history.length,
      sameWeekdayCoverageDays,
      openCustomerObligationCount: input.openCustomerObligationCount,
      openSupplierObligationCount: input.openSupplierObligationCount,
      contractualInflowsMinor: totalContractualInflowsMinor,
      contractualOutflowsMinor: totalContractualOutflowsMinor,
      assumptions: assumptions(history.length),
    },
    days,
  };
}
