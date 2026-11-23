import type { SellableItem } from "./catalog-read-model";

/** Device-local favourites are isolated to the active business and branch. */
export function quickServeStorageKey(businessId: string, branchId: string): string {
  if (!businessId || !branchId) throw new Error("Quick Serve requires an active business and branch.");
  return "tradeos.quick-serve.favourites.v1:" + encodeURIComponent(businessId) + ":" + encodeURIComponent(branchId);
}

export function cleanQuickServeFavourites(value: unknown, validKeys: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set<string>();
  for (const key of value) {
    if (typeof key !== "string" || !validKeys.has(key)) continue;
    selected.add(key);
    if (selected.size >= 30) break;
  }
  return [...selected];
}

/** Prefer a branch's pinned food tiles; otherwise show prepared food first. */
export function quickServeTiles(items: readonly SellableItem[], pinnedKeys: readonly string[]): SellableItem[] {
  const pinned = new Set(pinnedKeys);
  const order = new Map(pinnedKeys.map((key, index) => [key, index]));
  return [...items].sort((a, b) => {
    const pin = Number(pinned.has(b.key)) - Number(pinned.has(a.key));
    if (pin !== 0) return pin;
    if (pinned.has(a.key) && pinned.has(b.key)) {
      const orderDifference = (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
      if (orderDifference !== 0) return orderDifference;
    }
    const prepared = Number(b.kind === "PREPARED_PRODUCT") - Number(a.kind === "PREPARED_PRODUCT");
    return prepared || a.name.localeCompare(b.name) || a.unitLabel.localeCompare(b.unitLabel);
  });
}
