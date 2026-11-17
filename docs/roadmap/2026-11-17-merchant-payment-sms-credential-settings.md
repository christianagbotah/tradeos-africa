# Merchant payment + SMS API credential setup
TradeOS Africa — 17 November 2026

## Why this work

The old Payment providers page showed a long grid of global payment choices
before the merchant's credential form; no SMS provider settings existed.
Merchants could reasonably assume choosing a provider would reveal that
provider's API fields. This release makes the selected gateway and API key
flow contiguous and introduces a dedicated Settings > SMS & messaging page.

## Merchant workflow

1. Open Settings > Payment providers and choose the desired gateway from
   the compact list. Supported TEST self-service credential entry appears
   immediately below the Paystack or Flutterwave selection. The preferred
   provider can be saved independently from its test credentials.
2. For Paystack/Flutterwave enter the **TEST secret key**, then confirm with
   the current TradeOS account password and select Save TEST credential.
   Merchant credentials require an encryption master key configured privately
   in the staging deployment. Without the vault, the key field stays disabled
   and displays an explanation. Live keys are rejected.
3. For other gateways, the UI clearly states that self-service credential
   onboarding is not implemented; existing Hubtel merchant collection is
   platform-verified and remains disabled absent authorization.
4. Open Settings > SMS & messaging. Choose Arkesel, Nalo, Hubtel SMS or
   Twilio; enter approved sender ID, API key/token, and provider-specific
   account ID where necessary. Confirm your TradeOS password and save.
   Entries can be revoked. The UI displays only redacted connection status,
   provider account ID and sender ID; never the API secret.

Provider-specific fields (aligned with published service guidance):
- Arkesel: API key + approved Sender ID.
- Nalo: SMS API key + approved Sender ID. Real API sending endpoint still
  requires vendor contract and integration testing.
- Hubtel SMS: SMS Client ID, SMS Client Secret, approved Sender ID.
  **Do not confuse with Hubtel payment checkout API ID/Key**.
- Twilio: Account SID, Auth Token, approved E.164 sender phone number.

## Security boundaries

- Database migration 0045 stores each business/provider's encrypted secret,
  random nonce and authentication tag, metadata, revision and audit events.
- Server-only AES-256-GCM uses unique authenticated encryption context
  `TradeOS/v1/{businessId}/SMS/{provider}` so another business/provider
  cannot decrypt the ciphertext; payment keys use a distinct context.
- API requires authenticated business OWNER/ADMIN, current password
  reauthentication, and expected-revision optimistic locking.
- Sensitive writes are online-only and server transactions are atomic;
  unauthorized tenant access is denied. Revocation clears the active
  ciphertext, nonce and authentication tag; historical encrypted backups
  follow the platform retention policy.
- Vault key never goes into Git, user-facing JS, URLs or logs.
- Database constraint `enabled=false` is non-negotiable in this release.
  Saving SMS credentials does NOT trigger delivery, OTP, campaign, customer
  notification, or any SMS provider network request. Sender verification,
  consent, send/delivery audit, opt-out and rate limiting remain pending.

## Operator action (staging only)

Provision a unique 256-bit encryption key using the existing protected
staging secret workflow, with secure backup and recovery/rotation plan.
Set `TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64` only in the private
server environment; never expose this value in logs or chat.
Production requires its own separate secret; do not copy staging secrets.
The UI advertises vault readiness, but never returns the key.

## Official documentation

- Arkesel: https://developers.arkesel.com/
- Nalo sender IDs: https://help.nalosolutions.com/en/requesting-sender-ids/
- Hubtel SMS: https://code.hubtel.com/docs/guides/sms
- Twilio messaging: https://www.twilio.com/docs/messaging/quickstart

## Remaining work

Implement outbound SMS adapters with verified provider contracts, sender
approval, rate limiting, balances, per-tenant budgets, opted-in recipients,
templates and delivery reports. No live SMS sends are activated yet.
Payment gateway TEST account validation, merchant payout ownership and
real-money collection authorization are separate release gates.
