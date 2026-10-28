# Financial Metric Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-validated, range-scoped intelligence for nine Financial Reports metrics and let Ask TradeOS inherit the exact selected metric context.

**Architecture:** Reuse one canonical server financial-report builder; derive metric intelligence from that report, never from client-calculated values or duplicate accounting SQL. Extend the existing assistant context as an entity-or-metric union, then add one lazy report metric drawer that fetches only after a user clicks Explain.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-10-23-financial-metric-intelligence-design.md`

## Global Constraints

- Supported metrics: `NET_REVENUE`, `GROSS_PROFIT`, `OPERATING_PROFIT`, `EXPENSES`, `NET_CASH_MOVEMENT`, `CASH_BALANCE`, `RECEIVABLES`, `PAYABLES`, `INVENTORY_VALUE`.
- Supported ranges: `today`, `week`, `month`, `quarter`.
- Metric intelligence is read-only; no economic/access mutation endpoints are added.
- The server must reuse the canonical `FinancialSummaryReport` computation.
- The client may not select SQL, source tables, arbitrary labels, report fields, or tools.
- Metric intelligence must not grant more access than the underlying Financial Reports route.
- The report page must issue zero metric-intelligence requests until a human selects one metric.

## Review Focus

- Mixed/extra context fields must fail closed rather than being interpreted as an entity or metric context.
- Inventory value must not invent a prior historical snapshot; previous/delta/change remain null.
- Zero previous values must yield `changePercent: null`, not Infinity/NaN.
- Switching report range while a metric drawer is open must refetch the selected metric under the new range and not show stale success/data from the old range.
- Offline mode must not POST/queue Ask or metric-intelligence requests while pretending data is fresh.

---

### Task 1: Metric contracts and assistant-context union

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Test: `packages/contracts/src/business-intelligence.type-test.ts`

**Interfaces:**
- Produces `BusinessFinancialMetricKey`, `BusinessFinancialMetricRange`, `BusinessMetricContext`, `BusinessAssistantContext`, `BusinessFinancialMetricIntelligence`.
- Changes `BusinessAssistantQueryRequest.context` to `BusinessAssistantContext | null`.

- [ ] Write failing type tests covering all nine keys, four ranges, entity context compatibility, metric context, and invalid mixed/arbitrary shapes.
- [ ] Run the contract type/build test and observe RED on missing metric types.
- [ ] Add the minimal shared types; financial metric response includes current/previous/delta/change, period, currency, summary, evidence, attention, recommendations, askPrompt.
- [ ] Build contracts and run the focused type tests; expect GREEN.
- [ ] Commit `feat(ai): add financial metric intelligence contracts`.

### Task 2: Extract one canonical financial-report builder

**Files:**
- Modify: `apps/api/src/reports.ts`
- Test: `apps/api/test/financial-reports.integration.test.ts`

**Interfaces:**
- Produces `getFinancialSummaryReport(pool, input)` where input carries `businessId`, `branchId`, and the existing report query range/from/to shape.
- Existing `/v1/reports/financial-summary` route delegates to this function and preserves the compatibility `summary` envelope when `range` is supplied.

- [ ] Add a regression test that compares the route’s canonical top-level fields before/after extraction and verifies preset range semantics remain unchanged.
- [ ] Run focused report tests and confirm RED on missing shared builder export.
- [ ] Extract the current repeatable-read computation without changing report SQL, calculation order, public fields, or range validation.
- [ ] Run report tests and API typecheck; expect GREEN.
- [ ] Commit `refactor(reports): share canonical financial summary builder`.

### Task 3: Deterministic financial metric service

**Files:**
- Create: `apps/api/src/business-intelligence/metric-service.ts`
- Create: `apps/api/test/business-metric-intelligence.integration.test.ts`

**Interfaces:**
- Consumes `getFinancialSummaryReport` and `listBusinessAttention`.
- Produces `getBusinessFinancialMetricIntelligence(pool, { businessId, branchId, metricKey, range })` and `BusinessMetricIntelligenceError`.

- [ ] Write integration tests for all nine metric mappings, previous/delta/change calculation, zero-previous handling, inventory null-prior semantics, relevant attention filtering, and foreign branch/business failure.
- [ ] Run the new test file and observe RED because the service does not exist.
- [ ] Implement the allow-list mapping and bounded evidence using only the canonical report object; no duplicated financial SQL.
- [ ] Add deterministic navigation-only recommendation mapping and default Ask prompts.
- [ ] Run metric tests plus financial-report tests and strict API typecheck; expect GREEN.
- [ ] Commit `feat(ai): add financial metric intelligence service`.

### Task 4: Metric endpoint and server-grounded Ask context

**Files:**
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Modify: `apps/api/src/business-intelligence/query-service.ts`
- Test: `apps/api/test/business-entity-intelligence-routes.integration.test.ts`
- Test: `apps/api/test/business-intelligence-query.test.ts`

**Interfaces:**
- Adds `GET /v1/intelligence/metric?businessId=&branchId=&metricKey=&range=`.
- Query parser accepts exactly entity context or metric context; mixed/extra fields fail closed.
- `answerBusinessQuestion` loads metric evidence server-side for metric context and includes validated metric label/range in provider grounding.

- [ ] Add failing route tests for all allow-list boundaries, missing/mixed contexts, safe scope, and the new GET endpoint.
- [ ] Add failing query tests proving metric context reaches the provider only after server validation and a forged key/range never does.
- [ ] Implement exact context-shape parsing and the metric GET route under the same report-read roles.
- [ ] Extend query grounding to branch on entity vs metric context and translate service errors into safe query errors.
- [ ] Run both route/query suites plus API typecheck; expect GREEN.
- [ ] Commit `feat(ai): ground Ask TradeOS in financial metrics`.

### Task 5: Shared metric intelligence drawer and structured Ask handoff

**Files:**
- Create: `apps/web/app/components/intelligence/financial-metric-intelligence-drawer.tsx`
- Create: `apps/web/app/components/intelligence/financial-metric-intelligence-drawer-contract.test.ts`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/components/intelligence/ask-tradeos-drawer.tsx`
- Modify: `apps/web/app/components/intelligence/business-intelligence-contract.test.ts`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Drawer props: `{ metricKey, range, open, onClose }`.
- `tradeos:ask` detail supports either validated entity context or validated metric context.
- Global/topbar Ask clears all structured context.

- [ ] Add RED contracts for lazy online-only metric GET, current/previous/delta rendering, inventory-null-prior copy, exact metric Ask context, offline state, and no POST/PATCH/DELETE in the metric drawer.
- [ ] Add RED AppShell/drawer contracts for allow-listed metric context and malformed/mixed context rejection.
- [ ] Implement the shared drawer, range-keyed request state, and structured Ask handoff.
- [ ] Add responsive drawer styles using existing TradeOS tokens only.
- [ ] Run focused Web intelligence tests and strict Web typecheck; expect GREEN.
- [ ] Commit `feat(ai): add financial metric intelligence drawer`.

### Task 6: Mount Explain controls on the nine report metrics

**Files:**
- Modify: `apps/web/app/components/reports/financial-reports.tsx`
- Create: `apps/web/app/components/intelligence/financial-metric-workspace-contract.test.ts`

**Interfaces:**
- Financial Reports owns one `selectedMetric` state and one drawer instance.
- `ReportKpi` and `PositionCard` accept an optional non-submitting Explain callback/label; no network call happens until the callback selects a metric.

- [ ] Add RED contracts asserting all nine metric keys are wired exactly once to Explain controls, only one drawer is mounted, and no metric request is made from render/list loops.
- [ ] Implement metric selection for the executive net-revenue hero, four flow/KPI values, and four position cards.
- [ ] Ensure a range change updates the open drawer’s context to the new selected range.
- [ ] Run report/metric Web contracts and strict typecheck; expect GREEN.
- [ ] Commit `feat(ai): explain financial report metrics in context`.

### Task 7: Whole-slice verification and review

**Files:**
- Review all changes from the Phase B design commit through HEAD.

**Interfaces:**
- Produces a clean, pushed draft-PR head only after all local gates are fresh.

- [ ] Run contracts build/type tests.
- [ ] Run all API tests inside a disposable PostgreSQL schema with all 24 migrations, then API typecheck/build and confirm schema cleanup.
- [ ] Run full Web tests, typecheck and production build; revert generated `next-env.d.ts` changes.
- [ ] Run VPS/deployment/security contracts as the intended non-root identity.
- [ ] Run `git diff --check` and safety scans proving the metric service/route are read-only and the drawer has no mutation methods.
- [ ] Self-review tenant/branch validation, report calculation reuse, permission parity, stale-range behavior, provider grounding, and no N+1 requests; write regression tests before fixing any Important finding.
- [ ] Push the branch, update PR #92 description, and require fresh GitHub CI + Visual QA success on the exact SHA.
