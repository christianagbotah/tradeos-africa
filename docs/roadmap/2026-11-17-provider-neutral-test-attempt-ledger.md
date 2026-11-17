# TradeOS payment-provider collection attempts
17 November 2026 — provider-neutral TEST intent foundation

## Scope: an attempt is NOT a receipt

This increment adds a provider-neutral sale/payment intent table and review
history for the future Paystack, Flutterwave and regional payment connectors.
It is for **TEST preparation only**. There is no checkout initialization
endpoint, no wallet prompt, no live provider charge, no status confirmation
that can make an attempt PAID, and no cashbook/stock/revenue posting from this
module. Saving a TEST merchant key still cannot authorize real collections.

## Canonical financial safeguards

The new migration 0043 stores the original business, branch, sale, pending
payment, gateway, environment, merchant credential revision, request UUID,
random provider reference, integer amount, ISO currency and payment method.
A PostgreSQL trigger checks the sale owner, branch, payment, method, total,
currency, pending status and merchant TEST connection revision at creation.
All original identity and amount fields are immutable after creation.

Single-collection uniqueness guards prevent overlapping provider attempts:
unique business+sale, unique payment, unique business+clientRequestId and
unique provider+clientReference. A repeated client request returns the
existing attempt. A new ID for a sale that already has an attempt returns
HTTP 409 instead of initiating a second charge. Existing Hubtel attempts
remain in their original dedicated table; they are not automatically copied
or converted by this migration.

Only PREPARED, CANCELLED and REVIEW_REQUIRED states exist. The later verified
PAID and RECONCILED states deliberately do not exist yet. The internal
service prepares a TEST attempt only for an OPEN sale with exactly one
PENDING MOMO/CARD payment, matching total and business currency. It may
subsequently close a prepared attempt or flag it for review, with an
append-only event record, but it never initiates an external payment.
Rotation or revocation of test credentials does not erase existing attempts.

## Merchant experience

Business owners/admins see a read-only Payment attempt audit panel under
Settings > Payment providers. It shows counts of prepared/cancelled/review
records, provider, method, amount and original payment reference. Manager
and accountant roles have a read-only server endpoint, as appropriate.
A tenant cannot view another business's collection attempts or references.
No provider credentials, merchant secret or checkout URL is returned.

- GET /v1/businesses/:businessId/payment-gateways/attempts?limit=20
- Optionally filter by branchId for a business you are authorized to read.
- There is intentionally no public POST/PUT route for creating/settling
  attempts. Future checkout orchestration must use a server-only path with
  verified account ownership and existing transaction safeguards.

## Next milestones before production charging

1. An actual provider-account verification flow using merchant-owned sandbox
   credentials and an approved secret-management/key-rotation procedure.
2. Provider-specific test checkout and independently verified server status,
   with webhook signature verification, deduplication and request throttling.
3. Provider-neutral payment finality, multi-tenant merchant payout account
   check, exact amount and ISO minor-unit exponent, method, immutable
   reference, and transaction ID before a single cashbook/stock posting.
4. Reconcile late payments, stock reservation expiry, returns, partial
   refunds and chargebacks, with no silent cross-provider retries.
5. Security review, market compliance tests, demo verification and explicit
   production provider go-live approval.

The secure credential vault master key is still unprovisioned on staging;
the API correctly fails closed for TEST key writes until it is provisioned.
