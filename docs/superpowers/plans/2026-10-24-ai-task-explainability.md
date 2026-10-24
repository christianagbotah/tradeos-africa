# AI Task Explainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lazy, read-only `Why this task?` explanation for TradeOS Intelligence action items that resolves automation/attention/entity provenance without leaking evidence after role changes.

**Architecture:** Add a shared explanation contract, expose one actor-safe action-item read primitive from the existing automation service, and build a focused explanation service that resolves run/policy/attention provenance only after an explicit detail request. The Dashboard renders a reusable inline explanation component that fetches only when opened and falls back to the cached task reason offline.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-24-ai-task-explainability-design.md`

## Global Constraints

- No sale, payment, refund, purchase receipt, stock movement/write-off, cashbook, staff, role, membership, subscription, or access mutation.
- No LLM/provider call is required.
- Explanation data loads lazily; action-list reads must not gain provenance joins or N+1 calls.
- Current-role action visibility and entity financial-evidence filtering must be reapplied at explanation time.
- Foreign/unauthorized action IDs fail closed without exposing cross-tenant existence.
- Evidence shown in the explanation is bounded to five facts in the UI.

## Review Focus

- A role downgraded after task creation must not regain historical financial evidence through explanation.
- A lower role may explain only a currently assigned action still permitted for that role.
- Automation provenance joins must never cross `business_id`, and branch attention must remain in scope.
- Missing/deleted policy, run, or attention provenance must degrade to truthful partial explanation rather than fail the whole task detail.
- Repeated open/close actions and offline mode must not issue eager or duplicate list-time requests.

---

### Task 1: Explanation contracts

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Test: `packages/contracts/src/business-intelligence.test-d.ts`

**Interfaces:**
- Produces: `BusinessActionItemExplanationSourceKind` and `BusinessActionItemExplanation`.
- `BusinessActionItemExplanation` contains scope/action IDs, `generatedAt`, `sourceKind`, `summary`, permission-filtered `action`, optional `automation`, optional `attention`, optional `entity`, and bounded `evidence`.

- [ ] **Step 1: Write the failing contract test** proving the four source kinds and the complete explanation shape compile while invalid source kinds do not.
- [ ] **Step 2: Run** `pnpm --filter @tradeos/contracts build` and the contract type test; expect failure for missing explanation types.
- [ ] **Step 3: Add the explanation types** to `packages/contracts/src/business-intelligence.ts` with the exact fields from the design.
- [ ] **Step 4: Re-run contract build/type tests** and expect PASS.
- [ ] **Step 5: Commit** `feat(ai): add action task explanation contracts`.

### Task 2: Actor-safe explanation service and route

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Create: `apps/api/src/business-intelligence/action-explanation-service.ts`
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Create: `apps/api/test/business-action-explanation.integration.test.ts`

**Interfaces:**
- Produces from automation service: `getBusinessActionItemForActor(pool, actor, actionItemId): Promise<BusinessActionItem>` using the exact visibility/evidence rules already shared by list/complete/snooze.
- Produces: `explainBusinessActionItem(pool, actor, actionItemId, now?): Promise<BusinessActionItemExplanation>`.
- Route: `GET /v1/intelligence/action-items/:id/explanation?businessId=<uuid>`.

- [ ] **Step 1: Write failing integration tests** for: entity-review explanation; system automation explanation with policy/run/attention; safe partial output when optional provenance rows are missing; foreign business safe not-found; lower-role assignment denial; role-downgrade evidence filtering; and unchanged economic/access ledger counts.
- [ ] **Step 2: Run** the new API integration test in a disposable migrated PostgreSQL schema and verify RED for the missing service/route.
- [ ] **Step 3: Export `getBusinessActionItemForActor`** from the automation service without changing list/mutation behavior.
- [ ] **Step 4: Implement `action-explanation-service.ts`**. Classify source in priority order `AUTOMATION`, `ENTITY_REVIEW`, `ATTENTION`, `MANUAL`; resolve optional run/policy/attention with same-business predicates; enforce branch compatibility for attention; build deterministic summary; return at most 12 service evidence facts.
- [ ] **Step 5: Add the GET route** with access-token auth, `READ_ROLES`, UUID/business parsing, and the existing automation actor mapping. No writes.
- [ ] **Step 6: Run the new test plus existing entity-action/automation/query suites and `pnpm typecheck`; expect PASS.**
- [ ] **Step 7: Commit** `feat(ai): explain action task provenance`.

### Task 3: Lazy Dashboard `Why this task?` UX

**Files:**
- Modify: `apps/web/app/components/intelligence/business-action-items.ts`
- Modify: `apps/web/app/components/intelligence/business-action-items.test.ts`
- Create: `apps/web/app/components/intelligence/business-action-explanation.tsx`
- Create: `apps/web/app/components/intelligence/business-action-explanation-contract.test.ts`
- Modify: `apps/web/app/components/intelligence/business-briefing.tsx`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Produces: `fetchBusinessActionItemExplanation(fetcher, { businessId, actionItemId }): Promise<BusinessActionItemExplanation>`.
- Produces component: `BusinessActionExplanation({ item, businessId, online })`.

- [ ] **Step 1: Write failing helper tests** proving one GET to the encoded explanation URL, non-OK error shaping, and no request before helper invocation.
- [ ] **Step 2: Write failing UI contract tests** proving a `type="button"` `Why this task?` control exists per action card, the existing reason renders before fetch, online expansion lazily calls the helper, offline expansion shows reconnect copy without fetch, and explanation markup has no mutation verbs/handlers.
- [ ] **Step 3: Implement the fetch helper** in `business-action-items.ts`.
- [ ] **Step 4: Implement `BusinessActionExplanation`** as inline expandable detail with source label, policy/signal when present, up to five evidence facts, timestamps, loading/error/retry, and offline cached-reason fallback.
- [ ] **Step 5: Mount the component** inside each Dashboard action card while leaving Open workflow/Mark done/Snooze independent.
- [ ] **Step 6: Add responsive styles** under `.tos-ai-action-explanation*` with adequate spacing/touch targets.
- [ ] **Step 7: Run focused Web tests and `pnpm typecheck`; expect PASS.**
- [ ] **Step 8: Commit** `feat(ai): explain dashboard review tasks`.

### Task 4: Whole-slice verification and review

**Files:**
- Review all files changed since `ac8dc3a`.

**Interfaces:**
- Consumes all prior tasks; produces no new runtime interface.

- [ ] **Step 1: Run full API tests** only in a disposable PostgreSQL schema with all canonical migrations; require every file/test PASS and schema cleanup.
- [ ] **Step 2: Run full Web tests, strict typecheck, and production build.**
- [ ] **Step 3: Run contracts build, API typecheck/build, `git diff --check`, safety grep, and the 49 VPS/deployment/security contracts under the intended non-root identity.**
- [ ] **Step 4: Self-review** tenant/branch isolation, role-downgrade privacy, optional provenance degradation, no N+1 list fetches, and no economic/access writes. Add RED→GREEN tests for any Important finding.
- [ ] **Step 5: Commit review fixes separately, rerun affected/full gates, push the branch, update PR #92, and require fresh GitHub CI + Visual QA on the exact pushed SHA.**
