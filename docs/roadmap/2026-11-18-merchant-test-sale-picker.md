## Merchant gateway TEST sale picker

Date: 18 November 2026. Scope: remove the requirement to copy internal sale UUIDs for Paystack/Flutterwave sandbox testing.

The merchant owner/admin chooses an eligible pending electronic sale directly from Settings → Payments → Payment attempt audit. The picker shows branch, payment method, currency-aware formatted amount and short sale reference. It shows up to 40 recent eligible sales and explains missing TEST keys or unsupported gateway preference. Advanced disclosure preserves manual sale ID entry.

GET /v1/businesses/:businessId/payment-gateways/eligible-test-sales?limit=40 with optional branchId, role-restricted to active owner/admin. No customer information, credentials, provider references or full sale contents. Only open, positive-total, matching-currency sales with exactly one matching PENDING card/MoMo payment; excludes inactive branches and any pre-existing gateway or Hubtel checkout. Readiness checks merchant country/currency, selected gateway and stored TEST connection. Response never enables collection. No provider calls are made.

Preparation of a selected sale still independently revalidates all requirements under a transaction lock before writing an immutable TEST reference. Provider-hosted TEST checkout remains a separate password-confirmed action, and sandbox payment observation never creates a canonical receipt. The picker cannot change stock, sales, payments, refunds, cashbook, tax or subscriptions.

Tests cover tenant isolation, unauthenticated denial, candidate exclusions, readiness, branch filtering, and unchanged canonical financial records. No database migration is required. CI, Linux desktop-native and authenticated visual QA are required before protected staging rollout.
