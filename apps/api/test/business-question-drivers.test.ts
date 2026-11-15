import { describe, expect, it } from "vitest";
import type { FinancialFlowSummary } from "@tradeos/contracts";
import { recordedChangeDrivers } from "../src/business-intelligence/question-drivers.js";

const EMPTY: FinancialFlowSummary = {
  grossRevenueMinor:0,returnsRevenueMinor:0,netRevenueMinor:0,
  grossTaxMinor:0,returnsTaxMinor:0,netTaxMinor:0,
  grossCogsMinor:0,cogsReversalMinor:0,netCogsMinor:0,
  discardedReturnCostMinor:0,grossProfitMinor:0,
  expenseMinor:0,purchaseReturnVarianceMinor:0,operatingProfitMinor:0,
  grossSalesTotalMinor:0,refundTotalMinor:0,
  salesCount:0,returnCount:0,averageNetSaleMinor:0,
  cashInflowMinor:0,cashOutflowMinor:0,netCashMovementMinor:0,
  operatingCashNetMinor:0,
};
const flow = (partial: Partial<FinancialFlowSummary>): FinancialFlowSummary => ({...EMPTY,...partial});
const previous = flow({
  grossRevenueMinor:20000, returnsRevenueMinor:2000,
  netRevenueMinor:18000, netCogsMinor:9000,
  expenseMinor:1000, operatingProfitMinor:8000, salesCount:4,
});
const current = flow({
  grossRevenueMinor:13000, returnsRevenueMinor:3000,
  netRevenueMinor:10000, netCogsMinor:6000,
  expenseMinor:2000, purchaseReturnVarianceMinor:500,
  operatingProfitMinor:2500, salesCount:2,
});

describe("grounded change diagnostics", () => {
  it("exactly decomposes a fall in net sales into revenue and returns", () => {
    const drivers = recordedChangeDrivers(current,previous,"SALES","GHS");
    expect(drivers.evidence.map((e)=>[e.key,e.value])).toEqual([
      ["driver_grossRevenue",-7000],
      ["driver_returnsReversal",-1000],
    ]);
    expect(drivers.evidence.reduce((sum,e)=>sum+e.value,0)).toBe(-8000);
    expect(drivers.text).toContain("−₵80.00");
    expect(drivers.items).toHaveLength(2);
    expect(drivers.items[0]?.label).toMatch(/gross sales/i);
    expect(drivers.limitations.join(" ")).toMatch(/does not prove its underlying cause/i);
  });

  it("exactly decomposes profit including COGS, expenses and purchase return variance", () => {
    const drivers = recordedChangeDrivers(current,previous,"PROFIT","GHS");
    expect(drivers.evidence.map(e=>e.value)).toEqual([-7000,-1000,3000,-1000,500]);
    expect(drivers.evidence.reduce((sum,e)=>sum+e.value,0)).toBe(-5500);
    expect(drivers.items.map(x=>x.id)).toEqual([
      "grossRevenue","netCogs","expenses","returnsReversal","purchaseReturnVariance",
    ]);
  });

  it("does not imply drivers or predictions when periods have no activity", () => {
    const drivers = recordedChangeDrivers(EMPTY,EMPTY,"SALES","GHS");
    expect(drivers.items).toHaveLength(0);
    expect(drivers.text).toMatch(/No recorded accounting movement/i);
    expect(drivers.evidence.reduce((a,b)=>a+b.value,0)).toBe(0);
  });

  it("refuses to invent a reconciliation when the reporting fields disagree", () => {
    const broken = flow({...current,netRevenueMinor:10001});
    const drivers = recordedChangeDrivers(broken,previous,"SALES","GHS");
    expect(drivers.items).toEqual([]);
    expect(drivers.evidence).toEqual([]);
    expect(drivers.text).toMatch(/could not be reconciled/i);
  });
});
