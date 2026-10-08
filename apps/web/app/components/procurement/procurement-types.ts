export type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  balanceMinor: number;
  paymentTermsDays: number;
};

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

export type PurchaseSummary = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierReference: string | null;
  totalMinor: number;
  currencyCode: string;
  receivedAt: string;
  receiverName: string | null;
  lineCount: number;
  settlementMethod: string;
};

export type ProcurementSnapshot = {
  suppliers: Supplier[];
  inventory: InventoryItem[];
  purchases: PurchaseSummary[];
};

export type ProcurementDataSource = "live" | "cached" | "unavailable";
