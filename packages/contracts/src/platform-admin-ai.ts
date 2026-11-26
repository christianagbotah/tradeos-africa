import type { PlatformAdminRole } from "./platform-admin.js";

export type AdminAttentionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AdminAttentionState = "OPEN" | "RESOLVED" | "DISMISSED";

export interface AdminAttentionEvidence {
  sourceType: string;
  sourceId?: string;
  label: string;
  value?: unknown;
  observedAt?: string;
  href?: string;
}

export interface AdminAttentionItem {
  id: string;
  sourceKey: string;
  ruleCode: string;
  businessId: string | null;
  entityType: string | null;
  entityId: string | null;
  severity: AdminAttentionSeverity;
  state: AdminAttentionState;
  title: string;
  summary: string;
  evidence: AdminAttentionEvidence[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAttentionSummary {
  open: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export type AdminAutomationExecutionClass = 0 | 1 | 2 | 3;
export type AdminAutomationRunState =
  | "QUEUED"
  | "EVALUATING"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "REJECTED"
  | "CANCELED";

export interface AdminAutomationPolicy {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  businessId: string | null;
  triggerType: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfiguration: Record<string, unknown>;
  executionClass: AdminAutomationExecutionClass;
  approvalRole: PlatformAdminRole | null;
  policyVersion: number;
  createdByPlatformUserId: string;
  updatedByPlatformUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAutomationRun {
  id: string;
  policyId: string;
  policyVersion: number;
  businessId: string | null;
  triggerSource: string;
  triggerCorrelationId: string;
  state: AdminAutomationRunState;
  executionClass: AdminAutomationExecutionClass;
  structuredInput: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  proposedAction: Record<string, unknown>;
  evidence: AdminAttentionEvidence[];
  providerMetadata: Record<string, unknown>;
  approvedByPlatformUserId: string | null;
  executedByPlatformUserId: string | null;
  approvalRequestedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminApprovalItem {
  run: AdminAutomationRun;
  policy: AdminAutomationPolicy;
  attentionItem: AdminAttentionItem | null;
  requiredRole: PlatformAdminRole | null;
}

export interface AdminAiRecommendation {
  id: string;
  title: string;
  summary: string;
  priority: AdminAttentionSeverity;
  businessId: string | null;
  evidence: AdminAttentionEvidence[];
  proposedAction: Record<string, unknown> | null;
  executionClass: AdminAutomationExecutionClass;
}

export interface AdminAiBriefing {
  generatedAt: string;
  headline: string;
  summary: string;
  attention: AdminAttentionSummary;
  recommendations: AdminAiRecommendation[];
  evidence: AdminAttentionEvidence[];
}

export interface AiGroundingEvidence {
  sourceType: string;
  sourceId?: string;
  label: string;
  value?: unknown;
  observedAt?: string;
}

export interface AiTextRequest {
  systemInstruction?: string;
  prompt: string;
  evidence: AiGroundingEvidence[];
  outputSchema?: Record<string, unknown>;
  correlationId?: string;
}

export interface AiTextResponse {
  text: string;
  structuredOutput?: unknown;
  providerMetadata?: Record<string, unknown>;
}

/**
 * Vendor-neutral text intelligence boundary shared by platform and tenant AI.
 * Provider SDK types, credentials, and transport details must not cross this interface.
 */
export interface AiTextProvider {
  generate(input: AiTextRequest): Promise<AiTextResponse>;
}
