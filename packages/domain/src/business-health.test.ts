import { describe, expect, it } from "vitest";
import type { FinancialSummaryReport } from "@tradeos/contracts";
import { evaluateBusinessHealth } from "./business-health.js";

type Basis = Omit<FinancialSummaryReport, "health">;

function basis(overrides: Partial<Basis> = {}): Basis {
  const base: Basis = {
    businessId: "11111111-1111-4111-8111-111111111111",
    branchId: "22222222-2222-4222-8222-222222222222",
    currencyCode: "GHS",
    period: { from: "2026-09-06T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z", timezone: "Africa/Accra" },
    previousPeriod: { from: "2026-08-07T00:00:00.000Z", to: "2026-09-06T00:00:00.000Z", timezone: "Africa/Accra" },
    flow: {
      grossRevenueMinor: 102000, returnsRevenueMinor: 2000, netRevenueMinor: 100000,
      grossTaxMinor: 0, returnsTaxMinor: 0, netTaxMinor: 0,
      grossCogsMinor: 50000, cogsReversalMinor: 1000, netCogsMinor: 49000, discardedReturnCostMinor: 0,
      grossProfitMinor: 51000, expenseMinor: 31000, purchaseReturnVarianceMinor: 0, operatingProfitMinor: 20000,
      grossSalesTotalMinor: 102000, refundTotalMinor: 2000, salesCount: 20, returnCount: 1,
      averageNetSaleMinor: 5000, cashInflowMinor: 95000, cashOutflowMinor: 80000,
      netCashMovementMinor: 15000, operatingCashNetMinor: 15000,
    },
    previousFlow: {
      grossRevenueMinor: 85000, returnsRevenueMinor: 1000, netRevenueMinor: 84000,
      grossTaxMinor: 0, returnsTaxMinor: 0, netTaxMinor: 0,
      grossCogsMinor: 43000, cogsReversalMinor: 500, netCogsMinor: 42500, discardedReturnCostMinor: 0,
      grossProfitMinor: 41500, expenseMinor: 25500, purchaseReturnVarianceMinor: 0, operatingProfitMinor: 16000,
      grossSalesTotalMinor: 85000, refundTotalMinor: 1000, salesCount: 17, returnCount: 1,
      averageNetSaleMinor: 4941, cashInflowMinor: 80000, cashOutflowMinor: 68000,
      netCashMovementMinor: 12000, operatingCashNetMinor: 12000,
    },
    comparison: {
      netRevenueDeltaMinor: 16000, grossProfitDeltaMinor: 9500, expenseDeltaMinor: 5500,
      operatingProfitDeltaMinor: 4000, salesCountDelta: 3, netCashMovementDeltaMinor: 3000,
      netRevenueChangePercent: 19.05, grossProfitChangePercent: 22.89, operatingProfitChangePercent: 25,
    },
    position: {
      cashBalanceMinor: 50000, receivablesMinor: 5000, customerCreditBalanceMinor: 0,
      payablesMinor: 10000, supplierCreditBalanceMinor: 0, inventoryValueMinor: 45000,
      inventoryAvailableValueMinor: 45000, inventoryQuarantineValueMinor: 0, inventoryOtherValueMinor: 0,
      inventorySnapshotAt: "2026-10-06T00:00:00.000Z", inventoryIsCurrentSnapshot: true,
    },
    previousPosition: { cashBalanceMinor: 35000, receivablesMinor: 4000, customerCreditBalanceMinor: 0, payablesMinor: 12000, supplierCreditBalanceMinor: 0 },
    daily: [], branches: [], topItems: [],
  };
  return { ...base, ...overrides };
}

describe("business health rules", () => {
  it("scores a profitable, cash-generative business highly and explains the positives", () => {
    const result = evaluateBusinessHealth(basis());
    expect(result.algorithmVersion).toBe("health-v1");
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThanOrEqual(80);
    expect(["GOOD", "EXCELLENT"]).toContain(result.status);
    expect(result.confidence).toBe("HIGH");
    expect(result.insights.map((item) => item.code)).toEqual(expect.arrayContaining(["HEALTHY_MARGIN", "REVENUE_GROWTH"]));
  });

  it("does not let owner funding hide negative operating cash or weak supplier coverage", () => {
    const report = basis({
      flow: { ...basis().flow, netRevenueMinor: 50000, operatingProfitMinor: 5000, netCashMovementMinor: 15000, operatingCashNetMinor: -12000 },
      position: { ...basis().position, cashBalanceMinor: 10000, payablesMinor: 40000 },
    });
    const result = evaluateBusinessHealth(report);
    const codes = result.insights.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["NEGATIVE_OPERATING_CASH", "NON_OPERATING_CASH_SUPPORT", "PAYABLE_COVERAGE"]));
    expect(result.dimensions.find((item) => item.key === "CASH_FLOW")!.score!).toBeLessThan(50);
  });

  it("does not penalize a service-only business for having no inventory", () => {
    const report = basis({ position: { ...basis().position, inventoryValueMinor: 0, inventoryAvailableValueMinor: 0, inventoryQuarantineValueMinor: 0 } });
    const result = evaluateBusinessHealth(report);
    const inventory = result.dimensions.find((item) => item.key === "INVENTORY")!;
    expect(inventory.applicable).toBe(false);
    expect(inventory.score).toBeNull();
  });


  it("treats a product business with zero valued stock differently from a service business", () => {
    const report = basis({
      position: { ...basis().position, inventoryValueMinor: 0, inventoryAvailableValueMinor: 0, inventoryQuarantineValueMinor: 0 },
      topItems: [{ itemId: "33333333-3333-4333-8333-333333333333", itemName: "Nails", itemKind: "PRODUCT", unitCode: "lb", quantitySold: 4, quantityReturned: 0, netRevenueMinor: 20000, netCogsMinor: 12000, grossProfitMinor: 8000 }],
    });
    const result = evaluateBusinessHealth(report);
    const inventory = result.dimensions.find((item) => item.key === "INVENTORY")!;
    expect(inventory.applicable).toBe(true);
    expect(inventory.score).toBe(60);
    expect(result.insights.map((item) => item.code)).toContain("PRODUCT_STOCK_VALUE_MISSING");
  });

  it("does not mix the current inventory snapshot into a historical-period health score", () => {
    const report = basis({
      period: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z", timezone: "Africa/Accra" },
      position: { ...basis().position, inventorySnapshotAt: "2026-10-06T00:00:00.000Z" },
      topItems: [{ itemId: "44444444-4444-4444-8444-444444444444", itemName: "Iron rod", itemKind: "PRODUCT", unitCode: "piece", quantitySold: 5, quantityReturned: 0, netRevenueMinor: 50000, netCogsMinor: 30000, grossProfitMinor: 20000 }],
    });
    const result = evaluateBusinessHealth(report);
    const inventory = result.dimensions.find((item) => item.key === "INVENTORY")!;
    expect(inventory.applicable).toBe(false);
    expect(inventory.score).toBeNull();
    expect(inventory.summary).toContain("historical period");
    expect(result.insights.map((item) => item.code)).not.toContain("INVENTORY_TIEUP");
  });

  it("measures inventory coverage against cost-of-goods run rate rather than sales revenue", () => {
    const report = basis({
      flow: { ...basis().flow, netRevenueMinor: 200000, netCogsMinor: 100000 },
      position: { ...basis().position, inventoryValueMinor: 200000, inventoryAvailableValueMinor: 200000, inventoryQuarantineValueMinor: 0 },
    });
    const result = evaluateBusinessHealth(report);
    const metric = result.dimensions.find((item) => item.key === "INVENTORY")!.metrics.find((item) => item.key === "inventoryMonths")!;
    expect(metric.label).toBe("Inventory / monthly COGS");
    expect(metric.value).toBeGreaterThan(1.9);
    expect(metric.value).toBeLessThan(2.1);
  });

  it("surfaces credit, stock, quarantine and return pressure from the evidence", () => {
    const report = basis({
      flow: { ...basis().flow, grossRevenueMinor: 100000, returnsRevenueMinor: 25000, netRevenueMinor: 75000, discardedReturnCostMinor: 3000, operatingProfitMinor: 5000 },
      comparison: { ...basis().comparison, netRevenueChangePercent: -40 },
      position: { ...basis().position, receivablesMinor: 180000, inventoryValueMinor: 400000, inventoryAvailableValueMinor: 320000, inventoryQuarantineValueMinor: 80000 },
    });
    const result = evaluateBusinessHealth(report);
    const codes = result.insights.map((item) => item.code);
    expect(codes).toEqual(expect.arrayContaining(["RECEIVABLE_PRESSURE", "INVENTORY_TIEUP", "QUARANTINE_PRESSURE", "HIGH_RETURNS", "REVENUE_DECLINE", "RETURN_WASTE"]));
    expect(result.status).not.toBe("EXCELLENT");
  });

  it("turns working-capital pressure into ranked owner actions with direct workflow routes", () => {
    const report = basis({
      flow: { ...basis().flow, netRevenueMinor: 50000, netCogsMinor: 30000, operatingCashNetMinor: -12000, netCashMovementMinor: 15000 },
      position: { ...basis().position, cashBalanceMinor: 10000, receivablesMinor: 90000, payablesMinor: 40000, inventoryValueMinor: 120000, inventoryAvailableValueMinor: 120000 },
    });
    const result = evaluateBusinessHealth(report);
    expect(result.workingCapital.status).toBe("PRESSURED");
    expect(result.workingCapital.cashAfterPayablesMinor).toBe(-30000);
    expect(result.workingCapital.netTradeCreditMinor).toBe(50000);
    expect(result.workingCapital.operatingWorkingCapitalMinor).toBe(170000);
    expect(result.actions[0]?.priority).toBe("URGENT");
    expect(result.actions.some((item) => item.sourceInsightCode === "PAYABLE_COVERAGE" && item.href === "#purchases")).toBe(true);
    expect(result.actions.some((item) => item.sourceInsightCode === "RECEIVABLE_PRESSURE" && item.href === "#customers")).toBe(true);
  });

  it("does not fabricate operating working capital for a historical period with a current inventory snapshot", () => {
    const report = basis({
      period: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z", timezone: "Africa/Accra" },
      position: { ...basis().position, inventorySnapshotAt: "2026-10-06T00:00:00.000Z" },
    });
    const result = evaluateBusinessHealth(report);
    expect(result.workingCapital.inventorySnapshotAligned).toBe(false);
    expect(result.workingCapital.operatingWorkingCapitalMinor).toBeNull();
    expect(result.workingCapital.inventoryMonths).toBeNull();
  });

  it("gives a healthy business a low-priority keep-recording action instead of inventing a problem", () => {
    const result = evaluateBusinessHealth(basis());
    expect(result.workingCapital.status).toBe("HEALTHY");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ code: "ACTION_MAINTAIN_RECORDING", priority: "LOW", area: "REPORTS" });
  });

  it("returns insufficient data instead of inventing a score for an empty business", () => {
    const empty = basis({
      flow: { ...basis().flow, grossRevenueMinor: 0, returnsRevenueMinor: 0, netRevenueMinor: 0, grossCogsMinor: 0, cogsReversalMinor: 0, netCogsMinor: 0, grossProfitMinor: 0, expenseMinor: 0, operatingProfitMinor: 0, grossSalesTotalMinor: 0, refundTotalMinor: 0, salesCount: 0, returnCount: 0, averageNetSaleMinor: 0, cashInflowMinor: 0, cashOutflowMinor: 0, netCashMovementMinor: 0, operatingCashNetMinor: 0 },
      previousFlow: { ...basis().previousFlow, grossRevenueMinor: 0, returnsRevenueMinor: 0, netRevenueMinor: 0, grossCogsMinor: 0, cogsReversalMinor: 0, netCogsMinor: 0, grossProfitMinor: 0, expenseMinor: 0, operatingProfitMinor: 0, grossSalesTotalMinor: 0, refundTotalMinor: 0, salesCount: 0, returnCount: 0, averageNetSaleMinor: 0, cashInflowMinor: 0, cashOutflowMinor: 0, netCashMovementMinor: 0, operatingCashNetMinor: 0 },
      comparison: { ...basis().comparison, netRevenueDeltaMinor: 0, grossProfitDeltaMinor: 0, expenseDeltaMinor: 0, operatingProfitDeltaMinor: 0, salesCountDelta: 0, netCashMovementDeltaMinor: 0, netRevenueChangePercent: 0, grossProfitChangePercent: 0, operatingProfitChangePercent: 0 },
      position: { ...basis().position, cashBalanceMinor: 0, receivablesMinor: 0, payablesMinor: 0, inventoryValueMinor: 0, inventoryAvailableValueMinor: 0, inventoryQuarantineValueMinor: 0 },
    });
    const result = evaluateBusinessHealth(empty);
    expect(result.score).toBeNull();
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.confidence).toBe("LOW");
  });
});
