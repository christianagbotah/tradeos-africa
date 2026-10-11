import type { SupplierCreateInput, SupplierUpdateInput } from "@tradeos/contracts";
import { quantityFromUnits, quantityUnits } from "./commerce/valuation.js";
import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabasePool } from "./db.js";
import { createSupplier, loadSupplier, SUPPLIER_WRITE_ROLES, SupplierServiceError, updateSupplier } from "./supplier-service.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];
type SupplierCreateBody = SupplierCreateInput & { businessId: string };
type SupplierUpdateBody = SupplierUpdateInput & { businessId: string };

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms_days: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  balance_minor?: string | number;
};

function toSupplierListView(row: SupplierRow) {
  return {
    balanceMinor: Number(row.balance_minor ?? 0),
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    paymentTermsDays: row.payment_terms_days,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function registerSupplierInventoryRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: { businessId?: string; query?: string; limit?: string } }>("/v1/suppliers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const query = request.query.query?.trim() ?? "";
      const result = await pool.query<SupplierRow>(
        `SELECT id,name,phone,email,address,payment_terms_days,is_active,created_at,updated_at,
           (SELECT COALESCE(SUM(balance_delta_minor),0) FROM supplier_payable_ledger l WHERE l.business_id=suppliers.business_id AND l.supplier_id=suppliers.id) AS balance_minor
         FROM suppliers
         WHERE business_id=$1 AND ($2='' OR name ILIKE $3 OR COALESCE(phone,'') ILIKE $3 OR COALESCE(email,'') ILIKE $3)
         ORDER BY is_active DESC,name,id LIMIT $4`,
        [businessId,query,`%${query}%`,clampLimit(request.query.limit)],
      );
      return { suppliers: result.rows.map(toSupplierListView) };
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
      const obligations = await pool.query<{id:string;purchase_id:string;original_minor:string;open_minor:string;issued_at:Date;due_at:Date}>(`SELECT id,purchase_id,original_minor,open_minor,issued_at,due_at FROM supplier_credit_obligations WHERE business_id=$1 AND supplier_id=$2 ORDER BY (open_minor>0) DESC,due_at,issued_at,id`,[businessId,supplier.id]);
      return {supplier:{...supplier,balanceMinor:Number(balance.rows[0]!.balance)},obligations:obligations.rows.map(row=>({id:row.id,purchaseId:row.purchase_id,originalMinor:Number(row.original_minor),openMinor:Number(row.open_minor),issuedAt:row.issued_at.toISOString(),dueAt:row.due_at.toISOString()})),ledger:entries.rows.map(row=>({id:row.id,branchId:row.branch_id,currencyCode:row.currency_code,balanceDeltaMinor:Number(row.balance_delta_minor),method:row.method,sourceType:row.source_type,sourceId:row.source_id,actorStaffId:row.actor_staff_id,occurredAt:row.occurred_at.toISOString()}))};
    } catch(error) {return sendError(request,reply,error);}
  });

  app.post<{ Body: SupplierCreateBody }>("/v1/suppliers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, SUPPLIER_WRITE_ROLES);
      const { businessId: _businessId, ...input } = request.body;
      const supplier = await createSupplier(pool, access, input);
      return reply.code(201).send({ supplier });
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.patch<{ Params: { supplierId: string }; Body: SupplierUpdateBody }>("/v1/suppliers/:supplierId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, SUPPLIER_WRITE_ROLES);
      const { businessId: _businessId, ...input } = request.body;
      return { supplier: await updateSupplier(pool, access, request.params.supplierId, input) };
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

  app.get<{ Params: { itemId: string }; Querystring: { businessId?: string; branchId?: string; limit?: string } }>("/v1/inventory/:itemId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      const branchId = required(request.query.branchId, "branchId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      await assertBranch(pool, businessId, branchId);

      const itemResult = await pool.query<{
        id: string; sku: string | null; name: string; stock_unit_code: string; is_active: boolean;
      }>(
        `SELECT id,sku,name,stock_unit_code,is_active
         FROM catalog_items
         WHERE id=$1 AND business_id=$2 AND kind='PRODUCT' AND track_stock=true`,
        [request.params.itemId, businessId],
      );
      const item = itemResult.rows[0];
      if (!item || !item.stock_unit_code) throw new SupplierError("Inventory item was not found", 404, "INVENTORY_ITEM_NOT_FOUND");

      const balanceResult = await pool.query<{
        available: string | number; quarantine: string | number; damaged: string | number; waste: string | number;
        inventory_value_minor: string | number; latest_stock_unit_cost_minor: string | number | null;
      }>(
        `SELECT
           COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='AVAILABLE'),0) AS available,
           COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='QUARANTINE'),0) AS quarantine,
           COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='DAMAGED'),0) AS damaged,
           COALESCE(SUM(im.quantity_delta) FILTER (WHERE im.location_type='WASTE'),0) AS waste,
           COALESCE((SELECT SUM(v.value_minor) FROM inventory_valuations v WHERE v.business_id=$1 AND v.branch_id=$2 AND v.item_id=$3),0) AS inventory_value_minor,
           (SELECT v.value_minor / NULLIF(v.quantity,0) FROM inventory_valuations v
             WHERE v.business_id=$1 AND v.branch_id=$2 AND v.item_id=$3 AND v.location_type='AVAILABLE') AS latest_stock_unit_cost_minor
         FROM inventory_movements im
         WHERE im.business_id=$1 AND im.branch_id=$2 AND im.item_id=$3`,
        [businessId, branchId, item.id],
      );
      const balance = balanceResult.rows[0]!;

      const movementResult = await pool.query<{
        id: string; stock_unit_code: string; quantity_delta: string | number; location_type: string; reason: string;
        reference_type: string; reference_id: string; actor_staff_id: string | null; actor_name: string | null; occurred_at: Date;
      }>(
        `SELECT im.id,im.stock_unit_code,im.quantity_delta,im.location_type,im.reason,im.reference_type,im.reference_id,
                im.actor_staff_id,st.display_name AS actor_name,im.occurred_at
         FROM inventory_movements im
         LEFT JOIN staff st ON st.id=im.actor_staff_id AND st.business_id=im.business_id
         WHERE im.business_id=$1 AND im.branch_id=$2 AND im.item_id=$3
         ORDER BY im.occurred_at DESC,im.id DESC LIMIT $4`,
        [businessId, branchId, item.id, clampLimit(request.query.limit, 50)],
      );

      return {
        item: {
          id: item.id, sku: item.sku, name: item.name, stockUnitCode: item.stock_unit_code, active: item.is_active,
          available: Number(balance.available), quarantine: Number(balance.quarantine), damaged: Number(balance.damaged), waste: Number(balance.waste),
          inventoryValueMinor: Number(balance.inventory_value_minor),
          averageStockUnitCostMinor: balance.latest_stock_unit_cost_minor === null ? null : Number(balance.latest_stock_unit_cost_minor),
        },
        movements: movementResult.rows.map((row) => ({
          id: row.id, stockUnitCode: row.stock_unit_code, quantityDelta: Number(row.quantity_delta), location: row.location_type,
          reason: row.reason, referenceType: row.reference_type, referenceId: row.reference_id,
          actorStaffId: row.actor_staff_id, actorName: row.actor_name, occurredAt: row.occurred_at.toISOString(),
        })),
      };
    } catch (error) {
      return sendError(request, reply, error);
    }
  });

  app.get<{ Params: { purchaseId: string }; Querystring: { businessId?: string } }>("/v1/purchases/:purchaseId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const purchase = (await pool.query(`SELECT p.*,s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1 AND p.business_id=$2`, [request.params.purchaseId,businessId])).rows[0];
      if (!purchase) throw new SupplierError("Purchase was not found",404,"PURCHASE_NOT_FOUND");
      const lines = await pool.query(`SELECT pl.*,COALESCE(r.quantity,0) AS returned_quantity,
        COALESCE(r.recovery,0) AS returned_recovery_minor FROM purchase_lines pl
        LEFT JOIN (SELECT purchase_line_id,SUM(purchase_quantity) AS quantity,SUM(supplier_recovery_minor) AS recovery FROM purchase_return_lines GROUP BY purchase_line_id) r ON r.purchase_line_id=pl.id
        WHERE pl.purchase_id=$1 AND pl.business_id=$2 ORDER BY pl.created_at,pl.id`,[purchase.id,businessId]);
      const returns = await pool.query(`SELECT id,recovery_method,supplier_recovery_minor,inventory_value_removed_minor,purchase_price_variance_minor,occurred_at FROM purchase_return_cases WHERE original_purchase_id=$1 AND business_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 25`,[purchase.id,businessId]);
      return { purchase: { id:purchase.id,businessId,branchId:purchase.branch_id,supplierId:purchase.supplier_id,supplierName:purchase.supplier_name,status:purchase.status,currencyCode:purchase.currency_code,totalMinor:Number(purchase.total_minor),settlementMethod:purchase.settlement_method },
        lines:lines.rows.map(row=>({id:row.id,itemId:row.item_id,itemName:row.item_name_snapshot,purchaseUnitCode:row.purchase_unit_code,purchaseQuantity:Number(row.purchase_quantity),stockUnitCode:row.stock_unit_code,stockQuantity:Number(row.stock_quantity),unitCostMinor:Number(row.unit_cost_minor),lineCostMinor:Number(row.line_cost_minor),returnedQuantity:Number(row.returned_quantity),remainingQuantity:quantityFromUnits(quantityUnits(Number(row.purchase_quantity))-quantityUnits(Number(row.returned_quantity))),returnedRecoveryMinor:Number(row.returned_recovery_minor)})),
        returns:returns.rows.map(row=>({id:row.id,recoveryMethod:row.recovery_method,supplierRecoveryMinor:Number(row.supplier_recovery_minor),inventoryValueRemovedMinor:Number(row.inventory_value_removed_minor),purchasePriceVarianceMinor:Number(row.purchase_price_variance_minor),occurredAt:row.occurred_at.toISOString()})) };
    } catch (error) { return sendError(request,reply,error); }
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

class SupplierError extends Error {
  constructor(message: string,readonly statusCode=400,readonly code="SUPPLIER_INVALID") { super(message); }
}

function sendError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof SupplierError || error instanceof SupplierServiceError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code,message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "SUPPLIER_INVENTORY_REQUEST_FAILED",message: "Supplier or inventory request could not be completed." });
}
