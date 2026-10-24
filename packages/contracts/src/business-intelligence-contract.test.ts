import type {
  BusinessAssistantQueryRequest,
  BusinessEntityContext,
  BusinessEntityActionItemRequest,
  BusinessEntityActionItemResponse,
  BusinessEntityIntelligence,
  BusinessEntitySafeAction,
  BusinessEntityType,
  BusinessAssistantContext,
  BusinessFinancialMetricIntelligence,
  BusinessFinancialMetricKey,
  BusinessFinancialMetricRange,
  BusinessMetricContext,
  BusinessActionItemExplanation,
  BusinessActionItemExplanationSourceKind,
} from "./business-intelligence.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type _SupportedEntityTypes = Assert<Equal<BusinessEntityType, "CATALOG_ITEM" | "CUSTOMER" | "SUPPLIER" | "PURCHASE">>;

const context: BusinessEntityContext = {
  entityType: "CUSTOMER",
  entityId: "70000000-0000-4000-8000-000000000001",
};

const intelligence: BusinessEntityIntelligence = {
  businessId: "70000000-0000-4000-8000-000000000001",
  branchId: null,
  entity: {
    entityType: "CUSTOMER",
    entityId: "70000000-0000-4000-8000-000000000002",
    label: "Acme Stores",
  },
  generatedAt: "2026-10-23T00:00:00.000Z",
  evidence: [],
  attentionItems: [],
  recommendations: [],
  safeAction: { actionType: "CREATE_RECEIVABLE_FOLLOW_UP", label: "Create receivables follow-up", dueInHours: 24 },
  askPrompt: "What should I know about this customer?",
};

const query: BusinessAssistantQueryRequest = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  question: "What should I do next?",
  context,
};

void query;

const safeAction: BusinessEntitySafeAction = {
  actionType: "CREATE_REORDER_REVIEW",
  label: "Create reorder review",
  dueInHours: 24,
};

const actionRequest: BusinessEntityActionItemRequest = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  context,
};

const actionResponse: BusinessEntityActionItemResponse = {
  item: {
    businessId: intelligence.businessId,
    branchId: intelligence.branchId,
    id: "70000000-0000-4000-8000-000000000010",
    sourceAttentionItemId: null,
    sourceAutomationRunId: null,
    sourceEntityType: "CUSTOMER",
    sourceEntityId: context.entityId,
    createdByUserId: "70000000-0000-4000-8000-000000000011",
    actionType: safeAction.actionType,
    title: "Review customer",
    reason: "Evidence-backed review",
    evidence: [],
    assignedUserId: "70000000-0000-4000-8000-000000000011",
    assignedStaffId: null,
    dueAt: "2026-10-24T00:00:00.000Z",
    status: "OPEN",
    snoozedUntil: null,
    completedAt: null,
    createdAt: "2026-10-23T00:00:00.000Z",
    updatedAt: "2026-10-23T00:00:00.000Z",
  },
  created: true,
};

void safeAction;
void actionRequest;
void actionResponse;

type _ExplanationSourceKinds = Assert<Equal<BusinessActionItemExplanationSourceKind, "AUTOMATION" | "ENTITY_REVIEW" | "ATTENTION" | "MANUAL">>;

const explanation: BusinessActionItemExplanation = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  actionItemId: actionResponse.item.id,
  generatedAt: "2026-10-24T00:00:00.000Z",
  sourceKind: "AUTOMATION",
  summary: "TradeOS created this review from an enabled automation policy.",
  action: actionResponse.item,
  automation: {
    policyId: "70000000-0000-4000-8000-000000000020",
    policyName: "Receivables follow-up",
    policyVersion: 2,
    triggerType: "ATTENTION",
    triggerSource: "ATTENTION",
    runId: "70000000-0000-4000-8000-000000000021",
    runCreatedAt: "2026-10-24T00:00:00.000Z",
  },
  attention: {
    id: "70000000-0000-4000-8000-000000000022",
    ruleCode: "RECEIVABLES_OVERDUE",
    severity: "HIGH",
    title: "Receivables need follow-up",
    summary: "A customer balance is overdue.",
    lastSeenAt: "2026-10-24T00:00:00.000Z",
  },
  entity: { entityType: "CUSTOMER", entityId: context.entityId },
  evidence: [],
};

void explanation;

// @ts-expect-error unsupported explanation source kind
const badExplanationSource: BusinessActionItemExplanationSourceKind = "MODEL";
void badExplanationSource;


type _SupportedMetricKeys = Assert<Equal<BusinessFinancialMetricKey,
  | "NET_REVENUE"
  | "GROSS_PROFIT"
  | "OPERATING_PROFIT"
  | "EXPENSES"
  | "NET_CASH_MOVEMENT"
  | "CASH_BALANCE"
  | "RECEIVABLES"
  | "PAYABLES"
  | "INVENTORY_VALUE"
>>;
type _SupportedMetricRanges = Assert<Equal<BusinessFinancialMetricRange, "today" | "week" | "month" | "quarter">>;

const metricContext: BusinessMetricContext = { metricKey: "NET_REVENUE", range: "month" };
const assistantEntityContext: BusinessAssistantContext = context;
const assistantMetricContext: BusinessAssistantContext = metricContext;

const metricIntelligence: BusinessFinancialMetricIntelligence = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  metric: { metricKey: "NET_REVENUE", label: "Net revenue" },
  range: "month",
  period: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-23T00:00:00.000Z", timezone: "Africa/Accra" },
  currencyCode: "GHS",
  generatedAt: "2026-10-23T00:00:00.000Z",
  currentMinor: 125000,
  previousMinor: 100000,
  deltaMinor: 25000,
  changePercent: 25,
  summary: "Net revenue is higher than the prior comparable period.",
  evidence: [],
  attentionItems: [],
  recommendations: [],
  askPrompt: "Why did net revenue change this month?",
};

const metricQuery: BusinessAssistantQueryRequest = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  question: "Explain this metric.",
  context: metricContext,
};

void assistantEntityContext;
void assistantMetricContext;
void metricIntelligence;
void metricQuery;

// @ts-expect-error unsupported metric key
const badMetricKey: BusinessFinancialMetricKey = "GROSS_MARGIN";
// @ts-expect-error unsupported metric range
const badMetricRange: BusinessFinancialMetricRange = "year";
// @ts-expect-error assistant context must be exactly an entity or metric context
const badMixedContext: BusinessAssistantContext = { entityType: "CUSTOMER", entityId: context.entityId, metricKey: "NET_REVENUE", range: "month" };
void badMetricKey; void badMetricRange; void badMixedContext;
