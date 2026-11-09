# Subscription Invoice Lifecycle Design

## Intent

Turn TradeOS's existing plan/subscription and SaaS billing ledgers into a real commercial billing lifecycle. Active Ghanaian tenants must receive deterministic subscription invoices automatically, renew on the configured billing interval, become past due from authoritative invoice state, and recover to active after payment without touching tenant POS/payment/cashbook ledgers.

This is the provider-independent foundation for Hubtel/other payment adapters. Provider callbacks must never be the mechanism that creates a bill.

## Goals

- Issue exactly one invoice for every billable MONTHLY or ANNUAL subscription period.
- Snapshot the plan price/currency into the invoice at issuance time; later plan-price edits do not rewrite history.
- Convert an expired TRIALING subscription into its first billable ACTIVE period and issue its first invoice.
- Advance ACTIVE/PAST_DUE subscriptions into the next period when the current period ends and issue the next invoice.
- Honor `cancel_at_period_end` by canceling at period end instead of renewing.
- Derive ACTIVE vs PAST_DUE from open/partially-paid overdue subscription invoices.
- Restore PAST_DUE to ACTIVE after authoritative payment/reconciliation removes the overdue balance.
- Make scheduler retries, concurrent app instances, and delayed ticks idempotent.
- Leave tenant operational `payments`, `cashbook_entries`, sales, inventory, customer/supplier ledgers, staff, and membership data untouched.

## Non-goals / anti-goals

- No Hubtel/Paystack/provider HTTP integration in this slice.
- No checkout/payment-link UI in this slice.
- No automatic card/MoMo collection.
- No tax calculation. `tax_minor=0` until an explicit tax policy exists; TradeOS must not invent Ghana VAT rules.
- No automatic CUSTOM-plan renewal. CUSTOM plans require an explicit period policy before automation is allowed.
- No proration for mid-cycle plan changes in this slice.
- No autonomous refund, plan change, suspension, or tenant deletion.

## Approaches considered

### 1. Dedicated billing-cycle service + scheduler — chosen

A provider-independent `subscription-billing-lifecycle-service.ts` owns invoice issuance, trial conversion, renewal, cancellation-at-period-end and standing refresh. A small scheduler runs the lifecycle under a PostgreSQL advisory lock. Provider payment recording calls the same standing-refresh primitive after invoice recomputation.

This preserves one source of truth, gives deterministic retry behavior, and keeps payment-provider code downstream of invoices.

### 2. Generate invoices inside every subscription transition

This gives immediate invoices on ASSIGN/ACTIVATE, but couples plan administration to billing side effects, duplicates renewal logic, and still needs a scheduler for future periods. Rejected.

### 3. Let provider checkout creation create invoices lazily

This would mean a tenant has no authoritative bill until someone opens checkout and would make accounting depend on Hubtel/another provider. Rejected.

## Data model

Add migration `0027_subscription_invoice_period_uniqueness.sql`:

- unique index on `(subscription_id, period_start, period_end)` for non-VOID invoices;
- index supporting overdue-standing scans by `subscription_id,status,due_at`.

Existing invoice rows remain valid. The period uniqueness constraint is the database-backed idempotency boundary for concurrent scheduler ticks.

## Invoice issuance

For a billable MONTHLY/ANNUAL period:

- `business_id` and `subscription_id` come from the locked subscription;
- `currency_code` and `subtotal_minor` come from the current plan at issuance time;
- `tax_minor=0`;
- `total_minor=subtotal_minor`;
- `amount_paid_minor=0`;
- `status='OPEN'`;
- `period_start/current_period_starts_at` and `period_end/current_period_ends_at` must match exactly;
- `issued_at=now`;
- `due_at=issued_at + 7 days`;
- provider fields stay null until a provider/checkout layer owns them.

Invoice numbers use `TOS-YYYYMMDD-XXXXXXXX`, where the suffix comes from a generated UUID. The unique invoice-number constraint remains a second collision guard.

If the period invoice already exists, return/reuse it; never create a duplicate.

## Trial conversion

When `TRIALING.trial_ends_at <= now` for a MONTHLY/ANNUAL plan:

1. lock the subscription;
2. set status to ACTIVE;
3. use `trial_ends_at` as the first paid period start (not scheduler wall-clock time);
4. calculate period end from the plan interval;
5. clear the trial boundary only if the existing schema/contract expects that; otherwise preserve it as history;
6. issue the first period invoice;
7. audit the system transition.

A trial that has not ended produces no invoice.

## Renewal and cancellation

For ACTIVE/PAST_DUE MONTHLY/ANNUAL subscriptions:

- first ensure the current period has an invoice;
- if `current_period_ends_at > now`, do not advance the period;
- if the period has ended and `cancel_at_period_end=true`, set status CANCELED, set `canceled_at`, and issue no renewal invoice;
- otherwise advance start to the previous `current_period_ends_at`, compute the next end from the current plan interval, update the subscription period, and issue the new invoice.

A tick may catch up at most 12 missed periods per subscription. If more remain, stop and report the subscription as incomplete for the next tick rather than generating an unbounded invoice burst.

## Subscription standing

`refreshSubscriptionStanding(client, subscriptionId, now)` is authoritative only for subscriptions currently ACTIVE or PAST_DUE:

- if any invoice for the subscription has positive outstanding balance, status OPEN/PARTIALLY_PAID, and `due_at < now`, standing is PAST_DUE;
- otherwise standing is ACTIVE.

PAUSED, CANCELED, EXPIRED and TRIALING are never changed by this helper.

`recordProviderPayment`, successful refund/reconciliation paths and the billing scheduler call this helper after invoice recomputation so the UI does not wait for a future scheduler tick to reflect recovered standing.

## Scheduler

Add `subscription-billing-scheduler.ts` with a dedicated PostgreSQL advisory lock. Default interval: 15 minutes.

The tick:

1. obtains the lock with `pg_try_advisory_lock`;
2. enumerates TRIALING/ACTIVE/PAST_DUE subscriptions on active MONTHLY/ANNUAL plans;
3. processes each subscription transactionally with row locking;
4. catches/report failures per subscription so one corrupt tenant does not block every other tenant;
5. releases the advisory lock;
6. performs no provider/model calls.

Server lifecycle:

- enabled by default in production;
- `SUBSCRIPTION_BILLING_SCHEDULER_ENABLED=false|0|off` disables it;
- `SUBSCRIPTION_BILLING_SCHEDULER_INTERVAL_MS` overrides cadence with a 60-second minimum;
- shutdown waits for an in-flight tick before closing the database pool.

## Audit and safety

System lifecycle changes write platform audit events with null platform actor and explicit action names:

- `SUBSCRIPTION_INVOICE_ISSUED`
- `SUBSCRIPTION_TRIAL_CONVERTED`
- `SUBSCRIPTION_RENEWED`
- `SUBSCRIPTION_CANCELED_AT_PERIOD_END`
- `SUBSCRIPTION_MARKED_PAST_DUE`
- `SUBSCRIPTION_RESTORED_ACTIVE`

The lifecycle may write only subscription/billing/audit records. It must not write tenant operational economic/access ledgers.

## Testing

- migration uniqueness and index contract;
- active first-period invoice creation and exact price/currency snapshot;
- duplicate/concurrent issuance idempotency;
- expired-trial conversion and not-yet-expired trial no-op;
- monthly and annual renewal anchored to the previous period end;
- cancel-at-period-end behavior;
- overdue -> PAST_DUE and paid/reconciled -> ACTIVE;
- custom-plan fail-closed/no automatic invoice;
- delayed-cycle catch-up cap;
- economic/access ledger invariants;
- advisory-lock concurrency and server start/stop lifecycle;
- full API tests/typecheck/build, migration validation, Web regression, VPS/deployment/security contracts, GitHub CI and Visual QA before integration.
