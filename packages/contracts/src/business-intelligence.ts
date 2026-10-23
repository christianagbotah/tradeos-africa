import type { FinancialPeriod } from "./reports.js";

export type BusinessIntelligenceScope = {
  businessId: string;
  branchId: string | null;
};

export type BusinessEntityType = "CATALOG_ITEM" | "CUSTOMER" | "SUPPLIER" | "PURCHASE";

export type BusinessEntityContext = {
  entityType: BusinessEntityType;
  entityId: string;
  metricKey?: never;
  range?: never;
};

export type BusinessFinancialMetricKey =
  | "NET_REVENUE"
  | "GROSS_PROFIT"
  | "OPERATING_PROFIT"
  | "EXPENSES"
  | "NET_CASH_MOVEMENT"
  | "CASH_BALANCE"
  | "RECEIVABLES"
  | "PAYABLES"
  | "INVENTORY_VALUE";

export type BusinessFinancialMetricRange = "today" | "week" | "month" | "quarter";

export type BusinessMetricContext = {
  metricKey: BusinessFinancialMetricKey;
  range: BusinessFinancialMetricRange;
  entityType?: never;
  entityId?: never;
};

export type BusinessAssistantContext = BusinessEntityContext | BusinessMetricContext;

export type BusinessEntityIdentity = BusinessEntityContext & {
  label: string;
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
export type BusinessInsightRange = "today" | "week" | "month";
export type BusinessInsightConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

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
  | "URGENT"
  | "SALES"
  | "CASH"
  | "CUSTOMERS_CREDIT"
  | "SUPPLIERS_PAYABLES"
  | "INVENTORY"
  | "OPPORTUNITIES";

export type BusinessBriefingSection = {
  code: BusinessBriefingSectionCode;
  title: string;
  summary: string;
  attentionItems: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
};

export type BusinessBriefing = BusinessIntelligenceScope & {
  range: BusinessInsightRange;
  generatedAt: string;
  headline: string;
  summary: string;
  confidence: {
    level: BusinessInsightConfidenceLevel;
    reason: string;
  };
  dataQuality: {
    completedSales30d: number;
    sufficientForTrends: boolean;
    currencyCode: string;
  };
  sections: BusinessBriefingSection[];
  evidence: BusinessEvidenceReference[];
};

export type BusinessEntitySafeAction = {
  actionType: "CREATE_REORDER_REVIEW" | "CREATE_RECEIVABLE_FOLLOW_UP" | "CREATE_FOLLOW_UP";
  label: string;
  dueInHours: 24;
};

export type BusinessEntityActionItemRequest = BusinessIntelligenceScope & {
  context: BusinessEntityContext;
};

export type BusinessEntityIntelligence = BusinessIntelligenceScope & {
  entity: BusinessEntityIdentity;
  generatedAt: string;
  evidence: BusinessEvidenceReference[];
  attentionItems: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
  safeAction: BusinessEntitySafeAction | null;
  askPrompt: string;
};

export type BusinessFinancialMetricIdentity = {
  metricKey: BusinessFinancialMetricKey;
  label: string;
};

export type BusinessFinancialMetricIntelligence = BusinessIntelligenceScope & {
  metric: BusinessFinancialMetricIdentity;
  range: BusinessFinancialMetricRange;
  period: FinancialPeriod;
  currencyCode: string;
  generatedAt: string;
  currentMinor: number;
  previousMinor: number | null;
  deltaMinor: number | null;
  changePercent: number | null;
  summary: string;
  evidence: BusinessEvidenceReference[];
  attentionItems: BusinessAttentionItem[];
  recommendations: BusinessRecommendation[];
  askPrompt: string;
};

export type BusinessAssistantQueryRequest = BusinessIntelligenceScope & {
  question: string;
  conversationId?: string | null;
  context?: BusinessAssistantContext | null;
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
  sourceEntityType: BusinessEntityType | null;
  sourceEntityId: string | null;
  createdByUserId: string | null;
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

export type BusinessEntityActionItemResponse = {
  item: BusinessActionItem;
  created: boolean;
};
