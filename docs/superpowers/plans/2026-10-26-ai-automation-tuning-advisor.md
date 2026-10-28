# AI Automation Tuning Advisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, management-only tuning recommendations to TradeOS automation effectiveness and let users open the existing guided policy editor without any automatic policy mutation.

**Architecture:** Extend the existing `BusinessAutomationEffectiveness` response so the API remains the sole authority for tuning rules and the Web continues to make one GET. The effectiveness panel renders server-owned recommendations; `BusinessAutomationsPanel` supplies a callback only for already-loaded policies that are editable in the current scope.

**Tech Stack:** TypeScript, PostgreSQL, Fastify, React/Next.js, Vitest, existing TradeOS contracts/UI/offline infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-26-ai-automation-tuning-advisor-design.md`

## Global Constraints

- No automatic policy mutation, enable/disable, threshold change, assignment change, due-time change, or policy creation.
- No POST/PATCH/DELETE endpoint and no provider/LLM call for tuning advice.
- Reuse the existing effectiveness GET; no second fetch or N+1 reads.
- Recommendations are deterministic, aggregate-only, management-role scoped, and capped at 10.
- No historical dry-run replay until a complete historical attention-event stream exists.
- Existing policy editor is the only place settings change.

## Review Focus

- A policy qualifies for multiple rules: emit exactly one recommendation using HIGH_NEGATIVE_OUTCOMES > LOW_COMPLETION > NO_TRIGGERED_WORK precedence.
- A disabled policy has bad historical outcomes: show effectiveness history but emit no tuning recommendation.
- A policy was moved away from the current branch after generating historical work: retain advice/history but do not expose a Review policy control unless the parent has that policy loaded and editable now.
- Effectiveness analytics fail/offline: tuning degrades with that panel and does not block automation controls.
- Advice payload/UI must not contain a proposed mutation, raw evidence/contact/money data, or create an extra network request.

---

### Task 1: Tuning recommendation contracts and deterministic selector

**Files:**
- Modify: `packages/contracts/src/business-intelligence.ts`
- Create: `apps/api/src/business-intelligence/automation-tuning.ts`
- Create/Test: `apps/api/test/business-automation-tuning.test.ts`

**Interfaces:**
- Consumes: `BusinessAutomationEffectivenessPolicyRow`.
- Produces: `BusinessAutomationTuningRecommendationKind`, `BusinessAutomationTuningFocus`, `BusinessAutomationTuningRecommendation`.
- Produces: `businessAutomationTuningRecommendation(row): BusinessAutomationTuningRecommendation | null`.
- Produces: `businessAutomationTuningRecommendations(rows): BusinessAutomationTuningRecommendation[]` sorted and capped at 10.

- [ ] **Step 1: Write failing tests** for all three recommendation rules, precedence, disabled-policy exclusion, healthy/learning exclusion, deterministic priority/name/id ordering, and 10-item cap.
- [ ] **Step 2: Run the focused test/contracts build and confirm RED** because the tuning types/module do not exist.
- [ ] **Step 3: Add contract types and implement the pure selector** with exact thresholds from the spec and no proposed mutation fields.
- [ ] **Step 4: Run focused tests plus `pnpm --filter @tradeos/contracts build`; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): define automation tuning recommendations`.

### Task 2: Effectiveness response integration

**Files:**
- Modify: `apps/api/src/business-intelligence/automation-effectiveness-service.ts`
- Modify/Test: `apps/api/test/business-automation-effectiveness.integration.test.ts`
- Modify/Test: `apps/api/test/business-automation-effectiveness.contract.test.ts`

**Interfaces:**
- Consumes: `businessAutomationTuningRecommendations(rows)` from Task 1.
- Produces: `BusinessAutomationEffectiveness.tuningRecommendations` from the existing GET response; no new route.

- [ ] **Step 1: Add failing integration/contract assertions** for HIGH/MEDIUM/INFO recommendations, disabled/healthy exclusion, historical moved-policy preservation, branch/tenant isolation, and forbidden sensitive/mutation-shaped fields.
- [ ] **Step 2: Run focused API tests and confirm RED** because the effectiveness response lacks `tuningRecommendations`.
- [ ] **Step 3: Derive recommendations from already-mapped policy rows** after the existing scoped aggregate query and return them in the same response.
- [ ] **Step 4: Run focused effectiveness + automation regression tests and strict API typecheck; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): add automation tuning advice`.

### Task 3: Callback-only tuning UI and existing editor handoff

**Files:**
- Modify: `apps/web/app/components/intelligence/business-automation-effectiveness-panel.tsx`
- Modify: `apps/web/app/components/intelligence/business-automations-panel.tsx`
- Modify: `apps/web/app/intelligence.css`
- Modify/Test: `apps/web/app/components/intelligence/business-automation-effectiveness-panel-contract.test.ts`
- Modify/Test: `apps/web/app/components/intelligence/business-automations-panel-contract.test.ts`
- Modify/Test: `apps/web/app/components/intelligence/business-automation-effectiveness.test.ts`

**Interfaces:**
- `BusinessAutomationEffectivenessPanel` gains `onReviewPolicy?: (policyId: string) => void` and a read-only set/list of reviewable policy IDs.
- Parent resolves a recommendation ID only against its already-loaded relevant policies and calls existing `openEdit(policy)` after existing editability checks.

- [ ] **Step 1: Write failing Web contracts** proving tuning cards render from the existing response, there is still one effectiveness GET, no mutation method/new fetch, and Review policy appears only for reviewable IDs.
- [ ] **Step 2: Add failing parent contract assertions** that current loaded/editable policies are passed as reviewable and callback uses the existing `openEdit` path; historical/unloaded IDs cannot open an editor.
- [ ] **Step 3: Implement compact responsive tuning cards** with priority/focus copy and callback-only Review policy buttons; preserve offline/loading/error independence.
- [ ] **Step 4: Run focused Web tests and strict Web typecheck; confirm GREEN.**
- [ ] **Step 5: Commit** `feat(ai): surface automation tuning advisor`.

### Task 4: Whole-slice review and exact-head verification

**Files:**
- Update: PR #92 body after push.
- No additional product interfaces unless review finds a defect.

**Interfaces:**
- Verifies Tasks 1–3 as one safe read-only slice.

- [ ] **Step 1: Review the slice diff** for denominator drift, branch/tenant leakage, historical-policy edit leakage, duplicate/client-side recommendation logic, sensitive fields, extra fetches, and accidental mutations.
- [ ] **Step 2: Run contracts build and `git diff --check`.**
- [ ] **Step 3: Run full API tests in the repository-approved test database/disposable schema, then API typecheck/build; confirm cleanup.**
- [ ] **Step 4: Run full Web tests/typecheck/production build and confirm all routes generate.**
- [ ] **Step 5: Run the 49 non-root VPS/deployment/security contracts.**
- [ ] **Step 6: Push exact head, update PR #92, and require fresh GitHub CI + Visual QA success for that SHA.**
