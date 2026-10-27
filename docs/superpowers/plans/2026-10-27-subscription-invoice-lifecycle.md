# Subscription Invoice Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically issue and renew provider-independent SaaS subscription invoices and keep ACTIVE/PAST_DUE standing synchronized with authoritative invoice/payment state.

**Architecture:** A new lifecycle service owns period invoices and subscription standing; a dedicated advisory-locked scheduler invokes it every 15 minutes. Existing provider-payment ledger writes call the same standing refresh after invoice recomputation. Hubtel/checkout code remains downstream and out of scope.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-10-27-subscription-invoice-lifecycle-design.md`

## Global Constraints

- Automatic billing supports MONTHLY and ANNUAL only; CUSTOM remains fail-closed/manual.
- Invoice tax is exactly zero until a configured tax policy exists.
- One non-VOID invoice maximum per subscription/period.
- Scheduler default interval is 15 minutes; environment override has a 60-second minimum.
- Catch-up is capped at 12 periods per subscription per tick.
- Billing lifecycle never writes tenant operational payments, cashbook, sales, inventory, customer/supplier, staff, membership or access ledgers.
- No payment-provider or AI/model network call is allowed in this slice.

## Review Focus

- Month-end/annual boundary arithmetic must anchor each next period to the prior period end rather than scheduler time.
- A delayed/concurrent scheduler must not create duplicate invoices or double-advance periods.
- Role/provider payment reconciliation must not leave a paid subscription falsely PAST_DUE until a later tick.
- Cancel-at-period-end must stop renewal while preserving already-issued invoice history.
- Malformed legacy/custom subscription periods must fail closed for that subscription without blocking every other tenant.

---

### Task 1: Invoice period uniqueness and base issuance

**Files:**
- Create: `packages/db/migrations/0027_subscription_invoice_period_uniqueness.sql`
- Create: `apps/api/src/platform-admin/subscription-billing-lifecycle-service.ts`
- Create: `apps/api/test/platform-admin-subscription-billing-lifecycle.integration.test.ts`

**Interfaces:**
- Produces `issueSubscriptionPeriodInvoice(client, input): Promise<{ invoiceId: string; created: boolean }>`.
- Input includes locked subscription/business/plan/period facts plus `now` and optional due-days override for tests.

- [ ] **Step 1: Write failing migration/service tests**
  - Active MONTHLY subscription with a valid period produces one OPEN invoice whose subtotal/total/currency snapshot equals the current plan, tax is zero, provider fields are null, and due time is exactly 7 days after issuance.
  - Repeated and concurrent issuance returns/reuses the same period invoice and row count remains one.
  - A conflicting second non-VOID invoice for the same subscription/period is rejected by PostgreSQL.
  - Tenant operational ledger row counts remain unchanged.

- [ ] **Step 2: Run RED**
  - Use a disposable migrated schema and run only the new test file; expected failure is missing migration/service.

- [ ] **Step 3: Implement migration and `issueSubscriptionPeriodInvoice`**
  - Add partial unique index `(subscription_id,period_start,period_end) WHERE status<>'VOID'` and overdue scan index.
  - Generate invoice UUID in application code and `TOS-YYYYMMDD-XXXXXXXX` invoice number.
  - On unique violation, reload the matching non-VOID period invoice and return `created:false`; divergent period identity remains an error.
  - Audit new invoices as `SUBSCRIPTION_INVOICE_ISSUED` with system actor null.

- [ ] **Step 4: Run GREEN + migration validation + API typecheck**

- [ ] **Step 5: Commit**
  - `feat(billing): issue idempotent subscription invoices`

### Task 2: Trial conversion, renewal, cancellation and standing

**Files:**
- Modify: `apps/api/src/platform-admin/subscription-billing-lifecycle-service.ts`
- Modify: `apps/api/test/platform-admin-subscription-billing-lifecycle.integration.test.ts`

**Interfaces:**
- Produces `processSubscriptionBillingCycle(pool, { now?, maxCatchUpPeriods? }): Promise<BillingCycleResult>`.
- Produces `refreshSubscriptionStanding(client, subscriptionId, now): Promise<"ACTIVE" | "PAST_DUE" | null>`.
- `BillingCycleResult` reports processed/created/renewed/trialConverted/canceled/pastDue/restored/errors/catchUpDeferred counts without sensitive data.

- [ ] **Step 1: Write failing lifecycle tests**
  - Future trial: no invoice/no state change.
  - Expired trial: first paid period starts at `trial_ends_at`, ends by plan interval, status ACTIVE, one invoice.
  - MONTHLY and ANNUAL renewal start exactly at previous period end and issue one invoice.
  - `cancel_at_period_end=true` sets CANCELED/canceled_at and issues no renewal invoice.
  - CUSTOM plan is skipped with no invoice/period mutation.
  - Overdue positive balance marks ACTIVE -> PAST_DUE; no overdue balance restores PAST_DUE -> ACTIVE.
  - Catch-up stops after 12 periods and reports deferred work.
  - One malformed subscription increments errors but a second valid subscription is still processed.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement lifecycle processing**
  - Enumerate TRIALING/ACTIVE/PAST_DUE subscriptions on active MONTHLY/ANNUAL plans.
  - Lock each subscription in its own transaction.
  - Use PostgreSQL interval arithmetic from the anchored period start/end.
  - Issue current-period invoice before any period advance.
  - Write system audits for trial conversion, renewal, cancellation and standing changes.

- [ ] **Step 4: Run GREEN + strict API typecheck**

- [ ] **Step 5: Commit**
  - `feat(billing): advance subscription billing lifecycle`

### Task 3: Keep standing current after payment/refund/reconciliation

**Files:**
- Modify: `apps/api/src/platform-admin/billing-service.ts`
- Modify: `apps/api/test/platform-admin-billing.integration.test.ts`
- Modify: `apps/api/test/platform-admin-subscription-billing-lifecycle.integration.test.ts`

**Interfaces:**
- Consumes `refreshSubscriptionStanding(client, subscriptionId, now)` from Task 2.
- Add internal invoice lookup/recompute return data only as needed; public billing contracts stay unchanged.

- [ ] **Step 1: Write failing integration tests**
  - Overdue invoice + successful provider payment immediately restores PAST_DUE subscription to ACTIVE in the same transaction path.
  - Successful reconciliation does the same.
  - Partial payment that leaves overdue balance keeps PAST_DUE.
  - Successful refund that re-opens an overdue balance marks subscription PAST_DUE again.
  - Existing payment/refund idempotency and tenant-ledger invariants remain unchanged.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Wire standing refresh after invoice recomputation**
  - Resolve invoice -> subscription id transactionally.
  - Use the payment/refund/reconcile event timestamp where authoritative; otherwise database/current time.
  - Never restore PAUSED/CANCELED/TRIALING through this helper.

- [ ] **Step 4: Run billing + lifecycle suites and API typecheck GREEN**

- [ ] **Step 5: Commit**
  - `fix(billing): reconcile subscription standing with payments`

### Task 4: Advisory-locked billing scheduler and server lifecycle

**Files:**
- Create: `apps/api/src/platform-admin/subscription-billing-scheduler.ts`
- Create: `apps/api/test/platform-admin-subscription-billing-scheduler.integration.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces `runSubscriptionBillingSchedulerTick(pool, options?): Promise<{ acquired: boolean; result: BillingCycleResult | null }>`.
- Produces `startSubscriptionBillingScheduler(pool, options?): { stop(): Promise<void> }`.

- [ ] **Step 1: Write failing scheduler/server tests**
  - Two concurrent ticks: only one obtains the dedicated advisory lock and one invoice is created.
  - Scheduler default cadence is 15 minutes and has no provider/AI imports.
  - Server starts scheduler by default, honors `SUBSCRIPTION_BILLING_SCHEDULER_ENABLED`, enforces 60-second minimum override, and awaits `stop()` during SIGTERM/SIGINT/startup failure cleanup.
  - `stop()` drains an in-flight tick before returning.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement scheduler and server wiring**
  - Use a lock key distinct from platform/tenant automation schedulers.
  - Catch/log top-level tick failures without crashing the API server; per-subscription failures already belong in cycle results.

- [ ] **Step 4: Run scheduler + existing scheduler regression suites + API typecheck GREEN**

- [ ] **Step 5: Commit**
  - `feat(billing): schedule subscription invoice lifecycle`

### Task 5: Whole-slice verification and integration

**Files:**
- Modify only tests/docs if review finds a reproducible gap.

- [ ] **Step 1: Run fresh disposable-schema API gate**
  - Apply all migrations; run full API tests, typecheck and build; drop schema on exit.

- [ ] **Step 2: Run Web/System Admin regression gates**
  - Full Web tests/typecheck/build; System Admin tests/typecheck/build; 49 VPS/deployment/security contracts under intended non-root identity.

- [ ] **Step 3: Safety review**
  - Diff scan proves lifecycle SQL writes are limited to `subscription_invoices`, `business_subscriptions`, and `platform_audit_events`; payment integration keeps existing `subscription_payments/refunds` only.
  - Verify no provider/AI import in lifecycle/scheduler.
  - Verify CUSTOM no-op and catch-up cap.
  - `git diff --check` and clean worktree.

- [ ] **Step 4: Push branch and create PR into `feat/tenant-user-ai-intelligence-automation`**
  - Keep the larger tenant-AI PR to `main` draft.

- [ ] **Step 5: Require fresh GitHub CI + Visual QA on exact head before integrating the sub-PR**

