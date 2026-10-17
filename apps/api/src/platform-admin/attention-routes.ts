import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { evaluatePlatformAttention, listPlatformAttention } from "./attention-service.js";
import { authenticatePlatformAdmin, PlatformAdminError } from "./security.js";

const ADMIN_COOKIE = "__Host-tradeos_admin_session";

export function registerPlatformAdminAttentionRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get("/api/admin/attention", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { items: await listPlatformAttention(pool, admin) };
    } catch (error) {
      return sendAttentionError(request, reply, error, "ADMIN_ATTENTION_FAILED", "Platform attention could not be loaded.");
    }
  });

  app.post<{ Body: { correlationId?: unknown } }>("/api/admin/attention/evaluate", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return { items: await evaluatePlatformAttention(pool, admin, request.body ?? {}) };
    } catch (error) {
      return sendAttentionError(request, reply, error, "ADMIN_ATTENTION_EVALUATION_FAILED", "Platform attention could not be evaluated.");
    }
  });
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

function sendAttentionError(
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
