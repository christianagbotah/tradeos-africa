# Hubtel Online Checkout: durable, UNTRUSTED notification inbox

Date: 17 November 2026. Scope: staging-only, opt-in, zero financial side effects.

## Rationale

Hubtel's Online Checkout v1 callbacks are not cryptographically signed
and can be repeated or lost. A callback that claims success is NOT proof
that funds settled. The only authoritative path remains independent server-
to-server transaction-status verification against the original Hubtel
collection account, reference, exact amount and tender method.

References:
- https://code.hubtel.com/docs/webhooks
- https://code.hubtel.com/docs/callbacks
- https://code.hubtel.com/docs/guides/reconciliation
- https://code.hubtel.com/docs/api/v1/transaction-status/get-transaction-status

## New behavior

The existing `POST /v1/payments/hubtel/notifications` continues returning
a generic 202 acknowledgement. It never finalizes a payment. When private
`TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED=true`, the server optionally
stores a bounded, deduplicated callback **hint** if it matches an existing
unguessable TradeOS `TSP-<24 hex>` checkout reference.

- Migration 0049: `hubtel_pos_notification_inbox` and strict DB trigger.
  Stores only attempt ID, business scope, exact client reference, SHA-256
  digest, coarse status hint, `trust_level=UNTRUSTED`, received timestamp.
  Nothing resembling raw customer phone, name, amount, card info, API key,
  IP address, token or whole webhook body is retained.
- Unknown and malformed references do not create new records; the endpoint
  responds identically so it does not reveal whether a reference exists.
- Duplicate payloads are idempotent. Distinct payload variants are capped
  at 12 observations per checkout under a database row lock, preventing
  unbounded growth from a known checkout reference.
- Direct SQL attempts to forge a cross-business notification, rewrite a
  status hint, or delete the history are rejected by a database trigger.
- Owner/admin reconciliation readout includes `notificationCount`,
  `lastNotificationHint`, `lastNotificationAt`, and
  `notificationTrust: UNTRUSTED`. Even a `SUCCESS_CLAIM` is not paid.
- If the inbox is enabled and a genuine storage error happens, the webhook
  route returns a retryable HTTP 503, rather than falsely claiming that a
  durable notification was stored. Opt-out remains the existing no-op
  with HTTP 202; the default is **OFF**.

## Explicit non-goals and security caveats

- This release does not automatically fetch transaction status from a
  callback, because the callback is untrusted and no request may bypass the
  existing five-minute status-check safeguards.
- It never updates sales, payments, stock, cashbook, refund, payout,
  approved collection-account state, money account, or POS enablement.
- Only the original provider's independent status check may finalize paid.
- Callback sender-IP provenance is not yet asserted at application level.
  Fastify currently does not trust reverse-proxy forwarding headers, and
  the public callback URL cannot safely infer the external Hubtel source IP.
  The inbox is **untrusted** regardless of network origin, and the feature
  flag stays OFF until reverse-proxy trust, rate limiting, and operational
  callback testing are verified.
- Existing merchant-owned LIVE POS remains blocked by migration 0046's
  `collection_enabled=false` database constraint; no real-money go-live
  is implied.

## Evidence

Isolated PostgreSQL integration tests cover disabled/no-op, invalid and
unknown reference, forged success, duplicate idempotence, per-attempt cap,
cross-tenant DB trigger rejection, append-only audit, merchant monitor
visibility, and unchanged OPEN/PENDING sales with zero cashbook receipts.
CI, desktop-native and authenticated Visual QA must pass before merge.

## Next gate

Private reverse-proxy source-IP handling, validated callback size and
per-IP/rate limits, match original payment state and amount to independently
verified Hubtel transaction-status response, bounded durable status polling
for late/refunded payments, and secure manual dispute workflow. Only
after full sandbox evidence and beneficiary approval may merchant checkout
activation be considered.
