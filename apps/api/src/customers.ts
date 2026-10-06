import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabaseClient, DatabasePool } from "./db.js";
import { withTransaction } from "./db.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];
const WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "ACCOUNTANT"];
const CREDIT_CONTROL_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];

type CustomerInput = {
  businessId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  creditLimitMinor?: number | null;
};

type CustomerPatch = Partial<Omit<CustomerInput, "businessId">> & { businessId: string; active?: boolean };

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  credit_limit_minor: string | number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  balance_minor: string | number;
};

export function registerCustomerRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: { businessId?: string; query?: string; limit?: string } }>("/v1/customers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const query = request.query.query?.trim() ?? "";
      const search = `%${query}%`;
      const limit = clampLimit(request.query.limit);
      const result = await pool.query<CustomerRow>(
        `SELECT c.id,c.name,c.phone,c.email,c.credit_limit_minor,c.is_active,c.created_at,c.updated_at,
                COALESCE((SELECT SUM(cae.balance_delta_minor) FROM customer_account_entries cae
                  WHERE cae.business_id=c.business_id AND cae.customer_id=c.id),0) AS balance_minor
         FROM customers c
         WHERE c.business_id=$1
           AND ($2='' OR c.name ILIKE $3 OR COALESCE(c.phone,'') ILIKE $3 OR COALESCE(c.email,'') ILIKE $3)
         ORDER BY c.is_active DESC,c.name,c.id
         LIMIT $4`,
        [businessId, query, search, limit],
      );
      return { customers: result.rows.map(toCustomer) };
    } catch (error) {
      return sendCustomerError(request, reply, error);
    }
  });

  app.post<{ Body: CustomerInput }>("/v1/customers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const input = validateCustomerInput(request.body);
      const access = await requireBusinessRole(pool, auth, input.businessId, WRITE_ROLES);
      assertCreditControl(access, request.body.creditLimitMinor !== undefined);
      const id = await withTransaction(pool, async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO customers (business_id,name,phone,email,credit_limit_minor)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [input.businessId,input.name,input.phone,input.email,input.creditLimitMinor],
        );
        const customerId = created.rows[0]?.id;
        if (!customerId) throw new CustomerRouteError("Customer could not be created", 500, "CUSTOMER_CREATE_FAILED");
        await writeAudit(client, input.businessId, access.staffId, "CUSTOMER_CREATED", customerId, {
          name: input.name, creditLimitMinor: input.creditLimitMinor,
        });
        return customerId;
      });
      return reply.code(201).send({ customer: await loadCustomer(pool, input.businessId, id) });
    } catch (error) {
      return sendCustomerError(request, reply, error);
    }
  });

  app.patch<{ Params: { customerId: string }; Body: CustomerPatch }>("/v1/customers/:customerId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
      const touchesCreditControl = request.body.creditLimitMinor !== undefined || request.body.active !== undefined;
      assertCreditControl(access, touchesCreditControl);
      const current = await loadCustomer(pool, businessId, request.params.customerId);
      const next = validateCustomerInput({
        businessId,
        name: request.body.name ?? current.name,
        phone: request.body.phone === undefined ? current.phone : request.body.phone,
        email: request.body.email === undefined ? current.email : request.body.email,
        creditLimitMinor: request.body.creditLimitMinor === undefined ? current.creditLimitMinor : request.body.creditLimitMinor,
      });
      const active = request.body.active ?? current.active;
      await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE customers SET name=$3,phone=$4,email=$5,credit_limit_minor=$6,is_active=$7,updated_at=now()
           WHERE id=$1 AND business_id=$2`,
          [request.params.customerId,businessId,next.name,next.phone,next.email,next.creditLimitMinor,active],
        );
        if (updated.rowCount !== 1) throw new CustomerRouteError("Customer was not found", 404, "CUSTOMER_NOT_FOUND");
        await writeAudit(client, businessId, access.staffId, "CUSTOMER_UPDATED", request.params.customerId, {
          name: next.name, creditLimitMinor: next.creditLimitMinor, active,
        });
      });
      return { customer: await loadCustomer(pool, businessId, request.params.customerId) };
    } catch (error) {
      return sendCustomerError(request, reply, error);
    }
  });

  app.get<{ Params: { customerId: string }; Querystring: { businessId?: string; limit?: string } }>(
    "/v1/customers/:customerId",
    async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = required(request.query.businessId, "businessId");
        await requireBusinessRole(pool, auth, businessId, READ_ROLES);
        const customer = await loadCustomer(pool, businessId, request.params.customerId);
        const limit = clampLimit(request.query.limit, 100);
        const ledger = await pool.query<{
          id: string;
          branch_id: string;
          currency_code: string;
          entry_type: string;
          balance_delta_minor: string | number;
          source_type: string;
          source_id: string;
          actor_name: string | null;
          occurred_at: Date;
        }>(
          `SELECT cae.id,cae.branch_id,cae.currency_code,cae.entry_type,cae.balance_delta_minor,
                  cae.source_type,cae.source_id,st.display_name AS actor_name,cae.occurred_at
           FROM customer_account_entries cae
           LEFT JOIN staff st ON st.id=cae.actor_staff_id
           WHERE cae.business_id=$1 AND cae.customer_id=$2
           ORDER BY cae.occurred_at DESC,cae.id DESC LIMIT $3`,
          [businessId, request.params.customerId, limit],
        );
        return {
          customer,
          ledger: ledger.rows.map((entry) => ({
            id: entry.id,
            branchId: entry.branch_id,
            currencyCode: entry.currency_code,
            entryType: entry.entry_type,
            balanceDeltaMinor: Number(entry.balance_delta_minor),
            sourceType: entry.source_type,
            sourceId: entry.source_id,
            actorName: entry.actor_name,
            occurredAt: entry.occurred_at.toISOString(),
          })),
        };
      } catch (error) {
        return sendCustomerError(request, reply, error);
      }
    },
  );
}

async function loadCustomer(pool: DatabasePool, businessId: string, customerId: string) {
  const result = await pool.query<CustomerRow>(
    `SELECT c.id,c.name,c.phone,c.email,c.credit_limit_minor,c.is_active,c.created_at,c.updated_at,
            COALESCE((SELECT SUM(cae.balance_delta_minor) FROM customer_account_entries cae
              WHERE cae.business_id=c.business_id AND cae.customer_id=c.id),0) AS balance_minor
     FROM customers c WHERE c.id=$1 AND c.business_id=$2`,
    [customerId, businessId],
  );
  const row = result.rows[0];
  if (!row) throw new CustomerRouteError("Customer was not found", 404, "CUSTOMER_NOT_FOUND");
  return toCustomer(row);
}

function toCustomer(row: CustomerRow) {
  const balanceMinor = Number(row.balance_minor);
  const creditLimitMinor = row.credit_limit_minor === null ? null : Number(row.credit_limit_minor);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    creditLimitMinor,
    balanceMinor,
    availableCreditMinor: creditLimitMinor === null ? null : Math.max(0, creditLimitMinor - balanceMinor),
    creditEnabled: creditLimitMinor !== null,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function validateCustomerInput(body: CustomerInput) {
  const businessId = required(body.businessId, "businessId");
  const name = body.name?.trim();
  if (!name || name.length > 160) throw new CustomerRouteError("Customer name is required and must be at most 160 characters");
  const phone = nullable(body.phone, 40);
  const email = nullable(body.email, 254)?.toLowerCase() ?? null;
  if (email && !email.includes("@")) throw new CustomerRouteError("Customer email is invalid");
  const creditLimitMinor = body.creditLimitMinor ?? null;
  if (creditLimitMinor !== null && (!Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0)) {
    throw new CustomerRouteError("Credit limit must be a non-negative minor-unit integer", 400, "INVALID_CREDIT_LIMIT");
  }
  return { businessId, name, phone, email, creditLimitMinor };
}

function assertCreditControl(access: BusinessAccess, requested: boolean): void {
  if (requested && !CREDIT_CONTROL_ROLES.includes(access.role)) {
    throw new AuthError("Your role cannot change customer credit limits or account status", 403, "CREDIT_CONTROL_FORBIDDEN");
  }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new CustomerRouteError(`${name} is required`);
  return normalized;
}

function nullable(value: string | null | undefined, max: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > max) throw new CustomerRouteError(`Value must be at most ${max} characters`);
  return normalized;
}

function clampLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 200);
}

async function writeAudit(
  db: DatabasePool | DatabaseClient,
  businessId: string,
  actorStaffId: string | null,
  eventType: string,
  customerId: string,
  payload: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (business_id,actor_staff_id,event_type,entity_type,entity_id,payload)
     VALUES ($1,$2,$3,'CUSTOMER',$4,$5::jsonb)`,
    [businessId, actorStaffId, eventType, customerId, JSON.stringify(payload)],
  );
}

class CustomerRouteError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = "CUSTOMER_INVALID") { super(message); }
}

function sendCustomerError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof CustomerRouteError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "CUSTOMER_REQUEST_FAILED", message: "Customer request could not be completed." });
}
