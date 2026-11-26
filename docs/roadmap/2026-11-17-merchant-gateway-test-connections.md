# Merchant payment gateway connections — test-only foundation

## Changes (17 November 2026)

Business owners and administrators can prepare their own Paystack and
Flutterwave TEST credentials in Settings > Payment providers.
A stored key is NOT permission to collect real money. No provider payment
initiation, settlement or refund is activated by this change.

Payment keys are encrypted using AES-256-GCM with a fresh nonce and
authenticated tenant, provider and environment context. The database holds
ciphertext only. The master key must live in protected API server secrets.
Credential saves and revocations require the merchant's TradeOS password,
current role and an optimistic revision. All successful changes are audited
without storing any password or secret in the audit.

A DB constraint forces enabled=false for all new connection records. Revoke
clears the active ciphertext, nonce and authentication tag. Older encrypted
copies can persist in database backups under the retention policy.

## Operator setup

Provision a distinct, securely backed-up 32-byte random master key for each
environment. The configuration name is:
TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64

Use the protected VPS secret configuration; do not commit it to Git, paste
it into chat, or print it in command output. Current key version is 1.
Changing the key without carefully re-encrypting existing records makes
them unreadable. This version has no master-key rotation UI.

If the master key is absent or invalid, new credential saves return HTTP 503.
The Settings panel displays a disabled state. Existing Hubtel POS safety
gates are unaffected.

## API

- GET /v1/businesses/:businessId/payment-gateways/connections:
  owner/admin, redacted status only (no secret or ciphertext).
- PUT /v1/businesses/:businessId/payment-gateways/connections/PAYSTACK
  and /FLUTTERWAVE:
  owner/admin, current password, valid TEST key, expected revision.
  Stores encrypted secret with PENDING_VERIFICATION status and enabled=false.
- DELETE same route:
  owner/admin, current password and expected revision.
  Revokes saved test credential; does not authorize a refund or payout.

The API sends no external provider request as part of saving a key.

## Next safe milestones

1. Confirm actual merchant account, collecting identity, API permissions and
   settlement destination with each provider.
2. Provider-neutral collection attempt ledger and independently verified,
   idempotent finality; exact amount/currency/reference/method/account checks.
3. Webhook signature validation, status reconciliation and exception queues.
4. Late-paid and post-stock-expiry reconciliation; refunds and chargebacks.
5. Live credential onboarding, separate key storage and explicit approval
   after full non-production financial testing.

Provider references:
https://paystack.com/docs/api/authentication/
https://developer.flutterwave.com/docs/authentication
