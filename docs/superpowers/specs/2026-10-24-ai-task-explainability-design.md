# AI Task Explainability Design

## Intent

Make every TradeOS Intelligence review task understandable before a user acts on it. A user should be able to answer: “Why did TradeOS create this task?”, “Which signal or record caused it?”, “Which automation policy ran?”, and “What evidence supported it?” without exposing evidence their current role is not allowed to see.

This slice improves trust and operability of the existing AI automation stack. It does not create a new automation engine and does not add any economic or access mutation.

## Goals

- Add a clear `Why this task?` affordance to AI-assisted review tasks.
- Resolve automation source details lazily only when requested; no N+1 detail calls from task lists.
- Reuse existing provenance: `source_attention_item_id`, `source_automation_run_id`, `source_entity_type`, `source_entity_id`, `created_by_user_id`, and stored evidence.
- Explain system-dispatched automation, manual automation runs, and entity-created review tasks truthfully.
- Reapply current action-item visibility and financial-evidence filtering when explanation is read.
- Work in the Dashboard action queue and be reusable from Business Pulse later without duplicating server logic.
- Keep offline behavior useful: show the already-cached task reason and say that source details need reconnection.

## Non-goals / anti-goals

- No sale, payment, refund, purchase receipt, stock movement/write-off, cashbook, staff, role, membership, subscription, or access mutation.
- No LLM/provider call is required to explain a task.
- No new background scheduler or automation policy type.
- No eager explanation joins on every action-list fetch.
- No second cache containing sensitive evidence.
- No raw database/internal IDs as the main user-facing explanation.

## Approaches considered

### 1. Client-only explanation from `BusinessActionItem` — rejected

The client already has `reason`, provenance IDs, and bounded evidence, so it could render a basic explanation with no API change. However, it cannot reliably resolve policy name/version, run trigger source, or the originating attention signal without guessing. It would also encourage duplicated interpretation logic across Dashboard and Business Pulse.

### 2. Enrich every action-list response with full explanation — rejected

This would make explanation immediately available, but would add joins to policies/runs/attention and larger evidence payloads to every action queue refresh. Most users will not open the explanation for every task, so the cost and coupling are unnecessary.

### 3. Lazy server-validated explanation endpoint — chosen

Add one read-only detail endpoint for an action item. The server first reuses the same current-role visibility rules as action listing/mutation, then resolves optional run → policy and attention provenance. The UI calls it only after `Why this task?` is opened.

This gives the richest truthful explanation, keeps list reads fast, and centralizes permission/evidence filtering.

## Contract

Add `BusinessActionItemExplanation` with:

- `businessId`, `branchId`, `actionItemId`
- `generatedAt`
- `sourceKind`: `AUTOMATION | ENTITY_REVIEW | ATTENTION | MANUAL`
- `summary`: server-owned plain-language explanation
- `action`: the currently permission-filtered `BusinessActionItem`
- optional `automation`:
  - `policyId`
  - `policyName`
  - `policyVersion`
  - `triggerType`
  - `triggerSource`
  - `runId`
  - `runCreatedAt`
- optional `attention`:
  - `id`
  - `ruleCode`
  - `severity`
  - `title`
  - `summary`
  - `lastSeenAt`
- optional `entity`:
  - `entityType`
  - `entityId`
- `evidence`: current-role filtered evidence, bounded to a small display set.

No confidential contact value or evidence excluded by the current role may be reintroduced by the explanation path.

## API and service

Add:

`GET /v1/intelligence/action-items/:actionItemId/explanation?businessId=<uuid>`

Flow:

1. authenticate access token;
2. resolve current active business membership/role through existing authorization;
3. load the action item in the authorized business;
4. apply the same full-queue vs assigned-item/current-action eligibility rules used by action listing/mutation;
5. map the action for the current actor so role-downgrade evidence filtering still applies;
6. if `source_automation_run_id` exists, read the run in the same business and its policy in the same business;
7. if `source_attention_item_id` exists, read the attention record in the same business/branch scope;
8. expose entity provenance only from the existing allow-listed fields;
9. build a deterministic summary and return bounded evidence.

No row is written. The endpoint must be safe under replay and offline retries because it is read-only.

## Source classification

- `AUTOMATION`: `sourceAutomationRunId` is present. The explanation distinguishes `SYSTEM_DISPATCHER` vs human/manual origin from the run’s structured input/trigger source without trusting client text.
- `ENTITY_REVIEW`: `sourceEntityType` + `sourceEntityId` are present and there is no automation run.
- `ATTENTION`: an attention source exists without an automation run/entity source.
- `MANUAL`: no richer provenance exists; explain only the server-stored reason/evidence without inventing a source.

## UI

### Dashboard action queue

Each active task gets a secondary `Why this task?` button next to workflow/task controls.

On open:

- show the existing reason immediately;
- if online, lazily fetch the explanation and show:
  - `Created by TradeOS automation` / `Created from record intelligence` / equivalent source label;
  - triggering signal title + severity when present;
  - automation policy name when present;
  - up to 5 evidence facts;
  - created/generated timestamps;
- if offline, show cached reason plus `Reconnect to see the automation source and fresh evidence.`
- keep `Open workflow`, `Mark done`, and `Snooze` separate from explanation. Explanation never performs mutations.

Use an inline expandable detail inside the action card, not another global drawer, so users retain task context.

### Business Pulse

The server/contract is reusable from Pulse, but the first UI mount remains the Dashboard action queue to keep the slice focused. A later small follow-up can add the same control inside the Pulse drawer without new server work.

## Permissions and privacy

- Owner/Admin/Manager/Accountant may see the full branch action queue under existing rules.
- Other roles may explain only an item that is currently assigned and still permitted for their current role.
- Entity-task evidence is filtered again for the current role; stored historical financial evidence cannot leak after a role downgrade.
- Automation policy/run/attention joins require the same `business_id`; branch-specific attention must remain in scope.
- Unknown/foreign action IDs use safe not-found semantics.

## Performance

- No list-row detail fetches.
- One GET per explicit explanation open.
- Bounded evidence (maximum 5 UI facts; service may retain a slightly larger internal cap if needed).
- Existing indexes on action/run/attention primary keys and policy IDs are sufficient; no migration is required.

## Testing

- Contract tests for explanation shape/source kinds.
- API integration tests for system automation, manual/entity task, foreign business, lower-role assignment, and role-downgrade evidence filtering.
- Assert explanation endpoint performs no economic/access writes.
- Web helper tests for lazy fetch/error shaping.
- Dashboard contract test for `Why this task?`, online lazy fetch, offline fallback, and non-submitting button behavior.
- Full Web suite/build, API CI suite on dedicated `tradeos_ci`, desktop CI, sync smoke, Visual QA, VPS/deployment contracts.
