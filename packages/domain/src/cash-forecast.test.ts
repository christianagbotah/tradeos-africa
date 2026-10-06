import { describe, expect, it } from "vitest";
import { buildCashForecast, CashForecastOverflowError, medianMinor } from "./cash-forecast.js";

const baseInput = () => ({
  generatedAt: "2026-10-06T12:00:00.000Z",
  businessId: "00000000-0000-4000-8000-000000000001",
  branchId: null as string | null,
  timezone: "Africa/Accra",
  currencyCode: "GHS",
  forecastStartDate: "2026-10-06",
  horizonDays: 3,
  openingCashMinor: 1_000,
  history: [] as Array<{ date: string; inflowMinor: number; outflowMinor: number }>,
  obligations: [] as Array<{
    date: string;
    customerInflowsMinor: number;
    overdueCustomerInflowsMinor: number;
    customerObligationCount: number;
    supplierOutflowsMinor: number;
    overdueSupplierOutflowsMinor: number;
    supplierObligationCount: number;
  }>,
  openCustomerObligationCount: 0,
  openSupplierObligationCount: 0,
});

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + days));
  return next.toISOString().slice(0, 10);
}

function historyEndingBefore(forecastStartDate: string, days: number, inflowMinor = 100, outflowMinor = 40) {
  return Array.from({ length: days }, (_, index) => ({
    date: addDays(forecastStartDate, index - days),
    inflowMinor,
    outflowMinor,
  }));
}

describe("cash forecast", () => {
  it("chains opening and closing cash through contractual movements", () => {
    const input = baseInput();
    input.obligations = [
      { date: "2026-10-06", customerInflowsMinor: 300, overdueCustomerInflowsMinor: 0, customerObligationCount: 1, supplierOutflowsMinor: 200, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 1 },
      { date: "2026-10-07", customerInflowsMinor: 0, overdueCustomerInflowsMinor: 0, customerObligationCount: 0, supplierOutflowsMinor: 500, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 1 },
    ];
    input.openCustomerObligationCount = 1;
    input.openSupplierObligationCount = 2;

    const forecast = buildCashForecast(input);

    expect(forecast.days.map((day) => [day.date, day.openingCashMinor, day.closingCashMinor])).toEqual([
      ["2026-10-06", 1_000, 1_100],
      ["2026-10-07", 1_100, 600],
      ["2026-10-08", 600, 600],
    ]);
    expect(forecast.summary).toMatchObject({
      openingCashMinor: 1_000,
      projectedClosingCashMinor: 600,
      totalContractualInflowsMinor: 300,
      totalContractualOutflowsMinor: 700,
    });
  });

  it("calculates odd and even medians in integer minor units", () => {
    expect(medianMinor([9, 1, 5])).toBe(5);
    expect(medianMinor([1, 4])).toBe(3);
  });

  it("uses the same-weekday median when four matching observations exist", () => {
    const input = baseInput();
    input.forecastStartDate = "2026-10-05";
    input.horizonDays = 1;
    input.history = historyEndingBefore(input.forecastStartDate, 28, 100, 40).map((row) => {
      const weekday = new Date(`${row.date}T00:00:00.000Z`).getUTCDay();
      if (weekday !== 1) return row;
      const mondayIndex = Math.floor((Date.parse(`${row.date}T00:00:00Z`) - Date.parse("2026-09-07T00:00:00Z")) / (7 * 86_400_000));
      return { ...row, inflowMinor: [100, 200, 300, 400][mondayIndex]!, outflowMinor: [10, 20, 30, 40][mondayIndex]! };
    });

    const forecast = buildCashForecast(input);

    expect(forecast.days[0]).toMatchObject({ baselineMethod: "WEEKDAY_MEDIAN", baselineInflowsMinor: 250, baselineOutflowsMinor: 25 });
    expect(forecast.confidence).toMatchObject({ level: "MEDIUM", historyDaysAvailable: 28, sameWeekdayCoverageDays: 4 });
  });

  it("falls back to the overall median when history is sufficient but weekday coverage is weak", () => {
    const input = baseInput();
    input.forecastStartDate = "2026-10-05";
    input.horizonDays = 1;
    input.history = historyEndingBefore(input.forecastStartDate, 14, 120, 60);

    const forecast = buildCashForecast(input);

    expect(forecast.days[0]).toMatchObject({ baselineMethod: "OVERALL_MEDIAN", baselineInflowsMinor: 120, baselineOutflowsMinor: 60 });
    expect(forecast.confidence).toMatchObject({ level: "MEDIUM", historyDaysAvailable: 14, sameWeekdayCoverageDays: 2 });
  });

  it("uses no behavioral baseline and LOW confidence with fewer than fourteen completed days", () => {
    const input = baseInput();
    input.history = historyEndingBefore(input.forecastStartDate, 13, 500, 300);

    const forecast = buildCashForecast(input);

    expect(forecast.days.every((day) => day.baselineMethod === "NONE" && day.baselineInflowsMinor === 0 && day.baselineOutflowsMinor === 0)).toBe(true);
    expect(forecast.confidence.level).toBe("LOW");
  });

  it("reports HIGH confidence only when 42+ days cover every horizon weekday four or more times", () => {
    const input = baseInput();
    input.forecastStartDate = "2026-10-05";
    input.horizonDays = 7;
    input.history = historyEndingBefore(input.forecastStartDate, 42, 100, 50);

    const forecast = buildCashForecast(input);

    expect(forecast.confidence).toMatchObject({ level: "HIGH", historyDaysAvailable: 42, sameWeekdayCoverageDays: 6 });
    expect(forecast.days.every((day) => day.baselineMethod === "WEEKDAY_MEDIAN")).toBe(true);
  });

  it("keeps overdue contractual amounts visible on day one and totals them once", () => {
    const input = baseInput();
    input.horizonDays = 1;
    input.obligations = [{
      date: "2026-10-06",
      customerInflowsMinor: 250,
      overdueCustomerInflowsMinor: 150,
      customerObligationCount: 2,
      supplierOutflowsMinor: 180,
      overdueSupplierOutflowsMinor: 80,
      supplierObligationCount: 2,
    }];
    input.openCustomerObligationCount = 2;
    input.openSupplierObligationCount = 2;

    const forecast = buildCashForecast(input);

    expect(forecast.days[0]).toMatchObject({ contractualInflowsMinor: 250, overdueContractualInflowsMinor: 150, contractualOutflowsMinor: 180, overdueContractualOutflowsMinor: 80 });
    expect(forecast.summary).toMatchObject({ totalContractualInflowsMinor: 250, totalContractualOutflowsMinor: 180, overdueReceivablesMinor: 150, overduePayablesMinor: 80 });
  });

  it("finds the first negative day and the lowest projected balance", () => {
    const input = baseInput();
    input.openingCashMinor = 100;
    input.obligations = [
      { date: "2026-10-06", customerInflowsMinor: 0, overdueCustomerInflowsMinor: 0, customerObligationCount: 0, supplierOutflowsMinor: 80, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 1 },
      { date: "2026-10-07", customerInflowsMinor: 0, overdueCustomerInflowsMinor: 0, customerObligationCount: 0, supplierOutflowsMinor: 50, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 1 },
      { date: "2026-10-08", customerInflowsMinor: 10, overdueCustomerInflowsMinor: 0, customerObligationCount: 1, supplierOutflowsMinor: 0, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 0 },
    ];

    const forecast = buildCashForecast(input);

    expect(forecast.summary).toMatchObject({ firstNegativeCashDate: "2026-10-07", lowestProjectedCashMinor: -30, lowestProjectedCashDate: "2026-10-07", projectedClosingCashMinor: -20 });
  });

  it("throws instead of overflowing safe integer money arithmetic", () => {
    const input = baseInput();
    input.horizonDays = 1;
    input.openingCashMinor = Number.MAX_SAFE_INTEGER;
    input.obligations = [{ date: "2026-10-06", customerInflowsMinor: 1, overdueCustomerInflowsMinor: 0, customerObligationCount: 1, supplierOutflowsMinor: 0, overdueSupplierOutflowsMinor: 0, supplierObligationCount: 0 }];

    expect(() => buildCashForecast(input)).toThrow(CashForecastOverflowError);
  });
});
