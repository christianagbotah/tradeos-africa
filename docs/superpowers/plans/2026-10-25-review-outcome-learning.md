# Review Outcome Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture structured review-task outcomes and use repeated negative feedback only to cool down low-priority automatic task dispatch for the same signal.

**Architecture:** Extend the existing action-item contract/table with completion outcome audit fields, keep completion backward compatible, add one small feedback-cooldown query service, and call it only from the tenant ATTENTION dispatcher. The underlying attention/evidence layer remains unchanged and visible; Web adds a compact outcome selector beside the existing Mark done action.

**Tech Stack:** TypeScript, PostgreSQL, Fastify, React/Next.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-25-review-outcome-learning-design.md`

## Global Constraints

- Allowed outcomes: `RESOLVED`, `ALREADY_HANDLED`, `NOT_RELEVANT`, `NO_ACTION_NEEDED`.
- Omitted completion outcome defaults to `RESOLVED`.
- Feedback cooldown applies only to automatic ATTENTION dispatch for `INFO` and `LOW` severity.
- Cooldown threshold: at least 2 negative (`NOT_RELEVANT` or `NO_ACTION_NEEDED`) automated outcomes in the previous 30 days for the same business + branch + attention `rule_code` + `source_key`.
- Cooldown ends 14 days after the latest qualifying negative completion.
- HIGH/CRITICAL and MEDIUM are never cooled down in this slice.
- Manual/entity review task creation is never cooled down.
- Underlying attention stays visible.
- No sale, payment, refund/return, purchase, inventory, cashbook, staff, role, membership, subscription, or access mutation.
- No free-text outcome feedback.

## Review Focus

- A client retries completion with a different outcome after the task is already DONE: preserve the first recorded outcome and return the existing task.
- A user changes role after task creation: existing current-role visibility/evidence filtering must still apply to completion responses.
- Negative feedback from another branch, tenant, rule, source key, or manual/entity task must not affect dispatcher cooldown.
- A second negative outcome exactly outside the 30-day window must not trigger cooldown; cooldown expiry must use the latest qualifying completion.
- Database/query failure must not hide attention: dispatcher records a failed candidate/scope through existing error handling rather than mutating or resolving the alert.

---

### Task 1: Completion outcome contracts and persistence

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Create: `packages/db/migrations/0026_business_action_outcomes.sql`
- Modify/Test: `apps/api/test/business-intelligence-schema.integration.test.ts`
- Test: existing contract/build checks under `packages/contracts`

**Interfaces:**
- Produces: `BusinessActionCompletionOutcome` union.
- Produces on `BusinessActionItem`: `completionOutcome: BusinessActionCompletionOutcome | null`, `completedByUserId: string | null`.
- Produces DB columns `completion_outcome`, `completed_by_user_id` and recent-feedback index.

- [ ] **Step 1: Write failing contract/schema assertions** for the four-value outcome union shape, new action-item fields, migration columns/checks/backfill/FK/index.
- [ ] **Step 2: Run focused tests/build and confirm RED** because the type/columns do not exist.
- [ ] **Step 3: Implement contracts and migration**; backfill legacy DONE rows to `RESOLVED`, require DONE rows to carry an allowed outcome, forbid outcomes on non-DONE rows, leave legacy `completed_by_user_id` nullable.
- [ ] **Step 4: Run focused schema test plus contracts build and confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): persist review completion outcomes`.

### Task 2: Backward-compatible completion API and audit

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Modify/Test: `apps/api/test/business-automation.integration.test.ts`
- Modify/Test: `apps/api/test/business-entity-actions.integration.test.ts` if mapper fixtures require new fields

**Interfaces:**
- Consumes: `BusinessActionCompletionOutcome`.
- Produces: `completeBusinessActionItem(..., input)` accepting optional `outcome` and writing `completed_by_user_id` from the authenticated actor.
- Preserves: already-DONE item returns unchanged even when a later request supplies a different outcome.

- [ ] **Step 1: Write failing integration tests** for default `RESOLVED`, each explicit outcome, invalid outcome 400, completed-by audit, retry preserving first outcome, and current-role evidence filtering on completion response.
- [ ] **Step 2: Run focused API tests and confirm RED.**
- [ ] **Step 3: Implement strict outcome parsing and completion write**; update row/select mappers with the new fields and do not permit client completion actor shaping.
- [ ] **Step 4: Run focused automation/entity tests plus strict API typecheck and confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): capture review task outcomes`.

### Task 3: Compact Web outcome selection

**Files:**
- Modify: `apps/web/app/components/intelligence/business-action-items.ts`
- Modify/Test: `apps/web/app/components/intelligence/business-action-items.test.ts`
- Modify: `apps/web/app/components/intelligence/business-briefing.tsx`
- Modify/Test: `apps/web/app/components/intelligence/business-intelligence-contract.test.ts`
- Modify: `apps/web/app/intelligence.css` only if a new compact selector class is required

**Interfaces:**
- Consumes: `BusinessActionCompletionOutcome`.
- `BusinessActionMutation` complete branch gains `outcome: BusinessActionCompletionOutcome`.
- `mutateBusinessActionItem` sends `{ businessId, outcome }` for complete.

- [ ] **Step 1: Write failing helper/UI contract tests** proving `RESOLVED` default selection, explicit payload, the four labels, online-only mutation, and no new economic mutation route.
- [ ] **Step 2: Run focused Web tests and confirm RED.**
- [ ] **Step 3: Implement per-action outcome state** with a compact selector defaulting to `RESOLVED`; keep Mark done/Snooze/Why-this-task behavior intact.
- [ ] **Step 4: Run focused Web tests and strict Web typecheck; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): add review outcome feedback`.

### Task 4: Feedback-aware low-priority dispatcher cooldown

**Files:**
- Create: `apps/api/src/business-intelligence/outcome-feedback-service.ts`
- Create/Test: `apps/api/test/business-outcome-feedback.integration.test.ts`
- Modify: `apps/api/src/business-intelligence/automation-dispatcher.ts`
- Modify/Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

**Interfaces:**
- Produces: `shouldCooldownAttentionAutomation(pool, input): Promise<{ skip: boolean; negativeCount: number; cooldownUntil: string | null }>`.
- Input: `{ businessId, branchId, ruleCode, sourceKey, severity, now }`.
- Extends `TenantAutomationDispatcherTickResult` with `feedbackCooldownSkips: number`.

- [ ] **Step 1: Write failing service integration tests** for 2-negative trigger, 1-negative no trigger, 30-day boundary, 14-day expiry, branch/tenant/rule/source isolation, automated-only counting, and INFO/LOW-only eligibility.
- [ ] **Step 2: Run service tests and confirm RED.**
- [ ] **Step 3: Implement the bounded query service** joining prior action items to their source attention records; count only DONE automated items with negative outcomes.
- [ ] **Step 4: Write failing dispatcher tests** proving skipped low-priority matches do not create runs/tasks, underlying attention remains OPEN/listed, HIGH/CRITICAL/MEDIUM still dispatch, and `feedbackCooldownSkips` increments.
- [ ] **Step 5: Wire the service before `evaluateBusinessAutomationSystem`** after policy-condition match; do not mutate policy/attention state.
- [ ] **Step 6: Run dispatcher/service/automation regressions plus strict API typecheck; confirm GREEN.**
- [ ] **Step 7: Commit** `feat(ai): learn from low priority review outcomes`.

### Task 5: Whole-branch safety review and exact-head verification

**Files:**
- Update: PR #92 body verification section after push
- Append: relevant `.superpowers/sdd/.../progress.md` scratch ledger (gitignored)

**Interfaces:**
- No new production interface; verifies Tasks 1–4 as one slice.

- [ ] **Step 1: Review the slice diff** for tenant/branch leakage, current-role evidence leakage, unsafe writes, client shaping, duplicate dispatch, hidden attention, and list-row fan-out.
- [ ] **Step 2: Run disposable-schema full API tests, strict typecheck, API build, and canonical migration application.** Expected: all green; schema dropped afterward.
- [ ] **Step 3: Run full Web tests, strict typecheck, production build, and `git diff --check`.** Expected: all green and all routes generated.
- [ ] **Step 4: Run contracts build plus non-root VPS/deployment/security contracts.** Expected: all green.
- [ ] **Step 5: Push exact head and verify GitHub CI + Visual QA succeed for that SHA.**
- [ ] **Step 6: Update PR #92 body** with outcome-learning behavior, safety boundaries, and exact verification counts.
