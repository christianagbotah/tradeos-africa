# TradeOS Africa — Hubtel POS by merchant (2026-11-15)

## Why this exists
Merchant POS collections and Lightworld's TradeOS subscription revenue are not the same money.
Every business tenant must use its own individually verified Hubtel collection account.
Do not provision all merchants with the platform subscription account. Do not allow payments
until ownership, settlement and legal responsibilities are verified with Hubtel.

## Implemented (feature-flagged; OFF by default)
- A business-scoped Hubtel sales gateway table records collection account, secret alias,
  and independently approved verification state; credentials are never stored in SQL,
  returned by the API, nor committed to Git.
- A collection account can belong to only one TradeOS business. The platform subscription
  account is explicitly forbidden for merchant sales.
- A trusted configured merchant creates a **pending** Hubtel MoMo order online. The
  POS backend prices and reserves stock, but does not mark the sale complete, post
  cashbook money or send a final receipt before payment confirmation.
- Idempotent merchant checkout initiation references the existing sale and payment.
  A provider request with ambiguous outcome is not retried blindly.
- Unsigned callbacks are acknowledged but NEVER settle sales. A separately authenticated
  verification call uses Hubtel's status API, requiring exact reference, currency, amount
  and provider transaction ID before updating payment, sale and cashbook atomically.
- Sales history shows unpaid orders and a resume/verify action; the sales revenue KPI excludes
  unpaid orders. Unpaid orders cannot issue final receipts or initiate returns from details.

## Release gates: required BEFORE enabling TRADEOS_HUBTEL_POS_ENABLED=true
1. Confirm Hubtel permits each business to use its own API ID/key for its own collection
   account, and that each account has the required direct checkout/status scopes.
2. Confirm merchant and Hubtel agreement on legal merchant-of-record, refund, taxes and
   settlement, including whether any platform commission is allowed. No shared wallet.
3. Approve merchant onboarding and platform-only ownership verification. The database
   row may only become enabled after authorization. The app intentionally exposes no
   self-service endpoint to mark an account VERIFIED.
4. Put per-merchant API credentials in a protected server secret variable
   TRADEOS_HUBTEL_POS_CREDENTIALS_JSON keyed by opaque alias. Never expose in UI or Git.
   Example structure (NO REAL SECRETS):
   {"merchant_alpha":{"apiId":"<private>","apiKey":"<private>"}}
   Protect access and set strict file permissions on the VPS.
5. Whitelist the VPS egress address for Hubtel's transaction status API. Test callbacks,
   network outages, duplicate attempts, spoofed callbacks, altered amounts/currencies,
   late success, refund and reconciliation, with Hubtel's test/sandbox account.
6. **Complete stock reservation expiry and cancellation policy.** Pending orders reserve
   stock/consume COGS before payment; cancellation must reverse inventory and valuation
   only after independently ruling out a late provider success. Currently there is NO
   automated expiry/cancel endpoint. This is a **hard blocker** for unrestricted activation.
7. Add a protected server-side due-at reconciliation worker (Hubtel requires status checks
   for missing callbacks after five minutes). Today authorized staff can manually Verify.
8. Validate that payment success creates one cashbook entry, one invoice/receipt and no
   duplicate sale; review partial refunds and full-order Hubtel refund constraints.
9. Run manual merchant pilot and real funds reconciliation; obtain launch approval.

## Environment gates
TRADEOS_HUBTEL_POS_ENABLED=false
TRADEOS_HUBTEL_POS_CREDENTIALS_JSON=<secure server-side mapping>
TRADEOS_HUBTEL_COLLECTION_ACCOUNT=<platform subscriptions only>

Merchant accounts are registered in business_hubtel_sales_accounts by a privileged,
audited provisioning process. Do not insert placeholder or test accounts into
production or enable live transactions by setting only the global flag.

## Follow-up implementation
- Admin-verified merchant connection onboarding and test-transaction consent.
- Cancel/expire unpaid sale with exactly-once stock and valuation reversals.
- Automated five-minute status reconciliation with provider outage backoff.
- Customer receipt/QR payment link, notifications with consent, settlement reports,
  charge fee allocation and GST/VAT treatment as legally applicable.
- Refund event and payout reconciliation scoped to the owning merchant Hubtel order.
