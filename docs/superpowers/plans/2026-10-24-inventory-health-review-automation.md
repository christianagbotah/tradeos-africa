# Inventory Health Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert slow-stock and wastage-spike attention into dedicated, safe internal inventory-health review automations.

**Architecture:** Extend the existing safe automation action allow-list with `CREATE_INVENTORY_REVIEW`; reuse the current policy/run/dispatcher/action queue. Add two rule-specific guided templates and deterministic Inventory navigation.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-inventory-health-review-automation-design.md`

## Constraints

- Internal review task only; no inventory/economic/access mutation.
- No new DB table or model/provider dependency.
- Keep `STOCKOUT_RISK` on existing `CREATE_REORDER_REVIEW`.
- Manager remains allowed because this is operational inventory review.

### Task 1: Add server safe action

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Test: `apps/api/test/business-automation.integration.test.ts`
- Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

- [ ] RED: Manager policy and system-dispatch tests for `CREATE_INVENTORY_REVIEW`.
- [ ] Add action to safe/system/Manager sets and `actionPresentation()`.
- [ ] GREEN: focused API tests + typecheck.
- [ ] Commit `feat(ai): add inventory review automation action`.

### Task 2: Add guided slow-stock and wastage templates

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automations.ts`
- Test: `apps/web/app/components/intelligence/business-automation-guidance.test.ts`
- Test: `apps/web/app/components/intelligence/business-automations.test.ts`

- [ ] RED: template catalog, role visibility, payload/default-draft tests.
- [ ] Pin slow-stock default `ANY` + 48h and wastage default `MEDIUM_PLUS` + 24h.
- [ ] RED: edit round-trip for both templates sharing one action type.
- [ ] Remove `SLOW_STOCK` and `WASTAGE_SPIKE` from generic follow-up.
- [ ] GREEN: focused Web tests + typecheck.
- [ ] Commit `feat(ai): guide inventory health reviews`.

### Task 3: Route inventory-review tasks

**Files:**
- Modify: `apps/web/app/components/intelligence/contextual-intelligence.ts`
- Modify: `apps/web/app/components/intelligence/business-pulse.tsx`
- Test: corresponding intelligence contract/unit tests.

- [ ] RED: `CREATE_INVENTORY_REVIEW` must route to `/inventory` everywhere.
- [ ] Add explicit mappings.
- [ ] GREEN: focused navigation tests + typecheck.
- [ ] Commit `feat(ai): route inventory reviews to inventory`.

### Task 4: Final verification

- [ ] Full API suite in disposable 25-migration schema, API typecheck/build.
- [ ] Full Web tests/typecheck/build.
- [ ] Contracts + non-root VPS/deployment/security suite.
- [ ] Safety scan and `git diff --check`.
- [ ] Whole-slice self-review for safe-action boundaries, template ambiguity, routing, and no mutation fan-out.
- [ ] Push PR #92 branch and require fresh CI + Visual QA success.
