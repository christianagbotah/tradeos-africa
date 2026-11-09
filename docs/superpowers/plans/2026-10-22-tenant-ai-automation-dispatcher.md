# Tenant AI Automation Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enabled tenant `ATTENTION` automations execute proactively in the background, creating safe internal action items without impersonating users or touching economic/access ledgers.

**Architecture:** Reuse the existing API-process scheduler pattern with a tenant-specific PostgreSQL advisory lock and 15-minute default interval. Refactor tenant automation execution into a human wrapper plus a narrow system-dispatch path, make run creation concurrency-safe and failures durable, then dispatch deterministic attention signals branch-by-branch and update the tenant UI to describe the now-active background behavior truthfully.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Next.js/React, Vitest, pnpm, existing `@tradeos/contracts` business-intelligence contracts.

**Spec:** `docs/superpowers/specs/2026-10-22-tenant-ai-automation-dispatcher-design.md`

## Global Constraints

- Default scheduler interval is **15 minutes**; configuration may override it but must enforce a conservative minimum.
- `buildApp()` must not start background timers; only the real API server lifecycle starts/stops the dispatcher.
- The dispatcher must use a PostgreSQL advisory lock distinct from `PLATFORM_AUTOMATION_SCHEDULER_LOCK_KEY`.
- Background execution origin is `SYSTEM_DISPATCHER`; it is not an OWNER/ADMIN role and cannot be passed to general tenant authorization as one.
- Background execution remains limited to the existing safe internal action allow-list and must re-check the action type server-side.
- `ATTENTION` trigger correlation is exactly `attention:<attentionItemId>` for dispatcher-created evaluations.
- Idempotency remains business + policy + policy version + trigger correlation ID and must survive true concurrent delivery.
- Business-wide policies expand across active branches; they do not also create aggregate business-level tasks for the same branch signal.
- Automatic dispatch is model-free and does not depend on `AiTextProvider` or the OpenAI adapter.
- Dashboard/briefing reads must not become hidden workflow mutation triggers.
- A failed policy/action must not stop unrelated policies, branches, businesses, or later scheduler ticks.
- No dispatcher path may create sales, payments, refunds, purchases, stock movements/adjustments, cashbook entries, credit mutations, memberships, roles, or access grants.
- Existing manual **Run now** behavior and role restrictions remain available.
- No new queue service or database table is introduced unless implementation reveals an invariant that the existing policy/run/action schema cannot safely represent.

## Review Focus

- **Concurrent duplicate delivery:** two system evaluations for the same attention item must return one durable run and one action item, never a unique-constraint 500 — pinned in Task 2.
- **Business-wide policy with multiple branches:** each active branch may dispatch its own matching signal exactly once, while inactive/foreign branches never dispatch — pinned in Task 3.
- **Legacy or stale assignment:** a policy whose saved assignee is inactive/invalid must still create the task unassigned, never impersonate a replacement user — pinned in Tasks 1 and 2.
- **Corrupt/forbidden policy row:** even a directly seeded economic action type must be rejected by `SYSTEM_DISPATCHER` before any economic mutation — pinned in Task 2.
- **One policy fails mid-sweep:** its run becomes `FAILED`, the next eligible policy/business still succeeds, and the next timer tick still runs — pinned in Tasks 2 and 3.

---

### Task 1: Bind guided assignment intent to authenticated policy authors/editors

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts:123-223,445-552`
- Test: `apps/api/test/business-automation.integration.test.ts`

**Interfaces:**
- Consumes: existing policy create/update actor `{ userId, businessId, role, staffId }` and arbitrary `actionConfiguration` JSON.
- Produces: server-normalized policy configuration that retains `assignToActor`/`dueInHours` and, when `assignToActor === true`, stores authoritative `assignedUserId` and `assignedStaffId` derived from the authenticated actor. Client-supplied assignment IDs are ignored/overwritten.

- [ ] **Step 1: Write failing assignment-normalization tests**

Add integration assertions that:

```ts
expect(created.json().policy.actionConfiguration).toMatchObject({
  assignToActor: true,
  assignedUserId: tenant.userId,
  assignedStaffId: tenant.staffId,
});
```

Create the policy with forged `assignedUserId`/`assignedStaffId` values and assert the returned/persisted values are still the authenticated tenant actor. Add a PATCH case where another authorized editor saves `assignToActor: true` and assert the binding updates to that authenticated editor; saving `assignToActor: false` removes bound IDs.

- [ ] **Step 2: Run RED**

Run the targeted business automation integration test in the disposable PostgreSQL schema. Expected: assignment assertions fail because the service currently persists the client object unchanged.

- [ ] **Step 3: Implement server normalization**

Add a focused helper in `automation-service.ts`:

```ts
function normalizeActionConfiguration(
  actor: Actor,
  value: Record<string, unknown>,
): Record<string, unknown>
```

Rules: copy allowed existing configuration, always delete/overwrite client `assignedUserId` and `assignedStaffId`; when `assignToActor === true`, set actor user/staff IDs from server auth; otherwise omit the bound IDs. Use it in both create and update before writing JSON.

- [ ] **Step 4: Run GREEN plus existing automation tests**

Run `apps/api/test/business-automation.integration.test.ts`; expected: all cases pass, including existing manual Run-now assignment behavior.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/business-intelligence/automation-service.ts apps/api/test/business-automation.integration.test.ts
git commit -m "feat(ai): bind automation assignment to authenticated users"
```

### Task 2: Add safe system execution, conflict-safe idempotency, and durable failures

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts:226-318,383-600`
- Test: `apps/api/test/business-automation.integration.test.ts`

**Interfaces:**
- Consumes: existing `BusinessAutomationPolicy`, open attention item, safe action allow-list, server-bound assignment configuration from Task 1.
- Produces:

```ts
export async function evaluateBusinessAutomationSystem(
  pool: DatabasePool,
  input: {
    businessId: string;
    branchId: string;
    policyId: string;
    triggerSource: "ATTENTION";
    triggerCorrelationId: string;
    now?: Date;
  },
): Promise<BusinessAutomationRun>
```

Also produces a shared pure matcher used by manual validation and the dispatcher:

```ts
export function businessAutomationConditionsMatch(
  conditions: Record<string, unknown>,
  attention: { ruleCode: string; severity: string },
): boolean
```

`evaluateBusinessAutomation(...)` remains the human authenticated wrapper and preserves human role checks.

- [ ] **Step 1: Write failing system-execution tests**

Add tests that directly call `evaluateBusinessAutomationSystem` and assert:

- two `Promise.all` concurrent calls using `attention:<id>` produce the same run ID, one `business_automation_runs` row, and one `business_action_items` row;
- a valid system run assigns the action to the server-bound user/staff from Task 1;
- after suspending that membership or deactivating its staff record, a new attention item creates an unassigned action rather than impersonating another user;
- a legacy policy with only `assignToActor=true` falls back to the policy creator only while that creator has an active same-business membership/staff relationship;
- a directly seeded policy with `action_type='POST_PAYMENT'` is rejected and leaves canonical economic counts unchanged;
- a safe policy with directly seeded invalid `dueInHours` creates a durable `FAILED` run with `completed_at`/`error_message`, no action item, and unchanged economic counts.

- [ ] **Step 2: Run RED**

Run the targeted business automation integration test. Expected: system evaluator is missing and concurrent/failure-durability assertions fail.

- [ ] **Step 3: Split human authorization from safe action validation**

Introduce internal helpers so human execution applies role restrictions while `SYSTEM_DISPATCHER` only receives the safe allow-list:

```ts
function assertSafeActionType(actionType: string): void
function assertHumanActionAllowed(role: BusinessRole, actionType: string): void
```

Never construct a fake tenant role for system execution.

- [ ] **Step 4: Make run preparation conflict-safe**

Refactor run creation into an internal preparation function that inserts with the existing unique idempotency key using `ON CONFLICT ... DO NOTHING RETURNING *`; if no row is returned, fetch and return the existing run. Preserve branch/policy/attention validation before action creation.

- [ ] **Step 5: Make action execution/failure durable**

Execute action-item creation after durable run preparation. On success, mark the run `SUCCEEDED` with `{ actionItemId, actionType }`; on execution/configuration failure, update that run to `FAILED` with sanitized error text and `completed_at`, then return the failed run for system execution. Manual route error semantics may continue surfacing the existing `BusinessAutomationError` where appropriate, but must not duplicate runs/actions.

- [ ] **Step 6: Resolve system assignment safely**

Add an internal resolver that validates saved bound IDs (or legacy creator fallback) against `app_users.status='ACTIVE'`, `business_memberships.status='ACTIVE'`, same `business_id`, matching `staff_id`, and `staff.is_active=true`. Invalid/stale assignment resolves to `{ userId: null, staffId: null }`.

- [ ] **Step 7: Reuse one condition matcher**

Make `loadAttentionForTrigger` call `businessAutomationConditionsMatch` so dispatcher pre-filtering and execution-time enforcement cannot drift. `ruleCodes` and existing severity arrays keep their current semantics; the guided UI already converts threshold choices into explicit allowed severities.

- [ ] **Step 8: Run GREEN and economic-invariant checks**

Run the full business automation integration file. Expected: concurrency, failure durability, stale assignment, forbidden direct action, existing human role/idempotency, and economic-count assertions all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/business-intelligence/automation-service.ts apps/api/test/business-automation.integration.test.ts
git commit -m "feat(ai): add safe system automation execution"
```

### Task 3: Implement the branch-aware tenant automation dispatcher and scheduler

**Files:**
- Create: `apps/api/src/business-intelligence/automation-dispatcher.ts`
- Create: `apps/api/test/business-automation-dispatcher.integration.test.ts`
- Consume: `apps/api/src/business-intelligence/attention-service.ts`
- Consume: `apps/api/src/business-intelligence/automation-service.ts`

**Interfaces:**
- Consumes: `evaluateBusinessAttention`, `businessAutomationConditionsMatch`, `evaluateBusinessAutomationSystem`.
- Produces:

```ts
export const TENANT_AUTOMATION_DISPATCHER_LOCK_KEY: string;

export type TenantAutomationDispatcherTickResult = {
  acquired: boolean;
  correlationId: string | null;
  scopesEvaluated: number;
  policiesEvaluated: number;
  matches: number;
  succeeded: number;
  failed: number;
};

export async function runTenantAutomationDispatcherTick(
  pool: DatabasePool,
  options?: { intervalMs?: number; now?: () => Date },
): Promise<TenantAutomationDispatcherTickResult>;

export function startTenantAutomationDispatcher(
  pool: DatabasePool,
  options?: { enabled?: boolean; intervalMs?: number; now?: () => Date },
): { stop(): void };
```

- [ ] **Step 1: Write failing scheduler-lock and lifecycle-unit integration tests**

Assert a held `TENANT_AUTOMATION_DISPATCHER_LOCK_KEY` makes a second tick return `acquired:false`. Start two dispatcher instances with the same fixed clock and short test interval; assert duplicate ticks still create one run/action for the same policy/version/attention correlation. Assert `{ enabled:false }` creates no tick/run.

- [ ] **Step 2: Write failing branch/business-wide matching tests**

Seed one active business with two active branches and one inactive branch. Assert:

- a branch-scoped policy only dispatches its branch;
- a business-wide policy expands to both active branches exactly once when each branch has a matching deterministic signal;
- the inactive branch does not dispatch;
- a second business's signals never enter the first business's run/action rows;
- `ruleCodes` and severity arrays reject nonmatching attention items;
- disabled/non-`ATTENTION` policies are not scheduled.

- [ ] **Step 3: Write failing sweep-isolation tests**

Seed one invalid safe policy configuration that will produce a `FAILED` run and another valid policy/business. Assert one tick reports failure but the valid policy still reaches `SUCCEEDED`; a later tick can acquire the lock and run normally.

- [ ] **Step 4: Run RED**

Run `business-automation-dispatcher.integration.test.ts`. Expected: module/functions do not exist.

- [ ] **Step 5: Implement policy discovery and branch expansion**

Query enabled `ATTENTION` policies only for `businesses.status='ACTIVE'`, joining active branches so `branch_id IS NULL` expands to every active branch and branch-specific policies expand only to their own active branch. Group rows by `{ businessId, evaluationBranchId }` so attention is refreshed once per branch scope per tick.

- [ ] **Step 6: Implement facts-first matching and execution**

For each scope, call:

```ts
evaluateBusinessAttention(pool, {
  businessId,
  branchId,
  now,
  correlationId: `dispatcher:${bucket}:${businessId}:${branchId}`,
})
```

Filter returned open items with `businessAutomationConditionsMatch`, then call `evaluateBusinessAutomationSystem` with `triggerCorrelationId: `attention:${item.id}``. Catch failures per policy/item so the outer sweep continues.

- [ ] **Step 7: Implement advisory lock, interval bucket, timer, and safe logging**

Reuse the platform scheduler pattern: `pg_try_advisory_lock`, `finally` unlock/release, `running` guard, immediate first tick, `setInterval`, `timer.unref?.()`, and `stop()`. Default to `15 * 60 * 1000`; normalize unsafe intervals. Log only IDs/counts/correlation/duration, never raw evidence or secrets.

- [ ] **Step 8: Run GREEN plus platform scheduler regression**

Run tenant dispatcher tests and `apps/api/test/platform-admin-automation-scheduler.integration.test.ts`. Expected: all pass and the tenant scheduler source contains no AI/model provider import.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/business-intelligence/automation-dispatcher.ts apps/api/test/business-automation-dispatcher.integration.test.ts
git commit -m "feat(ai): dispatch tenant attention automations"
```

### Task 4: Wire dispatcher configuration into the real API server lifecycle

**Files:**
- Modify: `apps/api/src/server.ts:1-30`
- Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

**Interfaces:**
- Consumes: `startTenantAutomationDispatcher` from Task 3.
- Produces: production startup/shutdown wiring with environment-controlled enablement and interval while preserving existing platform scheduler lifecycle.

- [ ] **Step 1: Add failing server-source/lifecycle assertions**

Assert `server.ts` imports/starts the tenant dispatcher, stops it on SIGTERM/SIGINT and listen failure, and passes configuration derived from `TENANT_AUTOMATION_SCHEDULER_ENABLED` / `TENANT_AUTOMATION_SCHEDULER_INTERVAL_MS`. Assert `app.ts` does not start it.

- [ ] **Step 2: Run RED**

Run the dispatcher integration file; expected source assertions fail.

- [ ] **Step 3: Implement server wiring**

Parse the enable flag so only explicit case-insensitive `false`, `0`, or `off` disables it; absent value defaults enabled. Parse interval to a finite number and let dispatcher normalization enforce minimum/default behavior. Start it next to the existing platform scheduler and stop both in every shutdown/failure path.

- [ ] **Step 4: Run GREEN and API typecheck**

Run dispatcher tests plus `pnpm --filter @tradeos/api typecheck`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/test/business-automation-dispatcher.integration.test.ts
git commit -m "feat(ai): start tenant automation dispatcher"
```

### Task 5: Update tenant automation UX to describe active background execution

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automations.ts:118-165`
- Modify: `apps/web/app/components/intelligence/business-automations-panel.tsx:330-342`
- Modify: `apps/web/app/components/intelligence/business-automations-panel-contract.test.ts:33-60`
- Test: `apps/web/app/components/intelligence/business-automations.test.ts`

**Interfaces:**
- Consumes: existing guided template model; no new API contract.
- Produces: truthful copy stating enabled `ATTENTION` policies are checked automatically and **Run now** is an immediate manual test/execution path. Cash review remains explicitly manual.

- [ ] **Step 1: Change contract test first**

Replace the current expectation for “background execution still needs the automation dispatcher” with assertions that attention-template copy contains automatic checking/background execution language and that Cash position review still says manual. Assert **Run now** remains present as immediate manual execution/test wording.

- [ ] **Step 2: Run RED**

Run the two automation web test files. Expected: copy contract fails against the existing temporary wording.

- [ ] **Step 3: Update template/panel copy only**

Do not change action types, conditions, permissions, or request payloads. For attention templates, explain that enabled automations are checked automatically and create internal review/follow-up tasks only. Keep explicit “no purchase/payment/stock/cash posting” safety language. Keep cash review manual.

- [ ] **Step 4: Run GREEN plus web typecheck**

Run the two automation test files, then `pnpm --filter @tradeos/web typecheck`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/intelligence/business-automations.ts apps/web/app/components/intelligence/business-automations-panel.tsx apps/web/app/components/intelligence/business-automations-panel-contract.test.ts apps/web/app/components/intelligence/business-automations.test.ts
git commit -m "feat(ai): surface proactive tenant automation"
```

### Task 6: Full dispatcher regression, isolated database verification, and PR evidence

**Files:**
- Modify only if verification exposes defects; otherwise no product file change.
- Update PR #92 body after evidence is available.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: fresh evidence that proactive dispatch works without violating existing tenant-AI, platform scheduler, web, or economic invariants.

- [ ] **Step 1: Create disposable PostgreSQL schema on VPS**

Load the staging connection environment without printing it, create a unique temporary schema, set `PGOPTIONS` search path to that schema + `public`, register an EXIT trap that drops the schema, and apply all repository migrations there. Never run integration tests against the staging application schema itself.

- [ ] **Step 2: Run targeted API verification**

Run:

```bash
pnpm --filter @tradeos/domain build
pnpm --filter @tradeos/api exec vitest run --no-file-parallelism \
  test/business-automation.integration.test.ts \
  test/business-automation-dispatcher.integration.test.ts \
  test/business-attention.integration.test.ts \
  test/platform-admin-automation-scheduler.integration.test.ts
pnpm --filter @tradeos/api typecheck
```

Expected: zero failures.

- [ ] **Step 3: Run full web verification**

Run:

```bash
pnpm --filter @tradeos/web test
pnpm --filter @tradeos/web typecheck
```

Expected: zero failures.

- [ ] **Step 4: Verify diff/worktree and economic safety evidence**

Run `git diff --check`, inspect `git status --short`, and confirm dispatcher integration assertions explicitly compare economic/access table counts before/after safe automatic execution.

- [ ] **Step 5: Push and update draft PR #92**

Push the branch only after fresh verification. Update the PR body with the dispatcher commits and exact test/typecheck evidence. Keep the PR draft; do not merge until broader tenant-AI workstream/staging validation is complete.
