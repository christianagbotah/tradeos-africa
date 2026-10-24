# Entity Intelligence Safe Actions Design

## Intent

Make record-level TradeOS Intelligence immediately useful: after TradeOS explains an inventory item, customer, supplier, or purchase, an authorized user can create a safe internal review task from that evidence in one action. This must remain workflow assistance, not autonomous economic execution.

## Goals

- Create an internal `business_action_items` work item directly from an opened entity intelligence panel.
- Preserve exact tenant, branch, role, and entity ownership validation on the server.
- Carry authoritative entity evidence into the work item so the task remains explainable.
- Make browser retries/double-clicks idempotent while an equivalent task is still active.
- Record who created the task and which entity caused it.
- Reuse the existing action queue, completion, snooze, and canonical workflow links.
- Keep offline behavior explicit and fail closed.

## Non-goals / anti-goals

- No sale, payment, refund, purchase receipt, inventory movement/write-off, cashbook, staff, role, membership, subscription, or access mutation.
- No client-defined title, reason, evidence, entity type, or arbitrary action type.
- No hidden automation policy creation.
- No automatic execution merely because AI recommended a task.
- No entity-action calls from list rows.

## Approaches considered

### 1. Direct server-validated action item creation — chosen

Add an explicit entity-to-work-item service and POST route. The server revalidates entity scope, chooses the allowed action type/title/reason, copies authoritative evidence, assigns the current user, and inserts into the existing action queue. Add first-class entity provenance/audit fields and active-task deduplication to `business_action_items`.

This gives the shortest user flow, preserves the existing queue, and does not pollute automation policies.

### 2. Create/evaluate a temporary MANUAL automation policy

This maximizes reuse of the current automation runner but creates configuration records that are not really policies, complicates policy history, and makes a one-click record task depend on automation setup semantics. Rejected.

### 3. Navigate to Automations with a prefilled template

This requires no new action-item creation path but turns a simple “remember/review this record” intent into a multi-step configuration workflow and loses record-level immediacy. Rejected for this slice.

## Data model

Migration `0024_entity_action_items.sql` extends `business_action_items` with:

- `source_entity_type text NULL`
- `source_entity_id uuid NULL`
- `created_by_user_id uuid NULL REFERENCES app_users(id)`

Entity provenance is all-or-nothing. `source_entity_type`, when present, is allow-listed to `CATALOG_ITEM`, `CUSTOMER`, `SUPPLIER`, `PURCHASE`.

An expression-based unique partial index prevents more than one active (`OPEN` or `SNOOZED`) task for the same business + branch + entity type + entity id + action type. A completed task therefore does not permanently block a later legitimate task.

Existing automation-created rows remain valid with null entity/creator provenance.

## Server action mapping and roles

The client never chooses the effective action type. The server maps the validated record and actor role:

- `CATALOG_ITEM` → `CREATE_REORDER_REVIEW` for `OWNER`, `ADMIN`, `MANAGER`, `INVENTORY`; otherwise no direct task suggestion.
- `CUSTOMER` → `CREATE_RECEIVABLE_FOLLOW_UP` for `OWNER`, `ADMIN`, `ACCOUNTANT`; `CREATE_FOLLOW_UP` for `MANAGER`, `SALES`; otherwise no direct task suggestion.
- `SUPPLIER` → `CREATE_FOLLOW_UP` for `OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `INVENTORY`; otherwise no direct task suggestion.
- `PURCHASE` → `CREATE_FOLLOW_UP` for `OWNER`, `ADMIN`, `MANAGER`, `ACCOUNTANT`, `INVENTORY`; otherwise no direct task suggestion.

The action is assigned to the authenticated creator. `assigned_staff_id` is included only when the active business membership already resolves to a staff record.

## API

`GET /v1/intelligence/entity` additionally returns an optional `safeAction` descriptor derived server-side:

- `actionType`
- `label`
- `dueInHours` (default `24`)

`POST /v1/intelligence/entity/action-items` accepts only:

- `businessId`
- `branchId`
- `context: { entityType, entityId }`

The route authenticates, requires normal entity read access, resolves the actor/business membership, then delegates to `createBusinessEntityActionItem`.

The service:

1. reuses entity intelligence validation/evidence for the requested record and actor role;
2. derives the server-owned safe action descriptor;
3. rejects actors/entities without an eligible safe action;
4. creates a server-generated title/reason and carries bounded entity evidence;
5. links the highest-priority matching attention item when one exists;
6. assigns the creator and sets due time to 24 hours;
7. returns an already-active equivalent action item instead of creating a duplicate.

Response:

- `201 { item, created: true }` for a new task;
- `200 { item, created: false }` when an equivalent active task already exists.

## UI

The shared `EntityIntelligencePanel` renders `safeAction` only when the server provides it. The action sits beside `Ask TradeOS about this` and uses plain task language such as “Create reorder review” or “Create receivables follow-up.”

On click:

- require online state;
- POST only business/branch/context;
- disable while submitting;
- show a compact success state (“Review task added” or “Review task already open”);
- keep the canonical workflow link available;
- never optimistically invent evidence or action IDs;
- refetch entity intelligence after success only if needed for presentation, not for correctness.

The action is not queued for offline replay because intelligence evidence and authorization must be current at creation time.

## Security and safety

- Entity scope is revalidated server-side on every create request.
- Client cannot provide title, reason, evidence, assignment, due time, or effective action type.
- Financial evidence continues to follow existing role filtering.
- Customer/supplier contact values remain excluded from entity intelligence grounding.
- Direct action creation writes only `business_action_items`; no canonical economic/access table may be touched.
- Duplicate protection is database-backed, not client-only.

## Performance

- No list-row calls.
- One existing entity GET when the detail is opened.
- One POST only after a human click.
- Evidence remains bounded by the entity intelligence service.
- No broad scans or new provider/LLM call is required to create the task.

## Testing

- Migration/schema tests for provenance columns, all-or-nothing constraint, creator FK, and active duplicate index.
- Service integration tests for each entity mapping, role restrictions, tenant/branch isolation, creator assignment, evidence preservation, duplicate retry, and recreate-after-DONE.
- Route tests proving the client cannot select an action type or inject title/reason/evidence.
- Ledger invariants proving no sales, payments, refunds, purchases, inventory movements, cashbook, membership, staff, or access tables change.
- Web contract/tests for server-provided action rendering, online-only POST, pending/success/duplicate/error states, and no list-row mounting.
- Full API/Web tests, typechecks/builds, migration validation, VPS contracts, and Visual QA.
