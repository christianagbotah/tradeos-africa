import type { FastifyInstance, FastifyReply } from "fastify";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import {
  TenantBillingError,
  getTenantBillingInvoiceDetail,
  getTenantBillingOverview,
  listTenantBillingInvoices,
  listTenantBillingPayments,
  transitionTenantSubscription,
} from "./tenant-billing-service.js";

const READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "ACCOUNTANT"];
const WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Query = { businessId?: string; limit?: string };
type InvoiceParams = { invoiceId?: string };

type BillingBody = { businessId?: unknown } & Record<string, unknown>;

export function registerTenantBillingRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: Query }>("/v1/billing/overview", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      return await getTenantBillingOverview(pool, { businessId, role: access.role });
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.get<{ Querystring: Query }>("/v1/billing/invoices", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const items = await listTenantBillingInvoices(pool, { businessId, limit: parseLimit(request.query.limit) });
      return { items };
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.get<{ Querystring: Query; Params: InvoiceParams }>("/v1/billing/invoices/:invoiceId", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const invoiceId = uuid(request.params.invoiceId, "invoiceId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      return await getTenantBillingInvoiceDetail(pool, { businessId, invoiceId });
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.get<{ Querystring: Query }>("/v1/billing/payments", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const items = await listTenantBillingPayments(pool, { businessId, limit: parseLimit(request.query.limit) });
      return { items };
    } catch (error) {
      return sendBillingError(error, reply);
    }
  });

  app.post<{ Body: BillingBody }>("/v1/billing/subscription/cancel-at-period-end", async (request, reply) => {
    return transitionRoute(request.headers.authorization, request.body, reply, pool, "CANCEL_AT_PERIOD_END");
  });

  app.post<{ Body: BillingBody }>("/v1/billing/subscription/resume", async (request, reply) => {
    return transitionRoute(request.headers.authorization, request.body, reply, pool, "RESUME");
  });
}

async function transitionRoute(
  authorization: string | undefined,
  body: BillingBody | undefined,
  reply: FastifyReply,
  pool: DatabasePool,
  action: "CANCEL_AT_PERIOD_END" | "RESUME",
) {
  try {
    const input = body ?? {};
    assertBodyShape(input);
    const businessId = uuid(input.businessId, "businessId");
    const auth = await authenticateAccessToken(pool, authorization);
    const access = await requireBusinessRole(pool, auth, businessId, WRITE_ROLES);
    return await transitionTenantSubscription(pool, {
      businessId,
      role: access.role,
      staffId: access.staffId,
    }, action);
  } catch (error) {
    return sendBillingError(error, reply);
  }
}

function assertBodyShape(body: Record<string, unknown>): void {
  if (Object.keys(body).some((key) => key !== "businessId")) {
    throw new TenantBillingError(
      "Subscription lifecycle details are server-owned.",
      400,
      "TENANT_BILLING_BODY_INVALID",
    );
  }
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new TenantBillingError("limit must be between 1 and 100.", 400, "TENANT_BILLING_LIMIT_INVALID");
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new TenantBillingError("limit must be between 1 and 100.", 400, "TENANT_BILLING_LIMIT_INVALID");
  }
  return parsed;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TenantBillingError(`${label} must be a UUID.`, 400, "TENANT_BILLING_INPUT_INVALID");
  }
  return value;
}

function sendBillingError(error: unknown, reply: FastifyReply) {
  if (error instanceof TenantBillingError || error instanceof AuthError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}
