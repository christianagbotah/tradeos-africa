# Paystack / Flutterwave sandbox return handoff — 19 November 2026

## Scope

A hosted provider TEST checkout redirects back to `/gateway-test-return`, with the immutable TradeOS `attempt` and `expected_ref` attached by the server. The public responsive landing page makes no API call, performs no payment verification, and tells the operator that provider-reported success/failure remains **unverified**. It sanitizes the checkout URL from browser history before showing a link to Settings → Payments.

Known Paystack `reference` / `trxref` and Flutterwave `tx_ref`, `transaction_id`, `status` redirect parameters are treated as untrusted browser hints. Conflicting provider/reference values trigger a review warning. A well-formed Flutterwave numeric transaction ID can be carried into the merchant's own payment audit, but is **only** prefilled if the server-fetched TEST attempt matches both UUID and original client reference and is still PREPARED. The owner/admin must press "Check provider TEST status" to independently fetch provider evidence using the original merchant TEST credentials; even a verified sandbox payment never posts to the canonical sale, payment, stock, receipt, cashbook or payout.

Existing one-time TEST checkout creation, original key version, provider URL host allowlist, immutable attempts, database anti-retry guard, 1/min verification limiter, amount/currency/method validation, and LIVE-off controls remain unchanged. Return page does not auto-verify, auto-cancel, retry or complete payment. Settings strips return query hints once consumed. User-provided browser redirect values are never accepted as settlement evidence.

Tests: browser URL validation, conflicting references, transaction ID hint, role/tenant attempt-match semantics in UI, hosted adapter contracts and no financial side effects contract. GitHub CI, desktop build, and Visual QA must pass before protected staging deployment. Merchant-funded actual provider TEST end-to-end remains a separate go-live gate.
