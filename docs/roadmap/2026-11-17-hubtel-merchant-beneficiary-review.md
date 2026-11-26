# Hubtel merchant collection-account ownership review

17 November 2026 — TradeOS Africa platform governance milestone.

## Why this release

TradeOS merchants can enter their own Hubtel Payment API ID and API Key,
select a LIVE collection account, verify **read-only account access**, and
request activation. Those steps do not prove that the business legally
controls the settlement beneficiary. The earlier merchant checklist therefore
had no admin evidence approval screen.

This release adds a separate platform-admin review queue and an immutable
attestation record. **It does not enable live Hubtel collections.**

## Admin review workflow

1. Merchant saves its Hubtel LIVE API credentials, independently verifies
   account access through the read-only Hubtel API and requests activation.
2. The business appears in System Admin → Tenants → **Hubtel account reviews**
   at `/console/hubtel-merchant-accounts`.
3. The reviewer sees the business, collection account, provider, currency,
   credential revision, current evidence status, and any pre-existing
   Hubtel collection account (including conflicts). No API keys are exposed.
4. A SUPER_ADMIN or PLATFORM_ADMIN must inspect evidence *outside this
   workflow* (merchant legal identity, provider merchant ownership and payout
   beneficiary) and supply an internal evidence/case reference plus a
   12–500-character rationale. Approvals require explicit acknowledgement
   of independent beneficial-ownership confirmation.
5. The platform stores APPROVED or REJECTED with administrator identity,
   credential revision and exact collection account, plus an immutable
   historical event. Stale optimistic versions are rejected.
6. A changed credential revision or different collection account makes
   any earlier review **not current**. The business owner must re-verify
   and submit a new activation request for review. Rejected reviews remain
   visible, can be reconsidered with a new audited decision, and never
   enable collection.
7. The merchant's existing activation checklist reports the latest
   current review state without exposing the internal evidence reference,
   audit rationale or any merchant credential.

Role policy: SUPER_ADMIN/PLATFORM_ADMIN can review; OPERATIONS can view
the queue without writing; other roles have no access.
All admin access requires the separate platform administrator HttpOnly
session cookie. Tenant auth tokens cannot access the queue.

## Database changes

Migration `0048_hubtel_merchant_account_reviews.sql` adds:
- A current review record per business with exact account/reference,
  credential revision, decision, reviewer, required internal evidence
  reference and rationale, beneficiary confirmation, and monotonically
  increasing review version.
- Append-only `hubtel_merchant_account_review_events` with a DB trigger
  rejecting updates/deletes.
- A DB trigger rejecting reviews without a CURRENT VERIFIED Hubtel LIVE
  credential, matching collection account/revision, an activation request,
  an active business and **collection_enabled=false**.

All writes use the existing locked business row, matching merchant
credential update lock order, then review version checks. The review
cannot be used to activate a payment gateway.

## Absolute collection and security boundaries

- The platform review service never decrypts merchant secrets, contacts
  Hubtel, requests payment, changes a sale or payment, creates a cashbook
  entry, changes the Hubtel POS account alias or enables a collection.
- The existing migration 0046 still has the hard database
  `collection_enabled=false` CHECK. The global Hubtel POS and separate
  merchant-vault feature flags remain OFF on staging unless explicitly
  authorized by a future release.
- Approved **review evidence** is not proof of a successful sale payment;
  POS receipts must be independently verified against the original
  provider/merchant, amount, reference and payment method before accounting.
- Existing Hubtel `PLATFORM_ALIAS` checkout attempts remain tied to their
  original credential source and may need manual reconciliation, especially
  if a merchant changes payment account.
- The platform cannot independently claim ownership merely from a
  read-only balance API response or merchant self-attestation.
- Store evidence reference identifiers, not passwords, API secrets, bank
  passwords or customer PII in review notes. Supporting evidence documents
  remain subject to separate KYC secure storage and retention controls.
- Approvals remain an operator attestations pending later independent
  payout beneficiary verification and production reconciliation gates.

## Release evidence

- Isolated DB integration tests exercise platform auth/role permissions,
  merchant account verification and activation request, redacted queue,
  manual approval/rejection, stale version handling, credential rotation,
  immutable audit events and hard no-money invariants.
- System-admin static contract checks verify discoverability, reviewer
  acknowledgement and refusal to display API secrets.
- Full CI including PostgreSQL, merchant/admin pages and desktop-native
  build plus Visual QA is required before merge/staging deployment.

## Future go-live work

Add secure evidence upload/reference integration and formal KYC ownership
attestation, support billing country/regulatory review, merchant payout
destination proof and payout settlements, dual-control live authorization
where required, signed/independent payment finality verification, late
payments, chargebacks/refunds, cross-provider reattempt veto, and
exactly-once cashbook/stock with a separately privileged rollout.
No live payment collection should be enabled merely because this
review is marked APPROVED.
