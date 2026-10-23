import type { FastifyInstance } from "fastify";
import type { BusinessEntityContext, BusinessEntityType, BusinessInsightRange } from "@tradeos/contracts";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { AiProviderError } from "../ai/provider.js";
import { OpenAiResponsesProvider } from "../ai/openai-responses-provider.js";
import type { DatabasePool } from "../db.js";
import {
  BusinessAttentionError,
  evaluateBusinessAttention,
  FINANCIAL_BUSINESS_ATTENTION_RULE_CODES,
  listBusinessAttention,
} from "./attention-service.js";
import {
  BusinessAutomationError,
  completeBusinessActionItem,
  createBusinessAutomationPolicy,
  evaluateBusinessAutomation,
  listBusinessActionItems,
  listBusinessAutomationPolicies,
  snoozeBusinessActionItem,
  updateBusinessAutomationPolicy,
} from "./automation-service.js";
import { buildBusinessBriefing, BusinessBriefingError } from "./briefing-service.js";
import {
  BusinessEntityIntelligenceError,
  getBusinessEntityIntelligence,
} from "./entity-service.js";
import { answerBusinessQuestion, BusinessQueryError } from "./query-service.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER", "SALES", "INVENTORY", "STAFF", "VIEWER",
];
const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const EVALUATE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const BRIEFING_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const AUTOMATION_CONFIGURE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER"];
const AUTOMATION_EVALUATE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set<BusinessEntityType>(["CATALOG_ITEM", "CUSTOMER", "SUPPLIER", "PURCHASE"]);

type AttentionQuery = { businessId?: string; branchId?: string };
type BriefingQuery = AttentionQuery & { range?: string };
type EntityQuery = AttentionQuery & { entityType?: string; entityId?: string };
type EvaluateBody = { businessId?: string; branchId?: string | null; correlationId?: string };
type QueryBody = {
  businessId?: string;
  branchId?: string | null;
  question?: string;
  conversationId?: string | null;
  context?: unknown;
  tools?: unknown;
};
type AutomationBody = Record<string, unknown>;
type IdParams = { id: string };

export function registerBusinessIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {
  const provider = new OpenAiResponsesProvider();

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

  app.get<{ Querystring: EntityQuery }>("/v1/intelligence/entity", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const entityType = businessEntityType(request.query.entityType);
      const entityId = uuid(request.query.entityId, "entityId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      return await getBusinessEntityIntelligence(pool, {
        businessId,
        branchId,
        role: access.role,
        entityType,
        entityId,
      });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Body: QueryBody }>("/v1/intelligence/query", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const branchId = optionalUuid(body.branchId ?? undefined, "branchId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const context = optionalEntityContext(body.context);
      if (Object.prototype.hasOwnProperty.call(body, "tools")) {
        throw new BusinessQueryError(
          "Client-selected intelligence tools are not supported. TradeOS chooses safe evidence sources server-side.",
          400,
          "BUSINESS_AI_TOOL_UNSUPPORTED",
        );
      }
      return await answerBusinessQuestion(
        pool,
        access,
        {
          businessId,
          branchId,
          question: typeof body.question === "string" ? body.question : "",
          conversationId: body.conversationId ?? null,
          context,
        },
        provider,
      );
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

  app.get<{ Querystring: AttentionQuery }>("/v1/intelligence/automations", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const access = await requireBusinessRole(pool, auth, businessId, AUTOMATION_CONFIGURE_ROLES);
      const policies = await listBusinessAutomationPolicies(pool, automationActor(auth.userId, access), branchId);
      return { policies };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Body: AutomationBody }>("/v1/intelligence/automations", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, AUTOMATION_CONFIGURE_ROLES);
      const policy = await createBusinessAutomationPolicy(pool, automationActor(auth.userId, access), body);
      return reply.code(201).send({ policy });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.patch<{ Params: IdParams; Body: AutomationBody }>("/v1/intelligence/automations/:id", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, AUTOMATION_CONFIGURE_ROLES);
      const policy = await updateBusinessAutomationPolicy(pool, automationActor(auth.userId, access), request.params.id, body);
      return { policy };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Body: AutomationBody }>("/v1/intelligence/automations/evaluate", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, AUTOMATION_EVALUATE_ROLES);
      const run = await evaluateBusinessAutomation(pool, automationActor(auth.userId, access), body);
      return { run };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.get<{ Querystring: AttentionQuery }>("/v1/intelligence/action-items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const items = await listBusinessActionItems(pool, automationActor(auth.userId, access), branchId);
      return { items };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Params: IdParams; Body: AutomationBody }>("/v1/intelligence/action-items/:id/snooze", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const item = await snoozeBusinessActionItem(pool, automationActor(auth.userId, access), request.params.id, body);
      return { item };
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Params: IdParams; Body: AutomationBody }>("/v1/intelligence/action-items/:id/complete", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      const businessId = uuid(body.businessId, "businessId");
      const access = await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const item = await completeBusinessActionItem(pool, automationActor(auth.userId, access), request.params.id, body);
      return { item };
    } catch (error) {
      return sendError(error, reply);
    }
  });
}

function automationActor(userId: string, access: { businessId: string; role: BusinessRole; staffId: string | null }) {
  return { userId, businessId: access.businessId, role: access.role, staffId: access.staffId };
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

function businessEntityType(value: unknown): BusinessEntityType {
  if (typeof value === "string" && ENTITY_TYPES.has(value as BusinessEntityType)) return value as BusinessEntityType;
  throw new BusinessEntityIntelligenceError(
    "entityType must be one of CATALOG_ITEM, CUSTOMER, SUPPLIER, PURCHASE.",
    400,
    "ENTITY_TYPE_UNSUPPORTED",
  );
}

function optionalEntityContext(value: unknown): BusinessEntityContext | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessEntityIntelligenceError("Entity context is invalid.", 400, "ENTITY_CONTEXT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "entityType" && key !== "entityId")) {
    throw new BusinessEntityIntelligenceError("Entity context contains unsupported fields.", 400, "ENTITY_CONTEXT_INVALID");
  }
  return {
    entityType: businessEntityType(record.entityType),
    entityId: uuid(record.entityId, "context.entityId"),
  };
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
  if (error instanceof AuthError
    || error instanceof BusinessAttentionError
    || error instanceof BusinessAutomationError
    || error instanceof BusinessBriefingError
    || error instanceof BusinessEntityIntelligenceError
    || error instanceof BusinessQueryError
    || error instanceof AiProviderError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

void FINANCIAL_BUSINESS_ATTENTION_RULE_CODES;
