import type { InventoryItem, PurchaseSummary, Supplier } from "./procurement-types";

export type InventoryOverview = {
  trackedCount: number;
  inventoryValueMinor: number;
  outOfStockCount: number;
  outOfStockItems: InventoryItem[];
  quarantineQuantity: number;
  damagedQuantity: number;
  wasteQuantity: number;
  highValueItems: InventoryItem[];
};

export type ProcurementOverview = {
  activeSupplierCount: number;
  totalPayableMinor: number;
  supplierCreditMinor: number;
  payableSupplierCount: number;
  creditSupplierCount: number;
  recentPurchases: PurchaseSummary[];
};

export function buildInventoryOverview(items: readonly InventoryItem[]): InventoryOverview {
  const outOfStockItems = items.filter((item) => item.available <= 0);
  return {
    trackedCount: items.length,
    inventoryValueMinor: items.reduce((sum, item) => sum + item.inventoryValueMinor, 0),
    outOfStockCount: outOfStockItems.length,
    outOfStockItems,
    quarantineQuantity: items.reduce((sum, item) => sum + item.quarantine, 0),
    damagedQuantity: items.reduce((sum, item) => sum + item.damaged, 0),
    wasteQuantity: items.reduce((sum, item) => sum + item.waste, 0),
    highValueItems: [...items]
      .sort((left, right) => right.inventoryValueMinor - left.inventoryValueMinor || left.name.localeCompare(right.name))
      .slice(0, 5),
  };
}

export function filterInventory(items: readonly InventoryItem[], query: string): InventoryItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => item.name.toLocaleLowerCase().includes(normalized)
    || item.sku?.toLocaleLowerCase().includes(normalized));
}

export function buildProcurementOverview(
  suppliers: readonly Supplier[],
  purchases: readonly PurchaseSummary[],
): ProcurementOverview {
  const active = suppliers.filter((supplier) => supplier.active);
  return {
    activeSupplierCount: active.length,
    totalPayableMinor: active.reduce((sum, supplier) => sum + Math.max(0, supplier.balanceMinor), 0),
    supplierCreditMinor: active.reduce((sum, supplier) => sum + Math.max(0, -supplier.balanceMinor), 0),
    payableSupplierCount: active.filter((supplier) => supplier.balanceMinor > 0).length,
    creditSupplierCount: active.filter((supplier) => supplier.balanceMinor < 0).length,
    recentPurchases: [...purchases]
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || right.id.localeCompare(left.id))
      .slice(0, 8),
  };
}
