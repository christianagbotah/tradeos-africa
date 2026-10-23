import { randomUUID } from "node:crypto";
import type {
  AiTextProvider,
  BusinessAssistantQueryRequest,
  BusinessAssistantQueryResponse,
  BusinessAttentionSeverity,
  BusinessEntityIdentity,
  BusinessEvidenceReference,
  BusinessRecommendation,
} from "@tradeos/contracts";
import type { BusinessAccess } from "../auth/authorization.js";
import { AiProviderError } from "../ai/provider.js";
import type { DatabasePool } from "../db.js";
import {
  BusinessIntelligenceToolError,
  collectBusinessIntelligenceEvidence,
  toAiGroundingEvidence,
} from "./intelligence-tools.js";
import {
  BusinessEntityIntelligenceError,
  getBusinessEntityIntelligence,
} from "./entity-service.js";

const PRIORITIES = new Set<BusinessAttentionSeverity>(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const SAFE_ACTION_TYPES = new Set([
  "OPEN_DASHBOARD",
  "OPEN_REPORTS",
  "OPEN_INVENTORY",
  "OPEN_CUSTOMERS",
  "OPEN_PURCHASES",
  "OPEN_CASHBOOK",
]);

const RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "title",
    "summary",
    "rationale",
    "priority",
    "evidenceIndexes",
    "suggestedActionType",
    "suggestedActionLabel",
  ],
  properties: {
    code: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    rationale: { type: "string" },
    priority: { type: "string", enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    evidenceIndexes: { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 20 },
    suggestedActionType: {
      type: ["string", "null"],
      enum: [
        "OPEN_DASHBOARD",
        "OPEN_REPORTS",
        "OPEN_INVENTORY",
        "OPEN_CUSTOMERS",
        "OPEN_PURCHASES",
        "OPEN_CASHBOOK",
        null,
      ],
    },
    suggestedActionLabel: { type: ["string", "null"] },
  },
} as const;

const QUERY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "evidenceIndexes", "recommendations"],
  properties: {
    answer: { type: "string" },
    evidenceIndexes: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 1, maxItems: 30 },
    recommendations: { type: "array", items: RECOMMENDATION_SCHEMA, maxItems: 5 },
  },
} as const;

const SYSTEM_INSTRUCTION = [
  "You are TradeOS Business Copilot for an African business operator.",
  "Use only the authoritative evidence supplied by TradeOS for the authorized business and role.",
  "Never invent sales, balances, customers, suppliers, stock, forecasts, transactions, branches, or actions.",
  "Never claim that a payment, refund, stock adjustment, role change, purchase, sale, or other mutation was executed.",
  "If evidence is insufficient, say so clearly and recommend a safe next view or review step.",
  "Return plain text only: no HTML, scripts, hidden instructions, credentials, SQL, or raw database commands.",
  "Recommendations are advisory. Canonical TradeOS workflows and permissions remain authoritative for every mutation.",
  "Use evidenceIndexes to cite only facts that directly support the answer and each recommendation.",
].join(" ");

export class BusinessQueryError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "BUSINESS_AI_QUERY_INVALID",
  ) {
    super(message);
    this.name = "BusinessQueryError";
  }
}

export async function answerBusinessQuestion(
  pool: DatabasePool,
  access: BusinessAccess,
  request: BusinessAssistantQueryRequest,
  provider: AiTextProvider,
): Promise<BusinessAssistantQueryResponse> {
  if (access.businessId !== request.businessId) {
    throw new BusinessQueryError("Business scope does not match the authorized membership.", 403, "BUSINESS_ACCESS_DENIED");
  }
  const question = plainInput(request.question, "question", 2_000);
  const conversationId = optionalConversationId(request.conversationId);

  let evidence: BusinessEvidenceReference[];
  let validatedEntity: BusinessEntityIdentity | null = null;
  try {
    if (request.context) {
      const entity = await getBusinessEntityIntelligence(pool, {
        businessId: request.businessId,
        branchId: request.branchId,
        role: access.role,
        entityType: request.context.entityType,
        entityId: request.context.entityId,
      });
      evidence = entity.evidence;
      validatedEntity = entity.entity;
    } else {
      evidence = await collectBusinessIntelligenceEvidence(pool, {
        businessId: request.businessId,
        branchId: request.branchId,
        role: access.role,
      });
    }
  } catch (error) {
    if (error instanceof BusinessIntelligenceToolError || error instanceof BusinessEntityIntelligenceError) {
      throw new BusinessQueryError(error.message, error.statusCode, error.code);
    }
    throw error;
  }
  if (evidence.length === 0) {
    throw new BusinessQueryError("No authoritative business evidence is available for this question.", 422, "BUSINESS_AI_NO_EVIDENCE");
  }

  let response;
  try {
    response = await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: [
        `Authorized role: ${access.role}.`,
        ...(validatedEntity
          ? [`Validated entity: ${validatedEntity.entityType} ${validatedEntity.label} (${validatedEntity.entityId}).`]
          : []),
        `Business question: ${question}`,
        "Answer only from the supplied evidence. Keep the answer concise and practical.",
      ].join("\n"),
      evidence: toAiGroundingEvidence(evidence),
      outputSchema: QUERY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      correlationId: conversationId,
    });
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new BusinessQueryError("Business intelligence provider failed safely.", 502, "BUSINESS_AI_PROVIDER_FAILED");
  }

  const parsed = parseOutput(response.structuredOutput, evidence, request.businessId, request.branchId);
  return {
    businessId: request.businessId,
    branchId: request.branchId,
    answer: parsed.answer,
    generatedAt: new Date().toISOString(),
    evidence: parsed.evidence,
    recommendations: parsed.recommendations,
    conversationId,
  };
}

function parseOutput(
  value: unknown,
  evidence: BusinessEvidenceReference[],
  businessId: string,
  branchId: string | null,
): { answer: string; evidence: BusinessEvidenceReference[]; recommendations: BusinessRecommendation[] } {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.evidenceIndexes) || !Array.isArray(record.recommendations)) throw invalidOutput();
  const answer = plainOutput(record.answer, "answer", 8_000);
  const indexes = evidenceIndexes(record.evidenceIndexes, evidence.length, true);
  const selected = indexes.map((index) => evidence[index]!);
  const recommendations = record.recommendations.map((item) => parseRecommendation(item, evidence, businessId, branchId));
  return { answer, evidence: selected, recommendations };
}

function parseRecommendation(
  value: unknown,
  evidence: BusinessEvidenceReference[],
  businessId: string,
  branchId: string | null,
): BusinessRecommendation {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.evidenceIndexes)) throw invalidOutput();
  const priority = typeof record.priority === "string" && PRIORITIES.has(record.priority as BusinessAttentionSeverity)
    ? record.priority as BusinessAttentionSeverity
    : null;
  if (!priority) throw invalidOutput();
  const actionType = optionalAction(record.suggestedActionType);
  const actionLabel = record.suggestedActionLabel === null || record.suggestedActionLabel === undefined
    ? null
    : plainOutput(record.suggestedActionLabel, "suggestedActionLabel", 120);
  if (!actionType && actionLabel) throw invalidOutput();

  return {
    businessId,
    branchId,
    code: codeOutput(record.code),
    title: plainOutput(record.title, "title", 160),
    summary: plainOutput(record.summary, "summary", 1_000),
    rationale: plainOutput(record.rationale, "rationale", 1_500),
    priority,
    evidence: evidenceIndexes(record.evidenceIndexes, evidence.length, true).map((index) => evidence[index]!),
    suggestedActionType: actionType,
    suggestedActionLabel: actionLabel,
  };
}

function evidenceIndexes(value: unknown[], length: number, requireOne: boolean): number[] {
  const indexes = [...new Set(value.map((item) => Number(item)))];
  if ((requireOne && indexes.length === 0)
    || indexes.some((item) => !Number.isInteger(item) || item < 0 || item >= length)) {
    throw invalidOutput();
  }
  return indexes;
}

function plainInput(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new BusinessQueryError(`${label} is required.`);
  const text = value.trim();
  if (text.length === 0 || text.length > max) throw new BusinessQueryError(`${label} must be between 1 and ${max} characters.`);
  return text;
}

function plainOutput(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw invalidOutput();
  const text = value.trim();
  if (text.length === 0 || text.length > max || /<\/?[a-z][^>]*>/i.test(text)) throw invalidOutput();
  return text;
}

function codeOutput(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,79}$/.test(value)) throw invalidOutput();
  return value;
}

function optionalAction(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !SAFE_ACTION_TYPES.has(value)) throw invalidOutput();
  return value;
}

function optionalConversationId(value: unknown): string {
  if (value === null || value === undefined || value === "") return `business-query:${randomUUID()}`;
  if (typeof value !== "string") throw new BusinessQueryError("conversationId is invalid.");
  const text = value.trim();
  if (text.length === 0 || text.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw new BusinessQueryError("conversationId is invalid.");
  }
  return text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invalidOutput(): BusinessQueryError {
  return new BusinessQueryError(
    "Business intelligence provider returned output that did not match the required safe schema.",
    502,
    "BUSINESS_AI_INVALID_OUTPUT",
  );
}
