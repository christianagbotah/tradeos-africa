import { describe, expect, it } from "vitest";

type InventoryItem = {
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

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  balanceMinor: number;
  paymentTermsDays: number;
};

type PurchaseSummary = {
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

async function loadModel() {
  const path = "./procurement-model";
  try {
    return await import(/* @vite-ignore */ path);
  } catch {
    return null;
  }
}

const inventory: InventoryItem[] = [
  { id: "malt", sku: "MLT-001", name: "Malt", stockUnitCode: "bottle", available: 0, quarantine: 2, damaged: 1, waste: 0, averageStockUnitCostMinor: 700, inventoryValueMinor: 5000 },
  { id: "cement", sku: "GH-425", name: "GHACEM 42.5R", stockUnitCode: "bag", available: 5, quarantine: 0, damaged: 0, waste: 0, averageStockUnitCostMinor: 9600, inventoryValueMinor: 12000 },
  { id: "nails", sku: null, name: "Roofing nails", stockUnitCode: "box", available: -1, quarantine: 1, damaged: 2, waste: 1, averageStockUnitCostMinor: 1500, inventoryValueMinor: 3000 },
];

const suppliers: Supplier[] = [
  { id: "s1", name: "Alpha Supply", phone: null, email: null, address: null, active: true, balanceMinor: 15000, paymentTermsDays: 30 },
  { id: "s2", name: "Beta Trade", phone: null, email: null, address: null, active: true, balanceMinor: -2500, paymentTermsDays: 0 },
  { id: "s3", name: "Archived Co", phone: null, email: null, address: null, active: false, balanceMinor: 4000, paymentTermsDays: 14 },
];

const purchases: PurchaseSummary[] = [
  { id: "p-old", supplierId: "s1", supplierName: "Alpha Supply", supplierReference: null, totalMinor: 4000, currencyCode: "GHS", receivedAt: "2026-10-06T10:00:00.000Z", receiverName: "Ama", lineCount: 1, settlementMethod: "CASH" },
  { id: "p-new", supplierId: "s2", supplierName: "Beta Trade", supplierReference: "INV-92", totalMinor: 9000, currencyCode: "GHS", receivedAt: "2026-10-08T09:00:00.000Z", receiverName: "Kojo", lineCount: 2, settlementMethod: "SUPPLIER_CREDIT" },
];

describe("procurement presentation model", () => {
  it("summarizes only server-provided stock facts without inventing a low-stock threshold", async () => {
    const model = await loadModel();
    expect(model?.buildInventoryOverview).toBeTypeOf("function");
    if (!model) return;

    const overview = model.buildInventoryOverview(inventory);
    expect(overview.trackedCount).toBe(3);
    expect(overview.inventoryValueMinor).toBe(20000);
    expect(overview.outOfStockCount).toBe(2);
    expect(overview.outOfStockItems.map((item: InventoryItem) => item.id)).toEqual(["malt", "nails"]);
    expect(overview.quarantineQuantity).toBe(3);
    expect(overview.damagedQuantity).toBe(3);
    expect(overview.wasteQuantity).toBe(1);
    expect(overview.highValueItems.map((item: InventoryItem) => item.id)).toEqual(["cement", "malt", "nails"]);
    expect(overview.outOfStockItems.some((item: InventoryItem) => item.id === "cement")).toBe(false);
    expect(overview).not.toHaveProperty("lowStockCount");
  });

  it("filters inventory by name or SKU case-insensitively", async () => {
    const model = await loadModel();
    expect(model?.filterInventory).toBeTypeOf("function");
    if (!model) return;

    expect(model.filterInventory(inventory, "gh-425").map((item: InventoryItem) => item.id)).toEqual(["cement"]);
    expect(model.filterInventory(inventory, "MALT").map((item: InventoryItem) => item.id)).toEqual(["malt"]);
    expect(model.filterInventory(inventory, "  ")).toEqual(inventory);
  });

  it("keeps positive supplier balances as payables and negative balances as supplier credit", async () => {
    const model = await loadModel();
    expect(model?.buildProcurementOverview).toBeTypeOf("function");
    if (!model) return;

    const overview = model.buildProcurementOverview(suppliers, purchases);
    expect(overview.activeSupplierCount).toBe(2);
    expect(overview.totalPayableMinor).toBe(15000);
    expect(overview.supplierCreditMinor).toBe(2500);
    expect(overview.payableSupplierCount).toBe(1);
    expect(overview.creditSupplierCount).toBe(1);
    expect(overview.recentPurchases.map((purchase: PurchaseSummary) => purchase.id)).toEqual(["p-new", "p-old"]);
  });
});
