# Hubtel Online Checkout and SMS — direct setup, 19 November 2026

## Customer request and existing provider documentation

TradeOS merchants should not be sent to a generic Hubtel help page for API setup. The merchant chooses Hubtel under Settings → Payment providers, enters the Hubtel Sales API ID, Sales API Key, and merchant Collection Account, then chooses Hubtel SMS in SMS & messaging to enter the independent SMS Client ID, Client Secret, and approved Sender ID. Both are encrypted per business; stored secrets are never returned over the browser API.

The documented live Hubtel Online Checkout endpoint is `POST https://payproxyapi.hubtel.com/items/initiate` using Basic Auth, the merchant's actual collection account, absolute callback/return/cancel URLs and a unique client reference. TradeOS has implemented this in `HubtelCheckoutClient` and `hubtel-pos-service`. Online Checkout supports MoMo and cards, but redirection and unsigned callback claims cannot mark TradeOS sales paid. TradeOS must independently obtain transaction status from `GET https://api-txnstatus.hubtel.com/transactions/{account}/status?clientReference=...`, validate original account, reference, amount, currency, method and transaction ID before ledger posting. Merchant settlement remains OFF until exact-account beneficiary approval and Transaction Status permission have passed. Existing business-owned approved POS attempts retain their provider and cannot be reissued through a different gateway.

The user previously provided documents covering Hubtel Online Checkout, Direct Receive Money, Transaction Status, Refund and SMS. Hubtel SMS Simple POST is `POST https://sms.hubtel.com/v1/messages/send` with Basic SMS ClientID/Secret and `From`, `To`, `Content` fields. Never use GET to send SMS because GET embeds secrets in the URL.

## Added this release

- Inline Hubtel setup instead of external help link; choose Hubtel immediately for an eligible Ghana/GHS business with no preference yet, but do not silently change the saved merchant choice.
- SMS config defaults to Hubtel SMS and offers a distinct **owner/admin-only, password-confirmed one-message test** to a Ghana number they affirm they control. This can incur an SMS charge; no automatic sending occurs on save or page load. The server sends one fixed content payload, not unreviewed user content. One test is permitted every ten minutes; ambiguous outcomes (including process death during POST) require manual investigation, not a duplicate attempt.
- Each test intent is recorded before the external POST with a business/client-idempotency unique key, immutable audit and recipient last-four suffix only. `ACCEPTED` means Hubtel accepted the submission, **not** that the handset received the message. No bulk or customer notification sending is enabled by this feature.
- A privileged local-only import utility can migrate an owner-approved existing Hubtel private credentials file into a single named, uniquely owned business vault. Its dry-run is the default, refusing account collisions, existing credentials, incorrect merchant identity/country/currency and platform-account duplication. It never enables payment collection or bulk SMS and never prints credentials. It is not an HTTP endpoint. Any import must be separately confirmed against the actual target tenant and securely executed by an authorized VPS operator.

## Current account blocker

Previously on the same VPS, the user's Variety Groceries hosted ₵1 checkout could be initiated but Hubtel's Transaction Status API returned 403 and callback confirmation was not established. The Hubtel account must allowlist the public VPS IPv4 `163.245.212.15` and enable the correct collection-account Transaction Status and Refund permissions. Until merchant-owned transaction status, beneficiary settlement and refunds are validated against provider truth, do **not** enable `TRADEOS_HUBTEL_POS_ENABLED`, `TRADEOS_HUBTEL_MERCHANT_POS_ENABLED` or `TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED` or change database `collection_enabled=false` constraints. Do not claim live checkout or SMS delivery verified without an actual provider-confirmed test.

## Test and release gate

Unit mocked Hubtel POST and negative cases; isolated Postgres business/owner permission, password, recipient consent, idempotency and cooldown coverage; all DB migrations, typechecks, UI contract checks, web build, desktop-native build and visual QA must pass before protected staging deployment. Confirm private credentials imported only to the correct Lightworld tenant after the safe provisioning procedure is authorized and executable.
