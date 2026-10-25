# Review Outcome Learning Design

## Intent

Close the loop between TradeOS Intelligence and real operator outcomes. TradeOS already detects evidence, explains it, creates review tasks, dispatches safe automations, and lets users complete or snooze work. It does not yet know whether a completed review actually resolved something, was already handled, was not relevant, or needed no action. This slice records that outcome and uses it only to reduce repeated low-priority automation noise.

## Goals

- Capture a structured completion outcome for every newly completed `business_action_items` task.
- Preserve backward compatibility for existing clients that simply press “Mark done”.
- Record who completed the task and keep the outcome in the existing internal action audit trail.
- Let users choose an alternate completion outcome without typing free-form sensitive notes.
- Reuse outcome history to pause repeated **automatic** task creation for the same low-priority attention signal when recent users repeatedly say it was not useful.
- Keep the underlying attention item visible even when automatic task creation is cooled down.
- Never apply feedback cooldown to HIGH or CRITICAL attention.
- Never affect explicit/manual entity review task creation.
- Never mutate sales, payments, refunds/returns, purchases, inventory, cashbook, staff, role, membership, subscription, or access records.

## Non-goals / anti-goals

- No model training or opaque ML weights.
- No automatic severity downgrades.
- No suppression of the underlying Business Pulse/attention signal.
- No cooldown for HIGH/CRITICAL signals.
- No client-controlled cooldown duration or threshold.
- No free-text feedback in this slice.
- No automatic economic or access-changing action.

## Approaches considered

### 1. Structured outcomes + safe dispatcher cooldown — chosen

Persist a small allow-listed completion outcome on `business_action_items`. The tenant automation dispatcher checks recent completed tasks linked to the same attention rule/source. If at least two low-priority automated review tasks were completed as `NOT_RELEVANT` or `NO_ACTION_NEEDED` in the preceding 30 days, automatic dispatch for that same signal is paused for 14 days from the latest negative outcome. The underlying attention stays open and visible.

This gives a meaningful learning loop without hiding important information or changing accounting state.

### 2. Automatically tune attention severity/ranking

Use outcomes to lower severity or reorder future alerts. Rejected for this slice because operator feedback may be sparse or role-specific, and silently reducing business-risk severity would be harder to audit.

### 3. Analytics-only outcome capture

Record outcomes and show an effectiveness report, but never change automation behavior. Safe, but does not solve repeated task noise. We will still retain the audit data needed for future analytics, while applying only the narrowly bounded low-priority cooldown now.

## Data model

Migration `0026_business_action_outcomes.sql` extends `business_action_items` with:

- `completion_outcome text NULL`
- `completed_by_user_id uuid NULL REFERENCES app_users(id)`

Allowed outcomes:

- `RESOLVED`
- `ALREADY_HANDLED`
- `NOT_RELEVANT`
- `NO_ACTION_NEEDED`

Existing `DONE` rows are backfilled to `RESOLVED` so the table can enforce that DONE tasks have an outcome. Non-DONE tasks must not carry an outcome or `completed_by_user_id`.

The existing `completed_at` remains the completion timestamp. Add an index supporting recent outcome lookup by business, branch, source attention, outcome, and completion time.

## Contracts and API

Add `BusinessActionCompletionOutcome` and expose on `BusinessActionItem`:

- `completionOutcome`
- `completedByUserId`

The existing completion route remains:

`POST /v1/intelligence/action-items/:id/complete`

Body:

- `businessId`
- optional `outcome`

If omitted, the server uses `RESOLVED` for backward compatibility. Unsupported values fail closed with `400`.

The server continues to re-apply current assignment/role/evidence permissions before completion. The authenticated actor becomes `completed_by_user_id`.

## Web UX

In the Dashboard action queue, keep the one-click default easy:

- a compact outcome selector defaults to `Resolved`;
- choices: `Resolved`, `Already handled`, `Not relevant`, `No action needed`;
- `Mark done` completes with the selected outcome;
- existing Snooze and Why-this-task behavior remains unchanged;
- offline behavior remains fail-closed for these intelligence mutations.

No outcome selector is added to list rows outside the action queue, and no new economic mutation path is introduced.

## Feedback-aware automatic dispatch

The cooldown is evaluated only in the tenant automation dispatcher, before `evaluateBusinessAutomationSystem` is called.

A dispatch candidate is eligible for feedback cooldown only when:

1. attention severity is `INFO` or `LOW`;
2. the candidate is an automatic ATTENTION-triggered policy;
3. there are at least two prior `DONE` action items in the last 30 days that:
   - belong to the same business and branch;
   - trace through `source_attention_item_id` to the same `rule_code` **and `source_key`**;
   - were created by an automation run (`source_automation_run_id IS NOT NULL`);
   - have completion outcome `NOT_RELEVANT` or `NO_ACTION_NEEDED`.

If eligible, automation dispatch is skipped until 14 days after the most recent negative completion.

Important boundaries:

- HIGH/CRITICAL: never cooled down.
- MEDIUM: no cooldown in this first slice.
- manual entity review creation: never cooled down.
- attention evaluation/listing: never cooled down or hidden.
- policies remain enabled; the cooldown is a dispatch decision, not a policy mutation.
- idempotency semantics of automation runs remain unchanged.

## Observability

Extend `TenantAutomationDispatcherTickResult` with `feedbackCooldownSkips` so logs/tests can prove when the dispatcher intentionally avoided task spam. Do not log sensitive evidence or user feedback content.

## Security and privacy

- Outcome is a closed enum; no free text.
- The completion actor is server-owned from the authenticated session.
- Current action visibility and financial-evidence filtering still apply before returning the completed item.
- Cooldown queries are tenant/branch scoped.
- No user can shape thresholds, cooldown duration, or target signal identity from the client.

## Testing

- Migration tests: columns, enum/check constraints, backfill, FK, outcome index.
- Completion service/route tests: default outcome, explicit outcomes, invalid outcome rejection, completed-by audit, current-role permission behavior, repeated completion idempotency.
- Web tests: selector/default, request payload, error/pending behavior, no new unsafe mutation path.
- Dispatcher integration tests:
  - two recent negative low-priority automated outcomes cause a cooldown skip;
  - one negative outcome does not;
  - old outcomes outside 30 days do not;
  - HIGH/CRITICAL are never cooled down;
  - manual/entity tasks do not count;
  - different rule/source/branch/tenant do not bleed together;
  - the underlying attention remains visible;
  - no economic/access tables change.
- Full API/Web tests, strict typechecks/builds, migration validation, VPS/deployment contracts, CI and Visual QA.

## Rollout

Ship behind existing tenant automation behavior; no new environment flag is required because the cooldown is deterministic, narrow, and fail-open for dispatch if the feedback query itself is unavailable only through normal database error handling (the dispatcher records failure rather than hiding attention). Existing tasks and clients continue to work through the `RESOLVED` default.
