import type { InventoryAdjustmentLocation } from "./inventory-adjustments.js";

export type ExchangeReturnDisposition = "RESTOCK" | "QUARANTINE" | "DISCARD" | "NOT_APPLICABLE";
export type ExchangeSettlementMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "CUSTOMER_CREDIT" | "OTHER" | "ORIGINAL_METHOD";

export interface ExchangeCreateInput {
  originalSaleId: string;
  reason: string;
  settlementMethod: ExchangeSettlementMethod;
  moneyAccountId?: string;
  returnedLines: Array<{ saleLineId: string; quantity: number; disposition: ExchangeReturnDisposition }>;
  replacementLines: Array<{ itemId: string; saleUnitCode: string; quantity: number }>;
}

export interface ExchangeResult {
  exchangeCaseId: string;
  originalSaleId: string;
  returnCaseId: string;
  replacementSaleId: string;
  returnTotalMinor: number;
  replacementTotalMinor: number;
  netDifferenceMinor: number;
  status: "PROCESSING" | "COMPLETED";
}

// Re-exporting this type here keeps exchange consumers aligned with inventory location vocabulary.
export type ExchangeInventoryLocation = InventoryAdjustmentLocation;
