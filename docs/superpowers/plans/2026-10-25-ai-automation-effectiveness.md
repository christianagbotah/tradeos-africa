# AI Automation Effectiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give automation managers a transparent 30-day view of whether TradeOS AI-generated review work is being completed and judged relevant, without changing automation behavior or business state.

**Architecture:** Add a read-only deterministic aggregate service and route over existing automation/action/outcome tables, then render one compact effectiveness panel above the existing automation policy controls. The endpoint returns raw counts/rates and policy-level metrics only; the Web derives simple presentation labels without persisting scores.

**Tech Stack:** TypeScript, PostgreSQL, Fastify, React/Next.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-25-ai-automation-effectiveness-design.md`

## Global Constraints

- Fixed analytics window: 30 days.
- Roles allowed: `OWNER`, `ADMIN`, `MANAGER` only.
- Scope: exact business + selected active branch.
- Only action items with `source_automation_run_id IS NOT NULL` contribute to automation effectiveness rates.
- Direct entity-review tasks contribute only to `manualEntityReviewsCreated`.
- Relevant outcomes: `RESOLVED`, `ALREADY_HANDLED`.
- Negative outcomes: `NOT_RELEVANT`, `NO_ACTION_NEEDED`.
- No raw evidence JSON, attention `source_key`, contacts, customer/supplier names, or monetary values in the response.
- No POST/PATCH/DELETE endpoint or mutation behavior in this slice.
- API/provider failure must not block Dashboard or automation policy controls.

## Review Focus

- A policy exists but has zero runs/tasks in the window: return it with zeros rather than omitting it.
- A task belongs to another branch/tenant: it must not affect any aggregate or policy row.
- A direct entity-review task has outcomes: count it only in `manualEntityReviewsCreated`, never in automation rates.
- A completed task has no usable duration or outcome edge case: median/rates must remain finite and deterministic; no NaN/null leakage except `medianCompletionHours: null` when there are no completed automated tasks.
- An automation manager is offline or the analytics endpoint fails: policy controls must remain usable under their existing behavior and only the effectiveness panel degrades.

---

### Task 1: Effectiveness contracts

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Create/Test: `apps/api/test/business-automation-effectiveness.contract.test.ts`

**Interfaces:**
- Produces: `BusinessAutomationEffectivenessPolicyRow`.
- Produces: `BusinessAutomationEffectiveness` with the exact fields from the design.

- [ ] **Step 1: Write a failing compile/shape contract test** asserting `windowDays` is exactly `30`, the summary/outcome fields exist, and policy rows expose only aggregate identifiers/metrics.
- [ ] **Step 2: Run the focused contract test/build and confirm RED** because the types do not exist.
- [ ] **Step 3: Add the two contract types** to `packages/contracts/src/business-intelligence.ts` with numeric rates and nullable median/last-task fields.
- [ ] **Step 4: Run focused test plus `pnpm --filter @tradeos/contracts build`; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): define automation effectiveness contract`.

### Task 2: Deterministic effectiveness aggregate service

**Files:**
- Create: `apps/api/src/business-intelligence/automation-effectiveness-service.ts`
- Create/Test: `apps/api/test/business-automation-effectiveness.integration.test.ts`

**Interfaces:**
- Consumes: `BusinessAutomationEffectiveness`.
- Produces: `getBusinessAutomationEffectiveness(pool, input): Promise<BusinessAutomationEffectiveness>`.
- Input: `{ businessId: string; branchId: string; now?: Date }`.

- [ ] **Step 1: Write failing PostgreSQL integration tests** covering policy-with-zero-tasks, automated task attribution, entity/manual exclusion from rates, all four outcomes, tenant/branch isolation, cross-policy attribution, and median completion duration.
- [ ] **Step 2: Run the test in the dedicated CI/test database and confirm RED** because the service module does not exist.
- [ ] **Step 3: Implement `getBusinessAutomationEffectiveness`** using bounded SQL aggregates/`percentile_cont(0.5)` over the fixed 30-day window; include relevant business-wide + selected-branch policies and branch-scope all action counts.
- [ ] **Step 4: Add assertions that the returned object contains no `evidence`, `sourceKey`, contact, entity-label, or money fields.**
- [ ] **Step 5: Run the focused integration test and strict API typecheck; confirm GREEN.**
- [ ] **Step 6: Commit** `feat(ai): aggregate automation effectiveness`.

### Task 3: Read-only authenticated route

**Files:**
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Modify/Test: `apps/api/test/business-automation-effectiveness.integration.test.ts`

**Interfaces:**
- Consumes: `getBusinessAutomationEffectiveness`.
- Produces: `GET /v1/intelligence/automation-effectiveness?businessId=<uuid>&branchId=<uuid>`.

- [ ] **Step 1: Add failing route tests** for OWNER/ADMIN/MANAGER success, lower-role denial, invalid UUID 400, foreign business 403, foreign/inactive branch failure, and exact business/branch response scope.
- [ ] **Step 2: Run focused route tests and confirm RED** because the route is absent.
- [ ] **Step 3: Register the GET route** using the existing access-token/business-role helpers; validate branch scope before returning analytics and do not add a mutation route.
- [ ] **Step 4: Run focused API tests plus strict API typecheck; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): expose automation effectiveness`.

### Task 4: Compact Web effectiveness panel

**Files:**
- Create: `apps/web/app/components/intelligence/business-automation-effectiveness-panel.tsx`
- Create/Test: `apps/web/app/components/intelligence/business-automation-effectiveness-panel-contract.test.ts`
- Modify: `apps/web/app/components/intelligence/business-automations-panel.tsx`
- Modify/Test: `apps/web/app/components/intelligence/business-automations-panel-contract.test.ts`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Consumes: `BusinessAutomationEffectiveness`.
- Produces: `BusinessAutomationEffectivenessPanel` mounted inside `BusinessAutomationsPanel` before editor/policy rows.

- [ ] **Step 1: Write failing Web contract tests** proving one authenticated GET only when online/allowed, no mutation methods, four KPI labels, four outcome labels, policy rows, explicit loading/error/offline states, and no failure coupling to policy controls.
- [ ] **Step 2: Add failing presentation tests** for policy status derivation: zero tasks → `No triggered work yet`; fewer than 2 completed → `Learning`; at least 2 negative and negatives >= relevant → `Needs review`; otherwise → `Healthy`.
- [ ] **Step 3: Implement the panel** using `useApiFetch`, current session business/branch, compact percent/hour formatting, and no provider/Ask call.
- [ ] **Step 4: Mount the panel** in `BusinessAutomationsPanel` before policy controls and add responsive CSS using existing design tokens only.
- [ ] **Step 5: Run focused Web tests and strict Web typecheck; confirm GREEN.**
- [ ] **Step 6: Commit** `feat(ai): show automation effectiveness`.

### Task 5: Whole-slice review and exact-head verification

**Files:**
- Update: PR #92 body after push
- No production interface changes beyond Tasks 1–4.

**Interfaces:**
- Verifies the complete slice.

- [ ] **Step 1: Review the slice diff** for tenant/branch leakage, role leakage, incorrect denominator math, task-origin misclassification, sensitive-field exposure, N+1 queries, and accidental mutations.
- [ ] **Step 2: Run contracts build and `git diff --check`.**
- [ ] **Step 3: Run the full API package on the ephemeral dedicated `tradeos_ci` PostgreSQL cluster, then API typecheck/build; verify the cluster is removed.**
- [ ] **Step 4: Run full Web tests/typecheck/production build and confirm all routes generate.**
- [ ] **Step 5: Run non-root VPS/deployment/security contracts.**
- [ ] **Step 6: Push exact head, update PR #92 verification numbers, and require fresh GitHub CI + Visual QA success for that SHA.**
