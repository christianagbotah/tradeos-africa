# TradeOS Entity-Level Intelligence Design

## Intent
Move TradeOS intelligence from page-level business summaries into the exact record the operator is reviewing. When a user opens a customer, supplier, purchase, or tracked inventory item, TradeOS should explain the authoritative signals for that record, show supporting evidence, surface relevant attention, and let Ask TradeOS inherit that exact entity context.

## Phase A scope
Supported record entities:
- `CATALOG_ITEM`
- `CUSTOMER`
- `SUPPLIER`
- `PURCHASE`

Financial report metrics are deliberately deferred to Phase B because metrics are symbolic/range-scoped concepts rather than tenant-owned UUID records. Keeping them separate makes ownership and permission validation explicit.

## User experience
A shared `EntityIntelligencePanel` is embedded only inside an opened detail surface, never every list row. This avoids N+1 API traffic and visual noise.

Placement:
- Inventory: inside the existing inventory adjustment/detail sheet, after the item stock hero/stats and before adjustment controls.
- Customer: inside `CustomerSheet`, after account/credit summary and before mutation forms.
- Supplier: inside `SupplierSheet`, after supplier account summary and before mutation forms.
- Purchase: inside `PurchaseDetailSheet`, after purchase summary/stats and before return controls.

The panel shows:
1. record identity and freshness;
2. compact authoritative evidence relevant to that record;
3. matching open attention signals;
4. safe review/navigation recommendations;
5. `Ask TradeOS about this`.

The deterministic panel does not require an LLM. If the model provider is unavailable, evidence and attention remain usable. Ask TradeOS is separately unavailable with a clear provider/offline error.

## Shared contracts
Add:
- `BusinessEntityType = "CATALOG_ITEM" | "CUSTOMER" | "SUPPLIER" | "PURCHASE"`
- `BusinessEntityContext { entityType, entityId }`
- `BusinessEntityIntelligence` containing business/branch scope, entity identity/label, generatedAt, evidence, attentionItems, recommendations, and a safe default ask prompt.

`BusinessAssistantQueryRequest` gains optional `context?: BusinessEntityContext | null`.

No client-selected database tools, source names, SQL, or free-form entity types are accepted.

## API
Add model-free endpoint:
`GET /v1/intelligence/entity?businessId=&branchId=&entityType=&entityId=`

Flow:
1. authenticate access token;
2. require tenant membership;
3. validate business/branch scope;
4. parse supported entity type + UUID;
5. validate that the entity belongs to the business and, where applicable, requested branch;
6. collect role-allowed evidence inside a repeatable-read, read-only transaction;
7. attach only attention items whose evidence matches that entity type/id;
8. build safe canonical-workflow recommendations;
9. return deterministic entity intelligence.

Out-of-tenant entity IDs return the same safe not-found response and must not leak record existence.

## Entity evidence
### Catalog item
- item identity, SKU, stock unit, active/stock-tracked status;
- current branch available/quarantine/damaged/waste quantity;
- recent inventory movement quantities/reasons;
- recent sales quantity; revenue only for financial roles;
- matching stockout/slow-stock/wastage attention.
- recommendations navigate only to Inventory or Purchases.

### Customer
- identity/status/contact-presence (not unnecessary PII values in AI grounding);
- current balance/credit terms/credit limit only when role is permitted financial evidence;
- open obligations, oldest due date, recent account-entry direction/count;
- matching receivables attention;
- recommendation navigates to Customers only.

### Supplier
- identity/status/contact-presence;
- payable balance/payment terms and obligations only when permitted;
- recent purchase/return/payment counts and dates, financial totals only for financial roles;
- matching payable/supplier-bill attention;
- recommendation navigates to Purchases only.

### Purchase
- purchase identity/status/branch/supplier/reference presence;
- line count, received/posted timestamps, return state;
- financial totals only for permitted roles;
- no AI action can receive, pay, return, edit, or delete a purchase;
- recommendation navigates to Purchases only.

## Ask TradeOS structured context
The existing `tradeos:ask` UI event evolves from `{ question }` to `{ question, context? }`.
`AppShell` validates the event detail against the supported entity type and UUID shape and stores the context with the prefilled question.
`AskTradeOSDrawer` accepts `initialContext` and sends it as the query request `context`.

On the server, `answerBusinessQuestion` revalidates entity ownership and uses entity-specific evidence first. The model is told the exact validated entity identity. Client prompt text never establishes entity authorization.

The response evidence remains schema-validated and evidence-index referenced. Recommendations remain navigation-only and canonical workflows remain authoritative.

## Permissions
Tenant membership is necessary but not sufficient for sensitive evidence. Existing financial-role policy remains the default (`OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`) for monetary aggregates. Other roles receive operational identity/status/count/stock evidence appropriate to their existing surface, not hidden financial aggregates.

Entity ownership is always validated server-side. Branch-specific purchases/inventory evidence must match the requested branch when a branch scope exists.

## Offline and caching
Phase A does not introduce a second intelligence cache format. When offline, the panel renders an explicit reconnect state rather than pretending evidence is fresh. Existing business briefing cache remains untouched. Core offline mutation workflows remain available under their existing permissions; AI never auto-submits them.

## Performance
- no entity intelligence calls from list rows;
- one request only after a detail record is opened;
- queries are bounded (`LIMIT`s and recent windows);
- no broad N+1 record scans;
- evidence response is capped and deterministic.

## Safety
Entity intelligence remains read-only. It cannot call sale, receipt, payment, refund, return, inventory adjustment, role/access, staff, subscription, or destructive services. Recommendations only open existing workflows. Buttons in entity panels are `type="button"` so embedding inside the inventory adjustment form cannot submit it accidentally.

## Testing
- contract/type tests for the new entity context;
- API integration tests for each entity type, tenant isolation, branch isolation and financial-role filtering;
- query tests proving context is server-validated and entity evidence is actually used;
- route tests rejecting unsupported/free-form entity types and client-selected tools;
- web contract tests proving panels mount only in detail sheets and structured context reaches Ask TradeOS;
- full API/Web typecheck + test suites + Visual QA.
