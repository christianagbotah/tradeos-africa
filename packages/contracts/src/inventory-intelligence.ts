/** Scenario-based demand planning, not a purchase order or guaranteed forecast. */
export type InventoryAdvisoryStatus =
  | "OUT_OF_STOCK"
  | "REORDER_REVIEW"
  | "OVERSTOCK_REVIEW"
  | "SLOW_MOVING"
  | "HEALTHY"
  | "INSUFFICIENT_DATA";
export type InventoryDemandConfidence = "ESTABLISHED" | "LIMITED" | "INSUFFICIENT";

export interface InventoryAdvisoryItem {
  itemId: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  inventoryValueMinor: number;
  netSold30Days: number;
  salesMovementCount30Days: number;
  lastSaleAt: string | null;
  firstStockMovementAt: string | null;
  status: InventoryAdvisoryStatus;
  confidence: InventoryDemandConfidence;
  averageDailyDemand: number | null;
  estimatedCoverDays: number | null;
  suggestedReviewQuantity: number | null;
  explanation: string;
}
export interface InventoryIntelligenceReport {
  businessId: string;
  branchId: string;
  generatedAt: string;
  currencyCode: string;
  planningHorizonDays: 7 | 14 | 30;
  observationWindowDays: 30;
  /** This is the number of records evaluated, not the number in the full catalog. */
  evaluatedItemCount: number;
  truncated: boolean;
  summary: {
    outOfStock: number;
    reorderReview: number;
    slowMoving: number;
    overstockReview: number;
    insufficientData: number;
    potentialInventoryValueMinor: number;
  };
  items: InventoryAdvisoryItem[];
  methodology: string;
}
