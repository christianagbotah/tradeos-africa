import { randomUUID } from "node:crypto";
import { UnitConverter } from "@tradeos/domain";
import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

const CATALOG_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const CATALOG_READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

type CatalogKind = "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";

interface CatalogUnitInput {
  code: string;
  label: string;
  canPurchase?: boolean;
  canSell?: boolean;
  canStock?: boolean;
  defaultSalePriceMinor?: number;
}

interface ConversionInput {
  fromUnitCode: string;
  toUnitCode: string;
  factor: number;
}

interface CreateCatalogItemBody {
  businessId: string;
  name: string;
  sku?: string;
  kind: CatalogKind;
  trackStock?: boolean;
  stockUnitCode?: string;
  taxCategory?: string;
  units: CatalogUnitInput[];
  conversions?: ConversionInput[];
  openingStock?: {
    branchId: string;
    quantity: number;
  };
}

export function registerCatalogRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: CreateCatalogItemBody }>("/v1/catalog/items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const input = validateCreateItem(request.body);
      const access = await requireBusinessRole(pool, auth, input.businessId, CATALOG_WRITE_ROLES);

      const created = await withTransaction(pool, async (client) => {
        if (input.openingStock) {
          const branch = await client.query(
            `SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true FOR SHARE`,
            [input.openingStock.branchId, input.businessId],
          );
          if (branch.rowCount !== 1) {
            throw new CatalogError("Opening-stock branch was not found for this business", 400, "BRANCH_NOT_FOUND");
          }
        }

        if (input.sku) {
          const existingSku = await client.query(
            `SELECT id FROM catalog_items WHERE business_id=$1 AND sku=$2`,
            [input.businessId, input.sku],
          );
          if ((existingSku.rowCount ?? 0) > 0) {
            throw new CatalogError("SKU already exists in this business", 409, "SKU_EXISTS");
          }
        }

        const itemId = randomUUID();
        await client.query(
          `INSERT INTO catalog_items (
             id,business_id,sku,name,kind,stock_unit_code,track_stock,tax_category
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            itemId,
            input.businessId,
            input.sku,
            input.name,
            input.kind,
            input.stockUnitCode,
            input.trackStock,
            input.taxCategory,
          ],
        );

        for (const unit of input.units) {
          await client.query(
            `INSERT INTO catalog_item_units (
               business_id,item_id,unit_code,unit_label,can_purchase,can_sell,can_stock,default_sale_price_minor
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              input.businessId,
              itemId,
              unit.code,
              unit.label,
              unit.canPurchase,
              unit.canSell,
              unit.canStock,
              unit.defaultSalePriceMinor,
            ],
          );
        }

        for (const conversion of input.conversions) {
          await client.query(
            `INSERT INTO item_unit_conversions (
               business_id,item_id,from_unit_code,to_unit_code,factor
             ) VALUES ($1,$2,$3,$4,$5)`,
            [
              input.businessId,
              itemId,
              conversion.fromUnitCode,
              conversion.toUnitCode,
              conversion.factor,
            ],
          );
        }

        if (input.openingStock && input.stockUnitCode) {
          await client.query(
            `INSERT INTO inventory_movements (
               business_id,branch_id,item_id,stock_unit_code,quantity_delta,location_type,
               reason,reference_type,reference_id,actor_staff_id,idempotency_key,occurred_at
             ) VALUES ($1,$2,$3,$4,$5,'AVAILABLE','OPENING_BALANCE','CATALOG_ITEM',$3,$6,$7,now())`,
            [
              input.businessId,
              input.openingStock.branchId,
              itemId,
              input.stockUnitCode,
              input.openingStock.quantity,
              access.staffId,
              `catalog:${itemId}:opening-stock`,
            ],
          );
        }

        await client.query(
          `INSERT INTO audit_events (
             business_id,branch_id,actor_staff_id,event_type,entity_type,entity_id,payload
           ) VALUES ($1,$2,$3,'CATALOG_ITEM_CREATED','CATALOG_ITEM',$4,$5::jsonb)`,
          [
            input.businessId,
            input.openingStock?.branchId ?? null,
            access.staffId,
            itemId,
            JSON.stringify({
              kind: input.kind,
              sku: input.sku,
              stockUnitCode: input.stockUnitCode,
              unitCodes: input.units.map((unit) => unit.code),
            }),
          ],
        );

        return { itemId };
      });

      return reply.code(201).send({
        item: {
          id: created.itemId,
          businessId: input.businessId,
          name: input.name,
          sku: input.sku,
          kind: input.kind,
          trackStock: input.trackStock,
          stockUnitCode: input.stockUnitCode,
          taxCategory: input.taxCategory,
          units: input.units,
          conversions: input.conversions,
        },
      });
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });

  app.get<{ Querystring: { businessId?: string } }>("/v1/catalog/items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = request.query.businessId?.trim();
      if (!businessId) throw new CatalogError("businessId is required", 400, "BUSINESS_REQUIRED");
      await requireBusinessRole(pool, auth, businessId, CATALOG_READ_ROLES);

      const items = await pool.query<{
        id: string;
        sku: string | null;
        name: string;
        kind: CatalogKind;
        stock_unit_code: string | null;
        track_stock: boolean;
        tax_category: string | null;
        is_active: boolean;
      }>(
        `SELECT id,sku,name,kind,stock_unit_code,track_stock,tax_category,is_active
         FROM catalog_items
         WHERE business_id=$1
         ORDER BY name,id`,
        [businessId],
      );

      const itemIds = items.rows.map((item) => item.id);
      const units = itemIds.length === 0 ? { rows: [] as UnitRow[] } : await pool.query<UnitRow>(
        `SELECT item_id,unit_code,unit_label,can_purchase,can_sell,can_stock,default_sale_price_minor
         FROM catalog_item_units
         WHERE item_id = ANY($1::uuid[])
         ORDER BY item_id,created_at`,
        [itemIds],
      );
      const conversions = itemIds.length === 0 ? { rows: [] as ConversionRow[] } : await pool.query<ConversionRow>(
        `SELECT item_id,from_unit_code,to_unit_code,factor
         FROM item_unit_conversions
         WHERE item_id = ANY($1::uuid[])
         ORDER BY item_id,created_at`,
        [itemIds],
      );

      return {
        items: items.rows.map((item) => ({
          id: item.id,
          sku: item.sku,
          name: item.name,
          kind: item.kind,
          stockUnitCode: item.stock_unit_code,
          trackStock: item.track_stock,
          taxCategory: item.tax_category,
          active: item.is_active,
          units: units.rows.filter((unit) => unit.item_id === item.id).map((unit) => ({
            code: unit.unit_code,
            label: unit.unit_label,
            canPurchase: unit.can_purchase,
            canSell: unit.can_sell,
            canStock: unit.can_stock,
            defaultSalePriceMinor: unit.default_sale_price_minor === null ? null : Number(unit.default_sale_price_minor),
          })),
          conversions: conversions.rows.filter((conversion) => conversion.item_id === item.id).map((conversion) => ({
            fromUnitCode: conversion.from_unit_code,
            toUnitCode: conversion.to_unit_code,
            factor: Number(conversion.factor),
          })),
        })),
      };
    } catch (error) {
      return sendCatalogError(request, reply, error);
    }
  });
}

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

class CatalogError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "CATALOG_INVALID") {
    super(message);
  }
}

function validateCreateItem(body: CreateCatalogItemBody) {
  const businessId = body.businessId?.trim();
  const name = body.name?.trim();
  const sku = body.sku?.trim() || null;
  const taxCategory = body.taxCategory?.trim() || null;
  const trackStock = body.trackStock ?? false;
  const stockUnitCode = normalizeUnitCode(body.stockUnitCode) ?? null;

  if (!businessId) throw new CatalogError("businessId is required", 400, "BUSINESS_REQUIRED");
  if (!name || name.length > 160) throw new CatalogError("Item name is required and must be at most 160 characters");
  if (!["PRODUCT", "SERVICE", "PREPARED_PRODUCT"].includes(body.kind)) {
    throw new CatalogError("kind must be PRODUCT, SERVICE or PREPARED_PRODUCT");
  }
  if (!Array.isArray(body.units) || body.units.length === 0) {
    throw new CatalogError("At least one purchase/sale/stock unit is required", 400, "UNITS_REQUIRED");
  }

  const seenUnits = new Set<string>();
  const units = body.units.map((unit) => {
    const code = normalizeUnitCode(unit.code);
    const label = unit.label?.trim();
    if (!code || !label) throw new CatalogError("Each unit requires a code and label");
    if (seenUnits.has(code)) throw new CatalogError(`Duplicate unit code ${code}`);
    seenUnits.add(code);
    if (unit.defaultSalePriceMinor !== undefined && (!Number.isSafeInteger(unit.defaultSalePriceMinor) || unit.defaultSalePriceMinor < 0)) {
      throw new CatalogError(`Sale price for ${code} must be a non-negative integer in minor currency units`);
    }
    if (unit.canSell && unit.defaultSalePriceMinor === undefined) {
      throw new CatalogError(`Sellable unit ${code} requires a default sale price`, 400, "PRICE_REQUIRED");
    }
    return {
      code,
      label,
      canPurchase: unit.canPurchase ?? false,
      canSell: unit.canSell ?? false,
      canStock: unit.canStock ?? false,
      defaultSalePriceMinor: unit.defaultSalePriceMinor ?? null,
    };
  });

  if (!units.some((unit) => unit.canPurchase || unit.canSell || unit.canStock)) {
    throw new CatalogError("At least one unit must be usable for purchase, sale or stock");
  }

  if (body.kind === "SERVICE") {
    if (trackStock || stockUnitCode) throw new CatalogError("Services cannot carry their own stock", 400, "SERVICE_STOCK_INVALID");
    if (body.openingStock) throw new CatalogError("Services cannot have opening stock", 400, "SERVICE_OPENING_STOCK_INVALID");
  }

  if (trackStock) {
    if (body.kind !== "PRODUCT") throw new CatalogError("Only PRODUCT items can directly track stock", 400, "TRACK_STOCK_KIND_INVALID");
    if (!stockUnitCode) throw new CatalogError("Tracked products require stockUnitCode", 400, "STOCK_UNIT_REQUIRED");
    const stockUnit = units.find((unit) => unit.code === stockUnitCode);
    if (!stockUnit || !stockUnit.canStock) {
      throw new CatalogError("stockUnitCode must reference a unit marked canStock", 400, "STOCK_UNIT_INVALID");
    }
  }

  if (!trackStock && body.openingStock) {
    throw new CatalogError("Opening stock requires a tracked product", 400, "OPENING_STOCK_NOT_TRACKED");
  }

  const conversions = (body.conversions ?? []).map((conversion) => {
    const fromUnitCode = normalizeUnitCode(conversion.fromUnitCode);
    const toUnitCode = normalizeUnitCode(conversion.toUnitCode);
    if (!fromUnitCode || !toUnitCode || !seenUnits.has(fromUnitCode) || !seenUnits.has(toUnitCode)) {
      throw new CatalogError("Conversions must reference configured units", 400, "CONVERSION_UNIT_INVALID");
    }
    if (fromUnitCode === toUnitCode) throw new CatalogError("Conversion units must differ");
    if (!Number.isFinite(conversion.factor) || conversion.factor <= 0) {
      throw new CatalogError("Conversion factor must be a positive finite number");
    }
    return { fromUnitCode, toUnitCode, factor: conversion.factor };
  });

  if (trackStock && stockUnitCode) {
    const converter = new UnitConverter(conversions.map((conversion) => ({
      from: conversion.fromUnitCode,
      to: conversion.toUnitCode,
      factor: conversion.factor,
    })));
    for (const unit of units.filter((candidate) => candidate.canPurchase || candidate.canSell)) {
      if (unit.code === stockUnitCode) continue;
      try {
        converter.convert(1, unit.code, stockUnitCode);
      } catch {
        throw new CatalogError(
          `Unit ${unit.code} cannot convert to stock unit ${stockUnitCode}`,
          400,
          "CONVERSION_PATH_REQUIRED",
        );
      }
    }
  }

  let openingStock: { branchId: string; quantity: number } | null = null;
  if (body.openingStock) {
    if (!body.openingStock.branchId?.trim()) throw new CatalogError("Opening stock requires branchId");
    if (!Number.isFinite(body.openingStock.quantity) || body.openingStock.quantity <= 0) {
      throw new CatalogError("Opening stock quantity must be positive");
    }
    openingStock = { branchId: body.openingStock.branchId.trim(), quantity: body.openingStock.quantity };
  }

  return {
    businessId,
    name,
    sku,
    kind: body.kind,
    trackStock,
    stockUnitCode,
    taxCategory,
    units,
    conversions,
    openingStock,
  };
}

function normalizeUnitCode(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  if (!normalized) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(normalized)) {
    throw new CatalogError("Unit codes may contain lowercase letters, numbers, hyphens and underscores only");
  }
  return normalized;
}

function sendCatalogError(request: { log: { error: (error: unknown) => void } }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown) {
  if (error instanceof CatalogError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "CATALOG_FAILED", message: "The catalog request could not be completed." });
}
