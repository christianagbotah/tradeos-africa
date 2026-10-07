import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CashForecastResponse, CfoAction } from "@tradeos/contracts";
import { buildCfoActionCenterItems, CfoActionCenter } from "./cfo-action-center";

const healthActions: CfoAction[] = [
  {
    code: "ACTION_RECEIVABLE_PRESSURE",
    sourceInsightCode: "RECEIVABLE_PRESSURE",
    priority: "HIGH",
    area: "CUSTOMERS",
    title: "Customer balances are tying up cash",
    reason: "Receivables are high relative to recent sales.",
    action: "Collect customer balances.",
    href: "#customers",
    navigationLabel: "Collect customer balances",
    evidence: [{ key: "receivables", label: "Customer receivables", value: 50_000, unit: "MINOR" }],
  },
  {
    code: "ACTION_PAYABLE_COVERAGE",
    sourceInsightCode: "PAYABLE_COVERAGE",
    priority: "HIGH",
    area: "CASH",
    title: "Supplier balances pressure cash",
    reason: "Cash does not fully cover supplier balances.",
    action: "Review supplier balances.",
    href: "#purchases",
    navigationLabel: "Review supplier balances",
    evidence: [{ key: "payables", label: "Supplier payables", value: 40_000, unit: "MINOR" }],
  },
  {
    code: "ACTION_THIN_MARGIN",
    sourceInsightCode: "THIN_MARGIN",
    priority: "MEDIUM",
    area: "PRICING",
    title: "Margin needs attention",
    reason: "Operating margin is thin.",
    action: "Review prices and costs.",
    href: "#catalog",
    navigationLabel: "Review catalog & prices",
    evidence: [{ key: "margin", label: "Operating margin", value: 4.5, unit: "PERCENT" }],
  },
];

const aging = {
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  currencyCode: "GHS",
  generatedAt: "2026-10-07T09:00:00.000Z",
  receivables: {
    totalOpenMinor: 60_000,
    notDueMinor: 20_000,
    dueWithin7DaysMinor: 10_000,
    dueWithin30DaysMinor: 20_000,
    overdue1To30DaysMinor: 15_000,
    overdue31To60DaysMinor: 10_000,
    overdue61To90DaysMinor: 10_000,
    overdueOver90DaysMinor: 5_000,
    obligationCount: 5,
    oldestDueAt: "2026-07-01T00:00:00.000Z",
  },
  payables: {
    totalOpenMinor: 50_000,
    notDueMinor: 30_000,
    dueWithin7DaysMinor: 15_000,
    dueWithin30DaysMinor: 25_000,
    overdue1To30DaysMinor: 8_000,
    overdue31To60DaysMinor: 4_000,
    overdue61To90DaysMinor: 0,
    overdueOver90DaysMinor: 0,
    obligationCount: 4,
    oldestDueAt: "2026-09-01T00:00:00.000Z",
  },
};

const forecast: CashForecastResponse = {
  generatedAt: "2026-10-07T09:00:00.000Z",
  businessId: aging.businessId,
  branchId: aging.branchId,
  timezone: "Africa/Accra",
  currencyCode: "GHS",
  horizonDays: 30,
  summary: {
    openingCashMinor: 10_000,
    projectedClosingCashMinor: -5_000,
    lowestProjectedCashMinor: -20_000,
    lowestProjectedCashDate: "2026-10-10",
    firstNegativeCashDate: "2026-10-08",
    totalContractualInflowsMinor: 25_000,
    totalContractualOutflowsMinor: 60_000,
    totalBaselineInflowsMinor: 40_000,
    totalBaselineOutflowsMinor: 40_000,
    overdueReceivablesMinor: 40_000,
    overduePayablesMinor: 12_000,
  },
  confidence: {
    level: "MEDIUM",
    historyDaysAvailable: 28,
    sameWeekdayCoverageDays: 4,
    openCustomerObligationCount: 5,
    openSupplierObligationCount: 4,
    contractualInflowsMinor: 25_000,
    contractualOutflowsMinor: 60_000,
    assumptions: [],
  },
  days: [],
};

describe("CFO Action Center v2", () => {
  it("prioritizes precise forecast, overdue collection and supplier pressure actions over generic duplicates", () => {
    const items = buildCfoActionCenterItems({ healthActions, aging, forecast });
    expect(items.map((item) => item.code)).toEqual([
      "ACTION_FORECAST_SHORTFALL",
      "ACTION_SUPPLIER_PAYMENT_PRESSURE",
      "ACTION_OVERDUE_RECEIVABLES",
      "ACTION_THIN_MARGIN",
    ]);
    expect(items.map((item) => item.code)).not.toContain("ACTION_RECEIVABLE_PRESSURE");
    expect(items.map((item) => item.code)).not.toContain("ACTION_PAYABLE_COVERAGE");
    expect(items[0]?.evidence).toContainEqual(expect.objectContaining({ key: "projectedCashGap", value: 20_000, unit: "MINOR" }));
  });

  it("keeps existing health actions when due-date and forecast evidence do not require a more precise action", () => {
    const calmForecast = { ...forecast, summary: { ...forecast.summary, projectedClosingCashMinor: 25_000, lowestProjectedCashMinor: 10_000, firstNegativeCashDate: null } };
    const calmAging = {
      ...aging,
      receivables: { ...aging.receivables, overdue1To30DaysMinor: 0, overdue31To60DaysMinor: 0, overdue61To90DaysMinor: 0, overdueOver90DaysMinor: 0 },
      payables: { ...aging.payables, overdue1To30DaysMinor: 0, overdue31To60DaysMinor: 0, overdue61To90DaysMinor: 0, overdueOver90DaysMinor: 0, dueWithin7DaysMinor: 0 },
    };
    expect(buildCfoActionCenterItems({ healthActions, aging: calmAging, forecast: calmForecast })).toEqual(healthActions);
  });

  it("renders an owner briefing with quantified evidence", () => {
    const html = renderToStaticMarkup(
      <CfoActionCenter
        healthActions={healthActions}
        aging={aging}
        forecast={forecast}
        money={(minor) => `₵ ${(minor / 100).toFixed(2)}`}
      />,
    );
    expect(html).toContain("What needs my attention today?");
    expect(html).toContain("Cash shortfall projected for 2026-10-08");
    expect(html).toContain("Collect overdue customer balances");
    expect(html).toContain("Supplier payments need attention");
    expect(html).toContain("₵ 200.00");
  });
});
