# Supplier Payables Review Automation Design

## Intent

Turn overdue supplier balances into a first-class, safe TradeOS review workflow. `PAYABLES_OVERDUE` already exists as a deterministic financial attention rule, but today it falls through the generic follow-up template. TradeOS should create a clearly named internal supplier-payables review without ever posting a supplier payment, purchase receipt, cashbook entry, or other economic mutation.

## Goals

- Add dedicated safe action type `CREATE_PAYABLES_REVIEW`.
- Trigger it from `PAYABLES_OVERDUE` only.
- Reuse the existing automation policy/run/dispatcher/action queue; no new table or scheduler.
- Present it as “Supplier payables review” with a 24-hour default due time and `HIGH_PLUS` default severity.
- Route the resulting task to `/purchases` everywhere TradeOS exposes workflow links.
- Remove `PAYABLES_OVERDUE` from the generic follow-up template so edit round-trips remain unambiguous.

## Roles

- `OWNER` and `ADMIN` may configure the guided payables automation.
- The system dispatcher may execute an enabled payables-review policy.
- `MANAGER` is intentionally not allowed to configure `CREATE_PAYABLES_REVIEW`; supplier payables are financial oversight, matching the existing cash/receivables restriction.
- Lower roles cannot manage automation policies.

## Safety

- The action creates only an internal `business_action_items` review task through the existing safe automation runner.
- No supplier payment, payable ledger settlement, purchase receipt, cashbook, inventory, refund/return, staff, role/access, subscription, or membership mutation is added.
- Tenant/branch scoping, policy versioning, idempotency, assignment validation, and dispatcher crash recovery stay unchanged.
- Financial attention visibility continues to use the existing financial-rule gate.

## UX

Add a guided template named `supplier-payables-review` with:

- action: `CREATE_PAYABLES_REVIEW`
- signal: `PAYABLES_OVERDUE`
- severity: `HIGH_PLUS`
- due: `24` hours
- copy that explicitly states TradeOS creates a review task only and does not pay suppliers automatically.

The task route is `/purchases` in both contextual intelligence and Business Pulse.

## Approaches considered

1. **Dedicated `CREATE_PAYABLES_REVIEW` — chosen.** Clear user intent, deterministic routing, and no ambiguity with unrelated general follow-ups.
2. **Keep generic `CREATE_FOLLOW_UP`.** Minimal code, but weak wording and ambiguous edit round-trips; rejected now that all other major financial/operational signals have purpose-built review actions.
3. **Create a supplier-payment automation.** Rejected because it would cross the economic-mutation safety boundary.
