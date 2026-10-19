export type BusinessAttentionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type BusinessAttentionState = "OPEN" | "RESOLVED" | "DISMISSED";

export interface BusinessEvidence {
  sourceType: string;
  sourceId?: string;
  label: string;
  value?: unknown;
  observedAt?: string;
  href?: string;
}

export interface BusinessAttentionItem {
  id: string;
  businessId: string;
  branchId: string | null;
  sourceKey: string;
  ruleCode: string;
  entityType: string | null;
  entityId: string | null;
  severity: BusinessAttentionSeverity;
  state: BusinessAttentionState;
  title: string;
  summary: string;
  evidence: BusinessEvidence[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessRecommendation {
  id: string;
  businessId: string;
  branchId: string | null;
  title: string;
  summary: string;
  priority: BusinessAttentionSeverity;
  category: string;
  evidence: BusinessEvidence[];
  proposedAction: Record<string, unknown> | null;
  requiresHumanConfirmation: boolean;
}

export type BusinessBriefingSectionCode =
  | "URGENT"
  | "SALES"
  | "CASH"
  | "CUSTOMERS_CREDIT"
  | "SUPPLIERS_PAYABLES"
  | "INVENTORY"
  | "OPPORTUNITIES";

export interface BusinessBriefingSection {
  code: BusinessBriefingSectionCode;
  title: string;
  summary: string;
  priority: BusinessAttentionSeverity;
  evidence: BusinessEvidence[];
  recommendations: BusinessRecommendation[];
}

export interface BusinessBriefing {
  businessId: string;
  branchId: string | null;
  generatedAt: string;
  dataAsOf: string;
  headline: string;
  summary: string;
  sections: BusinessBriefingSection[];
  attention: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
  stale: boolean;
}

export interface BusinessAssistantQueryRequest {
  businessId: string;
  branchId?: string | null;
  question: string;
  conversationId?: string;
}

export interface BusinessAssistantQueryResponse {
  businessId: string;
  branchId: string | null;
  answeredAt: string;
  answer: string;
  evidence: BusinessEvidence[];
  recommendations: BusinessRecommendation[];
  providerMetadata?: Record<string, unknown>;
  stale: boolean;
}

export type BusinessAutomationRunState =
  | "QUEUED"
  | "EVALUATING"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "CANCELED";

export interface BusinessAutomationPolicy {
  id: string;
  businessId: string;
  branchId: string | null;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfiguration: Record<string, unknown>;
  policyVersion: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAutomationRun {
  id: string;
  businessId: string;
  branchId: string | null;
  policyId: string;
  policyVersion: number;
  triggerSource: string;
  triggerCorrelationId: string;
  state: BusinessAutomationRunState;
  actionType: string;
  structuredInput: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  evidence: BusinessEvidence[];
  actionItemId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BusinessActionItemStatus = "OPEN" | "DONE" | "SNOOZED" | "CANCELED";

export interface BusinessActionItem {
  id: string;
  businessId: string;
  branchId: string | null;
  title: string;
  reason: string;
  evidence: BusinessEvidence[];
  status: BusinessActionItemStatus;
  actionType: string | null;
  assignedUserId: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdByUserId: string | null;
  sourcePolicyId: string | null;
  createdAt: string;
  updatedAt: string;
}
