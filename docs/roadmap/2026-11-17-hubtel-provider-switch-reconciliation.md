# Preserve Hubtel payment provenance when switching payment providers

**Scope:** merchant Hubtel POS payment safety, regression tests and copy fixes.
**Live money collections:** unchanged and OFF by database/platform flags.

## Why

A merchant may change the preferred provider from Hubtel to Paystack or
Flutterwave while a customer has an existing Hubtel checkout. That existing
payment cannot safely disappear: an already-open Hosted Checkout may settle
later with the **original** provider. The original provider alone should
confirm its reference, account, currency, amount and payment method.

The existing code correctly preserved original payment attempts at the DB
layer, but did not consistently express this distinction:

1. The POS direct new-checkout service did not itself enforce the merchant's
   selected provider. A direct API call could still initiate Hubtel even
   when another provider was preferred (assuming the POS rollout flag was on).
2. The reconciliation workspace used the new-checkout readiness boolean
   to disable independent status verification for prior Hubtel attempts.
3. The sale action component could show 'Create checkout' on an uncertain
   PREPARED/REVIEW_REQUIRED attempt, and could offer old checkout links after
   switching providers even though the expected action was reconciliation.
4. A verified payment-method mismatch was retried by the automatic scheduler
   rather than immediately escalated for manual reconciliation.

## Behavior after this change

- On a **new** Hubtel checkout, independently enforce the current preferred
  provider inside the Hubtel service, not merely the Sales UI.
- An **existing** attempt's reference and immutable credential-source
  provenance remain tied to original Hubtel; verified status queries for
  those attempts do not depend on the presently selected preferred provider.
- Reconciliation UI displays and allows status verification of old attempts
  when Hubtel remains an authorized existing-checkout connection, even if
  Hubtel is no longer preferred for **new** transactions.
- New payment links are hidden for non-preferred Hubtel and are never offered
  for a PREPARED/REVIEW_REQUIRED existing checkout.
- Hubtel provider-reported payment-method mismatches, credential revision
  mismatches and merchant-scope errors immediately enter REVIEW_REQUIRED
  (with an auditable reason and without issuing cash receipts).
- Status checking stays server-side. Independent provider PAID verification
  and exact transaction/reference/account/amount/method match are required
  before any completed sale or cashbook receipt.

## Regression coverage

- Direct API attempt while Paystack preferred returns 409 and does not call
  Hubtel or post payment.
- Switch to Paystack AFTER Hubtel checkout creation; the original status
  verification still settles precisely once against the original provider.
- Authenticated UI contract prevents reopen/new-link action while enabling
  original provider verification and showing REVIEW_REQUIRED as reviewable.
- Independently verified CARD vs expected MoMo mismatch immediately holds
  funds, sale and stock for manual review, with zero receipt.
- Complete isolated PostgreSQL CI and authenticated web Visual QA must pass.

## Remaining gates

This work is not proof of merchant collection authority or accounting finality
under production conditions. Keep collection_enabled=false database gate
and TRADEOS_HUBTEL_POS_ENABLED and
TRADEOS_HUBTEL_MERCHANT_POS_ENABLED private flags OFF. Before enabling
real collections: validate actual merchant-owned Hubtel checkout, callback
and status API; review buyer/tender behaviors, late status, refunds/chargebacks,
independent beneficiary approval, credential rotation and exact-once posting.
