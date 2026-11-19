export type PurchaseOrderStatus = "DRAFT" | "ISSUED" | "CANCELLED";
export interface PurchaseOrderRow {
  id: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  totalMinor: number;
  currencyCode: string;
  supplierName: string;
  createdAt: string;
  expectedDeliveryDate: string | null;
}
export interface ConfirmedPurchaseOrder {
  order: PurchaseOrderRow;
  confirmedAt: number;
}
export const PURCHASE_ORDER_GUARD_MS = 120_000;

export function rememberPurchaseOrder(
  guards: Map<string, ConfirmedPurchaseOrder>,
  scope: string,
  order: PurchaseOrderRow,
  now = Date.now(),
) {
  guards.set(scope + ":" + order.id, { order, confirmedAt: now });
}

/** A POST confirmation wins over an older GET, while eventual data convergence
 * drops the guard. Scope includes both tenant and branch, never a global ID. */
export function reconcilePurchaseOrders(
  incoming: PurchaseOrderRow[],
  guards: Map<string, ConfirmedPurchaseOrder>,
  scope: string,
  now = Date.now(),
): PurchaseOrderRow[] {
  const existing = new Set<string>();
  const result: PurchaseOrderRow[] = [];
  for (const row of incoming) {
    const key = scope + ":" + row.id;
    existing.add(key);
    const latest = guards.get(key);
    if (!latest) { result.push(row); continue; }
    if (now - latest.confirmedAt >= PURCHASE_ORDER_GUARD_MS ||
      row.status === latest.order.status ||
      // An external actor may have already moved this order forward.
      (latest.order.status === "DRAFT" && row.status !== "DRAFT")) {
      guards.delete(key);
      result.push(row);
      continue;
    }
    result.push(latest.order);
  }
  for (const [key, latest] of guards) {
    if (!key.startsWith(scope + ":")) continue;
    if (now - latest.confirmedAt >= PURCHASE_ORDER_GUARD_MS) {
      guards.delete(key);
      continue;
    }
    if (!existing.has(key)) result.push(latest.order);
  }
  return result.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
