# TradeOS merchant-owned payment provider Connect & Activate portal

**Milestone:** 17 November 2026. **Scope:** authenticated merchant onboarding,
encrypted per-tenant credentials, read-only verification and activation requests.
No customer charging or automatic financial settlement is enabled by this work.

## Why

Business owners already have their own Hubtel merchant accounts and API keys.
The legacy TradeOS POS Hubtel connector required platform-managed env aliases;
the payment preferences UI had no way to supply merchant-owned Hubtel keys.
The new self-service portal is part of Settings > Payment providers, directly
below the selected provider.

## Supported entry fields

| Gateway | Required | Optional |
|---|---|---|
| **Hubtel** | Payment API ID, Payment API Key, Collection Account Number | Disbursement Account Number (payouts only) |
| Paystack | Secret Key | Public Key |
| Flutterwave | Secret Key | Encryption Key, Webhook Hash |
| Stripe | Secret Key | Publishable Key, Webhook Signing Secret |
| Pesapal | Consumer Key and Consumer Secret | — |
| DPO | Company Token | Service Type |
| Safaricom M-Pesa | Consumer Key, Consumer Secret, Business Shortcode, Online Payment Passkey | — |

The user chooses **TEST** or **LIVE** independently and supplies credentials
owned by the selected business. Every required/optional field is declared in
`apps/api/src/payment-providers/merchant-schemas.ts`, returned as schema-only
metadata to the UI; saved credential values are never returned.

## Merchant process

1. Sign in as business OWNER/ADMIN and open Settings > Payment providers.
2. Select Hubtel (or another available provider), confirm that business
   country/currency is supported, and save the preferred provider.
3. In **Connect & activate your merchant account**, choose TEST or LIVE,
   enter all required provider fields and the current TradeOS password.
4. Save. Fields are encrypted per business, provider, and environment with
   a unique AES-256-GCM nonce and authenticated encryption context.
   The API shows **Saved — verification required**.
5. For Hubtel LIVE, choose **Verify Hubtel account (no charge)**; server
   performs **GET** to a fixed `trnf.hubtel.com` collection balance endpoint
   with HTTP Basic authentication and expects an independently confirmed
   response. This only confirms read access to that collection account.
   In particular it never issues a payout, creates checkout, charges
   a customer or transfers a balance.
6. For Paystack/Flutterwave, choose **Verify API access (no charge)**.
   The server checks their documented read-only balance endpoints using
   the correct tenant/test-or-live key, without returning account balances.
   This confirms credential scope, **not beneficiary settlement ownership**.
7. Choose **Request activation**, which saves an auditable request.
   Activation requires an approved provider-specific payment and refund
   workflow, signed callbacks where applicable, independent verification,
   merchant account ownership, and exactly-once stock/cashbook posting.
   No live collections are automatically enabled by saving or verification.
8. Revocation erases the active ciphertext, nonce and authentication tag.
   Existing outstanding payment attempts still belong to their original
   provider and must be reconciled there.

**Hubtel Business SMS** uses Client ID/Client Secret, separate from
Payment API ID/API Key, and is configured under Settings > SMS & messaging.

## Security

- Database migration `0046_merchant_gateway_self_service.sql`: unique
  business/provider/environment credential records, strict revision,
  append-only audit, and `collection_enabled=false` DB constraint.
- Each secret JSON payload is sealed on server with AAD
  `TradeOS/v2/merchant/{businessId}/{provider}/{environment}`; neither
  plaintext values nor encrypted blobs are returned via API.
- Owner/admin authorization, account password confirmation, TLS and
  optimistic locking are required to write, revoke or verify.
- Separate Hubtel LIVE collection accounts may not be reused between
  different merchant tenants; a merchant may not configure the platform's
  TradeOS subscription collection account as its own.
- TEST Paystack/Flutterwave secret keys also synchronize to the existing
  unactivated sandbox ledger credential table to avoid a nonfunctional second
  secret store. No external charges from saving credentials.
- LIVE Hubtel account verification uses **read-only GET**, exact fixed host,
  request timeout, and fails closed for 401/403, invalid amount, malformed
  response, network failure, and stale credential revision.
- Previous Hubtel POS collection logic still uses platform-verified aliases,
  existing source payment attempts and `TRADEOS_HUBTEL_POS_ENABLED` global
  gate. This new portal does **not** bypass these checks or enable charging
  simply because credentials were entered.
- Master encryption key must remain in the private server environment
  and be backed up with a documented rotation/recovery plan.

## Remaining for actual Hubtel merchant collections

Bridge each verified merchant-owned credential to the vetted hosted Hubtel
checkout and independent status verification only after approving the
sandbox evidence and implementing recovery/late payment/refund conditions,
per-merchant callback reconciliation, stock/cashbook exactly-once posting,
and provider settlement account validation. Do not activate the global
live POS flag prematurely. Existing Hubtel merchant account ownership
and IP allowlist are prerequisites but not substitutes for reconciliation.

## Source documentation

- https://code.hubtel.com/docs/get-started/keys
- https://code.hubtel.com/docs/api/v1/balance-transfers/get-collection-balance
- https://code.hubtel.com/docs/get-started/go-live
- https://paystack.com/docs/developer-tools/api-keys/
- https://developer.flutterwave.com/api/misc/get-all-wallet-balances
