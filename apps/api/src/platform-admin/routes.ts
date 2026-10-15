import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import {
  authenticatePlatformAdmin,
  loginPlatformAdmin,
  logoutPlatformAdmin,
  PlatformAdminError,
  refreshPlatformAdminSession,
} from "./security.js";
import {
  getAdminTenant,
  listAdminAuditEvents,
  listAdminDevices,
  listAdminFeatureFlags,
  listAdminReleases,
  listAdminTenants,
} from "./read-service.js";

export function registerPlatformAdminRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: { identifier?: unknown; password?: unknown; platform?: unknown; deviceKey?: unknown } }>(
    "/api/admin/session/login",
    async (request, reply) => {
      try {
        return await loginPlatformAdmin(pool, request.body ?? {});
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_LOGIN_FAILED", "Administrator sign-in failed.");
      }
    },
  );

  app.post<{ Body: { refreshToken?: unknown } }>("/api/admin/session/refresh", async (request, reply) => {
    try {
      if (typeof request.body?.refreshToken !== "string") {
        throw new PlatformAdminError("Admin refresh token is required", 400, "ADMIN_REFRESH_REQUIRED");
      }
      return await refreshPlatformAdminSession(pool, request.body.refreshToken);
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_REFRESH_FAILED", "Administrator session could not be refreshed.");
    }
  });

  app.get("/api/admin/session/me", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { adminUser: stripContext(admin) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_ME_FAILED", "Administrator session could not be verified.");
    }
  });

  app.post("/api/admin/session/logout", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, request.headers.authorization);
      await logoutPlatformAdmin(pool, admin.sessionId);
      return reply.code(204).send();
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_LOGOUT_FAILED", "Administrator session could not be signed out.");
    }
  });

  app.get("/api/admin/tenants", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { tenants: await listAdminTenants(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANTS_FAILED", "Tenants could not be loaded.");
    }
  });

  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { tenant: await getAdminTenant(pool, request.params.id) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANT_FAILED", "Tenant details could not be loaded.");
    }
  });

  app.get("/api/admin/devices", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { devices: await listAdminDevices(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_DEVICES_FAILED", "Device health could not be loaded.");
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/api/admin/audit-events", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { events: await listAdminAuditEvents(pool, request.query?.limit) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_AUDIT_FAILED", "Platform audit events could not be loaded.");
    }
  });

  app.get("/api/admin/releases", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { releases: await listAdminReleases(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_RELEASES_FAILED", "Client releases could not be loaded.");
    }
  });

  app.get("/api/admin/feature-flags", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, request.headers.authorization);
      return { flags: await listAdminFeatureFlags(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_FLAGS_FAILED", "Feature flags could not be loaded.");
    }
  });
}

function stripContext(admin: Awaited<ReturnType<typeof authenticatePlatformAdmin>>) {
  return {
    id: admin.id,
    email: admin.email,
    displayName: admin.displayName,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt,
  };
}

function sendAdminError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload?: unknown) => unknown } },
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof PlatformAdminError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: fallbackCode, message: fallbackMessage });
}
