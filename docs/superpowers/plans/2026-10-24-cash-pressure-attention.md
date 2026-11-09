# Cash Pressure Attention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete proactive tenant cash-pressure intelligence by deriving `CASH_PRESSURE_FORECAST` from the canonical cash forecast and routing it into the existing safe cash-review workflow.

**Architecture:** Export a reusable cash-forecast report service from `cash-forecast.ts`; both the HTTP route and attention engine consume it. The attention rule is deterministic and triggers only on a projected negative cash date. Existing automation creates internal review work only.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, `@tradeos/domain`, `@tradeos/contracts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-cash-pressure-attention-design.md`

## Global Constraints

- Use the existing forecast calculation and loaders; do not duplicate forecast formulas.
- Trigger only when `firstNegativeCashDate !== null`.
- Severity is CRITICAL within 3 forecast days, HIGH otherwise.
- No economic/access mutations.
- Preserve tenant/branch and financial-role isolation.

## Review Focus

- Low history: a contractual negative forecast still alerts, but confidence evidence remains LOW.
- No negative date: no cash-pressure attention item is emitted and a previously open one resolves.
- Branch scope: branch A forecast cannot use branch B cash/obligations.
- Currency/evidence: monetary values are labeled as minor units with currency metadata.
- Automation: cash pressure may create `CREATE_CASH_REVIEW` only, never a payment/cashbook mutation.

---

### Task 1: Reusable cash forecast report service

**Files:**
- Modify: `apps/api/src/cash-forecast.ts`
- Test: `apps/api/test/cash-forecast.integration.test.ts`

**Interfaces:**
- Produce `getCashForecastReport(pool, { businessId, branchId, horizonDays, generatedAt? }): Promise<CashForecastResponse>`.
- HTTP `/v1/reports/cash-forecast` delegates to it.

- [ ] Write a failing service-level integration assertion that calls the exported function and matches the route forecast summary.
- [ ] Run RED.
- [ ] Extract the existing transactional forecast body with no formula change.
- [ ] Run cash forecast tests and API typecheck.
- [ ] Commit `refactor(ai): share canonical cash forecast report`.

### Task 2: Cash pressure attention rule

**Files:**
- Modify: `apps/api/src/business-intelligence/attention-service.ts`
- Modify: `apps/api/test/business-attention.integration.test.ts`

**Interfaces:**
- Consume `getCashForecastReport` with 30-day horizon and evaluation time.
- Emit `CASH_PRESSURE_FORECAST` only when `firstNegativeCashDate` exists.

- [ ] Add failing tests for HIGH/CRITICAL negative forecast, no-signal positive forecast, branch isolation, and evidence/confidence.
- [ ] Run RED.
- [ ] Implement the deterministic signal and currency-tagged evidence.
- [ ] Run attention + cash forecast + briefing/query regressions and API typecheck.
- [ ] Commit `feat(ai): add cash pressure forecast attention`.

### Task 3: Safe cash-review automation guidance

**Files:**
- Modify the existing guided automation template source under `apps/web/app/components/intelligence/`.
- Modify its focused tests.

**Interfaces:**
- Cash review template uses `CREATE_CASH_REVIEW` and `CASH_PRESSURE_FORECAST` as the guided ATTENTION trigger.
- No client-selected economic action.

- [ ] Add failing template contract assertion for the cash-pressure trigger.
- [ ] Run RED.
- [ ] Update the template/config only.
- [ ] Run focused Web tests/typecheck.
- [ ] Commit `feat(ai): guide cash pressure review automation`.

### Task 4: Whole-slice verification

- [ ] Run API full suite in disposable schema, API typecheck/build.
- [ ] Run full Web tests/typecheck/build.
- [ ] Run deployment/security contracts under intended non-root test identity.
- [ ] Run `git diff --check` and safety grep for forbidden economic writes.
- [ ] Push branch and require fresh GitHub CI + Visual QA on exact head.
