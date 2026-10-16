import type { FastifyInstance } from "fastify";
import type { DatabasePool } from "../db.js";
import { AiProviderError } from "../ai/provider.js";
import { OpenAiResponsesProvider } from "../ai/openai-responses-provider.js";
import { createPlatformAdminIntelligenceService } from "./intelligence-service.js";
import { authenticatePlatformAdmin, PlatformAdminError } from "./security.js";

const ADMIN_COOKIE = "__Host-tradeos_admin_session";

export function registerPlatformAdminIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {
  const service = createPlatformAdminIntelligenceService({ pool, provider: new OpenAiResponsesProvider() });

  app.post<{ Body: Record<string, unknown> }>("/api/admin/intelligence/query", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return await service.query(admin, request.body ?? {});
    } catch (error) {
      return sendIntelligenceError(request, reply, error, "ADMIN_AI_QUERY_FAILED", "Platform intelligence query could not be completed.");
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/api/admin/intelligence/briefing", async (request, reply) => {
    try {
      const admin = await authenticatePlatformAdmin(pool, readAdminCookie(request.headers.cookie));
      return await service.briefing(admin, request.body ?? {});
    } catch (error) {
      return sendIntelligenceError(request, reply, error, "ADMIN_AI_BRIEFING_FAILED", "Platform intelligence briefing could not be completed.");
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

function sendIntelligenceError(
  request: { log: { error: (error: unknown) => void } },
  reply: { code: (status: number) => { send: (payload?: unknown) => unknown } },
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof PlatformAdminError || error instanceof AiProviderError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: fallbackCode, message: fallbackMessage });
}
