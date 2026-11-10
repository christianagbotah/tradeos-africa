import type { BusinessInsightEvidence } from "./insights.js";

export type BusinessAttentionRule =
  | "LOW_DATA_CONFIDENCE"
  | "RECEIVABLES_OVERDUE"
  | "PAYABLES_OVERDUE"
  | "CASH_PRESSURE_FORECAST"
  | "BUSINESS_HEALTH_INSIGHT";
export type BusinessAttentionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type BusinessAttentionState = "OPEN" | "RESOLVED" | "DISMISSED";

/** A persisted, evidence-backed advisory alert. It is never an instruction to post money or stock. */
export interface BusinessAttentionItem {
  id: string;
  businessId: string;
  branchId: string | null;
  sourceKey: string;
  ruleCode: BusinessAttentionRule;
  severity: BusinessAttentionSeverity;
  state: BusinessAttentionState;
  title: string;
  summary: string;
  evidence: BusinessInsightEvidence[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BusinessAttentionResponse {
  businessId: string;
  branchId: string | null;
  items: BusinessAttentionItem[];
  generatedAt: string;
  evaluated: boolean;
}
