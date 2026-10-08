export type InventoryAdjustmentLocation = "AVAILABLE" | "QUARANTINE" | "DAMAGED" | "WASTE";

export type InventoryAdjustmentReasonCode =
  | "COUNT_CORRECTION"
  | "QUARANTINE"
  | "DAMAGE"
  | "WASTE"
  | "OTHER";

export interface InventoryAdjustmentInput {
  itemId: string;
  sourceLocation?: InventoryAdjustmentLocation;
  destinationLocation?: InventoryAdjustmentLocation;
  quantity: number;
  reasonCode: InventoryAdjustmentReasonCode;
  note?: string | null;
}

export interface InventoryAdjustmentResult {
  adjustmentId: string;
  itemId: string;
  sourceLocation: InventoryAdjustmentLocation | null;
  destinationLocation: InventoryAdjustmentLocation | null;
  quantity: number;
  movedValueMinor: number;
  reasonCode: InventoryAdjustmentReasonCode;
  balances: Record<InventoryAdjustmentLocation, number>;
  inventoryValueMinor: number;
}
