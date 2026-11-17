# TradeOS Hubtel merchant POS release preflight

**Date:** 17 November 2026
**Release mode:** read-only readiness, safe credential routing, checkout provenance
and accounting correction. Merchant-owned live collection remains **OFF**.

## Merchant-visible activation checklist

Under Settings > Payment providers > Hubtel, merchant owners see a current,
read-only checklist with seven steps:

1. Protected server credential vault is available.
2. The business has saved its own Hubtel Payment API ID, API Key and
   Collection Account Number.
3. Hubtel read-only collection account API check succeeded.
4. The business owner requested activation.
5. Hubtel is the business's selected electronic payment provider.
6. The exact merchant collection account received TradeOS's separate
   collection-account/settlement ownership approval.
7. Live POS settlement flow was explicitly authorized and released.

The checklist is authenticated OWNER/ADMIN, business-scoped, redacted, and
does not decrypt credentials or call Hubtel. It shows counts of outstanding
Hubtel checkouts and those requiring manual reconciliation. It does not
treat an API key or payout account as proof of payment.

## Server-side merchant credential bridge

The Hubtel POS resolver understands two credential authorities:

- **PLATFORM_ALIAS:** backward-compatible legacy approved account and its
  private environment alias. Old checkout status verification remains bound
  to this source, even if the merchant later selects another gateway.
- **MERCHANT_VAULT:** the new business-owned encrypted LIVE Hubtel Payment
  API ID and Key. Merchant credentials may be resolved only when *all*
  conditions are true: the existing global Hubtel POS authorization is ON,
  separate private merchant-vault rollout is ON, the account in the merchant
  vault equals the independent platform-approved collection account,
  verified API access and activation request exist, and the database
  explicitly marks merchant collection enabled.

The previous migration 0046 intentionally enforces
`collection_enabled=false` at the database level. This release does not
remove that constraint or provide a bypass, so the new merchant-vault
checkout authority **cannot be activated** merely by the owner saving a
LIVE key or clicking Request activation. A later reviewed, privileged
release must implement authorized merchant settlement and lift the
database gate with sufficient checks. The existing global POS flag remains
OFF on staging by default.

## Immutable checkout source

Migration 0047 adds `credential_source` (PLATFORM_ALIAS or MERCHANT_VAULT)
and nullable `merchant_credential_revision` to Hubtel attempt records.
Old attempts default to PLATFORM_ALIAS. New attempt inserts snapshot the
source and revision; a DB trigger prevents updating their provenance and
requires a previously verified exact merchant/collection account for
MERCHANT_VAULT. Status checks select the **original** credential source
and require the same revision. If credentials change, manual review is
required instead of falling back or retrying a different provider.

## Accounting correction

Previously a Hubtel card payment could be recorded as MoMo in
`cashbook_entries`. The independent status response verifies the real
payment method against the pending sale. The verified method is now used
when posting to the matching money account. A card sale is rejected
transactionally if the business has no valid CARD money account; TradeOS
must not silently record it in the MoMo account.

## Verification and remaining release gates

Isolated PostgreSQL CI covers cross-tenant authorization, no merchant
credentials in responses, account verification and activation-request
steps, no-charge/no-POST even with both feature flags true, original
source immutability, legacy checkout reconciliation and CARD cashbook
method parity. CI, Linux desktop-native build and Visual QA must pass
before merge. No live merchant credentials should be pasted into issues,
chat or workflow logs.

**Not yet approved:** merchant-vault live checkout enablement, settlement
beneficiary/payout ownership verification, independently signed callback
handling or periodic server-side status on pending merchant attempts,
strong idempotency across crash recovery, disputed/late refunded
transactions, chargebacks and refunds, secure credential rotation with
continuity of outstanding payments, and production go-live review.

Sources:
- https://code.hubtel.com/docs/get-started/keys
- https://code.hubtel.com/docs/guides/online-checkout
- https://code.hubtel.com/docs/guides/reconciliation
- https://code.hubtel.com/docs/api/v1/balance-transfers/get-collection-balance
