# Provider-hosted Paystack/Flutterwave TEST checkouts (PR #178)

Date: 18 November 2026. This release lets an active merchant OWNER/ADMIN deliberately initialize **one** Paystack or Flutterwave provider-hosted TEST checkout, using the immutable original TradeOS TEST payment reference. It is not a LIVE collection flow, provider webhook settlement, or refund mechanism.

## Merchant flow

1. In Settings → Payments, save a merchant TEST key, choose Paystack or Flutterwave, and prepare an eligible TEST attempt from an existing OPEN sale and its sole pending MoMo/card payment. The TEST reference is globally unique and immutable.
2. In the payment attempt audit row, enter a TEST customer email and reauthenticate with the current TradeOS password. Review the explicit confirmation. This is the only path that may call the provider TEST checkout-initiation API.
3. The server selects **the exact merchant TEST key and revision** recorded at preparation, not the present preferred gateway, and checks that it starts with `sk_test_` (Paystack) or `FLWSECK_TEST-` (Flutterwave). No LIVE keys or subscription credentials are used.
4. Exactly one external POST is permitted per attempt. A database claim occurs before the POST, ensuring concurrent or repeated calls cannot create a second provider checkout. Valid checkout URLs must belong to `checkout.paystack.com` or `checkout.flutterwave.com`. The UI displays the provider TEST link only after verification.
5. After simulating the checkout with provider TEST data, click **Check provider TEST status**. Paystack verifies the original reference, while Flutterwave requires its numeric provider transaction ID. Even a provider-confirmed TEST paid observation only records an immutable audit row. The real sale stays OPEN and the original payment remains PENDING.
6. If the provider initiation times out, responds with an invalid link, or the merchant key changes during the request, the checkout is `OUTCOME_UNKNOWN`: **no automatic retry**. Such cases must be investigated through the provider TEST portal, not cancelled as if no external checkout existed.

## Boundary protections

Migration 0053 adds a tenant-scoped one-row-per-attempt `gateway_sandbox_hosted_checkouts` table and append-only `gateway_sandbox_hosted_checkout_events`. SQL triggers lock identity, trusted host URL, state transitions and original merchant scope, and block cancelling a TEST attempt after an external checkout was initiated. Unknown outcomes do not expose a potentially unsafe link.

The API `POST /v1/businesses/:businessId/payment-gateways/attempts/:attemptId/hosted-test-checkout` is authenticated, owner/admin-only and current-password-confirmed. The GET test-attempt monitor exposes the persisted TEST checkout state and provider-owned link only to authenticated business administrators. No API secret, provider response body or full customer email is stored in hosted checkout records.

**No cashbook, sales, payments, inventory, tax, commissions, refunds, payouts, customer credits or subscription billing entries are changed by this flow.** All merchant LIVE payment flags remain disabled in protected staging.

## Tests and deployment

Multi-tenant isolated PostgreSQL tests verify Paystack and Flutterwave TEST initialization with network stubs, exact method/amount/reference/test key, idempotent replay, safe URL, insufficient authorization/password, key rotation, ambiguous network outcome, immutable event audit, cancellation block and unchanged financial totals. API/web compilation, migration suite, desktop-native and authenticated visual QA must pass before protected staging promotion.

Official provider references:
- https://paystack.com/docs/api/transaction/
- https://developer.flutterwave.com/api/charge/standard

Neither simulated provider tests nor a successful sandbox API response independently authorizes live collection. Real provider sandbox runs, merchant beneficiary verification, exact-once live posting, webhook validation and refund handling remain future release gates.
