import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];
const SUPPLIER_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"];

type SupplierInput = {
  businessId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
};
type SupplierPatch = Partial<Omit<SupplierInput, "businessId">> & { businessId: string; active?: boolean };

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  balance_minor?: string | number;
};

export function registerSupplierInventoryRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: { businessId?: string; query?: string; limit?: string } }>("/v1/suppliers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const query = request.query.query?.trim() ?? "";
      const result = await pool.query<SupplierRow>(
        `SELECT id,name,phone,email,address,is_active,created_at,updated_at,
           (SELECT COALESCE(SUM(balance_delta_minor),0) FROM supplier_payable_ledger l WHERE l.business_id=suppliers.business_id AND l.supplier_id=suppliers.id) AS balance_minor
         FROM suppliers
         WHERE business_id=$1 AND ($2='' OR name ILIKE $3 OR COALESCE(phone,'') ILIKE $3 OR COALESCE(email,'') ILIKE $3)
         ORDER BY is_active DESC,name,id LIMIT $4`,
        [businessId,query,`%${query}%`,clampLimit(request.query.limit)],
      );
      return { suppliers: result.rows.map(toSupplier) };
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get<{ Params: { supplierId: string }; Querystring: { businessId?: string } }>("/v1/suppliers/:supplierId", async (request,reply) => {
    try {
      const auth = await authenticateAccessToken(pool,request.headers.authorization);
      const businessId = required(request.query.businessId,"businessId");
      await requireBusinessRole(pool,auth,businessId,READ_ROLES);
      const supplier = await loadSupplier(pool,businessId,request.params.supplierId);
      const balance = await pool.query<{balance:string}>(`SELECT COALESCE(SUM(balance_delta_minor),0) AS balance FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2`,[businessId,supplier.id]);
      const entries = await pool.query<{id:string;branch_id:string;currency_code:string;balance_delta_minor:string;method:string;source_type:string;source_id:string;actor_staff_id:string;occurred_at:Date}>(`SELECT id,branch_id,currency_code,balance_delta_minor,method,source_type,source_id,actor_staff_id,occurred_at FROM supplier_payable_ledger WHERE business_id=$1 AND supplier_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 200`,[businessId,supplier.id]);
      return {supplier:{...supplier,balanceMinor:Number(balance.rows[0]!.balance)},ledger:entries.rows.map(row=>({id:row.id,branchId:row.branch_id,currencyCode:row.currency_code,balanceDeltaMinor:Number(row.balance_delta_minor),method:row.method,sourceType:row.source_type,sourceId:row.source_id,actorStaffId:row.actor_staff_id,occurredAt:row.occurred_at.toISOString()}))};
    } catch(error) {return sendError(request,reply,error);}
  });

  app.post<{ Body: SupplierInput }>("/v1/suppliers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const input = validateSupplier(request.body);
      const access = await requireBusinessRole(pool, auth, input.businessId, SUPPLIER_WRITE_ROLES);
      const id = await withTransaction(pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO suppliers (business_id,name,phone,email,address) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [input.businessId,input.name,input.phone,input.email,input.address],
        );
        const supplierId = result.rows[0]?.id;
        if (!supplierId) throw new SupplierError("Supplier could not be created", 500, "SUPPLIER_CREATE_FAILED");
        await supplierAudit(client, input.businessId, access, "SUPPLIER_CREATED", supplierId, { name: input.name });
        return supplierId;
      });
      return reply.code(201).send({ supplier: await loadSupplier(pool, input.businessId, id) });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.patch<{ Params: { supplierId: string }; Body: SupplierPatch }>("/v1/suppliers/:supplierId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, SUPPLIER_WRITE_ROLES);
      const current = await loadSupplier(pool, businessId, request.params.supplierId);
      const next = validateSupplier({
        businessId,
        name: request.body.name ?? current.name,
        phone: request.body.phone === undefined ? current.phone : request.body.phone,
        email: request.body.email === undefined ? current.email : request.body.email,
        address: request.body.address === undefined ? current.address : request.body.address,
      });
      const active = request.body.active ?? current.active;
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE suppliers SET name=$3,phone=$4,email=$5,address=$6,is_active=$7,updated_at=now()
           WHERE id=$1 AND business_id=$2`,
          [request.params.supplierId,businessId,next.name,next.phone,next.email,next.address,active],
        );
        if (updated.rowCount !== 1) throw new SupplierError("Supplier was not found", 404, "SUPPLIER_NOT_FOUND");
        await supplierAudit(client,businessId,access,"SUPPLIER_UPDATED",request.params.supplierId,{ name: next.name, active });
      });
      return { supplier: await loadSupplier(pool,businessId,request.params.supplierId) };
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get<{ Querystring: { businessId?: string; branchId?: string; query?: string } }>("/v1/inventory", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId,"businessId");
      const branchId = required(request.query.branchId,"branchId");
      await requireBusinessRole(pool,auth,businessId,READ_ROLES);
      await assertBranch(pool,businessId,branchId);
      const query = request.query.query?.trim() ?? "";
      const result = await pool.query<{
        id: string; sku: string | null; name: string; stock_unit_code: string;
        available: string | number; quarantine: string | number; damaged: string | number; waste: string | number;
        latest_stock_unit_cost_minor: string | number | null;
        inventory_value_minor: string | number;
      }>(
        `SELECT ci.id,ci.sku,ci.name,ci.stock_unit_code,
                COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='AVAILABLE'),0) AS available,
                COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='QUARANTINE'),0) AS quarantine,
                COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='DAMAGED'),0) AS damaged,
                COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='WASTE'),0) AS waste,
                (SELECT v.value_minor / NULLIF(v.quantity,0) FROM inventory_valuations v
                 WHERE v.business_id=ci.business_id AND v.item_id=ci.id AND v.branch_id=$2 AND v.location_type='AVAILABLE') AS latest_stock_unit_cost_minor,
                COALESCE((SELECT SUM(value_minor) FROM inventory_valuations v WHERE v.business_id=ci.business_id AND v.item_id=ci.id AND v.branch_id=$2),0) AS inventory_value_minor
         FROM catalog_items ci
         LEFT JOIN inventory_movements im ON im.business_id=ci.business_id AND im.item_id=ci.id AND im.branch_id=$2
         WHERE ci.business_id=$1 AND ci.is_active=true AND ci.kind='PRODUCT' AND ci.track_stock=true
           AND ($3='' OR ci.name ILIKE $4 OR COALESCE(ci.sku,'') ILIKE $4)
         GROUP BY ci.id,ci.sku,ci.name,ci.stock_unit_code,ci.business_id
         ORDER BY ci.name,ci.id`,
        [businessId,branchId,query,`%${query}%`],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,sku: row.sku,name: row.name,stockUnitCode: row.stock_unit_code,
          available: Number(row.available),quarantine: Number(row.quarantine),damaged: Number(row.damaged),waste: Number(row.waste),
          inventoryValueMinor: Number(row.inventory_value_minor),
          averageStockUnitCostMinor: row.latest_stock_unit_cost_minor === null ? null : Number(row.latest_stock_unit_cost_minor),
          latestStockUnitCostMinor: row.latest_stock_unit_cost_minor === null ? null : Math.round(Number(row.latest_stock_unit_cost_minor)),
        })),
      };
    } catch (error) {
      return sendError(request,reply,error);
    }
  });

  app.get<{ Querystring: { businessId?: string; branchId?: string; limit?: string } }>("/v1/purchases", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId,"businessId");
      const branchId = required(request.query.branchId,"branchId");
      await requireBusinessRole(pool,auth,businessId,READ_ROLES);
      await assertBranch(pool,businessId,branchId);
      const result = await pool.query<{
        id: string; supplier_id: string; supplier_name: string; supplier_reference: string | null;
        total_minor: string | number; settlement_method: string; currency_code: string; received_at: Date; receiver_name: string | null; line_count: string | number;
      }>(
        `SELECT p.id,p.supplier_id,s.name AS supplier_name,p.supplier_reference,p.total_minor,p.settlement_method,p.currency_code,p.received_at,
                st.display_name AS receiver_name,(SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id=p.id) AS line_count
         FROM purchases p JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN staff st ON st.id=p.received_by_staff_id
         WHERE p.business_id=$1 AND p.branch_id=$2 AND p.status='RECEIVED'
         ORDER BY p.received_at DESC,p.id DESC LIMIT $3`,
        [businessId,branchId,clampLimit(request.query.limit,25)],
      );
      return { purchases: result.rows.map((row) => ({
        id: row.id,supplierId: row.supplier_id,supplierName: row.supplier_name,supplierReference: row.supplier_reference,
        totalMinor: Number(row.total_minor),settlementMethod: row.settlement_method,currencyCode: row.currency_code,receivedAt: row.received_at.toISOString(),
        receiverName: row.receiver_name,lineCount: Number(row.line_count),
      })) };
    } catch (error) {
      return sendError(request,reply,error);
    }
  });
}

async function loadSupplier(pool: DatabasePool,businessId: string,supplierId: string) {
  const result = await pool.query<SupplierRow>(
    `SELECT id,name,phone,email,address,is_active,created_at,updated_at FROM suppliers WHERE id=$1 AND business_id=$2`,
    [supplierId,businessId],
  );
  const row = result.rows[0];
  if (!row) throw new SupplierError("Supplier was not found",404,"SUPPLIER_NOT_FOUND");
  return toSupplier(row);
}

function toSupplier(row: SupplierRow) {
  return { balanceMinor: Number(row.balance_minor ?? 0), id: row.id,name: row.name,phone: row.phone,email: row.email,address: row.address,active: row.is_active,
    createdAt: row.created_at.toISOString(),updatedAt: row.updated_at.toISOString() };
}

function validateSupplier(body: SupplierInput) {
  const businessId = required(body.businessId,"businessId");
  const name = body.name?.trim();
  if (!name || name.length > 180) throw new SupplierError("Supplier name is required and must be at most 180 characters");
  const phone = nullable(body.phone,40);
  const email = nullable(body.email,254)?.toLowerCase() ?? null;
  if (email && !email.includes("@")) throw new SupplierError("Supplier email is invalid");
  return { businessId,name,phone,email,address: nullable(body.address,500) };
}

function nullable(value: string | null | undefined,max: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > max) throw new SupplierError(`Value must be at most ${max} characters`);
  return normalized;
}

function required(value: string | undefined,name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new SupplierError(`${name} is required`);
  return normalized;
}

function clampLimit(value: string | undefined,fallback=50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed,200);
}

async function assertBranch(pool: DatabasePool,businessId: string,branchId: string): Promise<void> {
  const result = await pool.query(`SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`,[branchId,businessId]);
  if (result.rowCount !== 1) throw new SupplierError("Branch was not found for this business",404,"BRANCH_NOT_FOUND");
}

async function supplierAudit(client: DatabaseClient,businessId: string,access: BusinessAccess,eventType: string,supplierId: string,payload: unknown) {
  await client.query(
    `INSERT INTO audit_events (business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,'SUPPLIER',$4,$5::jsonb)`,
    [businessId,access.staffId,eventType,supplierId,JSON.stringify(payload)],
  );
}

class SupplierError extends Error {
  constructor(message: string,readonly statusCode=400,readonly code="SUPPLIER_INVALID") { super(message); }
}

function sendError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof SupplierError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code,message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "SUPPLIER_INVENTORY_REQUEST_FAILED",message: "Supplier or inventory request could not be completed." });
}
