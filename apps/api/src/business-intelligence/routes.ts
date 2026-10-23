import type { FastifyInstance } from "fastify";
import type {
  BusinessAssistantContext,
  BusinessEntityContext,
  BusinessEntityType,
  BusinessFinancialMetricKey,
  BusinessFinancialMetricRange,
  BusinessInsightRange,
  BusinessMetricContext,
} from "@tradeos/contracts";
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
import {
  BusinessEntityActionError,
  createBusinessEntityActionItem,
} from "./entity-action-service.js";
import {
  BusinessMetricIntelligenceError,
  getBusinessFinancialMetricIntelligence,
} from "./metric-service.js";
import { answerBusinessQuestion, BusinessQueryError } from "./query-service.js";

const READ_ROLES: readonly BusinessRole[] = [
  "OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "CASHIER", "SALES", "INVENTORY", "STAFF", "VIEWER",
];
const FINANCIAL_ROLES = new Set<BusinessRole>(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);
const REPORT_READ_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT", "VIEWER"];
const EVALUATE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const BRIEFING_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const AUTOMATION_CONFIGURE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER"];
const AUTOMATION_EVALUATE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set<BusinessEntityType>(["CATALOG_ITEM", "CUSTOMER", "SUPPLIER", "PURCHASE"]);
const FINANCIAL_METRIC_KEYS = new Set<BusinessFinancialMetricKey>([
  "NET_REVENUE", "GROSS_PROFIT", "OPERATING_PROFIT", "EXPENSES", "NET_CASH_MOVEMENT",
  "CASH_BALANCE", "RECEIVABLES", "PAYABLES", "INVENTORY_VALUE",
]);
const FINANCIAL_METRIC_RANGES = new Set<BusinessFinancialMetricRange>(["today", "week", "month", "quarter"]);

type AttentionQuery = { businessId?: string; branchId?: string };
type BriefingQuery = AttentionQuery & { range?: string };
type EntityQuery = AttentionQuery & { entityType?: string; entityId?: string };
type MetricQuery = AttentionQuery & { metricKey?: string; range?: string };
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

  app.get<{ Querystring: MetricQuery }>("/v1/intelligence/metric", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = uuid(request.query.businessId, "businessId");
      const branchId = optionalUuid(request.query.branchId, "branchId");
      const metricKey = financialMetricKey(request.query.metricKey);
      const range = financialMetricRange(request.query.range);
      await requireBusinessRole(pool, auth, businessId, REPORT_READ_ROLES);
      return await getBusinessFinancialMetricIntelligence(pool, { businessId, branchId, metricKey, range });
    } catch (error) {
      return sendError(error, reply);
    }
  });

  app.post<{ Body: Record<string, unknown> }>("/v1/intelligence/entity/action-items", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const body = request.body ?? {};
      assertEntityActionBodyShape(body);
      const businessId = uuid(body.businessId, "businessId");
      const branchId = optionalUuid(body.branchId ?? undefined, "branchId");
      const context = optionalEntityContext(body.context);
      if (!context) {
        throw new BusinessEntityActionError("Entity context is required.", 400, "ENTITY_CONTEXT_INVALID");
      }
      await requireBusinessRole(pool, auth, businessId, READ_ROLES);
      const result = await createBusinessEntityActionItem(
        pool,
        { userId: auth.userId, businessId },
        { businessId, branchId, entityType: context.entityType, entityId: context.entityId },
      );
      return reply.code(result.created ? 201 : 200).send(result);
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
      const context = optionalAssistantContext(body.context);
      const access = await requireBusinessRole(
        pool, auth, businessId, isMetricContext(context) ? REPORT_READ_ROLES : READ_ROLES,
      );
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

function assertEntityActionBodyShape(value: Record<string, unknown>): void {
  const allowed = new Set(["businessId", "branchId", "context"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BusinessEntityActionError(
      "Entity review task details are server-owned and cannot be shaped by the client.",
      400,
      "ENTITY_ACTION_CLIENT_SHAPING_FORBIDDEN",
    );
  }
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


function financialMetricKey(value: unknown): BusinessFinancialMetricKey {
  if (typeof value === "string" && FINANCIAL_METRIC_KEYS.has(value as BusinessFinancialMetricKey)) {
    return value as BusinessFinancialMetricKey;
  }
  throw new BusinessMetricIntelligenceError(
    "metricKey is unsupported.", 400, "BUSINESS_METRIC_UNSUPPORTED",
  );
}

function financialMetricRange(value: unknown): BusinessFinancialMetricRange {
  if (typeof value === "string" && FINANCIAL_METRIC_RANGES.has(value as BusinessFinancialMetricRange)) {
    return value as BusinessFinancialMetricRange;
  }
  throw new BusinessMetricIntelligenceError(
    "range must be one of today, week, month, quarter.", 400, "BUSINESS_METRIC_RANGE_INVALID",
  );
}

function optionalMetricContext(value: Record<string, unknown>): BusinessMetricContext {
  return {
    metricKey: financialMetricKey(value.metricKey),
    range: financialMetricRange(value.range),
  };
}

function optionalAssistantContext(value: unknown): BusinessAssistantContext | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessQueryError("Assistant context is invalid.", 400, "BUSINESS_AI_CONTEXT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const entityKeys = keys.filter((key) => key === "entityType" || key === "entityId");
  const metricKeys = keys.filter((key) => key === "metricKey" || key === "range");
  const hasOther = keys.some((key) => !["entityType", "entityId", "metricKey", "range"].includes(key));
  if (hasOther || (entityKeys.length > 0 && metricKeys.length > 0)) {
    throw new BusinessQueryError("Assistant context contains unsupported or mixed fields.", 400, "BUSINESS_AI_CONTEXT_INVALID");
  }
  if (entityKeys.length > 0) return optionalEntityContext(record);
  if (metricKeys.length > 0) {
    if (keys.length !== 2 || !keys.includes("metricKey") || !keys.includes("range")) {
      throw new BusinessQueryError("Financial metric context is incomplete.", 400, "BUSINESS_AI_CONTEXT_INVALID");
    }
    return optionalMetricContext(record);
  }
  throw new BusinessQueryError("Assistant context is invalid.", 400, "BUSINESS_AI_CONTEXT_INVALID");
}

function isMetricContext(value: BusinessAssistantContext | null): value is BusinessMetricContext {
  return value !== null && "metricKey" in value;
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
    || error instanceof BusinessEntityActionError
    || error instanceof BusinessEntityIntelligenceError
    || error instanceof BusinessMetricIntelligenceError
    || error instanceof BusinessQueryError
    || error instanceof AiProviderError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  throw error;
}

void FINANCIAL_BUSINESS_ATTENTION_RULE_CODES;
