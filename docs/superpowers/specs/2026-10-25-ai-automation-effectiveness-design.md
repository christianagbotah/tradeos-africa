# AI Automation Effectiveness Design

## Intent

TradeOS now creates safe internal review work, explains why it was created, records structured completion outcomes, and cools down repeated low-priority noise. Owners and managers still cannot answer a basic operational question: **is TradeOS Intelligence actually helping this business?**

This slice makes that answer visible with transparent, deterministic automation-effectiveness analytics. It does not change attention severity, policy behavior, task creation, or any economic/access state.

## Goals

- Show a compact 30-day AI automation effectiveness summary to users who manage automations.
- Measure only authoritative persisted automation runs/action items/outcomes; no LLM-generated analytics.
- Make policy-level usefulness visible without exposing raw source identifiers or sensitive evidence.
- Distinguish completed/relevant outcomes from negative feedback and unfinished work.
- Show median review time so the business can see whether AI-generated work is being acted on.
- Keep the view tenant/branch scoped and current-role protected.
- Keep offline behavior explicit and read-only.

## Non-goals / anti-goals

- No automatic policy disable/enable or threshold changes.
- No severity/ranking changes from effectiveness analytics.
- No economic, inventory, cashbook, staff, role, membership, subscription, or access mutation.
- No opaque effectiveness score or ML model.
- No free-text feedback.
- No raw evidence payloads or attention `source_key` values in the analytics response.
- No analytics derived by loading the client action queue and counting rows in the browser.

## Approaches considered

### 1. Dedicated read-only effectiveness endpoint — chosen

Add a deterministic service and `GET /v1/intelligence/automation-effectiveness` endpoint. It aggregates `business_automation_policies`, `business_automation_runs`, `business_action_items`, and structured completion outcomes for the selected business/branch over a fixed 30-day window. A reusable Web panel renders the summary above the existing automation policy list.

This keeps calculation authoritative, avoids role/pagination leakage, and keeps policy CRUD separate from analytics.

### 2. Derive analytics from the existing action queue in Web

Rejected. The action queue is role-filtered, not an analytics ledger, and may evolve pagination. Client counting would produce inconsistent numbers and duplicate business logic.

### 3. Extend the automation policies endpoint with analytics fields

Rejected. Policy configuration and effectiveness reporting have different lifecycles and permissions. Mixing them would make ordinary policy reads heavier and couple CRUD to analytics joins.

## Contract

Add `BusinessAutomationEffectiveness`:

- `businessId`
- `branchId`
- `generatedAt`
- `windowDays: 30`
- `summary`
  - `automatedTasksCreated`
  - `automatedTasksCompleted`
  - `automatedTasksOpen`
  - `automatedTasksSnoozed`
  - `completionRate` (0..1; 0 when no created tasks)
  - `relevantOutcomeRate` (0..1; completed `RESOLVED` + `ALREADY_HANDLED` divided by completed tasks with outcomes; 0 when none)
  - `negativeOutcomeCount` (`NOT_RELEVANT` + `NO_ACTION_NEEDED`)
  - `medianCompletionHours: number | null`
  - `manualEntityReviewsCreated` for context only; excluded from automation effectiveness rates
- `outcomes`
  - `resolved`
  - `alreadyHandled`
  - `notRelevant`
  - `noActionNeeded`
- `policies[]`
  - `policyId`
  - `name`
  - `enabled`
  - `actionType`
  - `tasksCreated`
  - `tasksCompleted`
  - `tasksOpen`
  - `tasksSnoozed`
  - `relevantOutcomes`
  - `negativeOutcomes`
  - `completionRate`
  - `relevantOutcomeRate`
  - `medianCompletionHours`
  - `lastTaskAt`

Only automated action items (`source_automation_run_id IS NOT NULL`) contribute to automation effectiveness rates. Direct entity review tasks are counted only in `manualEntityReviewsCreated`.

## Semantics

- Window is fixed at 30 days in this slice to avoid premature period controls and keep comparisons stable.
- Task creation is attributed to the policy through `business_action_items.source_automation_run_id -> business_automation_runs.policy_id`.
- `RESOLVED` and `ALREADY_HANDLED` are classified as relevant outcomes.
- `NOT_RELEVANT` and `NO_ACTION_NEEDED` are classified as negative outcomes.
- Completion rate = completed automated tasks / automated tasks created in the window.
- Relevant outcome rate = relevant outcomes / automated completed tasks carrying an outcome.
- Median completion hours uses `completed_at - created_at` for completed automated tasks created in the window.
- Policy rows are returned even when they created no tasks, so an enabled policy with no triggers is visible as “No triggered work yet.”
- Business-wide policies and branch policies are included when relevant to the selected branch; action counts themselves remain branch scoped.

## Permissions and scope

- Endpoint requires an authenticated active business membership.
- Allowed roles: `OWNER`, `ADMIN`, `MANAGER`, matching automation-management UX.
- `businessId` must match active membership.
- `branchId` must belong to the business and be active.
- Every aggregate is filtered by business and selected branch.
- No evidence JSON, contact details, source keys, customer/supplier names, or financial amounts are returned.

## API

`GET /v1/intelligence/automation-effectiveness?businessId=<uuid>&branchId=<uuid>`

Read-only. No POST/PATCH/DELETE path is added.

The service uses deterministic SQL aggregates/percentiles. It does not call the AI provider and cannot block core POS/catalog/purchases/inventory/cashbook flows.

## Web UX

Add `BusinessAutomationEffectivenessPanel` immediately inside the existing AI Automations section, before the policy list/editor.

Desktop/mobile presentation:

- headline: `AI effectiveness · Last 30 days`
- four compact KPIs:
  - Tasks created
  - Completion rate
  - Relevant outcomes
  - Median review time
- compact outcome breakdown chips
- policy rows with task/completion/usefulness metrics and plain states:
  - `No triggered work yet` when zero tasks
  - `Learning` when fewer than two completed tasks
  - `Needs review` when at least two negative outcomes and negative outcomes are not fewer than relevant outcomes
  - otherwise `Healthy`

The labels are presentation-only and derived from raw counts; no hidden score is persisted.

Offline: show a small `Effectiveness unavailable offline` message and do not fetch. Policy controls keep their existing offline behavior.

## Safety and failure behavior

- Read-only analytics only.
- No policy or task mutation.
- No hidden alert suppression.
- No provider dependency.
- API failure degrades only this panel and must not block policy controls or Dashboard rendering.
- No N+1: one aggregate request, one bounded policy result set.

## Testing

- Contract build/type assertions for effectiveness shape.
- API integration tests on a dedicated test database for:
  - exact business/branch isolation;
  - OWNER/ADMIN/MANAGER allowed; lower roles denied;
  - automated vs entity/manual task separation;
  - all four outcome counts;
  - completion/relevant rates;
  - median completion time;
  - policy with zero tasks included;
  - cross-policy attribution;
  - no evidence/source-key fields returned.
- Route tests for UUID/scope/role validation.
- Web contract tests for one read-only GET, four KPIs, outcome breakdown, policy state labels, mobile-safe markup, offline fail-closed behavior, and no mutation methods.
- Full API/Web suites, strict typechecks/builds, contracts build, `git diff --check`, VPS/security contracts, CI and Visual QA.

## Rollout

No migration and no feature flag are required. The endpoint is additive/read-only. It can ship with the existing tenant AI workstream and begin showing meaningful values as review outcomes accumulate.
