import type { FastifyInstance } from "fastify";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import {
  assertBusinessIntelligenceBranchScope,
  BusinessIntelligenceError,
  evaluateBusinessAttention,
  listBusinessAttention,
} from "./attention-service.js";

const INTELLIGENCE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AttentionQuery = { businessId?: string; branchId?: string };
type EvaluateBody = { businessId?: string; branchId?: string | null; correlationId?: string };

export function registerBusinessIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: AttentionQuery }>("/v1/intelligence/attention", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = requiredUuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      await requireBusinessRole(pool, auth, businessId, INTELLIGENCE_ROLES);
      await assertBusinessIntelligenceBranchScope(pool, businessId, branchId);
      return { items: await listBusinessAttention(pool, { businessId, branchId }) };
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post<{ Body: EvaluateBody }>("/v1/intelligence/attention/evaluate", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = requiredUuid(request.body?.businessId, "businessId");
      const branchId = optionalUuid(request.body?.branchId ?? undefined, "branchId");
      await requireBusinessRole(pool, auth, businessId, INTELLIGENCE_ROLES);
      await assertBusinessIntelligenceBranchScope(pool, businessId, branchId);
      return { items: await evaluateBusinessAttention(pool, { businessId, branchId }) };
    } catch (error) {
      return handleError(error, reply);
    }
  });
}

function requiredUuid(value: string | undefined, field: string): string {
  if (!value || !UUID.test(value)) {
    throw new BusinessIntelligenceError(`${field} must be a valid UUID`, 400, "BUSINESS_INTELLIGENCE_INVALID_SCOPE");
  }
  return value;
}

function optionalUuid(value: string | undefined, field: string): string | null {
  if (value === undefined || value === "") return null;
  return requiredUuid(value, field);
}

function handleError(error: unknown, reply: { code(statusCode: number): { send(payload: unknown): unknown } }): unknown {
  if (error instanceof AuthError || error instanceof BusinessIntelligenceError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}
