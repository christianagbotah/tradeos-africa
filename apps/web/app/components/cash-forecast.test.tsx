import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CashForecastResponse } from "@tradeos/contracts";
import { CashForecastPanel } from "./cash-forecast";

const forecast: CashForecastResponse = {
  generatedAt: "2026-10-06T12:30:00.000Z",
  businessId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  timezone: "Africa/Accra",
  currencyCode: "GHS",
  horizonDays: 30,
  summary: {
    openingCashMinor: 100000,
    projectedClosingCashMinor: -20000,
    lowestProjectedCashMinor: -35000,
    lowestProjectedCashDate: "2026-10-09",
    firstNegativeCashDate: "2026-10-08",
    totalContractualInflowsMinor: 50000,
    totalContractualOutflowsMinor: 90000,
    totalBaselineInflowsMinor: 30000,
    totalBaselineOutflowsMinor: 110000,
    overdueReceivablesMinor: 10000,
    overduePayablesMinor: 20000,
  },
  confidence: {
    level: "LOW",
    historyDaysAvailable: 10,
    sameWeekdayCoverageDays: 2,
    openCustomerObligationCount: 2,
    openSupplierObligationCount: 3,
    contractualInflowsMinor: 50000,
    contractualOutflowsMinor: 90000,
    assumptions: ["Normal operating cash could not yet be estimated reliably."],
  },
  days: [
    {
      date: "2026-10-06",
      openingCashMinor: 100000,
      contractualInflowsMinor: 10000,
      overdueContractualInflowsMinor: 10000,
      contractualOutflowsMinor: 20000,
      overdueContractualOutflowsMinor: 20000,
      baselineInflowsMinor: 3000,
      baselineOutflowsMinor: 5000,
      netMovementMinor: -12000,
      closingCashMinor: 88000,
      customerObligationCount: 1,
      supplierObligationCount: 1,
      baselineMethod: "NONE",
    },
    {
      date: "2026-10-08",
      openingCashMinor: 5000,
      contractualInflowsMinor: 0,
      overdueContractualInflowsMinor: 0,
      contractualOutflowsMinor: 15000,
      overdueContractualOutflowsMinor: 0,
      baselineInflowsMinor: 1000,
      baselineOutflowsMinor: 3000,
      netMovementMinor: -17000,
      closingCashMinor: -12000,
      customerObligationCount: 0,
      supplierObligationCount: 1,
      baselineMethod: "OVERALL_MEDIAN",
    },
  ],
};

describe("CashForecastPanel", () => {
  it("renders the owner summary, confidence and original generated timestamp", () => {
    const html = renderToStaticMarkup(<CashForecastPanel forecast={forecast} money={(minor) => `₵ ${(minor / 100).toFixed(2)}`} />);
    expect(html).toContain("30-Day Cash Forecast");
    expect(html).toContain("Cash today");
    expect(html).toContain("₵ 1000.00");
    expect(html).toContain("Projected day-30 cash");
    expect(html).toContain("₵ -200.00");
    expect(html).toContain("First projected shortfall");
    expect(html).toContain("2026-10-08");
    expect(html).toContain("LOW confidence");
    expect(html).toContain('dateTime="2026-10-06T12:30:00.000Z"');
  });

  it("annotates overdue day-one obligations and marks negative closing cash", () => {
    const html = renderToStaticMarkup(<CashForecastPanel forecast={forecast} money={(minor) => `₵ ${(minor / 100).toFixed(2)}`} />);
    expect(html).toContain("overdue ₵ 100.00");
    expect(html).toContain("overdue ₵ 200.00");
    expect(html).toContain('class="forecast-negative"');
    expect(html).toContain("Estimated inflow");
    expect(html).toContain("Estimated outflow");
  });

  it("explains contractual versus estimated values and shows offline cached state", () => {
    const html = renderToStaticMarkup(<CashForecastPanel forecast={forecast} money={(minor) => `₵ ${(minor / 100).toFixed(2)}`} offlineCached />);
    expect(html).toContain("Offline cached");
    expect(html).toContain("10 completed history days");
    expect(html).toContain("OVERALL MEDIAN");
    expect(html.toLowerCase()).toContain("dated obligations come from recorded credit terms");
    expect(html.toLowerCase()).toContain("estimated operating cash comes from recent settled cash behavior");
    expect(html).toContain("Normal operating cash could not yet be estimated reliably.");
  });
});
