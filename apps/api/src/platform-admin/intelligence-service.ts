import type {
  AdminAiBriefing,
  AdminAiRecommendation,
  AdminAttentionSeverity,
  AiGroundingEvidence,
  AiTextProvider,
} from "@tradeos/contracts";
import type { DatabasePool } from "../db.js";
import { AiProviderError } from "../ai/provider.js";
import { collectAdminIntelligenceEvidence, parseAdminIntelligenceTools } from "./intelligence-tools.js";
import { listPlatformAttention } from "./attention-service.js";
import { PlatformAdminError, type PlatformAdminContext } from "./security.js";

const PRIORITIES = new Set<AdminAttentionSeverity>(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const RECOMMENDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "priority", "executionClass", "businessId", "actionType"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    priority: { type: "string", enum: ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    executionClass: { type: "integer", enum: [0, 1, 2, 3] },
    businessId: { type: ["string", "null"] },
    actionType: { type: ["string", "null"] },
  },
} as const;

const QUERY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "recommendations"],
  properties: {
    answer: { type: "string" },
    recommendations: { type: "array", items: RECOMMENDATION_SCHEMA },
  },
} as const;

const BRIEFING_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "recommendations"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    recommendations: { type: "array", items: RECOMMENDATION_SCHEMA },
  },
} as const;

const SYSTEM_INSTRUCTION = [
  "You are the TradeOS platform operations copilot.",
  "Use only the supplied authoritative evidence. Never invent platform state or claim an action was executed.",
  "Separate observed facts from recommendations and state uncertainty when evidence is insufficient.",
  "Recommendations are advisory only; canonical TradeOS services and approval policies control every mutation.",
  "Do not request or reveal passwords, tokens, credentials, provider secrets, or raw payment credentials.",
].join(" ");

export function createPlatformAdminIntelligenceService(args: { pool: DatabasePool; provider: AiTextProvider }) {
  const { pool, provider } = args;

  return {
    async query(
      actor: PlatformAdminContext,
      input: { question?: unknown; tools?: unknown; correlationId?: unknown; businessId?: unknown },
    ) {
      const question = requireText(input.question, "ADMIN_AI_QUESTION_REQUIRED", 2_000);
      const correlationId = requireIdentifier(input.correlationId, "ADMIN_AI_CORRELATION_REQUIRED", 200);
      const businessId = optionalUuid(input.businessId);
      const tools = parseAdminIntelligenceTools(input.tools);
      const evidence = await collectAdminIntelligenceEvidence(
        pool,
        actor,
        tools,
        businessId ? { businessId } : {},
      );
      const response = await generate(provider, {
        prompt: `Answer this platform-operations question using only the evidence: ${question}`,
        evidence,
        correlationId,
        outputSchema: QUERY_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      });
      const output = parseQueryOutput(response.structuredOutput, correlationId, evidence);
      return {
        answer: output.answer,
        recommendations: output.recommendations,
        evidence,
        generatedAt: new Date().toISOString(),
        providerMetadata: safeProviderMetadata(response.providerMetadata),
      };
    },

    async briefing(actor: PlatformAdminContext, input: { correlationId?: unknown } = {}): Promise<AdminAiBriefing> {
      const correlationId = requireIdentifier(input.correlationId, "ADMIN_AI_CORRELATION_REQUIRED", 200);
      const tools = parseAdminIntelligenceTools([
        "platform_metrics",
        "attention_items",
        "invoice_payment_summary",
        "device_sync_health",
        "release_health",
      ]);
      const evidence = await collectAdminIntelligenceEvidence(pool, actor, tools);
      const response = await generate(provider, {
        prompt: "Create a concise operations briefing. Prioritize urgent risk, billing/revenue risk, tenant health, device/sync health, release health, then opportunities.",
        evidence,
        correlationId,
        outputSchema: BRIEFING_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      });
      const parsed = parseBriefingOutput(response.structuredOutput, correlationId, evidence);
      const attentionItems = await listPlatformAttention(pool, actor);
      return {
        generatedAt: new Date().toISOString(),
        headline: parsed.headline,
        summary: parsed.summary,
        attention: {
          open: attentionItems.length,
          critical: attentionItems.filter((item) => item.severity === "CRITICAL").length,
          high: attentionItems.filter((item) => item.severity === "HIGH").length,
          medium: attentionItems.filter((item) => item.severity === "MEDIUM").length,
          low: attentionItems.filter((item) => item.severity === "LOW").length,
          info: attentionItems.filter((item) => item.severity === "INFO").length,
        },
        recommendations: parsed.recommendations,
        evidence,
      };
    },
  };
}

async function generate(
  provider: AiTextProvider,
  input: { prompt: string; evidence: AiGroundingEvidence[]; correlationId: string; outputSchema: Record<string, unknown> },
) {
  try {
    return await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: input.prompt,
      evidence: input.evidence,
      correlationId: input.correlationId,
      outputSchema: input.outputSchema,
    });
  } catch (error) {
    if (error instanceof AiProviderError || error instanceof PlatformAdminError) throw error;
    throw new PlatformAdminError("AI provider request failed safely.", 502, "ADMIN_AI_PROVIDER_FAILED");
  }
}

function parseQueryOutput(
  value: unknown,
  correlationId: string,
  evidence: AiGroundingEvidence[],
): { answer: string; recommendations: AdminAiRecommendation[] } {
  const record = asRecord(value);
  if (!record || typeof record.answer !== "string" || !record.answer.trim() || !Array.isArray(record.recommendations)) {
    throw invalidOutput();
  }
  return {
    answer: record.answer.trim(),
    recommendations: parseRecommendations(record.recommendations, correlationId, evidence),
  };
}

function parseBriefingOutput(
  value: unknown,
  correlationId: string,
  evidence: AiGroundingEvidence[],
): { headline: string; summary: string; recommendations: AdminAiRecommendation[] } {
  const record = asRecord(value);
  if (!record || typeof record.headline !== "string" || !record.headline.trim()
    || typeof record.summary !== "string" || !record.summary.trim() || !Array.isArray(record.recommendations)) {
    throw invalidOutput();
  }
  return {
    headline: record.headline.trim(),
    summary: record.summary.trim(),
    recommendations: parseRecommendations(record.recommendations, correlationId, evidence),
  };
}

function parseRecommendations(
  value: unknown[],
  correlationId: string,
  evidence: AiGroundingEvidence[],
): AdminAiRecommendation[] {
  return value.map((item, index) => {
    const record = asRecord(item);
    if (!record || typeof record.title !== "string" || !record.title.trim()
      || typeof record.summary !== "string" || !record.summary.trim()
      || typeof record.priority !== "string" || !PRIORITIES.has(record.priority as AdminAttentionSeverity)
      || !Number.isInteger(record.executionClass) || Number(record.executionClass) < 0 || Number(record.executionClass) > 3
      || !(record.businessId === null || record.businessId === undefined || isUuid(record.businessId))
      || !(record.actionType === null || record.actionType === undefined || typeof record.actionType === "string")) {
      throw invalidOutput();
    }
    const executionClass = Number(record.executionClass) as 0 | 1 | 2 | 3;
    return {
      id: `${correlationId}:${index + 1}`,
      title: record.title.trim(),
      summary: record.summary.trim(),
      priority: record.priority as AdminAttentionSeverity,
      businessId: typeof record.businessId === "string" ? record.businessId : null,
      evidence: evidence.map((item) => ({ ...item })),
      proposedAction: typeof record.actionType === "string" && record.actionType.trim()
        ? { type: record.actionType.trim() }
        : null,
      executionClass,
    };
  });
}

function safeProviderMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const safe: Record<string, unknown> = {};
  for (const key of ["requestId", "responseId", "model"]) {
    const item = value[key];
    if (typeof item === "string" && item.length <= 300) safe[key] = item;
  }
  return safe;
}

function requireText(value: unknown, code: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformAdminError("Required AI input is missing.", 400, code);
  const text = value.trim();
  if (text.length > max) throw new PlatformAdminError("AI input is too long.", 400, code);
  return text;
}

function requireIdentifier(value: unknown, code: string, max: number): string {
  return requireText(value, code, max);
}

function optionalUuid(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isUuid(value)) throw new PlatformAdminError("businessId is invalid.", 400, "ADMIN_AI_BUSINESS_INVALID");
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invalidOutput(): PlatformAdminError {
  return new PlatformAdminError("AI provider returned output that did not match the required schema.", 502, "ADMIN_AI_INVALID_OUTPUT");
}
