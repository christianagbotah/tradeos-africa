import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import { withTransaction, type DatabaseClient, type DatabasePool } from "./db.js";
import { CashbookError, isCashMethod, cashMethods } from "./commerce/cashbook.js";

import { signedMinor, addSignedMinor } from "./commerce/valuation.js";

const READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT", "VIEWER"];
const WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
type Filters = { businessId?: string; branchId?: string; method?: string; from?: string; to?: string; limit?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown, name: string): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new CashbookError(`${name} must be a UUID`);
  return value;
}
type ExpenseCategoryRow = {
  id: string;
  name: string;
  is_active: boolean;
  is_system: boolean;
  created_at: Date;
  updated_at: Date;
};

function categoryName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 160) throw new CashbookError("Category name must contain 1–160 characters");
  return value.trim();
}
function categoryRevision(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new CashbookError("expectedUpdatedAt is required and must be an ISO date-time", "REVISION_REQUIRED", 400);
  }
  return new Date(value).toISOString();
}
function toExpenseCategory(row: ExpenseCategoryRow) {
  return {
    id: row.id,
    name: row.name,
    active: row.is_active,
    system: row.is_system,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
async function loadExpenseCategory(db: DatabasePool | DatabaseClient, businessId: string, categoryId: string, lock = false) {
  const result = await db.query<ExpenseCategoryRow>(
    `SELECT id,name,is_active,is_system,created_at,updated_at FROM expense_categories
     WHERE business_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [businessId, categoryId],
  );
  const row = result.rows[0];
  if (!row) throw new CashbookError("Category not found", "CATEGORY_NOT_FOUND", 404);
  return toExpenseCategory(row);
}
function categoryChanges(
  before: { name: string; active: boolean },
  after: { name: string; active: boolean },
) {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (before.name !== after.name) changes.name = { before: before.name, after: after.name };
  if (before.active !== after.active) changes.active = { before: before.active, after: after.active };
  return changes;
}
async function writeCategoryAudit(client: DatabaseClient, access: BusinessAccess, eventType: string, categoryId: string, changes: Record<string, { before: unknown; after: unknown }>) {
  await client.query(
    `INSERT INTO audit_events (business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,'EXPENSE_CATEGORY',$4,$5::jsonb)`,
    [access.businessId, access.staffId, eventType, categoryId, JSON.stringify({ changes })],
  );
}

export function registerCashbookRoutes(app: FastifyInstance, pool: DatabasePool): void {
  for (const resource of ["cashbook", "expenses"] as const) {
    app.get<{ Querystring: Filters }>(`/v1/${resource}`, async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = id(request.query.businessId, "businessId");
        const branchId = id(request.query.branchId, "branchId");
        await requireBusinessRole(pool, auth, businessId, READ_ROLES);
        if (!(await pool.query(`SELECT id FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true`, [branchId, businessId])).rowCount) throw new CashbookError("Branch not found", "BRANCH_NOT_FOUND", 404);
        const { method, from, to } = request.query;
        if (method && !isCashMethod(method)) throw new CashbookError("Invalid money method");
        for (const date of [from, to]) if (date && Number.isNaN(Date.parse(date))) throw new CashbookError("Invalid date filter");
        if (from && to && Date.parse(from) > Date.parse(to)) throw new CashbookError("Date range is reversed");
        const limit = Number(request.query.limit ?? 100);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new CashbookError("Limit must be between 1 and 500");
        const values = [businessId, branchId, method ?? null, from ?? null, to ?? null];
        const where = `e.business_id=$1 AND e.branch_id=$2 AND ($3::text IS NULL OR e.method=$3) AND ($4::timestamptz IS NULL OR e.occurred_at >= $4) AND ($5::timestamptz IS NULL OR e.occurred_at <= $5)`;
        return await withTransaction(pool, async client => {
        await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const rows = await client.query(`SELECT e.*${resource === "expenses" ? ",c.name AS category_name" : ""} FROM ${resource === "cashbook" ? "cashbook_entries" : "expenses"} e ${resource === "expenses" ? "JOIN expense_categories c ON c.id=e.category_id AND c.business_id=e.business_id" : ""} WHERE ${where} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $6`, [...values, limit]);
        const entries = rows.rows.map(row => ({ id: row.id, moneyAccountId:row.money_account_id, branchId: row.branch_id, currencyCode: row.currency_code, method: row.method, actorStaffId: row.actor_staff_id, occurredAt: row.occurred_at.toISOString(), ...(resource === "cashbook" ? { amountDeltaMinor: signedMinor(Number(row.amount_delta_minor)), entryType: row.entry_type, sourceType: row.source_type, sourceId: row.source_id } : { amountMinor: signedMinor(Number(row.amount_minor)), categoryId: row.category_id, categoryName: row.category_name, description: row.description, payee: row.payee, provider: row.provider, providerReference: row.provider_reference, status: row.status }) }));
        if (resource === "expenses") return { expenses: entries };
        // Totals cover the whole filtered range, independently of the display limit.
        const totals = await client.query(`SELECT e.method,e.currency_code,COALESCE(SUM(e.amount_delta_minor),0) AS balance,COALESCE(SUM(e.amount_delta_minor) FILTER (WHERE e.amount_delta_minor>0),0) AS inflow,COALESCE(-SUM(e.amount_delta_minor) FILTER (WHERE e.amount_delta_minor<0),0) AS outflow FROM cashbook_entries e WHERE ${where} GROUP BY e.method,e.currency_code ORDER BY e.method`, values);
        const byMethod = Object.fromEntries(cashMethods.map(method => [method, {inflowMinor:0,outflowMinor:0,netMinor:0}]));
        let inflowMinor=0,outflowMinor=0,netMinor=0;
        for (const row of totals.rows) {
          const movement={inflowMinor:signedMinor(Number(row.inflow)),outflowMinor:signedMinor(Number(row.outflow)),netMinor:signedMinor(Number(row.balance))};
          byMethod[row.method as keyof typeof byMethod]=movement;
          inflowMinor=addSignedMinor(inflowMinor,movement.inflowMinor);outflowMinor=addSignedMinor(outflowMinor,movement.outflowMinor);netMinor=addSignedMinor(netMinor,movement.netMinor);
        }
        return { entries, summary:{inflowMinor,outflowMinor,netMinor,byMethod}, totals: totals.rows.map(row => ({ method: row.method, currencyCode: row.currency_code, balanceMinor: Number(row.balance), inflowMinor: Number(row.inflow), outflowMinor: Number(row.outflow) })) };
        });
      } catch (error) { return sendError(reply, error); }
    });
  }
  app.get<{ Querystring: { businessId?: string } }>("/v1/expense-categories", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const rows = await pool.query<ExpenseCategoryRow>(`SELECT id,name,is_active,is_system,created_at,updated_at FROM expense_categories WHERE business_id=$1 ORDER BY name,id`, [businessId]);
      return { categories: rows.rows.map(toExpenseCategory) };
    } catch (error) { return sendError(reply, error); }
  });
  app.post<{ Body: { businessId: string; name: string } }>("/v1/expense-categories", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.body?.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const result = await pool.query<ExpenseCategoryRow>(
        `INSERT INTO expense_categories(business_id,name) VALUES ($1,$2)
         ON CONFLICT(business_id,name) DO UPDATE SET name=EXCLUDED.name
         RETURNING id,name,is_active,is_system,created_at,updated_at`,
        [businessId, categoryName(request.body.name)],
      );
      return reply.code(201).send({ category: toExpenseCategory(result.rows[0]!) });
    } catch (error) { return sendError(reply, error); }
  });
  app.patch<{ Params: { categoryId: string }; Body: { businessId: string; expectedUpdatedAt: string; name?: string; active?: boolean } }>("/v1/expense-categories/:categoryId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = id(request.body?.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const categoryId = id(request.params.categoryId, "categoryId");
      const expectedUpdatedAt = categoryRevision(request.body.expectedUpdatedAt);
      const requestedName = request.body.name === undefined ? undefined : categoryName(request.body.name);
      if (request.body.active !== undefined && typeof request.body.active !== "boolean") throw new CashbookError("active must be boolean");
      const category = await withTransaction(pool, async (client) => {
        const current = await loadExpenseCategory(client, businessId, categoryId, true);
        if (Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) {
          throw new CashbookError("Category changed on another device. Reload before saving again.", "STALE_VERSION", 409);
        }
        const name = requestedName ?? current.name;
        const active = request.body.active ?? current.active;
        const changes = categoryChanges(current, { name, active });
        await client.query(
          `UPDATE expense_categories SET name=$3,is_active=$4,updated_at=clock_timestamp() WHERE business_id=$1 AND id=$2`,
          [businessId, categoryId, name, active],
        );
        const eventType = current.active !== active
          ? (active ? "EXPENSE_CATEGORY_REACTIVATED" : "EXPENSE_CATEGORY_DEACTIVATED")
          : "EXPENSE_CATEGORY_UPDATED";
        await writeCategoryAudit(client, access, eventType, categoryId, changes);
        return loadExpenseCategory(client, businessId, categoryId);
      });
      return { category };
    } catch (error) { return sendError(reply, error); }
  });
}
function sendError(reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) {
  if (error instanceof CashbookError || error instanceof AuthError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  if ((error as { code?: string })?.code === "23505") return reply.code(409).send({ error: "CATEGORY_EXISTS", message: "Category name already exists" });
  throw error;
}
