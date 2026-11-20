# Refund payout ageing: read-only branch review

## Purpose

The existing unresolved refund worklist now shows **24h+ pending** and **7d+ pending** balances beside total pending and failed payouts. This makes long-pending provider refunds visible without implying they were paid or losing outstanding liabilities outside the current page or last 50 sales.

## Controls and semantics

- Server-side PostgreSQL calculations use `NOW()` against original `refund_transactions.created_at` to ensure all rows, not just the current page, are counted.
- Age bands count only `PENDING` refunds; `FAILED` payouts remain in the separate needs-review balance and are not miscounted as pending.
- The 7-day subset is included in the 24-hour subset, and both are included in total pending. These balances must **not** be added together.
- Results remain scoped to the authorized business + branch, grouped by the original currency, and are independent of list filters and pagination. All money is integer minor units; unsafe or incomplete values show unavailable rather than zero/NaN.
- This is **read-only**. It does not update return, refund, payment, stock, sales or cashbook state, make provider calls or claim payout settlement.
- The endpoint retains no-store caching and OWNER/ADMIN/MANAGER/ACCOUNTANT access controls.

## Verification

- Fresh dedicated QA database `tradeos_refund_aging_qa_20261120` with 57 migrations, no staging business data used.
- `apps/api/test/refund-settlement-currency.integration.test.ts`: 8-day GHS pending, 30-hour USD pending, aged failed excluded, other-branch aged pending excluded, status filter/paging independence and unauthorized denial.
- `apps/web/app/components/returns/refund-worklist-currency.contract.test.ts`: currency isolation, server ageing source, precise amount conversion and no fabricated zero.
- Frontend/API typecheck and protected CI/Visual QA required before release.

## Release safeguard

Do not deploy directly from a working tree. Merge only after CI and Visual QA, then use the protected staging deployment workflow and verify the running SHA and authenticated Returns page. No live merchant Hubtel collection or payout flags are authorized by this change.
