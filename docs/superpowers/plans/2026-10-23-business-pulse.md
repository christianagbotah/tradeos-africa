# Business Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global, cross-device Business Pulse that tells each permitted user what changed and what needs attention using existing evidence-backed attention and review-task data.

**Architecture:** Persist only a per-user/business/branch last-seen cursor. A deterministic API service synthesizes Pulse from existing role-filtered attention and action-item services, while AppShell exposes a lazy global drawer and badge. No provider call or economic mutation is introduced.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Next.js/React, Vitest, `@tradeos/contracts`.

**Spec:** `docs/superpowers/specs/2026-10-23-business-pulse-design.md`

## Global Constraints

- Strict tenant/branch/user isolation.
- Reuse current role/evidence filtering; never persist copied sensitive evidence in pulse state.
- No autonomous economic/access mutation and no offline seen replay.
- No AI provider dependency.
- Bounded reads and mobile-first drawer behavior.

## Review Focus

- Role downgrade after Pulse was previously viewed must immediately remove forbidden items/evidence.
- Switching business/branch must never retain the prior context badge/feed/cursor.
- Opening Pulse offline must not advance server seen state.
- Forged client `seenAt`/content fields must be rejected.
- Repeated/concurrent seen calls must remain monotonic and harmless.

---

### Task 1: Pulse persistence and contracts

**Files:**
- Create: `packages/db/migrations/0025_business_intelligence_pulse.sql`
- Modify: `packages/contracts/src/business-intelligence.ts`
- Test: `apps/api/test/business-pulse-schema.integration.test.ts`

**Interfaces:**
- Produces `BusinessPulse`, `BusinessPulseAttentionSummary`, and pulse-state persistence keyed by user/business/branch.

- [ ] Write RED tests for migration columns, user/business/branch FKs, null-safe uniqueness and contracts.
- [ ] Implement migration/contracts.
- [ ] Run targeted schema test and contracts build GREEN.
- [ ] Commit `feat(ai): add business pulse persistence contracts`.

### Task 2: Deterministic Pulse service

**Files:**
- Create: `apps/api/src/business-intelligence/pulse-service.ts`
- Test: `apps/api/test/business-pulse.integration.test.ts`

**Interfaces:**
- Produces `getBusinessPulse(pool, actor, { businessId, branchId, limit })`.
- Produces `markBusinessPulseSeen(pool, actor, { businessId, branchId, now? })`.
- Consumes `listBusinessAttention` and `listBusinessActionItems`.

- [ ] Write RED tests for unseen math, role/evidence filtering, tenant/branch isolation, role downgrade, monotonic seen cursor and bounded results.
- [ ] Implement the service without copying financial formulas or model logic.
- [ ] Run Pulse + attention + automation/entity-action regression suites and API typecheck GREEN.
- [ ] Commit `feat(ai): add deterministic business pulse service`.

### Task 3: Pulse routes and strict shaping

**Files:**
- Modify: `apps/api/src/business-intelligence/routes.ts`
- Test: `apps/api/test/business-pulse-routes.integration.test.ts`

**Interfaces:**
- `GET /v1/intelligence/pulse`.
- `POST /v1/intelligence/pulse/seen` accepting only `businessId`, `branchId`.

- [ ] Write RED route tests for auth, forged scope, limit validation, client timestamp/content injection and repeated seen calls.
- [ ] Implement routes using server-resolved membership/role and server time.
- [ ] Run route/service regressions and API typecheck GREEN.
- [ ] Commit `feat(ai): expose business pulse API`.

### Task 4: Global Pulse UI

**Files:**
- Create: `apps/web/app/components/intelligence/business-pulse.tsx`
- Create: `apps/web/app/components/intelligence/business-pulse-contract.test.ts`
- Modify: `apps/web/app/components/workspace/app-shell.tsx`
- Modify: `apps/web/app/intelligence.css`

**Interfaces:**
- Lazy fetches current business/branch Pulse.
- Marks seen only online after a successful live payload.
- Produces topbar button/badge and responsive drawer with navigation-only links.

- [ ] Write RED contracts for badge/drawer, context scoping, offline behavior, online-only seen POST, safe links and no economic endpoints.
- [ ] Implement Pulse UI and shell integration.
- [ ] Run focused contracts and strict Web typecheck GREEN.
- [ ] Commit `feat(ai): add global business pulse`.

### Task 5: Whole-slice verification and review

**Files:**
- Modify only if review finds a proven issue.

- [ ] Run canonical migration validation and full API suite in a disposable PostgreSQL schema.
- [ ] Run full Web tests/typecheck/production build.
- [ ] Run contracts build, `git diff --check`, VPS deployment/security suite as non-root.
- [ ] Review tenant isolation, role downgrade, context switching, read/write boundaries, mobile layout and N+1 behavior.
- [ ] Push PR #92 head; require fresh GitHub CI and Visual QA success before closing the slice.
