import type { CustomerCreateInput, CustomerUpdateInput } from "@tradeos/contracts";
import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { authenticateAccessToken, AuthError } from "./auth/security.js";
import type { DatabasePool } from "./db.js";
import {
  createCustomer,
  CUSTOMER_WRITE_ROLES,
  CustomerServiceError,
  loadCustomer,
  updateCustomer,
} from "./customer-service.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER",
];

type CustomerCreateBody = CustomerCreateInput & { businessId: string };
type CustomerUpdateBody = CustomerUpdateInput & { businessId: string };

type CustomerListRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  credit_limit_minor: string | number | null;
  credit_terms_days: number;
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
      const result = await pool.query<CustomerListRow>(
        `SELECT c.id,c.name,c.phone,c.email,c.credit_limit_minor,c.credit_terms_days,c.is_active,c.created_at,c.updated_at,
                COALESCE((SELECT SUM(cae.balance_delta_minor) FROM customer_account_entries cae
                  WHERE cae.business_id=c.business_id AND cae.customer_id=c.id),0) AS balance_minor
         FROM customers c
         WHERE c.business_id=$1
           AND ($2='' OR c.name ILIKE $3 OR COALESCE(c.phone,'') ILIKE $3 OR COALESCE(c.email,'') ILIKE $3)
         ORDER BY c.is_active DESC,c.name,c.id
         LIMIT $4`,
        [businessId, query, `%${query}%`, clampLimit(request.query.limit)],
      );
      return { customers: result.rows.map(toCustomerView) };
    } catch (error) {
      return sendCustomerError(request, reply, error);
    }
  });

  app.post<{ Body: CustomerCreateBody }>("/v1/customers", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, CUSTOMER_WRITE_ROLES);
      const { businessId: _businessId, ...input } = request.body;
      const customer = await createCustomer(pool, access, input);
      return reply.code(201).send({ customer });
    } catch (error) {
      return sendCustomerError(request, reply, error);
    }
  });

  app.patch<{ Params: { customerId: string }; Body: CustomerUpdateBody }>("/v1/customers/:customerId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = required(request.body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, CUSTOMER_WRITE_ROLES);
      const { businessId: _businessId, ...input } = request.body;
      return { customer: await updateCustomer(pool, access, request.params.customerId, input) };
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
          id: string; branch_id: string; currency_code: string; entry_type: string;
          balance_delta_minor: string | number; source_type: string; source_id: string;
          actor_name: string | null; occurred_at: Date;
        }>(
          `SELECT cae.id,cae.branch_id,cae.currency_code,cae.entry_type,cae.balance_delta_minor,
                  cae.source_type,cae.source_id,st.display_name AS actor_name,cae.occurred_at
           FROM customer_account_entries cae
           LEFT JOIN staff st ON st.id=cae.actor_staff_id
           WHERE cae.business_id=$1 AND cae.customer_id=$2
           ORDER BY cae.occurred_at DESC,cae.id DESC LIMIT $3`,
          [businessId, request.params.customerId, limit],
        );
        const obligations = await pool.query<{ id: string; sale_id: string; original_minor: string | number; open_minor: string | number; issued_at: Date; due_at: Date }>(
          `SELECT id,sale_id,original_minor,open_minor,issued_at,due_at FROM customer_credit_obligations
           WHERE business_id=$1 AND customer_id=$2 ORDER BY (open_minor>0) DESC,due_at,issued_at,id`,
          [businessId, request.params.customerId],
        );
        return {
          customer,
          obligations: obligations.rows.map((row) => ({
            id: row.id, saleId: row.sale_id, originalMinor: Number(row.original_minor), openMinor: Number(row.open_minor),
            issuedAt: row.issued_at.toISOString(), dueAt: row.due_at.toISOString(),
          })),
          ledger: ledger.rows.map((entry) => ({
            id: entry.id, branchId: entry.branch_id, currencyCode: entry.currency_code, entryType: entry.entry_type,
            balanceDeltaMinor: Number(entry.balance_delta_minor), sourceType: entry.source_type, sourceId: entry.source_id,
            actorName: entry.actor_name, occurredAt: entry.occurred_at.toISOString(),
          })),
        };
      } catch (error) {
        return sendCustomerError(request, reply, error);
      }
    },
  );
}

function toCustomerView(row: CustomerListRow) {
  const balanceMinor = Number(row.balance_minor);
  const creditLimitMinor = row.credit_limit_minor === null ? null : Number(row.credit_limit_minor);
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    creditLimitMinor,
    creditTermsDays: row.credit_terms_days,
    balanceMinor,
    availableCreditMinor: creditLimitMinor === null ? null : Math.max(0, creditLimitMinor - balanceMinor),
    creditEnabled: creditLimitMinor !== null,
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new CustomerServiceError(`${name} is required`);
  return normalized;
}

function clampLimit(value: string | undefined, fallback = 50): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, 200);
}

function sendCustomerError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
) {
  if (error instanceof CustomerServiceError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "CUSTOMER_REQUEST_FAILED", message: "Customer request could not be completed." });
}
