# Refund priority filters — staging safety and QA

## Scope

Extends the current **read-only** Returns → Refund settlement worklist. An authorized owner, admin, manager or accountant can select:

- All unresolved (pending and failed)
- Pending payout (all ages)
- Pending 24h+ (only pending rows with `created_at < NOW() - INTERVAL '24 hours'`)
- Pending 7d+ (only pending rows with `created_at < NOW() - INTERVAL '7 days'`)
- Needs review (only failed rows)

Server-side filtered results are tenant/branch-scoped, oldest-first, stably paginated; changing filters resets the cursor. Switching businesses or branches resets the filter and cursor. The existing `summaryByCurrency` remains **unfiltered** and contains all-time branch liabilities, grouped by the refund's original currency. Therefore no subtotal is falsely presented as the branch's total outstanding liability.

The 7d+ subset is contained in 24h+, and both are contained in total pending. FAILED never appears in overdue pending. All values remain integer minor units, rejected on unsafe precision. No payout, cashbook, sale, stock, provider, or credit-note mutations are added.

## Verification

- Run the API integration test `apps/api/test/refund-settlement-currency.integration.test.ts` against a **fresh disposable QA database**, after applying all 57 committed migrations. The test seeds: 8-day pending GHS, 30-hour pending USD, recent pending GHS, 10-day FAILED GHS, succeeded GHS, and 20-day pending GHS **in a different branch**. It verifies filters, pages, global-by-currency totals, malformed filters, anonymous access, and non-mutating behavior.
- Run web `refund-worklist-currency.contract.test.ts` and `refund-settlement-worklist.contract.test.ts`, plus API/web TypeScript checks. GitHub CI, native desktop and authenticated Visual QA are required before merge.
- After protected deployment, verify main and active staging symlink SHAs, HTTP 200 from web and `/health`, and HTTP 401 from unauthenticated `/v1/refunds/settlement-queue`. Authenticated browser test should switch filters and confirm each record and totals with test-only data.

## Guardrails

No Hubtel live collections, external refunds, SMS, email, or provider-side payouts are activated by these filters. Preserve prior staging release for rollback. Do not test using production tenants or modify merchant refund state to validate read-only filters.
