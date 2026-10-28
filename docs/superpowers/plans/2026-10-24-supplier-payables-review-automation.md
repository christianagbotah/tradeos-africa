# Supplier Payables Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert overdue supplier-balance attention into a dedicated, safe internal supplier-payables review automation routed to Purchases.

**Architecture:** Extend the existing safe automation action allow-list with `CREATE_PAYABLES_REVIEW`; reuse the current policy/run/dispatcher/action queue. Add one rule-specific guided template for `PAYABLES_OVERDUE` and deterministic `/purchases` navigation. No new persistence or provider is required.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-supplier-payables-review-automation-design.md`

## Global Constraints

- Internal review task only; no supplier payment, payable settlement, purchase receipt, cashbook, inventory, refund/return, staff, role/access, membership, or subscription mutation.
- `PAYABLES_OVERDUE` is the only trigger for this template.
- Owner/Admin may configure it; Manager may not.
- System dispatcher may execute enabled policies.
- Route review tasks to `/purchases`.
- Preserve existing tenant/branch isolation, idempotency, assignment validation, and financial visibility.

## Review Focus

- Manager policy creation/update for `CREATE_PAYABLES_REVIEW` must fail while Owner/Admin succeeds.
- System-dispatched payables reviews must create one internal task on duplicate/replayed delivery.
- Guided policy edit round-trip must resolve the payables template unambiguously after `PAYABLES_OVERDUE` is removed from general follow-up.
- Task navigation must be `/purchases` in both contextual intelligence and Business Pulse.
- No new economic-table writes may appear in the slice.

---

### Task 1: Add server safe payables-review action

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Test: `apps/api/test/business-automation.integration.test.ts`
- Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

**Interfaces:**
- Produce safe/system action `CREATE_PAYABLES_REVIEW`.
- Do not add it to `MANAGER_ACTION_TYPES`.
- Present tasks as supplier-payables review work.

- [ ] Write failing Owner/Admin/Manager policy assertions and system-dispatch assertion.
- [ ] Run RED and confirm the new action is rejected/missing.
- [ ] Add the action to safe/system allow-lists and `actionPresentation()` only.
- [ ] Run focused API tests + strict typecheck.
- [ ] Commit `feat(ai): add supplier payables review action`.

### Task 2: Add guided supplier-payables template

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automations.ts`
- Test: `apps/web/app/components/intelligence/business-automation-guidance.test.ts`
- Test: `apps/web/app/components/intelligence/business-automations.test.ts`

**Interfaces:**
- Add template id `supplier-payables-review`.
- Action `CREATE_PAYABLES_REVIEW`; trigger `PAYABLES_OVERDUE`; default `HIGH_PLUS`; due `24` hours.
- Remove `PAYABLES_OVERDUE` from `general-follow-up`, leaving low-data confidence there.

- [ ] Write failing template catalog, role visibility, default-draft, payload, and edit round-trip tests.
- [ ] Run RED.
- [ ] Implement the template/type changes and remove the generic overlap.
- [ ] Run focused Web tests + strict typecheck.
- [ ] Commit `feat(ai): guide supplier payables reviews`.

### Task 3: Route supplier-payables reviews

**Files:**
- Modify: `apps/web/app/components/intelligence/contextual-intelligence.ts`
- Modify: `apps/web/app/components/intelligence/business-pulse.tsx`
- Test: corresponding intelligence unit/contract tests.

**Interfaces:**
- `CREATE_PAYABLES_REVIEW` maps to `/purchases` everywhere.

- [ ] Write failing navigation assertions.
- [ ] Run RED.
- [ ] Add explicit routing mappings.
- [ ] Run focused navigation tests + strict Web typecheck.
- [ ] Commit `feat(ai): route supplier payables reviews`.

### Task 4: Whole-slice verification

- [ ] Run full API suite in a disposable 25-migration schema, API typecheck/build.
- [ ] Run full Web tests/typecheck/build.
- [ ] Run contracts build and non-root VPS/deployment/security suite.
- [ ] Run `git diff --check` and safety scan for forbidden economic/access writes.
- [ ] Whole-slice self-review for role boundary, template ambiguity, routing, dispatcher idempotency, and mutation safety.
- [ ] Push PR #92 branch and require fresh GitHub CI + Visual QA on exact head.
