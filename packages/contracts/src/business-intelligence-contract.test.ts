import type {
  BusinessAssistantQueryRequest,
  BusinessEntityContext,
  BusinessEntityActionItemRequest,
  BusinessEntityActionItemResponse,
  BusinessEntityIntelligence,
  BusinessEntitySafeAction,
  BusinessEntityType,
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
