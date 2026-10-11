/**
 * Desktop UI view models.
 *
 * Domain types (ClientMutation, MutationResult, SyncResponse, currency
 * metadata, QueuedMutation, ClientSession, TenantContext, PlatformProfile)
 * are imported from `@tradeos/contracts` and `@tradeos/client-core`. This
 * module defines ONLY desktop-specific presentation adapters and documents
 * why each one is UI-specific.
 *
 * The rule: anything the server is authoritative over (prices, totals, sale
 * ids, balances, currency exponents) lives in a canonical package. Anything
 * that exists purely to render a screen (display names, display price
 * previews, badge tone) lives here.
 */

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * UI view model: navigation targets in the desktop shell.
 * UI-specific because the desktop uses a state-based router (no react-router)
 * and the set of screens is a desktop product decision.
 */
export type ScreenId =
  | "dashboard"
  | "pos"
  | "sales"
  | "inventory"
  | "customers"
  | "reports";

// ---------------------------------------------------------------------------
// POS cart + browser
// ---------------------------------------------------------------------------

/**
 * UI view model: a line in the POS cart.
 *
 * Server-authoritative fields (sent in SALE_CREATE):
 *   - itemId
 *   - saleUnitCode
 *   - quantity
 *
 * Display-only fields (NEVER sent to the server — the server derives prices,
 * totals, taxes and accounting from the catalog at apply time):
 *   - key: stable React key + cart lookup id
 *   - displayName, displaySku, displayUnitLabel: presentation
 *   - displayPriceMinor: preview for the cart total UI; the server may price
 *     differently (multi-unit conversion, tax category, role-aware discount)
 *     so this is informational only
 */
export interface DesktopCartLine {
  // server-authoritative (sent)
  itemId: string;
  saleUnitCode: string;
  quantity: number;
  // display-only (never sent)
  key: string;
  displayName: string;
  displaySku: string | null;
  displayUnitLabel: string;
  displayPriceMinor: number;
}

/**
 * UI view model: a sellable catalog item projected for the POS browser grid.
 *
 * The desktop POS browser shows one tile per (item, sellable-unit) pair. The
 * server-authoritative identity is `(itemId, saleUnitCode)`; everything else
 * here is presentation. `availableStock` is a display hint, not an order
 * constraint — the server re-validates stock at apply time.
 */
export interface DesktopSellableItem {
  key: string;
  itemId: string;
  name: string;
  sku: string | null;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  unitCode: string;
  unitLabel: string;
  displayPriceMinor: number;
  trackStock: boolean;
  availableStock: number | null;
}

/**
 * UI view model: payment methods accepted at desktop checkout.
 *
 * The actual set of methods accepted is a server-side catalog decision; this
 * union captures only what the desktop checkout UI knows how to render. The
 * SALE_CREATE payload forwards the chosen method verbatim and the server
 * validates it.
 */
export type DesktopPaymentMethod = "CASH" | "MOMO" | "CARD" | "BANK" | "OTHER";

// ---------------------------------------------------------------------------
// Customers / Sales / Inventory (read-only list views)
// ---------------------------------------------------------------------------

/**
 * UI view model: customer master-data row for the Customers table.
 * Balances and LTV are derived server-side; this is a display snapshot.
 */
export interface DesktopCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  balanceMinor: number;
  active: boolean;
  lifetimeValueMinor: number;
  lastSeen: string | null;
}

/**
 * UI view model: sale row for the Sales history table.
 * Totals and method are server-derived; the desktop never computes them.
 */
export interface DesktopSaleRow {
  id: string;
  receiptNo: string;
  customerName: string;
  cashierName: string;
  occurredAt: string;
  totalMinor: number;
  method: string;
  status: string;
  lines: ReadonlyArray<DesktopSaleLine>;
}

/**
 * UI view model: a line inside a sale detail view.
 * Server-derived; the desktop never re-prices a posted sale.
 */
export interface DesktopSaleLine {
  name: string;
  unitLabel: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

/**
 * UI view model: inventory row for the Inventory table.
 * On-hand quantities are movement-derived server-side; the desktop renders
 * them read-only. `reorderLevel` is a display hint from the catalog.
 */
export interface DesktopInventoryRow {
  id: string;
  name: string;
  sku: string | null;
  stockUnitCode: string;
  category: string | null;
  onHand: number;
  reorderLevel: number | null;
  unitCostMinor: number | null;
  unitPriceMinor: number | null;
}

// ---------------------------------------------------------------------------
// Dashboard / Reports
// ---------------------------------------------------------------------------

/**
 * UI view model: dashboard KPI strip.
 * All figures are server-derived aggregates; the desktop never computes them.
 */
export interface DesktopDashboardKpis {
  todaySalesMinor: number;
  cashPositionMinor: number;
  outstandingCreditMinor: number;
  stockWarnings: number;
}

/**
 * UI view model: dashboard activity feed entry.
 * `tone` is a presentation hint (colour the amount positive/negative/neutral).
 */
export interface DesktopActivityItem {
  id: string;
  kind: "sale" | "expense" | "stock" | "customer" | "return";
  title: string;
  meta: string;
  amountMinor?: number;
  tone?: "positive" | "negative" | "neutral";
  at: string;
}

/**
 * UI view model: report summary card payload.
 * Read-only server-derived aggregates; never edited from the desktop.
 */
export interface DesktopReportSummary {
  sales: { revenueMinor: number; txns: number; avgMinor: number };
  profitability: { grossProfitMinor: number; marginPct: number; bestDay: string };
  inventory: { stockValueMinor: number; skus: number; lowStock: number; outOfStock: number };
  cashflow: { inTodayMinor: number; outTodayMinor: number; netTodayMinor: number };
}
