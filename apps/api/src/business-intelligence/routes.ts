import type { FastifyInstance } from "fastify";
import type { BusinessBriefingRange, BusinessActionTransition, MerchantAutomationConfigUpdate } from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { requireBusinessRole, type BusinessRole } from "../auth/authorization.js";
import { authenticateAccessToken, AuthError } from "../auth/security.js";
import { ReportError } from "../reports.js";
import { buildBusinessBriefing } from "./briefing-service.js";
import { listBusinessAttention, evaluateBusinessAttention } from "./attention-service.js";
import { listBusinessActions, generateBusinessActions, transitionBusinessAction, listBusinessActionHistory, BusinessActionError } from "./action-service.js";
import { readMerchantAutomation, configureMerchantAutomation, proposeMerchantAutomation, decideMerchantAutomationRun, MerchantAutomationError } from "./merchant-automation-service.js";
import { loadInventoryIntelligence, InventoryIntelligenceError, type InventoryPlanningHorizon } from "./inventory-intelligence-service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRIEFING_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"];
type Query = { businessId?: string; branchId?: string; range?: string };

export function registerBusinessIntelligenceRoutes(app: FastifyInstance, pool: DatabasePool): void {

  app.get<{ Querystring: Query & { horizonDays?: string } }>(
    "/v1/intelligence/inventory", async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const businessId = validUuid(request.query.businessId, "businessId");
        const branchId = validUuid(request.query.branchId, "branchId");
        await requireBusinessRole(pool, auth, businessId,
          ["OWNER","ADMIN","MANAGER","INVENTORY","ACCOUNTANT"]);
        const selected = request.query.horizonDays ?? "14";
        if (selected !== "7" && selected !== "14" && selected !== "30") {
          throw new InventoryIntelligenceError("horizonDays must be 7, 14 or 30");
        }
        return await loadInventoryIntelligence(pool, businessId, branchId,
          Number(selected) as InventoryPlanningHorizon);
      } catch (error) {
        return sendBusinessIntelligenceError(request, reply, error, "INVENTORY_ADVISORY_FAILED");
      }
    },
  );


  app.get<{ Querystring: Query }>("/v1/intelligence/automation", async (request, reply) => {
    try {
      const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
      if (branchId === null) throw new ReportError("branchId is required.");
      return await readMerchantAutomation(pool, businessId, branchId);
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "MERCHANT_AUTOMATION_READ_FAILED");
    }
  });

  app.put<{ Querystring: Query; Body: MerchantAutomationConfigUpdate }>(
    "/v1/intelligence/automation/config", async (request, reply) => {
      try {
        const { businessId, branchId, userId } = await ownerAutomationScope(pool, request.headers.authorization, request.query);
        return await configureMerchantAutomation(pool, businessId, branchId, userId, request.body);
      } catch (error) {
        return sendBusinessIntelligenceError(request, reply, error, "MERCHANT_AUTOMATION_CONFIG_FAILED");
      }
    },
  );

  app.post<{ Querystring: Query }>("/v1/intelligence/automation/propose", async (request, reply) => {
    try {
      const { businessId, branchId } = await ownerAutomationScope(pool, request.headers.authorization, request.query);
      const proposedCount = await proposeMerchantAutomation(pool, businessId, branchId);
      return { proposedCount, ...(await readMerchantAutomation(pool, businessId, branchId)) };
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "MERCHANT_AUTOMATION_PROPOSAL_FAILED");
    }
  });

  app.post<{ Querystring: Query; Params: { runId: string }; Body: { decision?: "APPROVE" | "REJECT" } }>(
    "/v1/intelligence/automation/runs/:runId/decision", async (request, reply) => {
      try {
        const { businessId, branchId, userId } = await ownerAutomationScope(pool, request.headers.authorization, request.query);
        const runId = validUuid(request.params.runId, "runId");
        return await decideMerchantAutomationRun(pool, {
          businessId, branchId, runId, actorUserId: userId,
          decision: request.body?.decision as "APPROVE" | "REJECT",
        });
      } catch (error) {
        return sendBusinessIntelligenceError(request, reply, error, "MERCHANT_AUTOMATION_DECISION_FAILED");
      }
    },
  );

  app.get<{ Querystring: Query }>("/v1/intelligence/actions", async (request, reply) => {
    try {
      const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
      return await listBusinessActions(pool, businessId, branchId);
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ACTION_READ_FAILED");
    }
  });

  app.post<{ Querystring: Query }>("/v1/intelligence/actions/generate", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
      return await generateBusinessActions(pool, businessId, branchId, auth.userId);
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ACTION_GENERATION_FAILED");
    }
  });

  app.get<{ Params: { actionId: string }; Querystring: Query }>(
    "/v1/intelligence/actions/:actionId/history", async (request, reply) => {
      try {
        const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
        const actionId = validUuid(request.params.actionId, "actionId");
        return await listBusinessActionHistory(pool, businessId, branchId, actionId);
      } catch (error) {
        return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ACTION_HISTORY_FAILED");
      }
    },
  );

  app.patch<{ Params: { actionId: string }; Querystring: Query; Body: BusinessActionTransition }>(
    "/v1/intelligence/actions/:actionId", async (request, reply) => {
      try {
        const auth = await authenticateAccessToken(pool, request.headers.authorization);
        const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
        const actionId = validUuid(request.params.actionId, "actionId");
        return await transitionBusinessAction(pool, {
          businessId, branchId, actionId, actorUserId: auth.userId, transition: request.body,
        });
      } catch (error) {
        return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ACTION_UPDATE_FAILED");
      }
    },
  );

  app.get<{ Querystring: Query }>("/v1/intelligence/attention", async (request, reply) => {
    try {
      const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
      return await listBusinessAttention(pool, businessId, branchId);
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ATTENTION_READ_FAILED");
    }
  });

  app.post<{ Querystring: Query }>("/v1/intelligence/attention/evaluate", async (request, reply) => {
    try {
      const { businessId, branchId } = await readAuthorizedScope(pool, request.headers.authorization, request.query);
      return await evaluateBusinessAttention(pool, businessId, branchId);
    } catch (error) {
      return sendBusinessIntelligenceError(request, reply, error, "BUSINESS_ATTENTION_EVALUATION_FAILED");
    }
  });

  app.get<{ Querystring: Query }>("/v1/intelligence/briefing", async (request, reply) => {
    try {
      const auth = await authenticateAccessToken(pool, request.headers.authorization);
      const businessId = validUuid(request.query.businessId, "businessId");
      const branchId = request.query.branchId === undefined
        ? null : validUuid(request.query.branchId, "branchId");
      const range = validRange(request.query.range);
      // Authorization must be checked before loading any branch-scoped facts.
      // A supplied businessId/branchId can never override the actor's membership.
      await requireBusinessRole(pool, auth, businessId, BRIEFING_ROLES);
      return await buildBusinessBriefing(pool, businessId, branchId, range);
    } catch (error) {
      if (error instanceof AuthError || error instanceof ReportError) {
        return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({
        error: "BUSINESS_BRIEFING_FAILED",
        message: "Business briefing could not be loaded. Sales and other operations are unaffected.",
      });
    }
  });
}

function validUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new ReportError(`${field} must be a UUID`);
  }
  return value;
}

function validRange(value: unknown): BusinessBriefingRange {
  if (value === undefined) return "today";
  if (value !== "today" && value !== "week" && value !== "month") {
    throw new ReportError("range must be today, week or month");
  }
  return value;
}

async function readAuthorizedScope(
  pool: DatabasePool, authorization: string | undefined, query: Query,
): Promise<{ businessId: string; branchId: string | null }> {
  const auth = await authenticateAccessToken(pool, authorization);
  const businessId = validUuid(query.businessId, "businessId");
  const branchId = query.branchId === undefined ? null : validUuid(query.branchId, "branchId");
  await requireBusinessRole(pool, auth, businessId, BRIEFING_ROLES);
  if (branchId !== null) {
    const branch = await pool.query(
      "SELECT 1 FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
      [branchId, businessId],
    );
    if (!branch.rows[0]) throw new ReportError("Branch not found", "BRANCH_NOT_FOUND", 404);
  }
  return { businessId, branchId };
}

async function ownerAutomationScope(
  pool: DatabasePool, authorization: string | undefined, query: Query,
): Promise<{ businessId: string; branchId: string; userId: string }> {
  const auth = await authenticateAccessToken(pool, authorization);
  const businessId = validUuid(query.businessId, "businessId");
  const branchId = validUuid(query.branchId, "branchId");
  await requireBusinessRole(pool, auth, businessId, ["OWNER"]);
  const branch = await pool.query(
    "SELECT 1 FROM branches WHERE id=$1 AND business_id=$2 AND is_active=true",
    [branchId, businessId],
  );
  if (!branch.rows[0]) throw new ReportError("Branch not found", "BRANCH_NOT_FOUND", 404);
  return { businessId, branchId, userId: auth.userId };
}

function sendBusinessIntelligenceError(
  request: { log: { error: (value: unknown) => void } },
  reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
  error: unknown, fallbackCode: string,
) {
  if (error instanceof AuthError || error instanceof ReportError || error instanceof BusinessActionError || error instanceof MerchantAutomationError || error instanceof InventoryIntelligenceError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: fallbackCode, message: "Business intelligence is temporarily unavailable. Sales and other operations are unaffected." });
}
