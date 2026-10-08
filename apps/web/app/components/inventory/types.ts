export type InventoryItem = {
  id: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  quarantine: number;
  damaged: number;
  waste: number;
  averageStockUnitCostMinor: number | null;
  inventoryValueMinor: number;
};

export type InventoryMovement = {
  id: string;
  stockUnitCode: string;
  quantityDelta: number;
  location: string;
  reason: string;
  referenceType: string;
  referenceId: string;
  actorStaffId: string | null;
  actorName: string | null;
  occurredAt: string;
};

export type InventoryDetail = {
  item: InventoryItem & { active: boolean };
  movements: InventoryMovement[];
};
