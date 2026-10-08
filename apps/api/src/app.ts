import { registerCashForecastRoutes } from "./cash-forecast.js";
import { registerReportRoutes } from "./reports.js";
import { registerOperationsRoutes } from "./operations.js";
import { registerTreasuryRoutes } from "./treasury.js";
import { registerCashbookRoutes } from "./cashbook.js";
import { registerSupplierInventoryRoutes } from "./suppliers-inventory.js";
import Fastify from "fastify";
import type { ClientMutation, SyncPushRequest } from "@tradeos/contracts";
import { requireBusinessRole, type BusinessAccess, type BusinessRole } from "./auth/authorization.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { authenticateAccessToken, AuthError, type AuthContext } from "./auth/security.js";
import { registerBusinessRoutes } from "./businesses.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerCustomerRoutes } from "./customers.js";
import { CUSTOMER_WRITE_ROLES } from "./customer-service.js";
import { SUPPLIER_WRITE_ROLES } from "./supplier-service.js";
import type { DatabasePool } from "./db.js";
import { registerOnboardingRoutes } from "./onboarding.js";
import { registerSalesReadRoutes } from "./sales-read.js";
import { ingestSyncBatch, SyncRequestError } from "./sync.js";

const SALE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"];
const RETURN_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER"];
const CUSTOMER_PAYMENT_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
const PURCHASE_RECEIVE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY", "ACCOUNTANT"];
const SUPPLIER_PAYMENT_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const EXPENSE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"];
const CASHBOOK_ADJUSTMENT_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const CATALOG_WRITE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const INVENTORY_ADJUSTMENT_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "INVENTORY"];
const CATALOG_MUTATIONS = new Set(["CATALOG_ITEM_CREATE", "CATALOG_ITEM_UPDATE", "CATALOG_ITEM_ARCHIVE", "CATALOG_ITEM_REACTIVATE"]);
const MASTER_DATA_MUTATIONS = new Set(["CUSTOMER_CREATE", "CUSTOMER_UPDATE", "SUPPLIER_CREATE", "SUPPLIER_UPDATE"]);

export function buildApp(pool: DatabasePool) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => {
    const result = await pool.query<{ now: Date }>("SELECT now() AS now");
    return {
      ok: true,
      service: "tradeos-api",
      databaseTime: result.rows[0]?.now.toISOString() ?? null,
    };
  });

  registerAuthRoutes(app, pool);
  registerOnboardingRoutes(app, pool);
  registerBusinessRoutes(app, pool);
  registerCatalogRoutes(app, pool);
  registerCustomerRoutes(app, pool);
  registerSalesReadRoutes(app, pool);
  registerSupplierInventoryRoutes(app, pool);
  registerCashbookRoutes(app, pool);
  registerOperationsRoutes(app,pool);
  registerTreasuryRoutes(app,pool);
  registerReportRoutes(app,pool);
  registerCashForecastRoutes(app,pool);

  app.post<{ Body: SyncPushRequest }>("/v1/sync", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const authorized = await authorizeAndEnrichSyncBatch(pool, auth, request.body);
      return await ingestSyncBatch(pool, authorized);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      if (error instanceof SyncRequestError) {
        return reply.code(error.statusCode).send({
          error: "INVALID_SYNC_REQUEST",
          message: error.message,
        });
      }
      request.log.error(error);
      return reply.code(500).send({
        error: "SYNC_FAILED",
        message: "The sync batch could not be processed.",
      });
    }
  });

  return app;
}

async function authorizeAndEnrichSyncBatch(
  pool: DatabasePool,
  auth: AuthContext,
  body: SyncPushRequest,
): Promise<SyncPushRequest> {
  if (!Array.isArray(body?.mutations)) throw new SyncRequestError("mutations must be an array");

  const accessCache = new Map<string, BusinessAccess>();
  const mutations: ClientMutation[] = [];

  for (const mutation of body.mutations) {
    if (mutation.clientId !== auth.deviceKey) {
      throw new AuthError("Sync clientId does not match the authenticated device", 403, "DEVICE_MISMATCH");
    }

    const roles = rolesForMutation(mutation);
    const authorizationKey = `${mutation.businessId}:${roles.join(",")}`;
    let access = accessCache.get(authorizationKey);
    if (!access) {
      access = await requireBusinessRole(pool, auth, mutation.businessId, roles);
      accessCache.set(authorizationKey, access);
    }
    if (!access.staffId) {
      throw new AuthError(
        "Your business membership is not linked to an active staff actor",
        403,
        "STAFF_ACTOR_REQUIRED",
      );
    }

    mutations.push({
      ...mutation,
      payload: authoritativeActorPayload(mutation, access),
    });
  }

  return { ...body, mutations };
}

function authoritativeActorPayload(mutation: ClientMutation, access: BusinessAccess): unknown {
  if (typeof mutation.payload !== "object" || mutation.payload === null || Array.isArray(mutation.payload)) {
    return mutation.payload;
  }
  const payload = mutation.payload as Record<string, unknown>;

  if (CATALOG_MUTATIONS.has(mutation.mutationType) || MASTER_DATA_MUTATIONS.has(mutation.mutationType)) {
    const { actorStaffId: _ignoredStaff, actorRole: _ignoredRole, ...rest } = payload;
    return { ...rest, actorStaffId: access.staffId, actorRole: access.role };
  }

  if (["EXPENSE_CREATE","CASHBOOK_ADJUSTMENT_CREATE","OPERATING_DAY_OPEN_CREATE","OPERATING_DAY_CLOSE_CREATE","SHIFT_OPEN_CREATE","SHIFT_CLOSE_CREATE","MONEY_TRANSFER_CREATE","MONEY_RECONCILIATION_CREATE","MONEY_RECONCILIATION_RESOLVE"].includes(mutation.mutationType)) {
    const { actorStaffId: _ignored, ...rest } = payload;
    return {...rest,actorStaffId:access.staffId,actorRole:access.role};
  }
  if (mutation.mutationType === "INVENTORY_ADJUSTMENT_CREATE") {
    const { actorStaffId: _ignored, ...rest } = payload;
    return { ...rest, actorStaffId: access.staffId };
  }
  if (mutation.mutationType === "SALE_CREATE") {
    const { cashierStaffId: _ignored, ...rest } = payload;
    return { ...rest, cashierStaffId: access.staffId };
  }

  if (mutation.mutationType === "EXCHANGE_CREATE") {
    const { initiatedByStaffId: _ignoredInitiator, actorStaffId: _legacyIgnored, ...rest } = payload;
    return { ...rest, initiatedByStaffId: access.staffId };
  }

  if (mutation.mutationType === "RETURN_CREATE" || mutation.mutationType === "REFUND_CREATE") {
    const { initiatedByStaffId: _ignoredInitiator, approvedByStaffId: _ignoredApprover, ...rest } = payload;
    return {
      ...rest,
      initiatedByStaffId: access.staffId,
      ...(["OWNER", "ADMIN", "MANAGER"].includes(access.role) ? { approvedByStaffId: access.staffId } : {}),
    };
  }

  if (["CUSTOMER_PAYMENT_CREATE", "PURCHASE_RECEIVE_CREATE"].includes(mutation.mutationType)) {
    const { receivedByStaffId: _ignored, ...rest } = payload;
    return { ...rest, receivedByStaffId: access.staffId };
  }

  if (mutation.mutationType === "PURCHASE_RETURN_CREATE") {
    const { returnedByStaffId: _ignored, ...rest } = payload;
    return { ...rest, returnedByStaffId: access.staffId };
  }

  if (mutation.mutationType === "SUPPLIER_PAYMENT_CREATE") {
    const { paidByStaffId: _ignored, receivedByStaffId: _legacyIgnored, ...rest } = payload;
    return { ...rest, paidByStaffId: access.staffId };
  }

  return payload;
}

function rolesForMutation(mutation: ClientMutation): readonly BusinessRole[] {
  switch (mutation.mutationType) {
    case "CATALOG_ITEM_CREATE":
    case "CATALOG_ITEM_UPDATE":
    case "CATALOG_ITEM_ARCHIVE":
    case "CATALOG_ITEM_REACTIVATE": return CATALOG_WRITE_ROLES;
    case "CUSTOMER_CREATE":
    case "CUSTOMER_UPDATE": return CUSTOMER_WRITE_ROLES;
    case "SUPPLIER_CREATE":
    case "SUPPLIER_UPDATE": return SUPPLIER_WRITE_ROLES;
    case "OPERATING_DAY_OPEN_CREATE":
    case "OPERATING_DAY_CLOSE_CREATE": return CASHBOOK_ADJUSTMENT_ROLES;
    case "SHIFT_OPEN_CREATE":
    case "SHIFT_CLOSE_CREATE":
    case "MONEY_RECONCILIATION_CREATE":
    case "EXPENSE_CREATE": return EXPENSE_ROLES;
    case "MONEY_TRANSFER_CREATE":
    case "MONEY_RECONCILIATION_RESOLVE": return CASHBOOK_ADJUSTMENT_ROLES;
    case "CASHBOOK_ADJUSTMENT_CREATE": return CASHBOOK_ADJUSTMENT_ROLES;
    case "INVENTORY_ADJUSTMENT_CREATE": return INVENTORY_ADJUSTMENT_ROLES;
    case "SALE_CREATE":
      return SALE_ROLES;
    case "RETURN_CREATE":
    case "REFUND_CREATE":
    case "EXCHANGE_CREATE":
      return RETURN_ROLES;
    case "PURCHASE_RETURN_CREATE":
    case "PURCHASE_RECEIVE_CREATE":
      return PURCHASE_RECEIVE_ROLES;
    case "SUPPLIER_PAYMENT_CREATE":
      return SUPPLIER_PAYMENT_ROLES;
    case "CUSTOMER_PAYMENT_CREATE":
      return CUSTOMER_PAYMENT_ROLES;
    default:
      throw new SyncRequestError(`Unsupported mutationType: ${mutation.mutationType}`);
  }
}
