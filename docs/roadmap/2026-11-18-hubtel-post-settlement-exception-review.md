# Hubtel post-settlement exception review (no money changes)

Date: 18 November 2026. Scope: merchant POS authenticated status recheck after a sale is independently paid and reconciled.

## Why

Hubtel's current status API exposes Paid, Unpaid and Refunded. An Unpaid response does not necessarily mean a failed or expired payment, so it is unsafe to reverse stock or sales purely on that status. A paid sale may later be refunded; the owner needs a durable, reviewable, idempotent exception instead of silent state drift.

- Hubtel reconciliation guide (updated 2 Nov 2026): https://code.hubtel.com/docs/guides/reconciliation
- Status API: https://code.hubtel.com/docs/api/v1/transaction-status/get-transaction-status
- Refund overview: https://code.hubtel.com/docs/guides/refunds

## Behavior

An OWNER/ADMIN/MANAGER opens Payments > Hubtel reconciliation and chooses Recheck settlement on an already reconciled sale. Server-side POST /v1/sales/:saleId/hubtel/settlement-review:

1. Uses the immutable original Hubtel merchant-account identifier, original checkout reference, expected amount and original credential source/revision. Credential rotation or revoked permission fails closed.
2. Rate limits rechecks per attempt to once every five minutes atomically at DB level, including failed status lookups; no parallel request flood.
3. Performs an independent authenticated GET to Hubtel transaction status. No checkout, transfer, refund, SMS, callback or customer wallet prompt is made.
4. Locks and revalidates the already-completed sale and original successful payment in canonical order before creating any review record.
5. If Hubtel confirms the original Paid transaction ID and payment method, returns unchanged and never posts an additional receipt.
6. If Hubtel reports Refunded, Unpaid after settlement, another transaction ID, or a different payment method, creates an append-only exception for manual review. The original completed sale, payment, cashbook, stock and VAT remain unchanged.
7. Deduplicates by original checkout and exception kind. Audit history is append-only and includes no raw API credentials or consumer data.

## Data and UX

Migration 0050 adds only per-attempt recheck cooldown/count plus the separate hubtel_pos_settlement_exceptions table. Strong SQL triggers reject wrong tenant, wrong branch, wrong payment/source transaction, unpublished original receipt, and updates/deletes. There is no financial posting.

The tenant-scoped reconciliation screen shows post-settlement alert count, latest type/date per attempt, and a clear warning that manual accounting/inventory review is required. Ordinary REVIEW_REQUIRED attempts remain distinct from already paid sales needing post-settlement investigation.

## Tests and rollout

CI PostgreSQL integrations cover a paid sale later reported Refunded, an Unpaid inconsistency, different tender/transaction ID, duplicate cooldown and immutable exception, auth and cross-tenant protection, no receipt duplication, and a clean Paid recheck. Authenticated visual QA and desktop-native build are mandatory before merging or deploying.

The new endpoint is not available to cashiers or unrelated tenants. It does not circumvent collection_enabled=false; Hubtel LIVE POS remains OFF. No refund processing or accounting reversal is authorized by this milestone. A separately designed, approval-controlled reversal and provider refund workflow remains required. Actual Hubtel sandbox response testing with merchant-owned credentials, payout ownership, account allowlisting and callback status reconciliation still remain go-live gates.
