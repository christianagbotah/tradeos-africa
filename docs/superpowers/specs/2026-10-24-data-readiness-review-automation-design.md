# Data Readiness Review Automation Design

## Intent

Turn `LOW_DATA_CONFIDENCE` into a clear, safe TradeOS workflow instead of a generic follow-up. When a business has too little recent operating history for strong AI conclusions, an Owner/Admin may enable TradeOS to create an internal data-readiness review task. The task helps the business review setup and data-capture consistency; it must never manufacture sales, payments, expenses, stock movements, or any other activity to raise confidence.

## Goals

- Add dedicated safe action type `CREATE_DATA_READINESS_REVIEW`.
- Trigger it from `LOW_DATA_CONFIDENCE` only.
- Reuse the existing automation policy/run/dispatcher/action queue; no new table, provider call, or scheduler.
- Present it as “Data readiness review”.
- Default to `ANY` severity because `LOW_DATA_CONFIDENCE` is informational.
- Default due time to 72 hours because this is a readiness review, not an urgent operational alert.
- Route the task to `/settings?section=business` in contextual workflow links and Business Pulse.
- Remove `LOW_DATA_CONFIDENCE` from the generic follow-up template so policy edit round-trips remain unambiguous.

## Roles

- `OWNER` and `ADMIN` may configure the guided data-readiness automation.
- The system dispatcher may execute an enabled data-readiness policy.
- `MANAGER` is intentionally not allowed to configure this action because the canonical destination is Business Settings, whose business-management controls are Owner/Admin-only.
- Lower roles cannot manage automation policies.

## Safety

- The action writes only an internal `business_action_items` review task through the existing safe automation runner.
- It must not create or modify sales, payments, expenses, cashbook entries, inventory movements, purchases, returns/refunds, customer/supplier balances, staff, roles/access, memberships, subscriptions, or business activity for the purpose of increasing AI confidence.
- Tenant/branch scoping, policy versioning, idempotency, assignment validation, crash recovery, and disabled-policy behavior stay unchanged.
- The task copy explicitly says confidence improves through normal real-world usage and complete configuration, not artificial transactions.

## UX

Add a guided template `data-readiness-review`:

- action: `CREATE_DATA_READINESS_REVIEW`
- signal: `LOW_DATA_CONFIDENCE`
- default severity: `ANY`
- default due: `72` hours
- copy: TradeOS creates an internal review to check business setup and consistent recording; it does not create transactions automatically.

The resulting action item title is `Review TradeOS data readiness`, with the attention summary as its reason when dispatched from `LOW_DATA_CONFIDENCE`.

The canonical route is `/settings?section=business` in both contextual intelligence and Business Pulse.

## Approaches considered

1. **Dedicated `CREATE_DATA_READINESS_REVIEW` — chosen.** Makes the final attention signal purpose-built, gives deterministic routing, and avoids ambiguous generic follow-up policy editing.
2. **Keep `LOW_DATA_CONFIDENCE` under `CREATE_FOLLOW_UP`.** Minimal code, but the destination and wording are vague and the policy is indistinguishable from unrelated follow-ups.
3. **Automatically create synthetic activity or seed transactions.** Rejected because it corrupts business records and AI confidence rather than improving it.
