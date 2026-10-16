import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { authenticatePlatformAdmin, PlatformAdminError } from "./security.js";
import { getInvoice, listInvoices, listSubscriptionPayments, reconcilePayment } from "./billing-service.js";
import { getPlatformMetrics } from "./metrics-service.js";

const ADMIN_COOKIE = "__Host-tradeos_admin_session";

export function registerPlatformAdminBillingRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get("/api/admin/metrics", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { metrics: await getPlatformMetrics(pool, admin) };
    } catch (error) {
      return sendBillingError(request, reply, error, "ADMIN_METRICS_FAILED", "Platform metrics could not be loaded.");
    }
  });

  app.get("/api/admin/billing/invoices", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { invoices: await listInvoices(pool) };
    } catch (error) {
      return sendBillingError(request, reply, error, "ADMIN_INVOICES_FAILED", "Subscription invoices could not be loaded.");
    }
  });

  app.get<{ Params: { id: string } }>("/api/admin/billing/invoices/:id", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { invoice: await getInvoice(pool, request.params.id) };
    } catch (error) {
      return sendBillingError(request, reply, error, "ADMIN_INVOICE_FAILED", "Subscription invoice could not be loaded.");
    }
  });

  app.get("/api/admin/billing/payments", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { payments: await listSubscriptionPayments(pool) };
    } catch (error) {
      return sendBillingError(request, reply, error, "ADMIN_PAYMENTS_FAILED", "Subscription payments could not be loaded.");
    }
  });

  app.post<{ Params: { id: string }; Body: { status?: unknown; reason?: unknown } }>(
    "/api/admin/billing/payments/:id/reconcile",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { payment: await reconcilePayment(pool, admin, request.params.id, request.body ?? {}) };
      } catch (error) {
        return sendBillingError(request, reply, error, "ADMIN_PAYMENT_RECONCILE_FAILED", "Subscription payment could not be reconciled.");
      }
    },
  );
}

// Provider callback ingress is intentionally not registered here. Provider adapters
// verify signatures and normalize events before they may call the billing service.
function readAdminCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== ADMIN_COOKIE) continue;
    const value = rawValue.join("=");
    if (!value) return undefined;
    try { return decodeURIComponent(value); } catch { return undefined; }
  }
  return undefined;
}

function sendBillingError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload?: unknown) => unknown } },
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof PlatformAdminError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  request.log.error(error);
  return reply.code(500).send({ error: fallbackCode, message: fallbackMessage });
}
