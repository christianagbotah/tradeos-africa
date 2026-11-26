import type { CatalogItem } from "../../../lib/catalog-read-model";

export type ConfirmedCatalogFields = Partial<Pick<CatalogItem,
  "name" | "sku" | "kind" | "trackStock" | "stockUnitCode" | "units" | "conversions" | "active"
>>;
export interface ConfirmedCatalogRevision {
  fields: ConfirmedCatalogFields;
  previousUpdatedAt: string;
  confirmedAt: number;
}
const MAX_GUARD_AGE_MS = 120_000;
export type ConfirmedCatalogDeletion = { confirmedAt: number };
export function registerConfirmedCatalogDeletion(
  deletions: Map<string, ConfirmedCatalogDeletion>,
  businessId: string,
  itemId: string,
  now = Date.now(),
) {
  deletions.set(businessId + ":" + itemId, { confirmedAt: now });
}

export function registerConfirmedCatalogUpdate(
  confirmed: Map<string, ConfirmedCatalogRevision>,
  businessId: string,
  item: CatalogItem,
  fields: ConfirmedCatalogFields,
  now = Date.now(),
) {
  confirmed.set(businessId + ":" + item.id, {
    fields, previousUpdatedAt: item.updatedAt, confirmedAt: now,
  });
}

export function reconcileConfirmedCatalog(
  rows: CatalogItem[],
  businessId: string,
  confirmed: Map<string, ConfirmedCatalogRevision>,
  now = Date.now(),
  deletions?: Map<string, ConfirmedCatalogDeletion>,
): CatalogItem[] {
  const seen = new Set<string>();
  const visible: CatalogItem[] = [];
  for (const item of rows) {
    const key = businessId + ":" + item.id;
    seen.add(key);
    const deletion = deletions?.get(key);
    if (deletion) {
      if (now - deletion.confirmedAt < MAX_GUARD_AGE_MS) continue;
      deletions?.delete(key);
    }
    const update = confirmed.get(key);
    if (!update) { visible.push(item); continue; }
    const fieldsMatch = Object.entries(update.fields).every(([field, value]) =>
      JSON.stringify(item[field as keyof CatalogItem]) === JSON.stringify(value));
    const oldRev = Date.parse(update.previousUpdatedAt);
    const newRev = Date.parse(item.updatedAt);
    if (now - update.confirmedAt >= MAX_GUARD_AGE_MS ||
      fieldsMatch ||
      (Number.isFinite(oldRev) && Number.isFinite(newRev) && newRev > oldRev)) {
      confirmed.delete(key);
      visible.push(item);
      continue;
    }
    visible.push({ ...item, ...update.fields });
  }
  if (deletions) {
    for (const [key] of deletions) {
      if (key.startsWith(businessId + ":") && !seen.has(key)) deletions.delete(key);
    }
  }
  return visible;
}
