/**
 * TradeOS Web — catalog read-model mapping.
 *
 * The API's canonical catalog contract (apps/api/src/catalog-service.ts) is:
 *
 *   CatalogItemView {
 *     active: boolean, trackStock, stockUnitCode, taxCategory,
 *     units: [{ code, label, canPurchase, canSell, canStock, defaultSalePriceMinor }],
 *     conversions: [{ fromUnitCode, toUnitCode, factor }],
 *   }
 *
 * The web MUST consume that shape as-is — `units[]` and `conversions[]` are
 * first-class multi-unit data (crate → bottle → glass, sack → bowl) and must
 * never be flattened away. This module is the single mapping layer between
 * the API response and the workspace state:
 *
 *   - `mapCatalogItem` — defensive API → CatalogItem mapping (no blind cast)
 *   - `mapInventoryItem` — /v1/inventory row → InventoryItem
 *   - `projectSellableItems` — canonical sellable projection, one entry per
 *     (item, canSell unit with a price), keyed `${itemId}:${unitCode}` — the
 *     same semantics as apps/mobile/src/pos-model.ts (the reference client).
 *   - POS carts must be keyed by that key so a crate line and a bottle line
 *     of the same item are distinct cart lines.
 *
 * Mapping is defensive by design: money arrives as integer minor units,
 * booleans as real booleans. If the server shape drifts, we surface an
 * honest runtime error rather than silently rendering `₵ undefined`.
 */

// --- Canonical API shapes (mirror of apps/api/src/catalog-service.ts) -----

export interface CatalogUnit {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  /** Integer minor units, or null when unpriced. */
  defaultSalePriceMinor: number | null;
}

export interface CatalogConversion {
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
}

export type CatalogKind = "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";

export interface CatalogItem {
  id: string;
  sku: string | null;
  name: string;
  kind: CatalogKind;
  stockUnitCode: string | null;
  trackStock: boolean;
  taxCategory: string | null;
  active: boolean;
  createdAt: string | null;
  updatedAt: string;
  units: CatalogUnit[];
  conversions: CatalogConversion[];
}

export interface InventoryItem {
  id: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  quarantine: number;
  damaged: number;
  waste: number;
  inventoryValueMinor: number;
  averageStockUnitCostMinor: number | null;
  latestStockUnitCostMinor: number | null;
}

export interface SellableItem {
  /** Stable cart-line key: `${itemId}:${unitCode}`. */
  key: string;
  itemId: string;
  name: string;
  sku: string | null;
  kind: CatalogKind;
  unitCode: string;
  unitLabel: string;
  /** Integer minor units — display-only; the server prices every sale. */
  priceMinor: number;
  trackStock: boolean;
  stockUnitCode: string | null;
  /** Last-known branch stock in stock units, or null when untracked/unknown. */
  availableStock: number | null;
}

// --- Defensive mapping -----------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNullableMinor(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  // Some transports stringify integers; accept numeric strings defensively.
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asKind(value: unknown): CatalogKind {
  return value === "SERVICE" || value === "PREPARED_PRODUCT" ? value : "PRODUCT";
}

/**
 * Maps a raw API catalog item to the canonical web model.
 * Throws when the response is structurally unusable — an honest failure
 * beats silently rendering undefined prices and phantom "Archived" states.
 */
export function mapCatalogItem(raw: unknown): CatalogItem {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) {
    throw new Error("Catalog response contained an item without an id.");
  }
  const updatedAt = asString(rec.updatedAt);
  const unitsRaw = Array.isArray(rec.units) ? rec.units : [];
  const units: CatalogUnit[] = unitsRaw.map((unitRaw) => {
    const unit = asRecord(unitRaw);
    return {
      code: asString(unit.code),
      label: asString(unit.label),
      canPurchase: asBoolean(unit.canPurchase),
      canSell: asBoolean(unit.canSell),
      canStock: asBoolean(unit.canStock),
      defaultSalePriceMinor: asNullableMinor(unit.defaultSalePriceMinor),
    };
  }).filter((unit) => unit.code.length > 0);
  const conversionsRaw = Array.isArray(rec.conversions) ? rec.conversions : [];
  const conversions: CatalogConversion[] = conversionsRaw.map((conversionRaw) => {
    const conversion = asRecord(conversionRaw);
    return {
      fromUnitCode: asString(conversion.fromUnitCode),
      toUnitCode: asString(conversion.toUnitCode),
      factor: asNumber(conversion.factor),
    };
  }).filter((conversion) => conversion.fromUnitCode.length > 0 && conversion.toUnitCode.length > 0);
  return {
    id,
    sku: asNullableString(rec.sku),
    name: asString(rec.name),
    kind: asKind(rec.kind),
    stockUnitCode: asNullableString(rec.stockUnitCode),
    trackStock: asBoolean(rec.trackStock),
    taxCategory: asNullableString(rec.taxCategory),
    active: asBoolean(rec.active),
    createdAt: asNullableString(rec.createdAt),
    updatedAt,
    units,
    conversions,
  };
}

/** Maps a raw /v1/inventory row to the branch stock read model. */
export function mapInventoryItem(raw: unknown): InventoryItem {
  const rec = asRecord(raw);
  const id = asString(rec.id);
  if (!id) {
    throw new Error("Inventory response contained an item without an id.");
  }
  return {
    id,
    sku: asNullableString(rec.sku),
    name: asString(rec.name),
    stockUnitCode: asString(rec.stockUnitCode),
    available: asNumber(rec.available),
    quarantine: asNumber(rec.quarantine),
    damaged: asNumber(rec.damaged),
    waste: asNumber(rec.waste),
    inventoryValueMinor: asNumber(rec.inventoryValueMinor),
    averageStockUnitCostMinor: asNullableNumber(rec.averageStockUnitCostMinor),
    latestStockUnitCostMinor: asNullableNumber(rec.latestStockUnitCostMinor),
  };
}

/** Indexes inventory rows by item id for O(1) joins with the catalog. */
export function indexInventory(items: readonly InventoryItem[]): Map<string, InventoryItem> {
  return new Map(items.map((item) => [item.id, item]));
}

// --- Sellable projection (mirrors apps/mobile/src/pos-model.ts) ------------

/**
 * Projects a canonical catalog + branch inventory into one sellable entry
 * per (item, sellable unit with a configured price). Active items only.
 */
export function projectSellableItems(
  catalog: readonly CatalogItem[],
  inventoryById: ReadonlyMap<string, InventoryItem>,
): SellableItem[] {
  return catalog.flatMap((item) => item.units
    .filter((unit) => item.active && unit.canSell && unit.defaultSalePriceMinor !== null)
    .map((unit) => ({
      key: `${item.id}:${unit.code}`,
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      kind: item.kind,
      unitCode: unit.code,
      unitLabel: unit.label,
      priceMinor: unit.defaultSalePriceMinor!,
      trackStock: item.trackStock,
      stockUnitCode: item.stockUnitCode,
      availableStock: item.trackStock ? (inventoryById.get(item.id)?.available ?? null) : null,
    })));
}

/** Case-insensitive search across name, SKU, unit label and unit code. */
export function filterSellableItems(items: readonly SellableItem[], query: string): SellableItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) => [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
    .some((value) => value.toLocaleLowerCase().includes(normalized)));
}

/**
 * Returns the first sellable unit of an item (order preserved from the API)
 * — used for list displays that show one representative price per item.
 */
export function primarySellableUnit(item: CatalogItem): CatalogUnit | null {
  return item.units.find((unit) => unit.canSell && unit.defaultSalePriceMinor !== null) ?? null;
}

/** All units that can be purchased (for receiving stock). */
export function purchasableUnits(item: CatalogItem): CatalogUnit[] {
  return item.units.filter((unit) => unit.canPurchase);
}

/** All units that can hold stock (candidates for stockUnitCode). */
export function stockableUnits(item: CatalogItem): CatalogUnit[] {
  return item.units.filter((unit) => unit.canStock);
}
