import type { Supplier } from "./supplier-sheet";

export type SupplierConfirmedUpdate = Partial<Pick<Supplier, "name" | "phone" | "email" | "address" | "active">>;
export type SupplierMutationEvent =
  | { kind: "updated"; supplier: Supplier; changes: SupplierConfirmedUpdate }
  | { kind: "deleted"; supplier: Supplier }
  | { kind: "refresh" };

export type SupplierGuard =
  | { kind: "updated"; beforeUpdatedAt: string; changes: SupplierConfirmedUpdate; confirmedAt: number }
  | { kind: "deleted"; confirmedAt: number };

export const SUPPLIER_GUARD_TTL_MS = 120_000;

export function supplierGuardKey(businessId: string, supplierId: string): string {
  return businessId + ":" + supplierId;
}

export function registerSupplierMutation(
  guards: Map<string, SupplierGuard>,
  businessId: string,
  event: SupplierMutationEvent,
  now = Date.now(),
): void {
  if (event.kind === "refresh") return;
  guards.set(supplierGuardKey(businessId, event.supplier.id),
    event.kind === "deleted"
      ? { kind: "deleted", confirmedAt: now }
      : { kind: "updated", beforeUpdatedAt: event.supplier.updatedAt,
          changes: event.changes, confirmedAt: now },
  );
}

/** Reconcile a completed server mutation against potentially stale GET data.
 * These guards are tenant-scoped and expire; no item from one business may
 * be merged into another business's supplier list.
 */
export function reconcileSupplierRows(
  rows: Supplier[],
  businessId: string,
  guards: Map<string, SupplierGuard>,
  now = Date.now(),
): Supplier[] {
  const result: Supplier[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = supplierGuardKey(businessId, row.id);
    seen.add(key);
    const guard = guards.get(key);
    if (!guard) { result.push(row); continue; }
    if (now - guard.confirmedAt >= SUPPLIER_GUARD_TTL_MS) {
      guards.delete(key); result.push(row); continue;
    }
    if (guard.kind === "deleted") continue;
    const matches = Object.entries(guard.changes)
      .every(([field, value]) => row[field as keyof Supplier] === value);
    const before = Date.parse(guard.beforeUpdatedAt);
    const incoming = Date.parse(row.updatedAt);
    if (matches || (Number.isFinite(before) && Number.isFinite(incoming) && incoming > before)) {
      guards.delete(key); result.push(row); continue;
    }
    result.push({ ...row, ...guard.changes });
  }
  // A completed deletion was acknowledged once the API stops returning it.
  for (const [key, guard] of guards) {
    if (!key.startsWith(businessId + ":")) continue;
    if (now - guard.confirmedAt >= SUPPLIER_GUARD_TTL_MS
      || (guard.kind === "deleted" && !seen.has(key))) guards.delete(key);
  }
  return result;
}
