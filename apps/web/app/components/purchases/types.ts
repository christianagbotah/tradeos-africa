export type PurchaseCatalogItem = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  trackStock: boolean;
  stockUnitCode: string | null;
  active: boolean;
  units: Array<{ code: string; label: string; canPurchase: boolean }>;
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
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

export type ReceiptLine = {
  key: string;
  itemId: string;
  itemName: string;
  purchaseUnitCode: string;
  purchaseUnitLabel: string;
  quantity: number;
  unitCostMinor: number;
  estimatedStockQuantity: number | null;
  stockUnitCode: string | null;
};

export type PurchaseDetailLine = {
  id: string;
  itemId: string;
  itemName: string;
  purchaseUnitCode: string;
  purchaseQuantity: number;
  stockUnitCode: string;
  stockQuantity: number;
  unitCostMinor: number;
  lineCostMinor: number;
  returnedQuantity: number;
  remainingQuantity: number;
  returnedRecoveryMinor: number;
};

export type PurchaseReturnCase = {
  id: string;
  recoveryMethod: string;
  supplierRecoveryMinor: number;
  inventoryValueRemovedMinor: number;
  purchasePriceVarianceMinor: number;
  occurredAt: string;
};

export type PurchaseDetail = {
  purchase: {
    id: string;
    businessId: string;
    branchId: string;
    supplierId: string;
    supplierName: string;
    status: string;
    currencyCode: string;
    totalMinor: number;
    settlementMethod: string;
  };
  lines: PurchaseDetailLine[];
  returns: PurchaseReturnCase[];
};
