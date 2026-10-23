import type {
  BusinessAssistantQueryRequest,
  BusinessEntityContext,
  BusinessEntityIntelligence,
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
  askPrompt: "What should I know about this customer?",
};

const query: BusinessAssistantQueryRequest = {
  businessId: intelligence.businessId,
  branchId: intelligence.branchId,
  question: "What should I do next?",
  context,
};

void query;
