import type { BusinessHealthSummary } from "./insights.js";

export interface FinancialPeriod {
  from: string;
  to: string;
  timezone: string;
}

export interface FinancialFlowSummary {
  grossRevenueMinor: number;
  returnsRevenueMinor: number;
  netRevenueMinor: number;
  grossTaxMinor: number;
  returnsTaxMinor: number;
  netTaxMinor: number;
  grossCogsMinor: number;
  cogsReversalMinor: number;
  netCogsMinor: number;
  discardedReturnCostMinor: number;
  grossProfitMinor: number;
  expenseMinor: number;
  purchaseReturnVarianceMinor: number;
  operatingProfitMinor: number;
  grossSalesTotalMinor: number;
  refundTotalMinor: number;
  salesCount: number;
  returnCount: number;
  averageNetSaleMinor: number;
  cashInflowMinor: number;
  cashOutflowMinor: number;
  netCashMovementMinor: number;
  operatingCashNetMinor: number;
}

export interface FinancialPositionSummary {
  cashBalanceMinor: number;
  receivablesMinor: number;
  customerCreditBalanceMinor: number;
  payablesMinor: number;
  supplierCreditBalanceMinor: number;
  inventoryValueMinor: number;
  inventoryAvailableValueMinor: number;
  inventoryQuarantineValueMinor: number;
  inventoryOtherValueMinor: number;
  inventorySnapshotAt: string;
  inventoryIsCurrentSnapshot: true;
}

export interface FinancialComparison {
  netRevenueDeltaMinor: number;
  grossProfitDeltaMinor: number;
  expenseDeltaMinor: number;
  operatingProfitDeltaMinor: number;
  salesCountDelta: number;
  netCashMovementDeltaMinor: number;
  netRevenueChangePercent: number | null;
  grossProfitChangePercent: number | null;
  operatingProfitChangePercent: number | null;
}

export interface DailyFinancialPoint {
  date: string;
  netRevenueMinor: number;
  netCogsMinor: number;
  grossProfitMinor: number;
  expenseMinor: number;
  purchaseReturnVarianceMinor: number;
  operatingProfitMinor: number;
  cashNetMinor: number;
  salesCount: number;
  returnCount: number;
}

export interface BranchFinancialRow {
  branchId: string;
  branchName: string;
  netRevenueMinor: number;
  netCogsMinor: number;
  grossProfitMinor: number;
  expenseMinor: number;
  purchaseReturnVarianceMinor: number;
  operatingProfitMinor: number;
  cashNetMinor: number;
  receivablesMinor: number;
  customerCreditBalanceMinor: number;
  payablesMinor: number;
  supplierCreditBalanceMinor: number;
  inventoryValueMinor: number;
  salesCount: number;
  returnCount: number;
}

export interface ItemPerformanceRow {
  itemId: string;
  itemName: string;
  itemKind: string;
  unitCode: string;
  quantitySold: number;
  quantityReturned: number;
  netRevenueMinor: number;
  netCogsMinor: number;
  grossProfitMinor: number;
}

export interface FinancialSummaryReport {
  businessId: string;
  branchId: string | null;
  currencyCode: string;
  period: FinancialPeriod;
  previousPeriod: FinancialPeriod;
  flow: FinancialFlowSummary;
  previousFlow: FinancialFlowSummary;
  comparison: FinancialComparison;
  position: FinancialPositionSummary;
  previousPosition: Omit<FinancialPositionSummary, "inventoryValueMinor" | "inventoryAvailableValueMinor" | "inventoryQuarantineValueMinor" | "inventoryOtherValueMinor" | "inventorySnapshotAt" | "inventoryIsCurrentSnapshot">;
  daily: DailyFinancialPoint[];
  branches: BranchFinancialRow[];
  topItems: ItemPerformanceRow[];
  health: BusinessHealthSummary;
}
