import type { FastifyInstance, FastifyReply } from "fastify";
import type { DatabasePool } from "../db.js";
import {
  authenticatePlatformAdmin,
  loginPlatformAdmin,
  logoutPlatformAdmin,
  PlatformAdminError,
} from "./security.js";
import {
  getAdminTenant,
  listAdminAuditEvents,
  listAdminDevices,
  listAdminFeatureFlags,
  listAdminReleases,
  listAdminTenants,
} from "./read-service.js";

const ADMIN_COOKIE = "__Host-tradeos_admin_session";

export function registerPlatformAdminRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.post<{ Body: { identifier?: unknown; password?: unknown; platform?: unknown; deviceKey?: unknown } }>(
    "/api/admin/session/login",
    async (request, reply) => {
      try {
        const result = await loginPlatformAdmin(pool, request.body ?? {});
        setAdminCookie(reply, result.sessionToken, result.session.expiresAt);
        return { adminUser: result.adminUser, session: result.session };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_LOGIN_FAILED", "Administrator sign-in failed.");
      }
    },
  );

  app.get("/api/admin/session/me", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return {
        adminUser: stripContext(admin),
        session: { expiresAt: admin.expiresAt, idleExpiresAt: admin.idleExpiresAt },
      };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_ME_FAILED", "Administrator session could not be verified.");
    }
  });

  app.post("/api/admin/session/logout", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      await logoutPlatformAdmin(pool, admin.sessionId, admin.id);
      clearAdminCookie(reply);
      return reply.code(204).send();
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_LOGOUT_FAILED", "Administrator session could not be signed out.");
    }
  });

  app.get("/api/admin/tenants", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { tenants: await listAdminTenants(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANTS_FAILED", "Tenants could not be loaded.");
    }
  });

  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { tenant: await getAdminTenant(pool, request.params.id) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANT_FAILED", "Tenant details could not be loaded.");
    }
  });

  app.get("/api/admin/devices", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { devices: await listAdminDevices(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_DEVICES_FAILED", "Device health could not be loaded.");
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/api/admin/audit-events", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { events: await listAdminAuditEvents(pool, request.query?.limit) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_AUDIT_FAILED", "Platform audit events could not be loaded.");
    }
  });

  app.get("/api/admin/releases", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { releases: await listAdminReleases(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_RELEASES_FAILED", "Client releases could not be loaded.");
    }
  });

  app.get("/api/admin/feature-flags", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { flags: await listAdminFeatureFlags(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_FLAGS_FAILED", "Feature flags could not be loaded.");
    }
  });
}

function setAdminCookie(reply: FastifyReply, token: string, expiresAt: string): void {
  const expires = new Date(expiresAt).toUTCString();
  reply.header(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`,
  );
}

function clearAdminCookie(reply: FastifyReply): void {
  reply.header(
    "Set-Cookie",
    `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

function readAdminCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== ADMIN_COOKIE) continue;
    const value = rawValue.join("=");
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
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
