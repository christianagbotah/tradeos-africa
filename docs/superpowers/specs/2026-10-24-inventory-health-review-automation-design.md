# Inventory Health Review Automation Design

## Intent

Turn TradeOS's existing `SLOW_STOCK` and `WASTAGE_SPIKE` attention signals into clear inventory-health review work instead of generic follow-up tasks. Stockout risk already has a dedicated reorder-review path and remains unchanged.

## Goals

- Add one explicit safe action type: `CREATE_INVENTORY_REVIEW`.
- Add dedicated guided templates for slow-moving stock and wastage spikes.
- Keep the task entirely internal: evidence-backed review only, no stock mutation.
- Route inventory-review work to `/inventory` from Business Pulse and shared contextual routing.
- Let Owner/Admin/Manager configure the action, consistent with operational inventory work.
- Reuse the existing policy/run/dispatcher/action-item pipeline and its idempotency/audit behavior.

## Non-goals / anti-goals

- No inventory movement, adjustment, write-off, transfer, purchase, sale, return/refund, payment, cashbook, staff, role, membership, subscription, or access mutation.
- No new inventory model or LLM dependency.
- No new database table.
- Do not replace `CREATE_REORDER_REVIEW` for `STOCKOUT_RISK`.

## Approaches considered

### 1. Dedicated `CREATE_INVENTORY_REVIEW` action — chosen

Reuse the existing safe automation engine with one first-class action type and two rule-specific templates. This preserves semantic clarity in the action queue and keeps list/detail navigation deterministic.

### 2. Keep generic `CREATE_FOLLOW_UP`

Requires less code but hides whether a task is about slow stock, wastage, payables, or data quality and weakens routing/reporting. Rejected.

### 3. Create separate action types for slow stock and wastage

Most explicit, but unnecessarily expands the safe-action surface when both are reviewed through the same Inventory workflow. Rejected.

## Guided workflows

### Slow stock review

- template id: `slow-stock-review`
- signal: `SLOW_STOCK`
- action: `CREATE_INVENTORY_REVIEW`
- default threshold: `ANY` (the current deterministic signal is LOW)
- default scope: current branch
- default due: 48 hours
- assign to actor: true

### Wastage review

- template id: `wastage-review`
- signal: `WASTAGE_SPIKE`
- action: `CREATE_INVENTORY_REVIEW`
- default threshold: `MEDIUM_PLUS`
- default scope: current branch
- default due: 24 hours
- assign to actor: true

`SLOW_STOCK` and `WASTAGE_SPIKE` are removed from the generic follow-up template. The generic template remains for `PAYABLES_OVERDUE` and `LOW_DATA_CONFIDENCE` until those receive their own intentionally designed flows.

## Server behavior

`CREATE_INVENTORY_REVIEW` is added to:
- human safe-action allow-list
- unattended system-dispatch allow-list
- Manager operational allow-list

Action presentation uses `Review inventory health` plus the originating attention title. Evidence and reason continue to come from the validated attention item. Dispatcher idempotency remains policy-version + attention correlation based.

## UX/navigation

- Guided copy says TradeOS creates an internal review task only and never changes stock automatically.
- `CREATE_INVENTORY_REVIEW` routes to `/inventory` in Business Pulse and `contextualWorkflowHref()`.
- Existing complete/snooze behavior is reused.

## Testing

- API policy test: Manager may configure inventory review; forbidden economic actions remain rejected.
- Dispatcher test: inventory review creates only `business_action_items` and leaves economic/access tables unchanged.
- Guided-template tests pin IDs, rule codes, thresholds, due times, role visibility, payloads, and edit round-trip for two templates sharing one action type.
- Generic follow-up no longer includes `SLOW_STOCK` or `WASTAGE_SPIKE`.
- Navigation tests pin `/inventory`.
- Full API/Web/typecheck/build/VPS/Visual QA gates required before closing the slice.
