# Data Readiness Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert low-data-confidence attention into a dedicated, safe internal data-readiness review routed to Business Settings.

**Architecture:** Extend the existing safe automation action allow-list with `CREATE_DATA_READINESS_REVIEW`; reuse policy/run/dispatcher/action queue persistence. Add one Owner/Admin guided template for `LOW_DATA_CONFIDENCE`, retain legacy generic low-data policies for runtime compatibility, and route the new action to `/settings?section=business`.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React/Next.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-data-readiness-review-automation-design.md`

## Global Constraints

- Internal review only; never synthesize or mutate business activity to increase confidence.
- `LOW_DATA_CONFIDENCE` is the only trigger for the new template.
- Owner/Admin may configure the new template; Manager may not.
- Existing `CREATE_FOLLOW_UP` policies remain executable for backward compatibility.
- System dispatcher may execute enabled dedicated policies.
- Route the new action to `/settings?section=business`.
- Preserve tenant/branch isolation, idempotency, assignment validation, and provider independence.

## Review Focus

- A Manager must be unable to create/update `CREATE_DATA_READINESS_REVIEW` while Owner/Admin succeeds.
- Duplicate/replayed `LOW_DATA_CONFIDENCE` dispatch must create one internal task only.
- Existing legacy `CREATE_FOLLOW_UP` + `LOW_DATA_CONFIDENCE` policies must continue running safely even after the new template is added.
- New task copy must never encourage synthetic transactions or fabricated records.
- Contextual and Business Pulse routing must land on Business Settings, not Reports/Dashboard.

---

### Task 1: Add server safe data-readiness action

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-service.ts`
- Test: `apps/api/test/business-automation.integration.test.ts`
- Test: `apps/api/test/business-automation-dispatcher.integration.test.ts`

**Interfaces:**
- Produce safe/system action `CREATE_DATA_READINESS_REVIEW`.
- Do not add it to `MANAGER_ACTION_TYPES`.
- `actionPresentation()` title: `Review TradeOS data readiness`.

- [ ] Write failing Owner/Admin/Manager policy and dispatcher assertions.
- [ ] Run RED and confirm the new action is rejected/missing.
- [ ] Add safe/system allow-list entries and presentation only; leave legacy `CREATE_FOLLOW_UP` supported.
- [ ] Run focused API tests + strict typecheck.
- [ ] Commit `feat(ai): add data readiness review action`.

### Task 2: Add guided data-readiness template with legacy recognition

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automations.ts`
- Test: `apps/web/app/components/intelligence/business-automation-guidance.test.ts`
- Test: `apps/web/app/components/intelligence/business-automations.test.ts`

**Interfaces:**
- Add template id `data-readiness-review`.
- Action `CREATE_DATA_READINESS_REVIEW`; trigger `LOW_DATA_CONFIDENCE`; default `ANY`; due `72` hours.
- New template visible to Owner/Admin, hidden from Manager.
- Do not delete server/runtime support for old `CREATE_FOLLOW_UP` policies.
- `guidedAutomationDraftFromPolicy()` recognizes legacy `CREATE_FOLLOW_UP` + `LOW_DATA_CONFIDENCE` as the data-readiness draft so an edit/save upgrades it to the dedicated action.

- [ ] Write failing template catalog, role visibility, 72-hour default, payload, new-policy round-trip, and legacy-policy recognition tests.
- [ ] Run RED.
- [ ] Implement template/type/default changes and legacy recognition.
- [ ] Run focused Web tests + strict typecheck.
- [ ] Commit `feat(ai): guide data readiness reviews`.

### Task 3: Route data-readiness reviews to Business Settings

**Files:**
- Modify: `apps/web/app/components/intelligence/contextual-intelligence.ts`
- Modify: `apps/web/app/components/intelligence/business-pulse.tsx`
- Test: corresponding intelligence unit/contract tests.

**Interfaces:**
- `CREATE_DATA_READINESS_REVIEW` maps to `/settings?section=business` everywhere.

- [ ] Write failing navigation assertions.
- [ ] Run RED.
- [ ] Add explicit routing mappings.
- [ ] Run focused navigation tests + strict Web typecheck.
- [ ] Commit `feat(ai): route data readiness reviews`.

### Task 4: Whole-slice verification

- [ ] Run full API suite in a disposable 25-migration schema, API typecheck/build.
- [ ] Run full Web tests/typecheck/build.
- [ ] Run contracts build and non-root VPS/deployment/security suite.
- [ ] Run `git diff --check` and safety scan for forbidden economic/access writes.
- [ ] Whole-slice self-review for legacy compatibility, role boundary, wording, routing, dispatcher idempotency, and mutation safety.
- [ ] Push PR #92 and require fresh GitHub CI + Visual QA on exact head.
