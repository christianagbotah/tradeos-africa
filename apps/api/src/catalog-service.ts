import { randomUUID } from "node:crypto";
import { UnitConverter } from "@tradeos/domain";
import type { BusinessAccess } from "./auth/authorization.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

export type CatalogKind = "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";

export interface CatalogUnitInput {
  code: string;
  label: string;
  canPurchase?: boolean;
  canSell?: boolean;
  canStock?: boolean;
  defaultSalePriceMinor?: number | null;
}

export interface ConversionInput {
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
}

export interface CreateCatalogItemBody {
  businessId: string;
  name: string;
  sku?: string | null;
  kind: CatalogKind;
  trackStock?: boolean;
  stockUnitCode?: string | null;
  taxCategory?: string | null;
  units: CatalogUnitInput[];
  conversions?: ConversionInput[];
  openingStock?: { branchId: string; quantity: number };
}

export interface UpdateCatalogItemBody {
  businessId: string;
  expectedUpdatedAt: string;
  name?: string;
  sku?: string | null;
  kind?: CatalogKind;
  trackStock?: boolean;
  stockUnitCode?: string | null;
  taxCategory?: string | null;
  units?: CatalogUnitInput[];
  conversions?: ConversionInput[];
  active?: boolean;
}

export type CatalogItemView = {
  id: string;
  businessId: string;
  sku: string | null;
  name: string;
  kind: CatalogKind;
  stockUnitCode: string | null;
  trackStock: boolean;
  taxCategory: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  units: Array<{
    code: string;
    label: string;
    canPurchase: boolean;
    canSell: boolean;
    canStock: boolean;
    defaultSalePriceMinor: number | null;
  }>;
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
};

type CatalogRow = {
  id: string;
  business_id: string;
  sku: string | null;
  name: string;
  kind: CatalogKind;
  stock_unit_code: string | null;
  track_stock: boolean;
  tax_category: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type UnitRow = {
  item_id: string;
  unit_code: string;
  unit_label: string;
  can_purchase: boolean;
  can_sell: boolean;
  can_stock: boolean;
  default_sale_price_minor: string | number | null;
};

type ConversionRow = {
  item_id: string;
  from_unit_code: string;
  to_unit_code: string;
  factor: string | number;
};

type ValidCatalog = ReturnType<typeof validateCatalogInput>;
type Queryable = Pick<DatabasePool, "query"> | Pick<DatabaseClient, "query">;

export class CatalogError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "CATALOG_INVALID") {
    super(message);
  }
}

export async function listCatalogItems(db: Queryable, businessId: string): Promise<CatalogItemView[]> {
  const rows = await db.query<CatalogRow>(
    `SELECT id,business_id,sku,name,kind,stock_unit_code,track_stock,tax_category,is_active,created_at,updated_at
     FROM catalog_items WHERE business_id=$1 ORDER BY name,id`,
    [businessId],
  );
  return hydrateCatalogRows(db, rows.rows);
}

export async function loadCatalogItem(db: Queryable, businessId: string, itemId: string): Promise<CatalogItemView> {
  const result = await db.query<CatalogRow>(
    `SELECT id,business_id,sku,name,kind,stock_unit_code,track_stock,tax_category,is_active,created_at,updated_at
     FROM catalog_items WHERE business_id=$1 AND id=$2`,
    [businessId, itemId],
  );
  const row = result.rows[0];
  if (!row) throw new CatalogError("Catalog item was not found", 404, "CATALOG_ITEM_NOT_FOUND");
  return (await hydrateCatalogRows(db, [row]))[0]!;
}

export async function createCatalogItem(
  pool: DatabasePool,
  access: BusinessAccess,
  body: CreateCatalogItemBody,
): Promise<CatalogItemView> {
  const input = validateCatalogInput(body);
  assertAccessBusiness(access, input.businessId);

  const itemId = await withTransaction(pool, async (client) => {
    await assertSkuAvailable(client, input.businessId, input.sku, null);
    if (input.openingStock) await assertActiveBranch(client, input.businessId, input.openingStock.branchId);

    const id = randomUUID();
    await client.query(
      `INSERT INTO catalog_items (id,business_id,sku,name,kind,stock_unit_code,track_stock,tax_category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,input.businessId,input.sku,input.name,input.kind,input.stockUnitCode,input.trackStock,input.taxCategory],
    );
    await replaceUnitsAndConversions(client, input.businessId, id, input.units, input.conversions);

    if (input.openingStock && input.stockUnitCode) {
      await client.query(
        `INSERT INTO inventory_movements (
           business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,
           reason,reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
         ) VALUES ($1,$2,$3,$4,$5,'AVAILABLE','OPENING_BALANCE','CATALOG_ITEM',$3,$6,$7,now())`,
        [input.businessId,input.openingStock.branchId,id,input.stockUnitCode,input.openingStock.quantity,access.staffId,`catalog:${id}:opening-stock`],
      );
    }

    await writeAudit(client, {
      businessId: input.businessId,
      branchId: input.openingStock?.branchId ?? null,
      actorStaffId: access.staffId,
      eventType: "CATALOG_ITEM_CREATED",
      itemId: id,
      payload: { after: auditShape({ ...input, active: true }), changedFields: ["created"] },
    });
    return id;
  });

  return loadCatalogItem(pool, input.businessId, itemId);
}

export async function updateCatalogItem(
  pool: DatabasePool,
  access: BusinessAccess,
  itemId: string,
  body: UpdateCatalogItemBody,
): Promise<CatalogItemView> {
  const businessId = required(body.businessId, "businessId", "BUSINESS_REQUIRED");
  const expectedUpdatedAt = revision(body.expectedUpdatedAt);
  assertAccessBusiness(access, businessId);

  await withTransaction(pool, async (client) => {
    const current = await lockCatalogItem(client, businessId, itemId);
    assertRevision(current.updated_at, expectedUpdatedAt);
    const currentView = await loadCatalogItem(client, businessId, itemId);

    const draft: CreateCatalogItemBody = {
      businessId,
      name: body.name ?? currentView.name,
      sku: body.sku === undefined ? currentView.sku : body.sku,
      kind: body.kind ?? currentView.kind,
      trackStock: body.trackStock ?? currentView.trackStock,
      stockUnitCode: body.stockUnitCode === undefined ? currentView.stockUnitCode : body.stockUnitCode,
      taxCategory: body.taxCategory === undefined ? currentView.taxCategory : body.taxCategory,
      units: body.units ?? currentView.units,
      conversions: body.conversions ?? currentView.conversions,
    };
    const next = validateCatalogInput(draft);
    await assertSkuAvailable(client, businessId, next.sku, itemId);

    const hasHistory = await hasProtectedHistory(client, businessId, itemId);
    if (hasHistory && structuralMeaningChanged(currentView, next)) {
      throw new CatalogError(
        "This item has business history. Stock structure, unit identities and conversion meaning cannot be rewritten; duplicate the item for a new structure.",
        409,
        "CATALOG_STRUCTURE_LOCKED",
      );
    }

    const active = body.active ?? currentView.active;
    await client.query(
      `UPDATE catalog_items
       SET sku=$3,name=$4,kind=$5,stock_unit_code=$6,track_stock=$7,tax_category=$8,is_active=$9,updated_at=clock_timestamp()
       WHERE business_id=$1 AND id=$2`,
      [businessId,itemId,next.sku,next.name,next.kind,next.stockUnitCode,next.trackStock,next.taxCategory,active],
    );
    await replaceUnitsAndConversions(client, businessId, itemId, next.units, next.conversions);

    const after = { ...next, active };
    const before = currentView;
    const eventType = currentView.active !== active
      ? active ? "CATALOG_ITEM_REACTIVATED" : "CATALOG_ITEM_ARCHIVED"
      : "CATALOG_ITEM_UPDATED";
    await writeAudit(client, {
      businessId,
      branchId: null,
      actorStaffId: access.staffId,
      eventType,
      itemId,
      payload: { before: auditShape(before), after: auditShape(after), changedFields: changedFields(before, after) },
    });
  });

  return loadCatalogItem(pool, businessId, itemId);
}

export async function deleteUnusedCatalogItem(
  pool: DatabasePool,
  access: BusinessAccess,
  businessIdInput: string,
  itemId: string,
  expectedUpdatedAtInput: string,
): Promise<void> {
  const businessId = required(businessIdInput, "businessId", "BUSINESS_REQUIRED");
  const expectedUpdatedAt = revision(expectedUpdatedAtInput);
  assertAccessBusiness(access, businessId);

  await withTransaction(pool, async (client) => {
    const current = await lockCatalogItem(client, businessId, itemId);
    assertRevision(current.updated_at, expectedUpdatedAt);
    const currentView = await loadCatalogItem(client, businessId, itemId);
    if (await hasProtectedHistory(client, businessId, itemId)) {
      throw new CatalogError(
        "This item has sales, purchases, stock or recipe history, so it cannot be permanently deleted. Archive it instead.",
        409,
        "CATALOG_ITEM_IN_USE",
      );
    }

    await writeAudit(client, {
      businessId,
      branchId: null,
      actorStaffId: access.staffId,
      eventType: "CATALOG_ITEM_DELETED_UNUSED",
      itemId,
      payload: { before: auditShape(currentView), changedFields: ["deleted"] },
    });
    await client.query(`DELETE FROM item_unit_conversions WHERE business_id=$1 AND item_id=$2`, [businessId,itemId]);
    await client.query(`DELETE FROM catalog_item_units WHERE business_id=$1 AND item_id=$2`, [businessId,itemId]);
    const removed = await client.query(`DELETE FROM catalog_items WHERE business_id=$1 AND id=$2`, [businessId,itemId]);
    if (removed.rowCount !== 1) throw new CatalogError("Catalog item was not found", 404, "CATALOG_ITEM_NOT_FOUND");
  });
}

export function validateCatalogInput(body: CreateCatalogItemBody) {
  const businessId = required(body.businessId, "businessId", "BUSINESS_REQUIRED");
  const name = body.name?.trim();
  const sku = nullable(body.sku, 160);
  const taxCategory = nullable(body.taxCategory, 160);
  const trackStock = body.trackStock ?? false;
  const stockUnitCode = normalizeUnitCode(body.stockUnitCode) ?? null;

  if (!name || name.length > 160) throw new CatalogError("Item name is required and must be at most 160 characters");
  if (!["PRODUCT", "SERVICE", "PREPARED_PRODUCT"].includes(body.kind)) throw new CatalogError("kind must be PRODUCT, SERVICE or PREPARED_PRODUCT");
  if (!Array.isArray(body.units) || body.units.length === 0) throw new CatalogError("At least one purchase/sale/stock unit is required", 400, "UNITS_REQUIRED");

  const seenUnits = new Set<string>();
  const units = body.units.map((unit) => {
    const code = normalizeUnitCode(unit.code);
    const label = unit.label?.trim();
    if (!code || !label) throw new CatalogError("Each unit requires a code and label");
    if (label.length > 120) throw new CatalogError("Unit labels must be at most 120 characters");
    if (seenUnits.has(code)) throw new CatalogError(`Duplicate unit code ${code}`);
    seenUnits.add(code);
    const price = unit.defaultSalePriceMinor ?? null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0)) throw new CatalogError(`Sale price for ${code} must be a non-negative integer in minor currency units`);
    if (unit.canSell && price === null) throw new CatalogError(`Sellable unit ${code} requires a default sale price`, 400, "PRICE_REQUIRED");
    return {
      code,
      label,
      canPurchase: unit.canPurchase ?? false,
      canSell: unit.canSell ?? false,
      canStock: unit.canStock ?? false,
      defaultSalePriceMinor: price,
    };
  });

  if (!units.some((unit) => unit.canPurchase || unit.canSell || unit.canStock)) throw new CatalogError("At least one unit must be usable for purchase, sale or stock");
  if (body.kind === "SERVICE") {
    if (trackStock || stockUnitCode) throw new CatalogError("Services cannot carry their own stock", 400, "SERVICE_STOCK_INVALID");
    if (body.openingStock) throw new CatalogError("Services cannot have opening stock", 400, "SERVICE_OPENING_STOCK_INVALID");
  }
  if (trackStock) {
    if (body.kind !== "PRODUCT") throw new CatalogError("Only PRODUCT items can directly track stock", 400, "TRACK_STOCK_KIND_INVALID");
    if (!stockUnitCode) throw new CatalogError("Tracked products require stockUnitCode", 400, "STOCK_UNIT_REQUIRED");
    const stockUnit = units.find((unit) => unit.code === stockUnitCode);
    if (!stockUnit || !stockUnit.canStock) throw new CatalogError("stockUnitCode must reference a unit marked canStock", 400, "STOCK_UNIT_INVALID");
  }
  if (!trackStock && body.openingStock) throw new CatalogError("Opening stock requires a tracked product", 400, "OPENING_STOCK_NOT_TRACKED");

  const seenConversions = new Set<string>();
  const conversions = (body.conversions ?? []).map((conversion) => {
    const fromUnitCode = normalizeUnitCode(conversion.fromUnitCode);
    const toUnitCode = normalizeUnitCode(conversion.toUnitCode);
    if (!fromUnitCode || !toUnitCode || !seenUnits.has(fromUnitCode) || !seenUnits.has(toUnitCode)) throw new CatalogError("Conversions must reference configured units", 400, "CONVERSION_UNIT_INVALID");
    if (fromUnitCode === toUnitCode) throw new CatalogError("Conversion units must differ");
    if (!Number.isFinite(conversion.factor) || conversion.factor <= 0) throw new CatalogError("Conversion factor must be a positive finite number");
    const key = `${fromUnitCode}>${toUnitCode}`;
    if (seenConversions.has(key)) throw new CatalogError(`Duplicate conversion ${fromUnitCode} to ${toUnitCode}`);
    seenConversions.add(key);
    return { fromUnitCode, toUnitCode, factor: conversion.factor };
  });

  if (trackStock && stockUnitCode) {
    const converter = new UnitConverter(conversions.map((conversion) => ({ from: conversion.fromUnitCode, to: conversion.toUnitCode, factor: conversion.factor })));
    for (const unit of units.filter((candidate) => candidate.canPurchase || candidate.canSell)) {
      if (unit.code === stockUnitCode) continue;
      try { converter.convert(1, unit.code, stockUnitCode); }
      catch { throw new CatalogError(`Unit ${unit.code} cannot convert to stock unit ${stockUnitCode}`, 400, "CONVERSION_PATH_REQUIRED"); }
    }
  }

  let openingStock: { branchId: string; quantity: number } | null = null;
  if (body.openingStock) {
    const branchId = required(body.openingStock.branchId, "branchId");
    if (!Number.isFinite(body.openingStock.quantity) || body.openingStock.quantity <= 0) throw new CatalogError("Opening stock quantity must be positive");
    openingStock = { branchId, quantity: body.openingStock.quantity };
  }
  return { businessId,name,sku,kind:body.kind,trackStock,stockUnitCode,taxCategory,units,conversions,openingStock };
}

async function hydrateCatalogRows(db: Queryable, rows: CatalogRow[]): Promise<CatalogItemView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const units = await db.query<UnitRow>(
    `SELECT item_id,unit_code,unit_label,can_purchase,can_sell,can_stock,default_sale_price_minor
     FROM catalog_item_units WHERE item_id=ANY($1::uuid[]) ORDER BY item_id,created_at,id`,
    [ids],
  );
  const conversions = await db.query<ConversionRow>(
    `SELECT item_id,from_unit_code,to_unit_code,factor
     FROM item_unit_conversions WHERE item_id=ANY($1::uuid[]) ORDER BY item_id,created_at,id`,
    [ids],
  );
  return rows.map((row) => ({
    id: row.id,
    businessId: row.business_id,
    sku: row.sku,
    name: row.name,
    kind: row.kind,
    stockUnitCode: row.stock_unit_code,
    trackStock: row.track_stock,
    taxCategory: row.tax_category,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    units: units.rows.filter((unit) => unit.item_id === row.id).map((unit) => ({
      code: unit.unit_code,
      label: unit.unit_label,
      canPurchase: unit.can_purchase,
      canSell: unit.can_sell,
      canStock: unit.can_stock,
      defaultSalePriceMinor: unit.default_sale_price_minor === null ? null : Number(unit.default_sale_price_minor),
    })),
    conversions: conversions.rows.filter((conversion) => conversion.item_id === row.id).map((conversion) => ({
      fromUnitCode: conversion.from_unit_code,
      toUnitCode: conversion.to_unit_code,
      factor: Number(conversion.factor),
    })),
  }));
}

async function replaceUnitsAndConversions(client: DatabaseClient, businessId: string, itemId: string, units: ValidCatalog["units"], conversions: ValidCatalog["conversions"]) {
  await client.query(`DELETE FROM item_unit_conversions WHERE business_id=$1 AND item_id=$2`, [businessId,itemId]);
  await client.query(`DELETE FROM catalog_item_units WHERE business_id=$1 AND item_id=$2`, [businessId,itemId]);
  for (const unit of units) {
    await client.query(
      `INSERT INTO catalog_item_units (business_id,item_id,unit_code,unit_label,can_purchase,can_sell,can_stock,default_sale_price_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [businessId,itemId,unit.code,unit.label,unit.canPurchase,unit.canSell,unit.canStock,unit.defaultSalePriceMinor],
    );
  }
  for (const conversion of conversions) {
    await client.query(
      `INSERT INTO item_unit_conversions (business_id,item_id,from_unit_code,to_unit_code,factor) VALUES ($1,$2,$3,$4,$5)`,
      [businessId,itemId,conversion.fromUnitCode,conversion.toUnitCode,conversion.factor],
    );
  }
}

async function lockCatalogItem(client: DatabaseClient, businessId: string, itemId: string): Promise<CatalogRow> {
  const result = await client.query<CatalogRow>(
    `SELECT id,business_id,sku,name,kind,stock_unit_code,track_stock,tax_category,is_active,created_at,updated_at
     FROM catalog_items WHERE business_id=$1 AND id=$2 FOR UPDATE`,
    [businessId,itemId],
  );
  const row = result.rows[0];
  if (!row) throw new CatalogError("Catalog item was not found", 404, "CATALOG_ITEM_NOT_FOUND");
  return row;
}

async function assertSkuAvailable(client: DatabaseClient, businessId: string, sku: string | null, itemId: string | null) {
  if (!sku) return;
  const result = await client.query(
    `SELECT id FROM catalog_items WHERE business_id=$1 AND sku=$2 AND ($3::uuid IS NULL OR id<>$3::uuid)`,
    [businessId,sku,itemId],
  );
  if ((result.rowCount ?? 0) > 0) throw new CatalogError("SKU already exists in this business", 409, "SKU_EXISTS");
}

async function assertActiveBranch(client: DatabaseClient, businessId: string, branchId: string) {
  const result = await client.query(`SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true FOR SHARE`, [branchId,businessId]);
  if (result.rowCount !== 1) throw new CatalogError("Opening-stock branch was not found for this business", 400, "BRANCH_NOT_FOUND");
}

async function hasProtectedHistory(client: DatabaseClient, businessId: string, itemId: string): Promise<boolean> {
  const result = await client.query<{ protected: boolean }>(
    `SELECT (
       EXISTS(SELECT 1 FROM sale_lines WHERE business_id=$1 AND item_id=$2) OR
       EXISTS(SELECT 1 FROM purchase_lines WHERE business_id=$1 AND item_id=$2) OR
       EXISTS(SELECT 1 FROM inventory_movements WHERE business_id=$1 AND item_id=$2) OR
       EXISTS(SELECT 1 FROM inventory_valuations WHERE business_id=$1 AND item_id=$2) OR
       EXISTS(SELECT 1 FROM consumption_definitions WHERE business_id=$1 AND output_item_id=$2) OR
       EXISTS(SELECT 1 FROM consumption_components cc JOIN consumption_definitions cd ON cd.id=cc.definition_id WHERE cd.business_id=$1 AND cc.component_item_id=$2)
     ) AS protected`,
    [businessId,itemId],
  );
  return Boolean(result.rows[0]?.protected);
}

function structuralMeaningChanged(current: CatalogItemView, next: ValidCatalog): boolean {
  if (current.kind !== next.kind || current.trackStock !== next.trackStock || current.stockUnitCode !== next.stockUnitCode) return true;
  const currentCodes = current.units.map((unit) => unit.code).sort();
  const nextCodes = next.units.map((unit) => unit.code).sort();
  if (JSON.stringify(currentCodes) !== JSON.stringify(nextCodes)) return true;
  const currentConversions = current.conversions
    .map((conversion) => `${conversion.fromUnitCode}>${conversion.toUnitCode}:${conversion.factor}`)
    .sort();
  const nextConversions = next.conversions
    .map((conversion) => `${conversion.fromUnitCode}>${conversion.toUnitCode}:${conversion.factor}`)
    .sort();
  return JSON.stringify(currentConversions) !== JSON.stringify(nextConversions);
}

function assertRevision(actual: Date, expected: string) {
  if (actual.toISOString() !== expected) {
    throw new CatalogError("This item was changed on another device. Reload the latest version before saving your changes.", 409, "STALE_VERSION");
  }
}

function revision(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) throw new CatalogError("expectedUpdatedAt must be a valid revision timestamp", 400, "REVISION_REQUIRED");
  return new Date(normalized).toISOString();
}

function assertAccessBusiness(access: BusinessAccess, businessId: string) {
  if (access.businessId !== businessId) throw new CatalogError("Business access does not match the catalog item", 403, "BUSINESS_ACCESS_DENIED");
}

function required(value: string | undefined, name: string, code = "CATALOG_INVALID"): string {
  const normalized = value?.trim();
  if (!normalized) throw new CatalogError(`${name} is required`, 400, code);
  return normalized;
}

function nullable(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > max) throw new CatalogError(`Value must be at most ${max} characters`);
  return normalized;
}

function normalizeUnitCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  if (!normalized) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) throw new CatalogError("Unit codes may contain lowercase letters, numbers, hyphens and underscores only");
  return normalized;
}

function auditShape(item: Partial<CatalogItemView> & Partial<ValidCatalog> & { active?: boolean }) {
  return {
    name: item.name,
    sku: item.sku ?? null,
    kind: item.kind,
    trackStock: item.trackStock,
    stockUnitCode: item.stockUnitCode ?? null,
    taxCategory: item.taxCategory ?? null,
    active: item.active,
    unitCodes: item.units?.map((unit) => unit.code) ?? [],
  };
}

function changedFields(before: CatalogItemView, after: ValidCatalog & { active: boolean }): string[] {
  const fields: string[] = [];
  if (before.name !== after.name) fields.push("name");
  if (before.sku !== after.sku) fields.push("sku");
  if (before.kind !== after.kind) fields.push("kind");
  if (before.trackStock !== after.trackStock) fields.push("trackStock");
  if (before.stockUnitCode !== after.stockUnitCode) fields.push("stockUnitCode");
  if (before.taxCategory !== after.taxCategory) fields.push("taxCategory");
  if (before.active !== after.active) fields.push("active");
  if (JSON.stringify(before.units) !== JSON.stringify(after.units)) fields.push("units");
  if (JSON.stringify(before.conversions) !== JSON.stringify(after.conversions)) fields.push("conversions");
  return fields;
}

async function writeAudit(client: DatabaseClient, input: {
  businessId: string;
  branchId: string | null;
  actorStaffId: string | null;
  eventType: string;
  itemId: string;
  payload: unknown;
}) {
  await client.query(
    `INSERT INTO audit_events (business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,$4,'CATALOG_ITEM',$5,$6::jsonb)`,
    [input.businessId,input.branchId,input.actorStaffId,input.eventType,input.itemId,JSON.stringify(input.payload)],
  );
}
