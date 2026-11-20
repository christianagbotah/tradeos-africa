# TradeOS — Authenticated Hubtel original-order refund observations

## Exact purpose
Add a per-refund, on-demand, authenticated Hubtel **original-payment** status check, with immutable audit history. Hubtel's public 2026-11-02 refund documentation supports a full-order mobile-money refund request (acceptance code `0001`) and callback. Its documented status lookup reports `Refunded` for the **original collection**, but exposes no independently authenticated refund-specific destination/receipt query. Hubtel refund callbacks have no publicly documented source IP; TradeOS must not treat them as provider-verified settlement.

This release therefore supports **original order observations only**, and deliberately never calls the refund initiation endpoint or marks a refund paid.

## What was added
- 0059 SQL migration adds `refund_provider_order_observations` append-only rows with authenticated provider status, normalized classification, original linked payment / checkout, current original transaction ID, expected amount/currency, actor and idempotency request ID. CHECK constraints force `refund_destination_verified=false` and `refund_settlement_verified=false`. DB trigger enforces active finance membership, exact business/branch/sale/payment/checkout links, amounts and original transaction ID. No modification/deletion allowed.
- Separate `refund_provider_order_check_cooldowns`: atomic PostgreSQL upsert allows at most one status request per unresolved refund every five minutes, even on HTTP error or timeout.
- `GET /v1/refunds/hubtel-original-order-observations`: read-only scoped history (latest 20), recheck eligibility based on original approved merchant credentials, next allowed time. Never returns secrets or original collection account.
- `POST /v1/refunds/hubtel-original-order-recheck`: authorized OWNER/ADMIN/MANAGER/ACCOUNTANT online action, exact business/branch/refund and unique UUID. Requires original settled **MOMO** payment, exactly matched GHS amount/full order refund, original verified transaction ID, `RECONCILED` checkout, original merchant credential source/revision/account. Calls Hubtel's authenticated **GET collection status API** (not checkout, refund or SMS); validates original client reference/account/amount, confirms original transaction identity and method and saves only an observation, plus audit event. All financial status and balance fields unchanged.
- Refund reconciliation UI now shows the authenticated original-order status timeline and the optional manually triggered recheck. Never says the *refund* was paid or shows a mark-paid action. Recheck disabled offline, during cooldown, or when original merchant credentials are not approved.

## Proof rules
`ORIGINAL_ORDER_REFUND_REPORTED` means Hubtel replied that the **original payment** has status `REFUNDED`. It does not identify a specific refund's destination, receipt, payout amount, or actual customer credit. `providerFinality=NOT_ESTABLISHED`, `canMarkPaid=false`, `refundDestinationVerified=false` and `refundSpecificSettlementVerified=false` remain true for all events and statuses.

The status API call uses only a previously approved server-side credential connection. A credential disabled by the rollout flags (including staging) blocks the recheck; no provider HTTP call is attempted. The official docs do not expose a refund-specific lookup; don't fabricate one. Retry safety: request UUID replay returns previous observation (no new provider call); changed UUID during five-minute cooldown returns 429. Unauthenticated/cashier/other branch requests fail.

## QA and release
- Apply 59 migrations to new disposable PostgreSQL 18 QA database only; never TRUNCATE staging.
- Test authenticated REFUNDED/PAID/UNPAID and transaction mismatch classification, 5min cooldown, idempotent replay, append-only guard, full-order-only restriction, merchant credential gating, role/branch denial, audit and unchanged refund status.
- API/web strict TypeScript and contracts. API refund follow-up/regression tests. Full GitHub CI, Linux desktop native build, authenticated Visual QA before squash merge and protected staging deploy.
- Verify exact staging SHA, HTTP 200 health/returns and HTTP 401 unauthorized new routes. Preserve previous release for rollback.

Refs: https://code.hubtel.com/docs/guides/refunds and https://code.hubtel.com/docs/api/v1/transaction-status and https://code.hubtel.com/docs/callbacks.
