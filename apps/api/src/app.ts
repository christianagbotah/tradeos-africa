import Fastify from "fastify";
import type { ClientMutation, SyncPushRequest } from "@tradeos/contracts";
import { requireBusinessRole, type BusinessRole } from "./auth/authorization.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { authenticateAccessToken, AuthError, type AuthContext } from "./auth/security.js";
import { registerCatalogRoutes } from "./catalog.js";
import type { DatabasePool } from "./db.js";
import { registerOnboardingRoutes } from "./onboarding.js";
import { ingestSyncBatch, SyncRequestError } from "./sync.js";

const SALE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"];
const RETURN_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "CASHIER"];

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
  registerCatalogRoutes(app, pool);

  app.post<{ Body: SyncPushRequest }>("/v1/sync", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      await authorizeSyncBatch(pool, auth, request.body);
      return await ingestSyncBatch(pool, request.body);
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

async function authorizeSyncBatch(pool: DatabasePool, auth: AuthContext, body: SyncPushRequest): Promise<void> {
  if (!Array.isArray(body?.mutations)) throw new SyncRequestError("mutations must be an array");

  const authorized = new Set<string>();
  for (const mutation of body.mutations) {
    if (mutation.clientId !== auth.deviceKey) {
      throw new AuthError("Sync clientId does not match the authenticated device", 403, "DEVICE_MISMATCH");
    }

    const roles = rolesForMutation(mutation);
    const authorizationKey = `${mutation.businessId}:${roles.join(",")}`;
    if (authorized.has(authorizationKey)) continue;
    await requireBusinessRole(pool, auth, mutation.businessId, roles);
    authorized.add(authorizationKey);
  }
}

function rolesForMutation(mutation: ClientMutation): readonly BusinessRole[] {
  switch (mutation.mutationType) {
    case "SALE_CREATE":
      return SALE_ROLES;
    case "RETURN_CREATE":
    case "REFUND_CREATE":
      return RETURN_ROLES;
    default:
      throw new SyncRequestError(`Unsupported mutationType: ${mutation.mutationType}`);
  }
}
