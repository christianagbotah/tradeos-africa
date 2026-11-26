# TradeOS TEST provider verification evidence and cross-gateway safety
17 November 2026

## Completed design

The Paystack and Flutterwave hosted adapters can now be used from a
server-side TEST verification observer. The observer reads the merchant,
original provider, transaction reference, method, currency, amount, and
credential revision from the immutable collection attempt. It decrypts the
original business's TEST credential server-side using tenant/provider
authenticated encryption and independently queries the provider. It does
**not** use the current preference or the platform's subscription gateway.

Only independently checked **sandbox observations** are persisted in
migration 0044, which has row-level immutable audit and a unique provider
transaction identifier. An UNPAID observation may be followed by a PAID
observation, but neither changes the canonical sale/payment. A repeated
PAID observation with the same ID is idempotent; a duplicate transaction
ID for a different attempt is rejected. A mismatched provider response
moves the TEST attempt into the review queue, without posting any money.

The buyer email and redirect URL are required ONLY for hosted initiation,
not verification. Verification now uses a typed minimal payment snapshot,
instead of inventing a customer email just to satisfy adapter validation.

A read-only sandbox evidence indicator is included in the existing
merchant Payment attempt audit; the label explicitly says that a
**TEST payment observed is not a settled payment**. Auth remains
business-scoped and the browser receives no encrypted or plaintext key.

## Cross-provider duplicate-charge safety

Existing Hubtel checkouts and the global-gateway collection attempts use
different physical tables. The new migration also installs shared sale-row
locks and reciprocal triggers to reject an attempt if the other table
already holds any attempt for the same canonical business+sale. Both
server-side preparation and Hubtel initialization return an explicit
409 conflict instead of attempting an automatic cross-provider retry.
Earlier Hubtel verification remains permitted for the original provider
even after preference changes.

## Strict release limits

- No new public checkout/verification POST endpoint is exposed.
- No live merchant secrets accepted, no outbound real charging is activated.
- No sale COMPLETED, payment SUCCEEDED, stock, refund, revenue,
  cashbook receipt or payout is written by sandbox observation.
- The DB has no PAID or RECONCILED gateway-attempt state, only
  PREPARED, CANCELLED or REVIEW_REQUIRED.
- The staging encryption master key must be provisioned through approved
  private secret management before actual sandbox calls can be made.
  Do not place a key in Git, logs, chat, shared docs or web responses.
- A valid test key proves the *request's credentials*, not the merchant
  account's settlement ownership. Merchant beneficiary/payout validation,
  webhooks and signature verification, regulatory checks, late payment,
  real refunds/chargebacks and live approval remain unimplemented.

## Independent verification requirements

Paystack uses GET transaction/verify/{reference}; transaction status is
**data.status**, distinct from the HTTP/API request status. Exact
amount, channel, currency, transaction ID and reference are checked.

Flutterwave uses GET /v3/transactions/{id}/verify; only an independently
re-queried transaction whose tx_ref, amount, currency, payment_type and
provider transaction ID match the original intent can be observed as
sandbox successful. An external transaction ID is only a lookup
candidate, never proof of payment.

References:
- https://paystack.com/docs/api/transaction/
- https://paystack.com/docs/payments/verify-payments/
- https://developer.flutterwave.com/api/transactions/verify-transaction
- https://developer.flutterwave.com/docs/ghana

## Future transaction finality gates

A separate, reviewed module will need real merchant account ownership
validation, signed callback dedup, independent verified payment finality,
reservation expiry/recovery, exactly-once cashbook and stock posting,
returns and refund reconciliation, and explicit live authorization.
Do not equate an observed sandbox success to an approved live collection.
