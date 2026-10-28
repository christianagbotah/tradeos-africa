# TradeOS Financial Metric Intelligence Design

## Intent

Complete Entity Intelligence Phase B by making the financial figures already visible in Reports explainable in context. A user should be able to select a specific financial metric, see the authoritative current value and comparable prior-period evidence, understand related attention signals, and ask TradeOS a question that inherits that exact metric context.

This is read-only decision support. It does not create payments, refunds, purchases, stock movements, cashbook entries, accounting adjustments, access changes, or any other economic/security mutation.

## Phase B scope

Allow-listed metric keys:
- `NET_REVENUE`
- `GROSS_PROFIT`
- `OPERATING_PROFIT`
- `EXPENSES`
- `NET_CASH_MOVEMENT`
- `CASH_BALANCE`
- `RECEIVABLES`
- `PAYABLES`
- `INVENTORY_VALUE`

Allow-listed report ranges:
- `today`
- `week`
- `month`
- `quarter`

All Phase B metrics are money-valued. Percentage and count metrics can be added later without weakening the contract.

## Approaches considered

### 1. Explicit metric context backed by the canonical financial report — chosen

Add a symbolic, allow-listed metric context and a model-free metric intelligence endpoint. The endpoint reuses the same canonical `FinancialSummaryReport` builder as the Reports page, derives the selected metric and prior-period comparison, attaches relevant attention, and returns deterministic intelligence. Ask TradeOS receives the same structured context and revalidates it server-side.

This keeps one accounting source of truth, avoids arbitrary labels/SQL, and makes range semantics explicit.

### 2. Client-derived metric explanations

The browser could reuse the already-loaded report object and build prompts/evidence locally. Rejected because the client would become a trust boundary for values, range, labels, and Ask TradeOS grounding; stale or manipulated client state could diverge from canonical reporting.

### 3. Model metrics as pseudo-entities

Metrics could be represented as fake entity IDs such as `FINANCIAL_METRIC:NET_REVENUE`. Rejected because metrics are symbolic/range-scoped concepts, not tenant-owned UUID records. Conflating them would weaken validation and make ownership semantics misleading.

## Shared contracts

Add:
- `BusinessFinancialMetricKey`
- `BusinessFinancialMetricRange`
- `BusinessMetricContext { metricKey, range }`
- `BusinessAssistantContext = BusinessEntityContext | BusinessMetricContext`
- `BusinessFinancialMetricIntelligence`

`BusinessFinancialMetricIntelligence` contains:
- business/branch scope;
- metric identity and label;
- range and canonical report period;
- currency code;
- current value in minor units;
- previous comparable value when the report contract provides one;
- delta and percentage change when meaningful;
- deterministic summary;
- bounded evidence;
- matching attention items;
- safe navigation recommendations;
- a default Ask TradeOS prompt.

`BusinessAssistantQueryRequest.context` evolves from entity-only context to `BusinessAssistantContext | null`.

## Canonical report reuse

Refactor the existing `/v1/reports/financial-summary` implementation so the accounting/report computation is callable as a shared server function. The existing route continues to return exactly the same public contract/compatibility envelope.

Metric intelligence must call that same report builder. It must not duplicate financial SQL or recompute figures with a second accounting model.

## Metric mapping

Flow metrics and comparable prior values:
- `NET_REVENUE` → `flow.netRevenueMinor` / `previousFlow.netRevenueMinor`
- `GROSS_PROFIT` → `flow.grossProfitMinor` / `previousFlow.grossProfitMinor`
- `OPERATING_PROFIT` → `flow.operatingProfitMinor` / `previousFlow.operatingProfitMinor`
- `EXPENSES` → `flow.expenseMinor` / `previousFlow.expenseMinor`
- `NET_CASH_MOVEMENT` → `flow.netCashMovementMinor` / `previousFlow.netCashMovementMinor`

Position metrics:
- `CASH_BALANCE` → `position.cashBalanceMinor` / `previousPosition.cashBalanceMinor`
- `RECEIVABLES` → `position.receivablesMinor` / `previousPosition.receivablesMinor`
- `PAYABLES` → `position.payablesMinor` / `previousPosition.payablesMinor`
- `INVENTORY_VALUE` → `position.inventoryValueMinor`; previous value is `null` because the current canonical report intentionally does not provide a historical inventory snapshot.

Related evidence is bounded to authoritative fields already present in the report, for example sales/returns counts for revenue, COGS for gross profit, gross profit/expenses for operating profit, cash in/out for net cash movement, and available/quarantine inventory valuation for inventory value.

## Attention mapping

Metric intelligence may attach existing open attention items relevant to the selected metric:
- revenue → `SALES_DROP`
- gross/operating profit and expenses → `MARGIN_PRESSURE`, `SALES_DROP`
- cash metrics → `CASH_PRESSURE_FORECAST`
- receivables → `RECEIVABLES_OVERDUE`
- payables → `PAYABLES_OVERDUE`, `SUPPLIER_BILL_DUE`
- inventory value → `STOCKOUT_RISK`, `SLOW_STOCK`, `WASTAGE_SPIKE`, `WASTAGE_LOSS`

No new attention generator is required in this slice.

## API

Add model-free endpoint:

`GET /v1/intelligence/metric?businessId=&branchId=&metricKey=&range=`

Flow:
1. authenticate;
2. require the same report-read membership already required by Financial Reports;
3. validate business/branch scope;
4. parse allow-listed metric key and range;
5. obtain the canonical financial report snapshot;
6. derive the metric and bounded evidence;
7. attach relevant open attention;
8. return deterministic metric intelligence.

Unsupported keys/ranges fail closed with a 400. Out-of-scope business/branch requests preserve existing safe report semantics.

## Ask TradeOS structured context

The existing `tradeos:ask` event and `AskTradeOSDrawer` support two validated context shapes:
- entity context: `{ entityType, entityId }`
- metric context: `{ metricKey, range }`

`AppShell` accepts only one complete allow-listed shape. Mixed or extra fields are rejected/ignored client-side.

The server is authoritative. When metric context is supplied, `answerBusinessQuestion` obtains fresh metric intelligence, uses its bounded evidence for grounding, and tells the model the validated metric label/range. Prompt text never establishes metric authorization or range.

## Permissions

Metric intelligence never grants more access than the underlying Financial Reports route. It uses the same authorized tenant/branch scope and exposes only fields already available from that report contract for that role.

No client-selected report field, SQL expression, source table, aggregation, or arbitrary metric label is accepted.

## User experience

Add one shared `FinancialMetricIntelligenceDrawer` to the Reports page. It fetches only after the user clicks an `Explain` control, so the page does not issue nine extra background requests.

Explain controls are added to the nine supported values already displayed in Reports. The drawer shows:
1. metric label, current value and selected period;
2. prior comparable value and delta when available;
3. a concise deterministic explanation;
4. related attention signals;
5. bounded supporting facts;
6. safe canonical workflow navigation;
7. `Ask TradeOS about this metric`.

The drawer is read-only. It does not expose direct review-task creation in this phase.

## Offline behavior

When offline, Explain controls remain non-destructive but the drawer clearly states that fresh financial intelligence requires reconnection. No stale second cache is introduced in this phase. The existing financial report data already on screen remains visible under its current behavior.

## Performance

- zero metric intelligence requests until a human selects one;
- one request per opened metric;
- no N+1 report calls;
- no new provider/LLM call for deterministic metric explanation;
- Ask TradeOS invokes the model only after explicit user action.

## Safety

- read-only metric intelligence endpoint;
- no economic/access mutations;
- all metric keys/ranges server allow-listed;
- one canonical accounting/report computation path;
- Ask TradeOS evidence remains server-generated and schema-bounded;
- recommendations remain navigation-only.

## Testing

- contract/type tests for metric keys, range and assistant context union;
- report-route regression tests proving canonical output is unchanged after extraction;
- metric service tests for all nine mappings, comparisons, inventory no-prior semantics, attention mapping and tenant/branch isolation;
- route tests for unsupported/mixed contexts and safe authorization;
- query tests proving metric context is revalidated server-side and actually grounds the provider;
- Web contract/tests proving lazy fetch, exact context handoff, offline behavior, all nine Explain mounts and no write methods;
- full API/Web tests, typechecks/builds, migration validation, VPS/security contracts, CI and Visual QA.
