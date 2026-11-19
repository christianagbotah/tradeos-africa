# Hubtel merchant payment reconciliation and review protocol

## Source and reason
Continues the user's TradeOS Tralo comparison and twelve Hubtel documents in
the Configure Email Sending conversation. An initiated checkout does not prove
payment. Hubtel requires transaction status checks after five minutes when a
final callback is not available; its merchant status API currently returned
403 from the VPS and must be authorized/allowlisted by Hubtel.

## Controls implemented
- Migration 0032 adds status check attempts, timestamps, next due, error and
  manual-review checkpoints to each merchant checkout.
- Every 60 seconds a bounded worker checks eligible cases after five minutes.
  A PostgreSQL session advisory lock prevents parallel schedulers running
  the same batch; the default batch is 12, maximum 25.
- UNPAID and provider outages retry after five minutes with exponential
  backoff capped at one hour. No failure result creates a cashbook receipt.
- Missing/uncertain PREPARED checkouts are escalated after 15 minutes, not
  restarted blindly; unresolved payment after 24 hours is escalated.
- Provider REFUNDED, response mismatch and invalid status are sent for review.
  A verified late PAID result can still settle an escalated sale exactly once.
- Read-only business-scoped monitor shows attempts, due times and review reasons
  at /payments/hubtel, linked from Operations. The endpoint returns no merchant
  credentials, collection account number or untrusted callback payload.
- Separate kill switch: TRADEOS_HUBTEL_POS_RECONCILIATION_ENABLED=false.
  By default the worker is off whenever TRADEOS_HUBTEL_POS_ENABLED is off.

## Critical limitation
The sale creation path currently consumes stock and valuation before remote
payment confirmation. Do NOT restore stock or cancel a PENDING sale on the basis
of an UNPAID status, expired period or HTTP 403. Those are insufficient
guarantees of payment finality. Accordingly the worker **does not cancel sales,
restore inventory, alter inventory valuation or post refund entries**. Cases
needing resolution remain in REVIEW_REQUIRED with OPEN sale/PENDING payment
until a safe late-payment/cancellation state machine is completed under issue
#134. Review checkout URLs are hidden to discourage duplicate payment.

## Production requirements before live activation
1. Authorize and allowlist the VPS outbound IP with each merchant's Hubtel
   Retail Systems Engineer for Transaction Status and Refund API services.
2. Validate the correct merchant collection account and Basic Auth keys in a
   controlled provider pilot. Platform subscription keys must remain separate.
3. Complete issue #134: atomic restoration of stock, components, valuation
   and cost flows, verified finality, expiry/cancel concurrency and late-payment
   fallback. Do not use an UNSIGNED callback as proof of payment.
4. Verify refund order eligibility (Hubtel's documented 45-day API limit),
   accounting reversals, network failure and duplicate notifications.
5. Validate audit, offline reconnection, merchant visibility and independent
   payment-status lookup using mocked credentials in an isolated test DB.

The global live merchant POS switch remains disabled by default. Provider
HTTP 403 is an access/authorization failure, never proof of failed payment.

## Overdue unpaid checkout visibility (19 November 2026)

The merchant reconciliation page now shows unverified open checkouts older than
24 hours, using database time rather than an untrusted browser clock. It also
shows *pending checkout face value*, grouped by currency, for the whole selected
branch including attempts outside the recent-50 display. This is **not inventory
valuation**, settled cash, or an instruction to refund the customer.

Only OPEN sales with PENDING payments and non-reconciled Hubtel attempts are
included. The summary deliberately includes cases already escalated to
REVIEW_REQUIRED. Staff can independently verify a transaction with Hubtel, or
escalate for review; a provider timeout, 403 response, or an UNPAID status does
not prove funds cannot arrive later. Neither the report nor the visibility
feature cancels sales or releases stock.

The remaining release gate is a provider-confirmed finality contract and an
audited, exactly-once reversal implementation covering simple stock, multi-part
recipes, valuations, COGS, concurrent verification and late provider success.
**Keep live merchant collections disabled until that gate and merchant pilot
are passed.**
