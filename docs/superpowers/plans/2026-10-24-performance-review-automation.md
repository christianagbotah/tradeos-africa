# Performance Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert sales-drop and margin-pressure attention into dedicated, safe internal performance-review automations.

**Architecture:** Extend the existing safe automation action allow-list with `CREATE_PERFORMANCE_REVIEW`; reuse the existing policy/run/dispatcher/action-item pipeline. Add two guided Web templates and route the resulting work item to Reports.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-performance-review-automation-design.md`

## Global Constraints

- No economic/access mutations; only internal `business_action_items` may be created by the dispatcher.
- No new database tables or provider/LLM dependency.
- Manager may configure the new operational review action.
- Sales/margin signals must leave the generic follow-up template.

## Review Focus

- A Manager can configure/run performance-review policy but still cannot configure cash/receivables economic-adjacent actions.
- Dispatcher rejects any action type outside the safe allow-list.
- Sales and margin templates emit only their pinned rule code and default threshold.
- Business Pulse/context routing sends performance reviews to Reports.
- Existing generic follow-up remains available for slow stock, wastage, payables, and low-data confidence.

---

### Task 1: Server safe action and presentation

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Test: `apps/api/test/business-automation.integration.test.ts`
- Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

**Interfaces:**
- Produces action type string `CREATE_PERFORMANCE_REVIEW` accepted by human/system automation paths.

- [ ] Write failing tests for Manager permission and dispatcher-created performance review.
- [ ] Run focused API tests and confirm RED.
- [ ] Add the action to safe/system/Manager allow-lists and `actionPresentation()`.
- [ ] Run focused API tests and confirm GREEN.
- [ ] Commit `feat(ai): add performance review automation action`.

### Task 2: Guided Sales and Margin templates

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automations.ts`
- Test: `apps/web/app/components/intelligence/business-automation-guidance.test.ts`
- Test: `apps/web/app/components/intelligence/business-automations.test.ts`

**Interfaces:**
- Produces template IDs `sales-performance-review` and `margin-performance-review` using `CREATE_PERFORMANCE_REVIEW`.

- [ ] Write failing tests for template labels, rules, `MEDIUM_PLUS`, 24-hour due time, and Manager visibility.
- [ ] Assert `SALES_DROP` and `MARGIN_PRESSURE` are absent from general-follow-up rule options.
- [ ] Run focused Web tests and confirm RED.
- [ ] Implement the templates/types/Manager allow-list.
- [ ] Run focused Web tests and confirm GREEN.
- [ ] Commit `feat(ai): guide sales and margin reviews`.

### Task 3: Workflow navigation

**Files:**
- Modify: `apps/web/app/components/intelligence/contextual-intelligence.ts`
- Modify: `apps/web/app/components/intelligence/business-pulse.tsx`
- Test: `apps/web/app/components/intelligence/contextual-intelligence.test.ts`
- Test: existing Business Pulse contract tests.

**Interfaces:**
- `CREATE_PERFORMANCE_REVIEW` resolves to `/reports`.

- [ ] Write failing navigation assertions.
- [ ] Run focused tests and confirm RED.
- [ ] Add the `/reports` mappings.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit `feat(ai): route performance reviews to reports`.

### Task 4: Final verification

- [ ] Run full API tests in a disposable migrated PostgreSQL schema, API typecheck/build.
- [ ] Run full Web tests/typecheck/build.
- [ ] Run contracts and VPS/deployment/security tests under their intended identities.
- [ ] Run safety grep and `git diff --check`.
- [ ] Review whole slice for mutation, permission, duplication, and navigation regressions.
- [ ] Push branch, update PR #92, and require fresh GitHub CI + Visual QA success.
