# Tenant/User AI Intelligence & Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TradeOS owners, managers, accountants, and permitted staff a simple, proactive AI-assisted operating experience with daily briefings, natural-language business questions, cash-flow and working-capital intelligence, inventory intelligence, sales/customer intelligence, guided workflows, and role-aware automation without bypassing accounting or offline safeguards.

**Architecture:** Build business intelligence on the authoritative financial report, cash forecast, credit aging, inventory, customer, supplier, and sales read models already in TradeOS. Deterministic business attention rules create evidence first; the shared AI provider may explain/rank/draft from allow-listed facts. Business automation is scoped by business/branch/role and initially auto-executes only non-economic workflow actions; posted financial, inventory, credit, refund, and access mutations continue through existing canonical services and approval/permission paths.

**Tech Stack:** TypeScript/Fastify/PostgreSQL/Next.js/React/Vitest, `@tradeos/contracts`, existing `@tradeos/domain` health/forecast logic, existing web workspace/session/offline queue, shared `apps/api/src/ai/provider.ts` + OpenAI adapter from the System Admin AI plan.

**Spec:** `docs/superpowers/specs/2026-10-16-system-admin-v2-ai-automation-design.md` — Workstream B.

## Global Constraints

- Business AI is tenant-isolated and branch-aware; no cross-business facts may enter a prompt, response, cache, or automation run.
- Existing accounting, inventory, returns/refunds, credit, authorization, and offline-sync services remain authoritative.
- AI cannot post a sale, purchase receipt, payment, refund, stock write-off/adjustment, credit-limit change, role/access change, or destructive mutation directly.
- Economic mutations continue through existing idempotent sync/canonical APIs; AI may only prepare/guide an action until a permitted user confirms it.
- Recommendations must link to authoritative evidence and distinguish facts, computed metrics, predictions, and recommendations.
- Owners/admins configure automations; other roles see/configure only what their business permissions allow.
- The default experience is contextual cards, action queues, smart defaults, concise briefings, and command/search surfaces; users are not forced into a generic chat screen.
- Mobile-first layouts and touch targets must remain usable in the existing workspace shell.
- AI/provider failure must never block POS, catalog, purchases, inventory, cashbook, reports, or offline mutation sync.
- Cached intelligence is explicitly timestamped/stale when offline; it never masquerades as current live data.

## Review Focus

- Tenant isolation: a crafted businessId/branchId query must never expose another tenant’s facts to the AI tool layer; pinned in Tasks 2 and 4.
- AI suggests an economic action while offline: UI may preserve the recommendation/draft but must not bypass the existing offline mutation queue or execute without confirmation; pinned in Task 6.
- Low-data/new business: briefing must say confidence/data is insufficient rather than hallucinating trends; pinned in Tasks 2–4.
- Mixed roles: cashier/viewer must not receive owner/accountant-only financial intelligence or automation controls; pinned in Tasks 2, 5, and 7.
- Cached briefing from another business/branch: cache keys must include user/business/branch and stale records must never cross context changes; pinned in Task 6.

---

### Task 1: Business intelligence and automation persistence/contracts

**Files:**
- Create: `packages/db/migrations/0023_business_ai_automation.sql`
- Create: `packages/contracts/src/business-intelligence.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/api/test/business-intelligence-schema.integration.test.ts`

**Interfaces:**
- Produces tables `business_attention_items`, `business_automation_policies`, `business_automation_runs`, and `business_action_items`.
- Produces contracts `BusinessAttentionItem`, `BusinessBriefing`, `BusinessBriefingSection`, `BusinessAssistantQueryRequest/Response`, `BusinessAutomationPolicy`, `BusinessAutomationRun`, `BusinessActionItem`, `BusinessRecommendation`.

- [ ] **Step 1: Write failing schema/contract tests**
  - Assert every row has `business_id`; branch-scoped rows optionally carry `branch_id` with business-consistency FK/validation.
  - Assert open attention uniqueness uses business + branch + rule/source key.
  - Assert automation idempotency includes business + policy/version + trigger correlation.
  - Assert `business_action_items` support `OPEN`, `DONE`, `SNOOZED`, `CANCELED` without economic posting fields.

- [ ] **Step 2: Run RED**
  - Run targeted schema test.

- [ ] **Step 3: Implement migration/contracts**
  - Action items are internal workflow records only: title, reason/evidence, owner staff/user where applicable, due date, status, source automation/recommendation, timestamps.

- [ ] **Step 4: Verify migration + contracts build**
  - Run migration validation, targeted test, `pnpm --filter @tradeos/contracts build`.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add business intelligence persistence contracts`

### Task 2: Deterministic business attention engine

**Files:**
- Create: `apps/api/src/business-intelligence/attention-service.ts`
- Create: `apps/api/src/business-intelligence/routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/business-attention.integration.test.ts`

**Interfaces:**
- Produces `evaluateBusinessAttention(pool, context: { auth; businessId; branchId?; now; correlationId }): Promise<BusinessAttentionItem[]>` and `listBusinessAttention`.
- Initial rule codes: `CASH_PRESSURE_FORECAST`, `RECEIVABLES_OVERDUE`, `PAYABLES_OVERDUE`, `SALES_DROP`, `MARGIN_PRESSURE`, `STOCKOUT_RISK`, `SLOW_STOCK`, `WASTAGE_SPIKE`, `LOW_DATA_CONFIDENCE`.
- Route: `GET /v1/intelligence/attention?businessId=&branchId=`; explicit evaluate route restricted to OWNER/ADMIN/MANAGER/ACCOUNTANT.

- [ ] **Step 1: Write failing rule/auth/isolation tests**
  - Seed two businesses and assert business A cannot request/see B attention via forged query IDs.
  - Assert financial rules are available only to `OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`; staff roles get only allowed operational signals.
  - Assert new/low-data business produces `LOW_DATA_CONFIDENCE` instead of synthetic trend claims.
  - Assert rule evidence uses existing report/forecast/ledger facts and re-evaluation updates rather than duplicates.

- [ ] **Step 2: Run RED**
  - Run: `pnpm --filter @tradeos/api exec vitest run test/business-attention.integration.test.ts --no-file-parallelism`

- [ ] **Step 3: Implement attention service by reusing existing authoritative logic**
  - Extract/read shared report/forecast loaders only where necessary; do not duplicate financial formulas from `reports.ts`, `cash-forecast.ts`, or `@tradeos/domain`.
  - Inventory rules must respect unit conversions/stock units already used by inventory/catalog services.

- [ ] **Step 4: Verify GREEN plus report/forecast regressions**
  - Run business-attention test, financial reports tests, cash forecast test, API typecheck.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add business attention engine`

### Task 3: Daily owner/manager briefing service

**Files:**
- Create: `apps/api/src/business-intelligence/briefing-service.ts`
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Test: `apps/api/test/business-briefing.integration.test.ts`

**Interfaces:**
- Produces `buildBusinessBriefing(pool, actor, input: { businessId; branchId?; range: "today"|"week"|"month" }): Promise<BusinessBriefing>`.
- Sections: `URGENT`, `SALES`, `CASH`, `CUSTOMERS_CREDIT`, `SUPPLIERS_PAYABLES`, `INVENTORY`, `OPPORTUNITIES`.
- Route: `GET /v1/intelligence/briefing` with business/branch/range query.

- [ ] **Step 1: Write failing briefing tests**
  - Assert briefing combines attention, health, cash forecast, credit aging, sales/top-items, and inventory signals with evidence links/codes and generated timestamp.
  - Assert confidence/data-quality is explicit and insufficient data yields conservative wording.
  - Assert branch-scoped briefing never includes another branch’s scoped facts except business-level facts explicitly labeled as such.

- [ ] **Step 2: Run RED**
  - Run targeted briefing integration test.

- [ ] **Step 3: Implement deterministic briefing composer first**
  - It must be useful without a live AI provider: concise fact/action sentences derive from deterministic rule templates.
  - AI enrichment is additive in Task 4, never required for core briefing availability.

- [ ] **Step 4: Verify GREEN/typecheck**
  - Run targeted test plus contracts/API typecheck.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add business daily briefing`

### Task 4: Natural-language business query and AI enrichment

**Files:**
- Create: `apps/api/src/business-intelligence/intelligence-tools.ts`
- Create: `apps/api/src/business-intelligence/query-service.ts`
- Modify: `apps/api/src/business-intelligence/briefing-service.ts`
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Test: `apps/api/test/business-intelligence-query.test.ts`

**Interfaces:**
- Consumes: shared `AiTextProvider.generateStructured(input: AiStructuredPrompt)` and `OpenAiResponsesProvider` from the System Admin AI plan, business auth context, existing reports/forecast/read models.
- Tool allow-list: financial summary, cash forecast, credit aging, top items/sales trend, inventory availability/value, customer balances, supplier balances, business attention, branches permitted to the actor.
- Produces `answerBusinessQuestion(pool, actor, request: BusinessAssistantQueryRequest, provider): Promise<BusinessAssistantQueryResponse>` and optional `enrichBusinessBriefing(...)`.
- Route: `POST /v1/intelligence/query`.

- [ ] **Step 1: Write failing grounding/isolation tests with fake provider**
  - Ask representative questions: “what sold best this week?”, “who owes us money?”, “what stock should I reorder?”, “why is cash lower than expected?”. Assert tool facts/evidence IDs are present in the answer envelope.
  - Attempt provider/tool request for a different business and assert rejection before data fetch.
  - Assert unsupported arbitrary SQL/tool request is rejected.
  - Assert malformed model output returns safe error and deterministic briefing still works.

- [ ] **Step 2: Run RED**
  - Run targeted query tests.

- [ ] **Step 3: Implement allow-listed query service and AI enrichment**
  - Model output is validated as structured text + evidence references + recommendation labels; never render/return unrestricted model HTML.
  - Respect actor role when deciding which tools/data fields may enter model context.

- [ ] **Step 4: Verify GREEN without live API key**
  - CI uses fake provider; production adapter is configuration-dependent.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add grounded business question answering`

### Task 5: Business automation policies and guided action items

**Files:**
- Create: `apps/api/src/business-intelligence/automation-service.ts`
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Test: `apps/api/test/business-automation.integration.test.ts`

**Interfaces:**
- Produces `createBusinessAutomationPolicy`, `updateBusinessAutomationPolicy`, `evaluateBusinessAutomations`, `completeBusinessActionItem`, `snoozeBusinessActionItem`.
- Initial auto-executable action types: `CREATE_FOLLOW_UP`, `CREATE_REORDER_REVIEW`, `CREATE_RECEIVABLE_FOLLOW_UP`, `CREATE_CASH_REVIEW`, `SNOOZE_ATTENTION`. These create internal action items only.
- Sensitive/economic recommendations use `PREPARE_*` states and require a permitted user confirmation through existing canonical flows; no direct economic dispatcher is added in this first tenant AI slice.

- [ ] **Step 1: Write failing role/idempotency/safety tests**
  - Assert OWNER/ADMIN may configure policies; MANAGER may configure only allowed non-financial policies if business policy permits; CASHIER/STAFF/VIEWER cannot configure.
  - Assert duplicate triggers create one action item/run.
  - Assert policy cannot select forbidden direct actions such as `POST_PAYMENT`, `REFUND`, `STOCK_WRITE_OFF`, `CHANGE_ROLE`.
  - Assert generated action item carries source evidence and due/owner metadata without posting accounting/stock entries.

- [ ] **Step 2: Run RED**
  - Run business automation integration test.

- [ ] **Step 3: Implement policy/action-item service and routes**
  - Add `GET/POST/PATCH /v1/intelligence/automations` and action-item endpoints.
  - Use server-side role checks and business membership; do not trust client-supplied actor role/staff ID.

- [ ] **Step 4: Verify GREEN and no economic-table diffs**
  - Tests assert sales/payments/refunds/stock movements/cashbook remain unchanged by Class 1 automation.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add safe business workflow automation`

### Task 6: AI-first Dashboard, Ask TradeOS, and offline-aware intelligence cache

**Files:**
- Modify: `apps/web/app/components/dashboard/dashboard-command-center.tsx`
- Create: `apps/web/app/components/intelligence/business-briefing.tsx`
- Create: `apps/web/app/components/intelligence/ask-tradeos-drawer.tsx`
- Create: `apps/web/app/components/intelligence/business-intelligence-cache.ts`
- Modify workspace shell/topbar component that owns global actions
- Test: `apps/web/app/components/intelligence/business-intelligence-contract.test.ts`
- Test: `apps/web/app/components/intelligence/business-intelligence-cache.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 endpoints and workspace session `{ userId/businessId/branchId/role }`.
- Cache key: `tradeos.intelligence.v1:${userId}:${businessId}:${branchId ?? "all"}`; cached envelope includes `generatedAt`, source route/range, and data.
- Produces Dashboard daily briefing + global optional “Ask TradeOS” drawer.

- [ ] **Step 1: Write failing UI/cache tests**
  - Assert Dashboard shows concise briefing/action queue before secondary charts on mobile.
  - Assert Ask TradeOS is optional/global and answers show facts/evidence/recommendations distinctly.
  - Assert cache never returns business/branch A data after switching to B.
  - Assert offline cached briefing is visibly labeled stale with generated time; no AI-recommended economic action auto-submits while offline.

- [ ] **Step 2: Run RED**
  - Run targeted web tests.

- [ ] **Step 3: Implement UI and cache adapter**
  - Cache only successful read envelopes; clear/ignore on identity mismatch and retain timestamp.
  - Do not cache secrets or access tokens.
  - Any guided economic action opens/navigates to the existing canonical workflow; it does not call a new direct AI mutation endpoint.

- [ ] **Step 4: Verify web tests/typecheck/build**
  - Run targeted tests then full `@tradeos/web` test/typecheck/build.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): add daily briefing and Ask TradeOS experience`

### Task 7: Contextual intelligence across Reports, Inventory, Customers, Purchases, and Settings

**Files:**
- Modify: `apps/web/app/components/reports/financial-reports.tsx`
- Modify: `apps/web/app/components/inventory/inventory-workspace.tsx`
- Modify: `apps/web/app/components/customers/customer-workspace.tsx`
- Modify: `apps/web/app/components/purchases/supplier-workspace.tsx`
- Create: `apps/web/app/components/intelligence/contextual-insight-card.tsx`
- Add automation settings panel to the existing Settings control center component(s)
- Test: `apps/web/app/components/intelligence/contextual-intelligence-contract.test.ts`

**Interfaces:**
- Consumes: attention/briefing/query/action-item/automation APIs.
- Produces contextual cards and guided actions using current route/business/branch context; automation settings are visible only to authorized roles.

- [ ] **Step 1: Write failing contextual UX/role tests**
  - Reports: cash/working-capital explanation + evidence links.
  - Inventory: reorder/stockout/slow-stock cards link to Catalog/Purchases and prefill review context, not post purchases.
  - Customers: overdue receivable follow-up cards link to customer account/payment workflows.
  - Purchases: supplier/payables/reorder review cards link to existing purchase/supplier flows.
  - Settings: OWNER/ADMIN see automation policies/run history; unauthorized roles do not, while API remains authoritative.

- [ ] **Step 2: Run RED**
  - Run contextual intelligence targeted web test.

- [ ] **Step 3: Implement shared contextual card and route integrations**
  - Keep cards concise with severity, why, evidence, recommended next step, and one primary action.
  - Avoid duplicating report calculations in React; display server evidence only.

- [ ] **Step 4: Full verification and Visual QA**
  - Run contracts build, API business-intelligence tests, full web tests/typecheck/build, `git diff --check`.
  - Visual QA at mobile/desktop for Dashboard briefing, Ask TradeOS, Reports, Inventory, Customers, Purchases, and Settings automation.

- [ ] **Step 5: Commit**
  - Commit: `feat(ai): complete contextual business intelligence experience`
