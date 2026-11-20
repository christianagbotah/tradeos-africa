# TradeOS — refund provider reconciliation preflight (read only)

## Purpose
Unresolved refund payouts can be reviewed from Returns → Refund settlement worklist → **Reconciliation checks**. The data comes from the linked refund transaction, its original payment, and (when present) the original Hubtel checkout recorded in this exact tenant/branch. It compares amount, currency, original payment status, original transaction reference and original checkout linkage.

**No actual refund has been verified or finalized by this feature.** Hubtel transaction status of `Refunded` on the *original payment* is not enough to prove a *particular refund* reached its intended customer. The existing database has no authenticated payout destination and no refund-specific provider settlement reference. Both are always reported as missing, and `canMarkPaid=false`, `providerFinality=NOT_ESTABLISHED` are mandatory.

## Security
- Read-only GET `/v1/refunds/reconciliation-preflight?businessId=...&branchId=...&refundId=...`; authenticated OWNER/ADMIN/MANAGER/ACCOUNTANT only, active business and branch, exact original sale/payment scope.
- Never accepts a merchant-supplied provider status. No POST, refund settlement mutation, Hubtel charge/refund call, callback, financial entry, customer-credit change, stock reversal, or false reconciliation flag.
- Handles disconnected payment and unsafe/missing minor units without NaN or cross-currency totals; no cache and no PII or secret credentials.
- The existing refund follow-up history remains untrusted human evidence, separate from the provider reconciliation checks.

## QA
- Build packages/contracts, packages/client-core, packages/domain, API and web TypeScript checks.
- Apply all committed **58** migrations to a fresh isolated PostgreSQL 18 QA DB; run `apps/api/test/refund-reconciliation-preflight.integration.test.ts` against it, plus the refund settlement/followup regression tests. Verify no staged tenant data changes.
- Run `apps/web/app/components/returns/refund-reconciliation.contract.test.ts` and related worklist contracts.
- Require full GitHub CI (including native desktop build) and authenticated Visual QA; merge via squash then protected staging deployment. Verify exact deployed SHA and unauthorized GET returns HTTP 401.

## Required future provider evidence before financial finality
Introduce only provider-authenticated refund-transaction evidence: independently verifiable refund-specific transaction reference, amount and currency, destination identifier/token, payout settlement status and provider timestamp, plus idempotent transactional accounting. Do not infer these fields from human notes, callbacks, order-level statuses, or payment-reference equality.
