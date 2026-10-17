import type { FastifyInstance } from "fastify";
import type { BusinessInsightRange } from "@tradeos/contracts";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import type { DatabasePool } from "../db.js";
import {
  BusinessAttentionError,
  evaluateBusinessAttention,
  FINANCIAL_BUSINESS_ATTENTION_RULE_CODES,
  listBusinessAttention,
} from "./attention-service.js";
import { buildBusinessBriefing, BusinessBriefingError } from "./briefing-service.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER", "SALES", "INVENTORY", "STAFF", "VIEWER",
];
const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const EVALUATE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const BRIEFING_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AttentionQuery = { businessId?: string; branchId?: string };
type BriefingQuery = AttentionQuery & { range?: string };
type EvaluateBody = { businessId?: string; branchId?: string | null; correlationId?: string };

export function registerBusinessIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {
  app.get<{ Querystring: AttentionQuery }>("/v1/intelligence/attention", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const items = await listBusinessAttention(pool, {
        businessId,
        branchId,
        includeFinancial: FINANCIAL_ROLES.has(access.role),
      });
      return { items };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.get<{ Querystring: BriefingQuery }>("/v1/intelligence/briefing", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const range = insightRange(request.query.range);
      await requireBusinessRole(pool, auth, businessId, BRIEFING_ROLES);
      return await buildBusinessBriefing(pool, { businessId, branchId, range });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Body: EvaluateBody }>("/v1/intelligence/attention/evaluate", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.body?.businessId, "businessId");
      const branchId = optionalUuid(request.body?.branchId ?? undefined, "branchId");
      const correlationId = text(request.body?.correlationId, "correlationId", 200);
      await requireBusinessRole(pool, auth, businessId, EVALUATE_ROLES);
      const items = await evaluateBusinessAttention(pool, {
        businessId,
        branchId,
        now: new Date(),
        correlationId,
      });
      return { items };
    } catch (error) {
      return sendError(error, reply);
    }
  });
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new BusinessAttentionError(`${label} must be a UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return uuid(value, label);
}

function insightRange(value: unknown): BusinessInsightRange {
  if (value === "today" || value === "week" || value === "month") return value;
  throw new BusinessBriefingError("range must be one of today, week, month");
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > max) {
    throw new BusinessAttentionError(`${label} is required and must be at most ${max} characters`);
  }
  return value.trim();
}

function sendError(error: unknown, reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
  if (error instanceof AuthError || error instanceof BusinessAttentionError || error instanceof BusinessBriefingError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

void FINANCIAL_BUSINESS_ATTENTION_RULE_CODES;
