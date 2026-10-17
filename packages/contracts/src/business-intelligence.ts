export type BusinessIntelligenceScope = {
  businessId: string;
  branchId: string | null;
};

export type BusinessEvidenceReference = {
  source: string;
  entityType: string;
  entityId?: string | null;
  observedAt?: string | null;
  label?: string | null;
  value?: string | number | boolean | null;
  metadata?: Record<string, unknown>;
};

export type BusinessAttentionSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type BusinessAttentionState = "OPEN" | "RESOLVED" | "DISMISSED";

export type BusinessAttentionItem = BusinessIntelligenceScope & {
  id: string;
  sourceKey: string;
  ruleCode: string;
  severity: BusinessAttentionSeverity;
  state: BusinessAttentionState;
  title: string;
  summary: string;
  evidence: BusinessEvidenceReference[];
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type BusinessRecommendation = BusinessIntelligenceScope & {
  code: string;
  title: string;
  summary: string;
  rationale: string;
  priority: BusinessAttentionSeverity;
  evidence: BusinessEvidenceReference[];
  suggestedActionType?: string | null;
  suggestedActionLabel?: string | null;
};

export type BusinessBriefingSectionCode =
  | "TODAY"
  | "CASH_FLOW"
  | "RECEIVABLES"
  | "PAYABLES"
  | "INVENTORY"
  | "SALES"
  | "CUSTOMERS"
  | "OPERATIONS";

export type BusinessBriefingSection = {
  code: BusinessBriefingSectionCode;
  title: string;
  summary: string;
  attentionItems: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
};

export type BusinessBriefing = BusinessIntelligenceScope & {
  generatedAt: string;
  headline: string;
  summary: string;
  sections: BusinessBriefingSection[];
  evidence: BusinessEvidenceReference[];
};

export type BusinessAssistantQueryRequest = BusinessIntelligenceScope & {
  question: string;
  conversationId?: string | null;
};

export type BusinessAssistantQueryResponse = BusinessIntelligenceScope & {
  answer: string;
  generatedAt: string;
  evidence: BusinessEvidenceReference[];
  recommendations: BusinessRecommendation[];
  conversationId?: string | null;
};

export type BusinessAutomationTriggerType = "ATTENTION" | "SCHEDULE" | "MANUAL" | "EVENT";
export type BusinessAutomationRunState = "QUEUED" | "EVALUATING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type BusinessActionItemStatus = "OPEN" | "DONE" | "SNOOZED" | "CANCELED";

export type BusinessAutomationPolicy = BusinessIntelligenceScope & {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  triggerType: BusinessAutomationTriggerType | string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfiguration: Record<string, unknown>;
  policyVersion: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type BusinessAutomationRun = BusinessIntelligenceScope & {
  id: string;
  policyId: string;
  policyVersion: number;
  triggerSource: string;
  triggerCorrelationId: string;
  state: BusinessAutomationRunState;
  structuredInput: Record<string, unknown>;
  outputSummary: Record<string, unknown>;
  evidence: BusinessEvidenceReference[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessActionItem = BusinessIntelligenceScope & {
  id: string;
  sourceAttentionItemId: string | null;
  sourceAutomationRunId: string | null;
  actionType: string | null;
  title: string;
  reason: string;
  evidence: BusinessEvidenceReference[];
  assignedUserId: string | null;
  assignedStaffId: string | null;
  dueAt: string | null;
  status: BusinessActionItemStatus;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
