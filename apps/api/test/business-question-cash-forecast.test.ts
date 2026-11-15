import { describe, expect, it } from "vitest";
import type { BusinessQuestionResponse } from "@tradeos/contracts";
import { buildCashForecast, type CashForecastInput } from "@tradeos/domain";
import { classifyBusinessQuestion } from "../src/business-intelligence/question-service.js";
import { cashForecastHorizon, summarizeCashForecast } from "../src/business-intelligence/question-cash-forecast.js";

// The domain's cash forecast model is the sole source of amounts, confidence
// and dates; the AI question formatter must not create a second forecast.
const base: BusinessQuestionResponse = {
  businessId:"00000000-0000-4000-8000-000000000001",
  branchId:"00000000-0000-4000-8000-000000000002",
  question:"Will I run out of cash in the next 7 days?",
  intent:"CASH_FORECAST",currencyCode:null,generatedAt:"2026-11-15T08:00:00.000Z",
  engine:"DETERMINISTIC_GROUNDED_V1",dataQuality:"NOT_APPLICABLE",
  sourcePage:null,answer:"",evidence:[],items:[],limitations:[],
};
const input = (other: Partial<CashForecastInput> = {}): CashForecastInput => ({
  generatedAt:"2026-11-15T08:00:00.000Z",
  businessId:base.businessId,
  branchId:base.branchId,
  currencyCode:"GHS",timezone:"Africa/Accra",
  forecastStartDate:"2026-11-15",horizonDays:7,
  openingCashMinor:12000,history:[],obligations:[],
  openCustomerObligationCount:0,openSupplierObligationCount:0,
  ...other,
});

describe("Ask TradeOS cash forecast", () => {
  it("recognizes future cash risk but does not steal current balance, stock or creditor questions", () => {
    expect(classifyBusinessQuestion("Will we run out of cash next week?")).toBe("CASH_FORECAST");
    expect(classifyBusinessQuestion("Forecast our cash for the next 14 days")).toBe("CASH_FORECAST");
    expect(classifyBusinessQuestion("How much cash will I have tomorrow?")).toBe("CASH_FORECAST");
    expect(classifyBusinessQuestion("What is our cash balance?")).toBe("CASH");
    expect(classifyBusinessQuestion("Who owes us money?")).toBe("CUSTOMERS_OVERDUE");
    expect(classifyBusinessQuestion("Which stock needs replenishment?")).toBe("REPLENISHMENT");
  });

  it("parses explicit horizons strictly rather than silently using 7 days", () => {
    for (const [q, expected] of [
      ["Forecast cash for the next 7 days",7],
      ["Will cash last in 14 days?",14],
      ["Show my 30-day cash projection",30],
      ["Cash forecast for the next 2 weeks",14],
      ["Cash forecast for the next two weeks",14],
      ["Cash next month",30],
      ["How much cash tomorrow?",2],
      ["Cash forecast today",1],
      ["Cash forecast",7],
      ["Cash forecast for the next 31 days",null],
      ["Cash projection over 90 days",null],
      ["Cash forecast in 2 months",null],
      ["Cash forecast for 0 days",null],
    ] as const) {
      expect(cashForecastHorizon(q)).toBe(expected);
    }
  });

  it("refuses a false prediction when no operating history or obligations exist", () => {
    const actual=buildCashForecast(input());
    const result=summarizeCashForecast(actual,base);
    expect(result).toMatchObject({
      intent:"CASH_FORECAST",dataQuality:"INSUFFICIENT",
      businessId:base.businessId,branchId:base.branchId,
      currencyCode:"GHS",sourcePage:"/reports",items:[],
    });
    expect(result.answer).toMatch(/not enough recorded operating history/i);
    expect(result.answer).not.toContain("₵120.00");
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"openingCashMinor",value:12000,source:"CASH_FORECAST"}),
      expect.objectContaining({key:"historyDaysAvailable",value:0}),
      expect.objectContaining({key:"horizonDays",value:7}),
    ]));
    expect(result.evidence.some(x=>x.key==="projectedClosingCashMinor")).toBe(false);
  });

  it("shows an obligation-only low-confidence scenario without calling it certain", () => {
    const actual=buildCashForecast(input({
      openingCashMinor:10000,
      horizonDays:3,
      obligations:[{date:"2026-11-16",customerInflowsMinor:1500,overdueCustomerInflowsMinor:0,
        customerObligationCount:1,supplierOutflowsMinor:18000,overdueSupplierOutflowsMinor:0,
        supplierObligationCount:1}],
      openCustomerObligationCount:1,openSupplierObligationCount:1,
    }));
    const result=summarizeCashForecast(actual,base);
    expect(result.dataQuality).toBe("LIMITED");
    expect(result.answer).toContain("low-confidence");
    expect(result.answer).toContain("−₵65.00");
    expect(result.answer).toContain("16-11-2026");
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({id:"risk",label:"Possible negative closing balance"}),
    ]));
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"projectedClosingCashMinor",value:-6500}),
      expect.objectContaining({key:"contractualInflowsMinor",value:1500}),
      expect.objectContaining({key:"contractualOutflowsMinor",value:18000}),
    ]));
    expect(result.limitations.join(" ")).toMatch(/not guaranteed balances/);
  });

  it("marks a 14-day operating history scenario as limited, never bank-verified", () => {
    const dates=Array.from({length:14},(_,i)=>{
      const date=new Date(Date.UTC(2026,9,31+i)).toISOString().slice(0,10);
      return {date,inflowMinor:3000,outflowMinor:1000};
    });
    const actual=buildCashForecast(input({history:dates}));
    const result=summarizeCashForecast(actual,base);
    expect(result.dataQuality).toBe("LIMITED");
    expect(result.answer).toContain("medium-confidence");
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({key:"historyDaysAvailable",value:14}),
      expect.objectContaining({key:"projectedClosingCashMinor",value:26000}),
    ]));
    expect(result.limitations.join(" ")).toMatch(/not a live bank balance/);
  });
});
