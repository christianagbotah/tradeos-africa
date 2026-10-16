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
import {
  changeAdminPassword,
  getAdminProfile,
  listOwnAdminSessions,
  revokeOwnAdminSession,
  updateAdminProfile,
} from "./profile-service.js";
import { changeTenantStatus, getTenant360 } from "./tenant-service.js";
import {
  createPlan,
  listPlans,
  listSubscriptions,
  setPlanEntitlements,
  transitionSubscription,
  updatePlan,
} from "./subscription-service.js";
import {
  createPlatformAdmin,
  listPlatformAdmins,
  setPlatformAdminActive,
  updatePlatformAdminRole,
} from "./admin-user-service.js";

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

  app.get("/api/admin/profile", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { profile: await getAdminProfile(pool, admin) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PROFILE_FAILED", "Administrator profile could not be loaded.");
    }
  });

  app.patch<{ Body: { email?: unknown; displayName?: unknown } }>("/api/admin/profile", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { profile: await updateAdminProfile(pool, admin, request.body ?? {}) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PROFILE_UPDATE_FAILED", "Administrator profile could not be updated.");
    }
  });

  app.post<{ Body: { currentPassword?: unknown; newPassword?: unknown } }>("/api/admin/profile/password", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      await changeAdminPassword(pool, admin, request.body ?? {});
      return reply.code(204).send();
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PASSWORD_CHANGE_FAILED", "Administrator password could not be changed.");
    }
  });

  app.get("/api/admin/profile/sessions", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { sessions: await listOwnAdminSessions(pool, admin) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_SESSIONS_FAILED", "Administrator sessions could not be loaded.");
    }
  });

  app.delete<{ Params: { sessionId: string } }>("/api/admin/profile/sessions/:sessionId", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      await revokeOwnAdminSession(pool, admin, request.params.sessionId);
      return reply.code(204).send();
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_SESSION_REVOKE_FAILED", "Administrator session could not be revoked.");
    }
  });

  app.get("/api/admin/admins", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { admins: await listPlatformAdmins(pool, admin) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_USERS_FAILED", "Platform administrators could not be loaded.");
    }
  });

  app.post<{ Body: { email?: unknown; displayName?: unknown; role?: unknown; reason?: unknown } }>(
    "/api/admin/admins",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return reply.code(201).send({ admin: await createPlatformAdmin(pool, admin, request.body ?? {}) });
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_USER_CREATE_FAILED", "Platform administrator could not be created.");
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: unknown; reason?: unknown } }>(
    "/api/admin/admins/:id/role",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { admin: await updatePlatformAdminRole(pool, admin, request.params.id, request.body ?? {}) };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_USER_ROLE_FAILED", "Administrator role could not be changed.");
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { active?: unknown; reason?: unknown } }>(
    "/api/admin/admins/:id/status",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { admin: await setPlatformAdminActive(pool, admin, request.params.id, request.body ?? {}) };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_USER_STATUS_FAILED", "Administrator status could not be changed.");
      }
    },
  );

  app.get("/api/admin/tenants", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { tenants: await listAdminTenants(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANTS_FAILED", "Tenants could not be loaded.");
    }
  });

  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id/overview", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { tenant: await getTenant360(pool, admin, request.params.id) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANT_OVERVIEW_FAILED", "Tenant overview could not be loaded.");
    }
  });

  app.patch<{ Params: { id: string }; Body: { status?: unknown; reason?: unknown; expectedUpdatedAt?: unknown } }>(
    "/api/admin/tenants/:id/status",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { tenant: await changeTenantStatus(pool, admin, request.params.id, request.body ?? {}) };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_TENANT_STATUS_FAILED", "Tenant status could not be changed.");
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/admin/tenants/:id", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { tenant: await getAdminTenant(pool, request.params.id) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_TENANT_FAILED", "Tenant details could not be loaded.");
    }
  });

  app.get("/api/admin/plans", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { plans: await listPlans(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PLANS_FAILED", "Plans could not be loaded.");
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/api/admin/plans", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return reply.code(201).send({ plan: await createPlan(pool, admin, request.body ?? {}) });
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PLAN_CREATE_FAILED", "Plan could not be created.");
    }
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/admin/plans/:id", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { plan: await updatePlan(pool, admin, request.params.id, request.body ?? {}) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_PLAN_UPDATE_FAILED", "Plan could not be updated.");
    }
  });

  app.put<{ Params: { id: string }; Body: { entitlements?: unknown; reason?: unknown; expectedUpdatedAt?: unknown } }>(
    "/api/admin/plans/:id/entitlements",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { plan: await setPlanEntitlements(pool, admin, request.params.id, request.body ?? {}) };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_PLAN_ENTITLEMENTS_FAILED", "Plan entitlements could not be updated.");
      }
    },
  );

  app.get("/api/admin/subscriptions", async (request, reply) => {
    try {
      await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { subscriptions: await listSubscriptions(pool) };
    } catch (error) {
      return sendAdminError(request, reply, error, "ADMIN_SUBSCRIPTIONS_FAILED", "Subscriptions could not be loaded.");
    }
  });

  app.post<{ Params: { id: string }; Body: { planId?: unknown; mode?: unknown; reason?: unknown } }>(
    "/api/admin/tenants/:id/subscription",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        const subscription = await transitionSubscription(pool, admin, {
          action: "ASSIGN", businessId: request.params.id, planId: request.body?.planId, mode: request.body?.mode, reason: request.body?.reason,
        });
        return reply.code(201).send({ subscription });
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_SUBSCRIPTION_CREATE_FAILED", "Subscription could not be assigned.");
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { action?: unknown; planId?: unknown; reason?: unknown; expectedUpdatedAt?: unknown } }>(
    "/api/admin/subscriptions/:id",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { subscription: await transitionSubscription(pool, admin, {
          subscriptionId: request.params.id, action: request.body?.action, planId: request.body?.planId,
          reason: request.body?.reason, expectedUpdatedAt: request.body?.expectedUpdatedAt,
        }) };
      } catch (error) {
        return sendAdminError(request, reply, error, "ADMIN_SUBSCRIPTION_UPDATE_FAILED", "Subscription could not be changed.");
      }
    },
  );

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
