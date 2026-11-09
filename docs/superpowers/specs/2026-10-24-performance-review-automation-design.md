# Performance Review Automation Design

## Intent

Turn TradeOS's existing `SALES_DROP` and `MARGIN_PRESSURE` attention signals into clear, safe, actionable internal work rather than generic follow-up tasks. The feature should help owners and managers notice performance deterioration early and open the right review workflow without letting AI change prices, discounts, expenses, sales, inventory, payments, cash, staff, roles, subscriptions, or access.

## Goals

- Add one explicit safe action type: `CREATE_PERFORMANCE_REVIEW`.
- Give `SALES_DROP` and `MARGIN_PRESSURE` dedicated guided automation templates.
- Create evidence-backed action items with specific performance-review wording.
- Route performance review tasks to Reports.
- Allow Manager configuration because this is operational review work; Owner/Admin remain fully supported.
- Keep dispatcher behavior idempotent and unchanged apart from the new safe action type.

## Non-goals

- No automatic repricing, discounting, sales creation, expense entry, stock change, cash movement, payment, refund, purchase, staff, role, membership, or subscription mutation.
- No new forecasting/model layer.
- No new database tables.
- No LLM requirement for dispatching the task.

## Approaches considered

### 1. Dedicated `CREATE_PERFORMANCE_REVIEW` action — chosen

Reuse the existing attention → policy → dispatcher → `business_action_items` pipeline, but add a first-class action type and guided templates. This keeps the safety boundary explicit, improves task wording/navigation, and uses existing idempotency/audit behavior.

### 2. Keep `CREATE_FOLLOW_UP` and only improve UI copy

Smaller, but the server and action queue would still lose the semantic distinction between general work and business-performance review. Rejected.

### 3. Build a separate performance automation engine

Would duplicate dispatcher, policy, run, and action-queue infrastructure. Rejected.

## Behavior

Two guided templates are added:

- **Sales performance review** → `SALES_DROP` → `CREATE_PERFORMANCE_REVIEW`, default `MEDIUM_PLUS`, current branch, 24-hour due time.
- **Margin performance review** → `MARGIN_PRESSURE` → `CREATE_PERFORMANCE_REVIEW`, default `MEDIUM_PLUS`, current branch, 24-hour due time.

`SALES_DROP` and `MARGIN_PRESSURE` are removed from the generic follow-up template so users do not create semantically weaker policies for those signals.

The server safe-action allow-list and system-dispatch allow-list accept `CREATE_PERFORMANCE_REVIEW`. Managers may configure it. Action presentation uses `Review business performance` plus the attention title and evidence-backed reason. The task remains an internal review only.

## UX/navigation

- Guided automation labels explain exactly what will happen and explicitly say TradeOS does not alter prices, sales, expenses, or money automatically.
- Business Pulse and contextual workflow routing send `CREATE_PERFORMANCE_REVIEW` to `/reports`.
- Existing queue complete/snooze behavior is reused.

## Testing

- API automation tests prove Manager can configure performance review while forbidden economic actions remain rejected.
- Dispatcher tests prove the new action creates only an internal `business_action_items` record from matching sales/margin attention.
- Web guidance tests pin both templates, thresholds, payloads, and removal from generic follow-up.
- Navigation tests pin `/reports` routing.
- Full API/Web/typecheck/build/VPS/Visual QA gates remain required.
