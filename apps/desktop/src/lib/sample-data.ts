/**
 * SAMPLE DATA — demo content for the TradeOS desktop client.
 *
 * This module is loaded ONLY when the `VITE_TRADEOS_DEMO=true` environment
 * variable is set. The production desktop NEVER auto-activates sample data:
 * on any auth/connectivity failure it shows a truthful empty/error state.
 *
 * When demo mode IS active, every screen shows a clear "DEMO MODE — sample
 * data" banner so a user can never mistake demo content for live business
 * data. Sample shapes mirror the live API DTOs (minor-unit money) so the
 * swap from demo to live is a 1:1 adapter change.
 */

import type {
  DesktopActivityItem,
  DesktopCustomerRow,
  DesktopDashboardKpis,
  DesktopInventoryRow,
  DesktopReportSummary,
  DesktopSaleRow,
  DesktopSellableItem,
} from "./types.js";

/**
 * True only when the desktop was built/run with `VITE_TRADEOS_DEMO=true`.
 * Vite inlines `import.meta.env.VITE_*` at build time, so this is a constant
 * in the bundle. The runtime exposes it via `isDemoMode()`.
 */
export const DEMO_MODE_ENABLED: boolean =
  typeof import.meta !== "undefined" &&
  typeof import.meta.env === "object" &&
  import.meta.env !== null &&
  Boolean((import.meta.env as { VITE_TRADEOS_DEMO?: string }).VITE_TRADEOS_DEMO);

/** Runtime accessor for demo mode. */
export function isDemoMode(): boolean {
  return DEMO_MODE_ENABLED;
}

// GHS money is stored as integer pesewas (1 GHS = 100 pesewas).
const ghs = (major: number) => Math.round(major * 100);

export const SAMPLE_SELLABLE_ITEMS: readonly DesktopSellableItem[] = [
  { key: "p1:pack", itemId: "p1", name: "Digestive Biscuits 200g", sku: "BISK-001", kind: "PRODUCT", unitCode: "pack", unitLabel: "pack", displayPriceMinor: ghs(6.5), trackStock: true, availableStock: 84 },
  { key: "p2:bottle", itemId: "p2", name: "Coca-Cola 500ml", sku: "DRK-014", kind: "PRODUCT", unitCode: "bottle", unitLabel: "bottle", displayPriceMinor: ghs(4.0), trackStock: true, availableStock: 120 },
  { key: "p3:bottle", itemId: "p3", name: "Voltic Water 1.5L", sku: "DRK-022", kind: "PRODUCT", unitCode: "bottle", unitLabel: "bottle", displayPriceMinor: ghs(5.0), trackStock: true, availableStock: 18 },
  { key: "p4:bag", itemId: "p4", name: "Perfumed Rice 5kg", sku: "RICE-110", kind: "PRODUCT", unitCode: "bag", unitLabel: "bag", displayPriceMinor: ghs(72.0), trackStock: true, availableStock: 40 },
  { key: "p5:bottle", itemId: "p5", name: "Cooking Oil 1L", sku: "OIL-205", kind: "PRODUCT", unitCode: "bottle", unitLabel: "bottle", displayPriceMinor: ghs(28.0), trackStock: true, availableStock: 33 },
  { key: "p6:pack", itemId: "p6", name: "Granulated Sugar 1kg", sku: "SUG-300", kind: "PRODUCT", unitCode: "pack", unitLabel: "pack", displayPriceMinor: ghs(12.0), trackStock: true, availableStock: 60 },
  { key: "p7:tin", itemId: "p7", name: "Powdered Milk 400g", sku: "MILK-410", kind: "PRODUCT", unitCode: "tin", unitLabel: "tin", displayPriceMinor: ghs(34.0), trackStock: true, availableStock: 9 },
  { key: "p8:box", itemId: "p8", name: "Lipton Tea 100 bags", sku: "TEA-505", kind: "PRODUCT", unitCode: "box", unitLabel: "box", displayPriceMinor: ghs(18.5), trackStock: true, availableStock: 27 },
  { key: "p9:bar", itemId: "p9", name: "Key Soap 250g", sku: "SOAP-600", kind: "PRODUCT", unitCode: "bar", unitLabel: "bar", displayPriceMinor: ghs(5.5), trackStock: true, availableStock: 96 },
  { key: "p10:pack", itemId: "p10", name: "Spaghetti 500g", sku: "PAST-700", kind: "PRODUCT", unitCode: "pack", unitLabel: "pack", displayPriceMinor: ghs(8.0), trackStock: true, availableStock: 0 },
  { key: "p11:tin", itemId: "p11", name: "Tomato Paste 400g", sku: "TOM-800", kind: "PRODUCT", unitCode: "tin", unitLabel: "tin", displayPriceMinor: ghs(7.5), trackStock: true, availableStock: 45 },
  { key: "p12:tin", itemId: "p12", name: "Sardines in Oil 155g", sku: "SARD-900", kind: "PRODUCT", unitCode: "tin", unitLabel: "tin", displayPriceMinor: ghs(9.0), trackStock: true, availableStock: 52 },
  { key: "p13:tray", itemId: "p13", name: "Eggs (tray of 30)", sku: "EGGS-100", kind: "PRODUCT", unitCode: "tray", unitLabel: "tray", displayPriceMinor: ghs(38.0), trackStock: true, availableStock: 14 },
  { key: "p14:loaf", itemId: "p14", name: "Fresh Bread Loaf", sku: "BREAD-110", kind: "PRODUCT", unitCode: "loaf", unitLabel: "loaf", displayPriceMinor: ghs(10.0), trackStock: true, availableStock: 22 },
  { key: "p15:pack", itemId: "p15", name: "Indomie Noodles 5-pack", sku: "INDEM-120", kind: "PRODUCT", unitCode: "pack", unitLabel: "pack", displayPriceMinor: ghs(9.5), trackStock: true, availableStock: 70 },
  { key: "p16:bar", itemId: "p16", name: "Cadbury Chocolate 100g", sku: "CHOC-130", kind: "PRODUCT", unitCode: "bar", unitLabel: "bar", displayPriceMinor: ghs(14.0), trackStock: true, availableStock: 6 },
];

export const SAMPLE_CUSTOMERS: readonly DesktopCustomerRow[] = [
  { id: "c1", name: "Adwoa Mensah", phone: "024 112 3344", balanceMinor: 0, active: true, lifetimeValueMinor: ghs(4280.5), lastSeen: "2026-10-09T13:20:00Z" },
  { id: "c2", name: "Kofi Boateng", phone: "020 998 7766", balanceMinor: ghs(145.0), active: true, lifetimeValueMinor: ghs(8120.0), lastSeen: "2026-10-10T08:05:00Z" },
  { id: "c3", name: "Ama Serwaa", phone: "055 445 2211", balanceMinor: ghs(320.5), active: true, lifetimeValueMinor: ghs(1560.0), lastSeen: "2026-10-07T16:40:00Z" },
  { id: "c4", name: "Yaw Asante", phone: "027 778 9900", balanceMinor: 0, active: true, lifetimeValueMinor: ghs(2210.0), lastSeen: "2026-10-10T11:12:00Z" },
  { id: "c5", name: "Akosua Frimpong", phone: "024 220 1199", balanceMinor: ghs(88.0), active: false, lifetimeValueMinor: ghs(540.0), lastSeen: "2026-09-28T10:00:00Z" },
  { id: "c6", name: "Kwabena Owusu", phone: "054 332 1100", balanceMinor: 0, active: true, lifetimeValueMinor: ghs(3340.0), lastSeen: "2026-10-09T18:25:00Z" },
  { id: "c7", name: "Esi Dankwa", phone: "020 556 7788", balanceMinor: ghs(510.0), active: true, lifetimeValueMinor: ghs(6780.0), lastSeen: "2026-10-10T09:40:00Z" },
];

export const SAMPLE_SALES: readonly DesktopSaleRow[] = [
  {
    id: "s1", receiptNo: "RCP-2026-00142", customerName: "Adwoa Mensah", cashierName: "Cashier 1",
    occurredAt: "2026-10-10T14:22:00Z", totalMinor: ghs(84.5), method: "CASH", status: "completed",
    lines: [
      { name: "Perfumed Rice 5kg", unitLabel: "bag", quantity: 1, unitPriceMinor: ghs(72.0), totalMinor: ghs(72.0) },
      { name: "Cooking Oil 1L", unitLabel: "bottle", quantity: 1, unitPriceMinor: ghs(12.5), totalMinor: ghs(12.5) },
    ],
  },
  {
    id: "s2", receiptNo: "RCP-2026-00141", customerName: "Kofi Boateng", cashierName: "Cashier 1",
    occurredAt: "2026-10-10T13:08:00Z", totalMinor: ghs(45.0), method: "MOMO", status: "completed",
    lines: [
      { name: "Spaghetti 500g", unitLabel: "pack", quantity: 3, unitPriceMinor: ghs(8.0), totalMinor: ghs(24.0) },
      { name: "Granulated Sugar 1kg", unitLabel: "pack", quantity: 1, unitPriceMinor: ghs(12.0), totalMinor: ghs(12.0) },
      { name: "Key Soap 250g", unitLabel: "bar", quantity: 2, unitPriceMinor: ghs(5.5), totalMinor: ghs(11.0) },
    ],
  },
  {
    id: "s3", receiptNo: "RCP-2026-00140", customerName: "Walk-in", cashierName: "Cashier 2",
    occurredAt: "2026-10-10T11:40:00Z", totalMinor: ghs(22.5), method: "CASH", status: "completed",
    lines: [
      { name: "Coca-Cola 500ml", unitLabel: "bottle", quantity: 3, unitPriceMinor: ghs(4.0), totalMinor: ghs(12.0) },
      { name: "Digestive Biscuits 200g", unitLabel: "pack", quantity: 1, unitPriceMinor: ghs(6.5), totalMinor: ghs(6.5) },
      { name: "Lipton Tea 100 bags", unitLabel: "box", quantity: 1, unitPriceMinor: ghs(4.0), totalMinor: ghs(4.0) },
    ],
  },
  {
    id: "s4", receiptNo: "RCP-2026-00139", customerName: "Esi Dankwa", cashierName: "Cashier 1",
    occurredAt: "2026-10-10T10:15:00Z", totalMinor: ghs(320.5), method: "CASH", status: "credit",
    lines: [
      { name: "Eggs (tray of 30)", unitLabel: "tray", quantity: 4, unitPriceMinor: ghs(38.0), totalMinor: ghs(152.0) },
      { name: "Perfumed Rice 5kg", unitLabel: "bag", quantity: 2, unitPriceMinor: ghs(72.0), totalMinor: ghs(144.0) },
      { name: "Cooking Oil 1L", unitLabel: "bottle", quantity: 1, unitPriceMinor: ghs(24.5), totalMinor: ghs(24.5) },
    ],
  },
  {
    id: "s5", receiptNo: "RCP-2026-00138", customerName: "Yaw Asante", cashierName: "Cashier 2",
    occurredAt: "2026-10-09T17:50:00Z", totalMinor: ghs(56.0), method: "CARD", status: "completed",
    lines: [
      { name: "Powdered Milk 400g", unitLabel: "tin", quantity: 1, unitPriceMinor: ghs(34.0), totalMinor: ghs(34.0) },
      { name: "Indomie Noodles 5-pack", unitLabel: "pack", quantity: 2, unitPriceMinor: ghs(9.5), totalMinor: ghs(19.0) },
    ],
  },
  {
    id: "s6", receiptNo: "RCP-2026-00137", customerName: "Walk-in", cashierName: "Cashier 1",
    occurredAt: "2026-10-09T15:30:00Z", totalMinor: ghs(18.0), method: "CASH", status: "voided",
    lines: [
      { name: "Fresh Bread Loaf", unitLabel: "loaf", quantity: 1, unitPriceMinor: ghs(10.0), totalMinor: ghs(10.0) },
      { name: "Sardines in Oil 155g", unitLabel: "tin", quantity: 1, unitPriceMinor: ghs(8.0), totalMinor: ghs(8.0) },
    ],
  },
  {
    id: "s7", receiptNo: "RCP-2026-00136", customerName: "Kwabena Owusu", cashierName: "Cashier 1",
    occurredAt: "2026-10-09T12:05:00Z", totalMinor: ghs(102.5), method: "MOMO", status: "completed",
    lines: [
      { name: "Tomato Paste 400g", unitLabel: "tin", quantity: 5, unitPriceMinor: ghs(7.5), totalMinor: ghs(37.5) },
      { name: "Cooking Oil 1L", unitLabel: "bottle", quantity: 2, unitPriceMinor: ghs(28.0), totalMinor: ghs(56.0) },
      { name: "Key Soap 250g", unitLabel: "bar", quantity: 1, unitPriceMinor: ghs(9.0), totalMinor: ghs(9.0) },
    ],
  },
];

const SAMPLE_INVENTORY_DERIVED: readonly DesktopInventoryRow[] = SAMPLE_SELLABLE_ITEMS.map((p) => {
  const stock = p.availableStock ?? 0;
  // Sample reorder levels mirror the prior demo data.
  const reorderMap: Record<string, number> = {
    p1: 24, p2: 36, p3: 24, p4: 12, p5: 12, p6: 20, p7: 12, p8: 10,
    p9: 30, p10: 18, p11: 15, p12: 20, p13: 8, p14: 12, p15: 24, p16: 16,
  };
  const costMap: Record<string, number> = {
    p1: 4.2, p2: 2.6, p3: 3.1, p4: 64.0, p5: 23.5, p6: 9.8, p7: 28.0, p8: 14.0,
    p9: 3.9, p10: 5.8, p11: 5.2, p12: 6.4, p13: 32.0, p14: 7.0, p15: 7.2, p16: 10.5,
  };
  const categoryMap: Record<string, string> = {
    p1: "Snacks", p2: "Drinks", p3: "Drinks", p4: "Staples", p5: "Staples", p6: "Staples",
    p7: "Dairy", p8: "Beverages", p9: "Household", p10: "Staples", p11: "Staples", p12: "Canned",
    p13: "Dairy", p14: "Bakery", p15: "Snacks", p16: "Snacks",
  };
  return {
    id: p.itemId,
    name: p.name,
    sku: p.sku,
    stockUnitCode: p.unitCode,
    category: categoryMap[p.itemId] ?? "Uncategorised",
    onHand: stock,
    reorderLevel: reorderMap[p.itemId] ?? 12,
    unitCostMinor: ghs(costMap[p.itemId] ?? 0),
    unitPriceMinor: p.displayPriceMinor,
  };
});
export { SAMPLE_INVENTORY_DERIVED as SAMPLE_INVENTORY };

export const SAMPLE_ACTIVITY: readonly DesktopActivityItem[] = [
  { id: "a1", kind: "sale", title: "Sale completed · RCP-2026-00142", meta: "Adwoa Mensah · Cashier 1 · 2m ago", amountMinor: ghs(84.5), tone: "positive", at: "2026-10-10T14:22:00Z" },
  { id: "a2", kind: "stock", title: "Stock correction · Cooking Oil 1L", meta: "Received 12 bottles · Cashier 1 · 18m ago", tone: "neutral", at: "2026-10-10T14:04:00Z" },
  { id: "a3", kind: "sale", title: "Sale completed · RCP-2026-00141", meta: "Kofi Boateng · MoMo · 1h ago", amountMinor: ghs(45.0), tone: "positive", at: "2026-10-10T13:08:00Z" },
  { id: "a4", kind: "expense", title: "Expense recorded · Transport", meta: "Cashier 2 · 2h ago", amountMinor: ghs(25.0), tone: "negative", at: "2026-10-10T12:30:00Z" },
  { id: "a5", kind: "customer", title: "New customer · Akosua Frimpong", meta: "Added by Cashier 1 · 3h ago", tone: "neutral", at: "2026-10-10T11:00:00Z" },
  { id: "a6", kind: "return", title: "Return processed · RCP-2026-00137", meta: "Walk-in · Cash refund · 4h ago", amountMinor: ghs(18.0), tone: "negative", at: "2026-10-10T10:15:00Z" },
  { id: "a7", kind: "sale", title: "Credit sale · RCP-2026-00139", meta: "Esi Dankwa · Outstanding 320.50 · 5h ago", amountMinor: ghs(320.5), tone: "neutral", at: "2026-10-10T09:40:00Z" },
];

/** Aggregated dashboard KPIs derived from the sample data above. */
export const SAMPLE_DASHBOARD_KPIS: DesktopDashboardKpis = {
  todaySalesMinor: ghs(152.0),
  cashPositionMinor: ghs(1840.5),
  outstandingCreditMinor: ghs(1063.5),
  stockWarnings: 4, // p3, p7, p10, p16
};

export const SAMPLE_REPORT_SUMMARY: DesktopReportSummary = {
  sales: { revenueMinor: ghs(4280.5), txns: 142, avgMinor: ghs(30.14) },
  profitability: { grossProfitMinor: ghs(1214.3), marginPct: 28.4, bestDay: "Fri" },
  inventory: { stockValueMinor: ghs(9240.0), skus: 16, lowStock: 4, outOfStock: 1 },
  cashflow: { inTodayMinor: ghs(1840.5), outTodayMinor: ghs(25.0), netTodayMinor: ghs(1815.5) },
};
