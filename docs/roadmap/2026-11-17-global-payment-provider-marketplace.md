# TradeOS Africa: Global payment provider marketplace (17 November 2026)

## Scope — discovery is NOT activation

TradeOS POS retains two primary tenders: Cash and Electronic.
The new Settings > Payment providers screen lets a merchant owner/admin choose
the preferred provider for their registered country and business currency.
The saved preference is tenant-scoped, version-checked, and audited.
Neither this setting nor an initial checkout link is evidence of payment.

| Provider | Preferred provider selection | Server adapter | Verified POS collection |
|---|---|---|---|
| Hubtel (Ghana) | Yes | Existing | Existing, gated and currently OFF |
| Paystack (GH, NG, KE, ZA) | Yes | Hosted initiate + verify | Not connected |
| Flutterwave (Africa, eligible intl) | Yes | Hosted initiate + verify | Not connected |
| Stripe (eligible Europe, UK, USA) | Yes | Planned | Not connected |
| Pesapal (selected East/Southern Africa) | Yes | Planned | Not connected |
| DPO Pay (multiple African markets) | Yes | Planned | Not connected |
| M-Pesa direct (Safaricom Kenya) | Yes | Planned | Not connected |

The catalog is conservative; a listed merchant market does not guarantee that
a specific account, business type, currency or payment method is approved.
Côte d'Ivoire/Egypt Paystack beta is not treated as general availability.
Countries are based on where the business is registered rather than the location
of a customer. Provider capabilities are different per country.

Current official references:
- https://support.paystack.com/en/articles/2130562
- https://paystack.com/docs/payments/accept-payments/
- https://developer.flutterwave.com/docs/coverage
- https://developer.flutterwave.com/docs/collections-inflow/flutterwave-standard
- https://developer.flutterwave.com/docs/transaction-verification
- https://stripe.com/global
- https://dpogroup.com/contact-us/
- https://www.pesapal.com/
- https://developer.safaricom.co.ke/

## Existing money movement controls

- The business's current, approved provider must be used for all new
  electronic sales. A new Hubtel checkout is blocked after another provider
  is selected; existing Hubtel attempts remain independently verifiable.
- No ledger entry, receipt or goods release on a redirect, callback, popup,
  or merely started payment. Require provider-authenticated transaction status.
- Confirm originating business, merchant settlement account, exact currency,
  authorized amount, original reference, actual tender channel, provider ID,
  and deduplicated final payment status.
- No automatically retried provider while the original attempt may charge.
  No silent exchange-rate conversion, double charge, or double stock release.
- No raw card details, mobile-money PIN, OTP, API key or webhook signing secret
  is accepted or stored in merchant preference settings.
- Cash is offline-first; electronic payment initiation needs active
  merchant permission and a server connection.
- Hubtel and platform-subscription merchant accounts remain isolated.

## Next engineering increments

1. Build merchant self-service connection onboarding with secure encrypted key
   vault/KMS, provider-specific account verification, test/live boundaries,
   key rotation, audit, and strict role and branch authority.
2. Build the provider-neutral collection attempt and refund ledgers:
   idempotency keys, provider reference uniqueness, independently verified
   status, polling, authenticated webhooks, out-of-order settlement handling,
   duplicate callback protection, late Paid after stock reservation expiry,
   partial refund and chargeback settlement with accounting reversals.
3. Connect Paystack and Flutterwave POS only when merchant credentials and
   provider-independent finality integration tests are green. Both hosted
   providers require customer information such as email to initialize.
4. Add Stripe for eligible European merchants; Pesapal and DPO for regional
   African businesses; direct Kenya M-Pesa with customer ownership/OTP safeguards; Tanzanian
   wallets through their separately verified provider interfaces.
5. Support QR, card, mobile money, split cash/electronic, SMS, OTP, refunds,
   and receipts subject to country-specific policies and provider approval.

This increment creates NO actual Paystack, Flutterwave, Stripe, DPO, Pesapal or
M-Pesa payments. Their live activation remains locked pending reviewed
integration and individual merchant provider authorization.

## International business profile metadata

This increment expands the TradeOS supported-country picker beyond its initial
African markets to all 27 EU members plus the United Kingdom, Norway,
Switzerland, United States, and Canada. It adds EUR, GBP, USD, CAD, CHF,
SEK, NOK, DKK, PLN, CZK, HUF, and RON with ISO-specific precision.
The euro is used for Bulgaria as of 1 January 2026, per the ECB.

Source: https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260101~c830245e42.en.html

This makes account creation and local time zone selection possible in these
markets, but DOES NOT by itself certify local tax, electronic invoicing, GDPR,
payment processing, fiscal receipt or settlement compliance for launch.
Country expansion beyond this tranche needs validation and local-market UAT.
