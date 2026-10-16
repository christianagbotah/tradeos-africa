import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import {
  approveAutomationRun,
  createAutomationPolicy,
  evaluateAutomationPolicy,
  listAutomationPolicies,
  listAutomationRuns,
  rejectAutomationRun,
} from "./automation-service.js";
import { registerPlatformAdminIntelligenceRoutes } from "./intelligence-routes.js";
import { authenticatePlatformAdmin, PlatformAdminError } from "./security.js";

const ADMIN_COOKIE = "__Host-tradeos_admin_session";

export function registerPlatformAdminAutomationRoutes(app: FastifyInstance, pool: DatabasePool): void {
  registerPlatformAdminIntelligenceRoutes(app, pool);

  app.get("/api/admin/automation/policies", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { policies: await listAutomationPolicies(pool, admin) };
    } catch (error) {
      return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_POLICIES_FAILED", "Automation policies could not be loaded.");
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/api/admin/automation/policies", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      const policy = await createAutomationPolicy(pool, admin, request.body ?? {});
      return reply.code(201).send({ policy });
    } catch (error) {
      return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_POLICY_CREATE_FAILED", "Automation policy could not be created.");
    }
  });

  app.get("/api/admin/automation/runs", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { runs: await listAutomationRuns(pool, admin) };
    } catch (error) {
      return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_RUNS_FAILED", "Automation runs could not be loaded.");
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/api/admin/automation/evaluate", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { run: await evaluateAutomationPolicy(pool, admin, request.body ?? {}) };
    } catch (error) {
      return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_EVALUATION_FAILED", "Automation policy could not be evaluated.");
    }
  });

  app.post<{ Params: { runId: string }; Body: Record<string, unknown> }>(
    "/api/admin/automation/runs/:runId/approve",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { run: await approveAutomationRun(pool, admin, request.params.runId, request.body ?? {}) };
      } catch (error) {
        return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_APPROVAL_FAILED", "Automation run could not be approved.");
      }
    },
  );

  app.post<{ Params: { runId: string }; Body: Record<string, unknown> }>(
    "/api/admin/automation/runs/:runId/reject",
    async (request, reply) => {
      try {
        const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
        return { run: await rejectAutomationRun(pool, admin, request.params.runId, request.body ?? {}) };
      } catch (error) {
        return sendAutomationError(request, reply, error, "ADMIN_AUTOMATION_REJECTION_FAILED", "Automation run could not be rejected.");
      }
    },
  );
}

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

function sendAutomationError(
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
