# Tenant Billing & Subscription Self-Service Implementation Plan

**Goal:** Give TradeOS tenants authoritative, safe subscription/billing visibility and narrow self-service cancellation controls using the existing SaaS ledger.

**Architecture:** Add tenant-safe contracts and `/v1/billing` services/routes over the existing platform subscription/billing tables. Reuse lifecycle validation, calculate effective entitlements server-side, audit tenant changes in `audit_events`, and surface the experience as a new Settings section. No provider checkout or economic billing writes are introduced.

---

## Task 1 — Tenant billing contracts

**Files:**
- modify `packages/contracts/src/index.ts`
- create `packages/contracts/src/tenant-billing.ts`
- create/update contract type tests if present

**TDD:**
1. Write compile-time/runtime contract expectations for overview, plan, entitlement, invoice, payment and supported actions.
2. Observe RED because types do not exist.
3. Add the minimum tenant-safe types and exports.
4. Build `@tradeos/contracts`.

## Task 2 — Read-only tenant billing service

**Files:**
- create `apps/api/src/billing/tenant-billing-service.ts`
- create `apps/api/test/tenant-billing.integration.test.ts`

**TDD:**
1. Seed two businesses, plans, subscription, entitlements/override, invoices and payments in an isolated PostgreSQL schema.
2. RED tests for overview, public plans, entitlement merge, invoice/payment projection and cross-tenant isolation.
3. Implement read service with strict business scoping and bounded limits.
4. Prove provider/internal fields are absent from returned objects.

## Task 3 — Safe subscription lifecycle service

**Files:**
- modify/extract shared transition helper from `apps/api/src/platform-admin/subscription-service.ts` if necessary
- extend `apps/api/src/billing/tenant-billing-service.ts`
- extend `apps/api/test/tenant-billing.integration.test.ts`

**TDD:**
1. RED Owner/Admin cancel-at-period-end and resume tests.
2. RED Accountant/lower-role mutation denial tests.
3. RED invalid transition, no-current-subscription and concurrent-request tests.
4. Implement transaction + row lock + shared transition validation.
5. Write `audit_events` in same transaction.
6. Assert invoices/payments/refunds/provider events/plan id remain unchanged.

## Task 4 — Tenant billing routes

**Files:**
- create `apps/api/src/billing/tenant-billing-routes.ts`
- register in `apps/api/src/app.ts`
- create `apps/api/test/tenant-billing-routes.integration.test.ts`

**Routes:**
- GET `/v1/billing/overview`
- GET `/v1/billing/invoices`
- GET `/v1/billing/invoices/:invoiceId`
- GET `/v1/billing/payments`
- POST `/v1/billing/subscription/cancel-at-period-end`
- POST `/v1/billing/subscription/resume`

**TDD:** authenticate first, validate UUID/limit/body shape, enforce read/mutation roles, and preserve 404 tenant-isolation semantics.

## Task 5 — Billing & subscription Settings UI

**Files:**
- create `apps/web/app/components/settings/billing-settings.tsx`
- modify `apps/web/app/components/settings/settings-workspace.tsx`
- add styles to the appropriate Settings/workspace stylesheet
- create `apps/web/app/components/settings/billing-settings-contract.test.ts`

**TDD:**
1. RED contract requiring Billing & subscription navigation, one overview fetch, invoices/payments, role-gated controls and online-only POST helpers.
2. Implement loading/error/empty states, current-plan card, public plan comparison, invoice/payment history.
3. Ensure no provider/internal fields are rendered.
4. Keep mutations out of offline queue and disable them offline.
5. Add narrow-mobile stacking guard.

## Task 6 — Full verification and review

1. Run focused API billing tests in disposable PostgreSQL schema.
2. Run full API suite + typecheck/build.
3. Run full Web suite + typecheck/build.
4. Run migration/deployment/security contracts.
5. Safety review for tenant isolation, provider-data exposure, forbidden billing mutations, offline behavior and mobile overflow.
6. Push branch, open PR, require CI + Visual QA green.
7. Do not deploy/merge until canonical review gates are green.
