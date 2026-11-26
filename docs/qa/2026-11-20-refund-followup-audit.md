# TradeOS Africa — Refund follow-ups and escalation audit

## Scope

Adds a human review timeline to each pending or failed refund in Returns → Refund settlement worklist. Authorized OWNER, ADMIN, MANAGER and ACCOUNTANT members can record **internal notes**, **customer contacted**, **provider contacted**, **escalated**, and **escalation reviewed**. Each recorded item is append-only, attributed to the actual authenticated member, and shows an optional external support-case reference. The worklist shows a per-refund follow-up count and whether an escalation remains open.

**Financial non-effects:** Notes and escalation reviews are not evidence of payment finality. No refund status, customer credit, sales, ledger, inventory, provider requests, SMS, external refunds, or merchant gateway collection flags are changed. An escalation review means management reviewed the case, **not** that the refund was paid. A settled refund retains its history but accepts no further entries.

## Security and correctness

- New migration 0058 uses server-side append-only protections for all writes (reject UPDATE and DELETE), active finance membership check, strict case/business/branch linkage, pending/failed state on insert, and escalation review prerequisite.
- `GET /v1/refunds/followups` and `POST /v1/refunds/followups` both require authenticated finance roles and an active branch. GET is paginated and no-store.
- POST locks the specific refund row, validates action/note/reference, and uses an immutable UUID clientRequestId unique to refund. Exact retries replay without a duplicate audit event; mismatched retries fail with 409.
- Worklist follow-up count and escalation state are derived from the branch's own refund events. Summary money balances remain authoritative, unfiltered and grouped by original currency, never dependent on how many follow-ups exist.
- UI only submits when online; unlike offline-first sales/inventory sync, an operational note must not silently enqueue as if provider evidence were confirmed. A lost response can be retried with the same UUID.

## Verification

- Apply **58/58** migrations on fresh disposable PostgreSQL 18 QA database only. Do not run test TRUNCATE on staging/production.
- `apps/api/test/refund-followups.integration.test.ts`: tests immutable idempotency, escalating and reviewing, status non-mutation, audit event correspondence, anonymous/cashier/other-tenant and cross-branch denial, invalid input, failed and settled cases.
- `apps/api/test/refund-settlement-currency.integration.test.ts`: ensure the existing full-branch sums per currency still match previous values.
- `apps/web/app/components/returns/refund-followups.contract.test.ts`: confirms offline write guard, replay IDs, escalation UI, branch-scoped API.
- API and web typechecks; full CI, desktop-native and authenticated visual QA before merge.
- Protected staging deploy must verify active exact SHA, GET /health and website HTTP 200, and unauthenticated refund history and settlement endpoints HTTP 401. The old atomic release remains available for rollback.
