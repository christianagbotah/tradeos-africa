# Tenant Billing & Subscription Self-Service Design

## Intent

Close a commercial-readiness gap in TradeOS: a business owner should not need the platform administrator to tell them which plan they are on, when it renews, whether a cancellation is scheduled, what invoices were issued, or which subscription payments were recorded.

This slice exposes the existing TradeOS SaaS subscription/billing ledger to the tenant safely. It does not invent a checkout or payment-provider flow that does not yet exist.

## Goals

- Add a clear **Billing & subscription** section to tenant Settings.
- Show the authoritative current subscription, plan price/interval, trial/period dates, cancel-at-period-end state and effective entitlements.
- Show active public plans for comparison without implying that an upgrade can be completed before provider/proration rules exist.
- Show tenant-scoped invoice history/detail and recorded subscription payment history.
- Allow Owner/Admin to schedule cancellation at period end and resume a scheduled cancellation.
- Audit tenant-initiated lifecycle changes through the existing tenant `audit_events` ledger.
- Reuse `subscription_plans`, `plan_entitlements`, `business_subscriptions`, `subscription_invoices` and `subscription_payments` as the single source of truth.
- Preserve strict tenant isolation and fail closed.

## Non-goals

- No fake checkout or payment-link generation.
- No direct plan upgrade/downgrade execution in this slice.
- No invoice creation/voiding, payment reconciliation, provider-event ingestion, refund execution, manual activation, pause/reactivation, or immediate cancellation from tenant UI.
- No exposure of provider customer/subscription references, provider event IDs, raw metadata, internal idempotency keys or platform audit records.
- No offline replay of billing mutations.
- No duplicate subscription/billing ledger.

## Roles

### Read access

`OWNER`, `ADMIN`, and `ACCOUNTANT` may read Billing & subscription data.

Rationale: subscription invoices/payments are financial records and should not be broadly exposed to Manager, Cashier, Sales, Inventory, Staff or Viewer roles.

### Mutation access

Only `OWNER` and `ADMIN` may:

- `CANCEL_AT_PERIOD_END`
- `RESUME` a scheduled cancellation

Accountants remain read-only.

## API surface

Tenant routes use the authenticated tenant session and never accept a platform-admin identity.

### `GET /v1/billing/overview?businessId=...`

Returns a tenant-safe projection:

- business id
- current subscription id/status
- plan: id/code/name/description/currency/amount/billing interval/trial days
- `trialEndsAt`
- `currentPeriodStartsAt`
- `currentPeriodEndsAt`
- `cancelAtPeriodEnd`
- `canceledAt`
- effective entitlements after active business overrides
- supported tenant actions derived by the server (`CANCEL_AT_PERIOD_END`, `RESUME`)
- active public plans for comparison, excluding provider/internal fields

If a business has no current subscription, the response remains useful and returns `subscription: null`, public plans, and no mutation actions. It must not fabricate a default subscription.

### `GET /v1/billing/invoices?businessId=...&limit=...`

Returns tenant-safe invoice summaries scoped by `business_id` only:

- id, invoice number, currency
- subtotal/tax/total/paid/balance
- status
- period start/end
- issued/due/paid/created timestamps

Never returns provider event references or raw metadata.

### `GET /v1/billing/invoices/:invoiceId?businessId=...`

Returns one tenant-safe invoice plus its tenant-safe payment rows. An invoice outside the authenticated business is indistinguishable from a missing invoice.

### `GET /v1/billing/payments?businessId=...&limit=...`

Returns tenant-safe subscription payment history:

- id, invoice id/number where present
- amount/currency
- status
- provider name may be shown as a display label
- provider payment reference may be masked/omitted; default is omitted
- occurred/settled/created timestamps

Raw metadata and idempotency internals are excluded.

### `POST /v1/billing/subscription/cancel-at-period-end`

Body:

```json
{ "businessId": "uuid" }
```

Owner/Admin only. The service locks the current subscription and allows the transition only when current platform transition semantics allow cancellation at period end. It sets `cancel_at_period_end=true` without terminating service early.

### `POST /v1/billing/subscription/resume`

Body:

```json
{ "businessId": "uuid" }
```

Owner/Admin only. Valid only while an otherwise active/trialing subscription is scheduled to cancel. It clears `cancel_at_period_end`.

Both mutation routes are online-only and write a tenant audit event in the same transaction.

## Lifecycle reuse

The tenant service must not fork subscription transition semantics. Extract/reuse the transition rules already held by the platform subscription service where practical, or centralize the transition primitive behind a business-safe service boundary.

The tenant API only exposes the two allowed lifecycle intentions above. Platform administrators retain broader lifecycle controls.

## Tenant audit

Use existing `audit_events` with:

- `business_id`
- `actor_staff_id` when current membership resolves to staff
- entity type `BUSINESS_SUBSCRIPTION`
- entity id = subscription id
- events such as `SUBSCRIPTION_CANCEL_SCHEDULED` and `SUBSCRIPTION_CANCEL_RESUMED`
- payload limited to before/after status, cancel-at-period-end flag, plan code and effective period end

Do not write platform audit events for tenant actors.

## Entitlements

The overview must calculate effective entitlements as:

1. plan entitlements;
2. overridden by currently active `business_entitlement_overrides` (`expires_at IS NULL OR expires_at > now()`).

Tenant output may expose entitlement code/value, but not override reason or platform user identity.

## UI

Add `billing` to Settings navigation as **Billing & subscription**.

The page should have:

1. **Current plan** hero/card: plan, status, price/interval, renewal/trial/end date, cancellation banner.
2. **Actions**: Owner/Admin see Schedule cancellation or Keep subscription/Resume when applicable; Accountant sees read-only state.
3. **Plan comparison**: public active plans with price/interval/entitlement summary and a clear `Contact/Request plan change` affordance rather than a fake instant upgrade. Initial implementation can present plan-change availability as informational only.
4. **Invoices** table/cards: status, invoice number, period, due date, total, balance.
5. **Payments** history: date, amount, status, invoice.
6. Explicit empty/error/loading states and a clear online-only notice for lifecycle changes.

Mobile: cards/tables must collapse without horizontal page overflow; detailed rows may use stacked mobile cards rather than wide tables.

## Safety and privacy

- Every query is filtered by authenticated business id.
- Every mutation revalidates active membership and role server-side.
- Client cannot choose target subscription id, plan id, status or transition.
- Tenant responses exclude provider/customer identifiers, internal metadata, platform audit and reconciliation fields.
- Billing mutations are not put into the offline queue.
- Cancellation is period-end only; no immediate destructive cancellation from tenant UI.

## Testing

- Contract tests for tenant-safe response types.
- API integration tests for Owner/Admin/Accountant role behavior and lower-role denial.
- Cross-tenant not-found tests for invoice detail.
- Read-plane tests proving provider/internal fields are absent.
- Entitlement override tests.
- Cancellation/resume tests with row locking, transition validation and tenant audit events.
- Invariants proving tenant actions do not create/modify invoices, payments, refunds, provider events or plan assignments.
- Web contract tests for Billing section, role-gated controls, online-only mutations, mobile-safe layout and no offline queue usage.
- Full API/Web/typecheck/build + deployment/security/Visual QA before completion.
