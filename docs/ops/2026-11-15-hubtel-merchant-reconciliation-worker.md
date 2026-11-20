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

## Read-only cancellation impact preflight (19 November 2026)

An authorized owner, administrator, manager or accountant can inspect a
specific Hubtel checkout from the merchant reconciliation page via
`GET /v1/sales/:saleId/hubtel/cancellation-preflight?businessId=...`.
The response is private, no-store and strictly business-scoped.

The preview reads the original sale line costs, and exact eight-decimal stock
movement quantities referencing those sale lines. It includes the original
consumption for stock products and each recorded service/recipe component,
identifies source movement mismatches and flags component-specific valuation
review. It is a current **read-only assessment**, not a guaranteed immutable
reversal plan; a concurrent payment verification can change the sale state.

**Every assessment returns `canReleaseStock: false` and
`permission: REVIEW_ONLY`.** No checkout cancellation, inventory or valuation
restoration, cashbook posting, payment mutation, or new Hubtel network call is
performed. The provider status API does not by itself prove that an old
`UNPAID` checkout can never settle later. A sale being old or in
`REVIEW_REQUIRED` is not cancellation proof.

Remaining implementation gates: obtain explicit provider-guaranteed finality
or a documented void/expiry mechanism, then design an idempotent,
transactional full reversal of source stock movements, their historical
valuation/COGS (including individual recipe components), the pending payment,
and OPEN sale. Validate concurrent verifier/canceller races and post-cancel
late-settlement handling. Do not enable live collections or stock-release
controls until those gates and a merchant pilot pass.

## Exact original stock-cost allocations (20 November 2026)

Migration 0055 introduces immutable `sale_stock_cost_allocations` records
(one original inventory movement per row), with the source quantity and
historical cost at the moment stock was consumed. Every new product sale and
every stock-consuming service/recipe component writes its allocation in the
same database transaction as the sale and inventory movement. A database
trigger rejects records that do not match the original business, branch,
sale line, item, unit, quantity and negative stock movement. Attempts to
change or delete original cost allocations are rejected.

The read-only Hubtel cancellation assessment joins these allocations against
the original journal and verifies that the per-component cost totals match
each sale line's recorded historical cost. Merchants see amounts per component,
not a reconstructed estimate based on today's moving average. For **legacy
sales** made before this migration, missing evidence remains explicitly
unavailable and is shown as a review blocker; there is no automatic backfill
or invented cost allocation.

This change **does not release inventory, void Hubtel orders or reverse
cashbook, customer balances, COGS or taxes**. An authenticated Hubtel status
of UNPAID alone is not an irrevocable provider void. Before any future
cancellation button or job is enabled, require the provider's verified
finality contract, dual-path concurrency/idempotency testing and the full
transactional compensation protocol. Keep live POS merchant collections gated.

## Provider cancellation investigation requests (20 November 2026)

Hubtel's currently published v1 Online Checkout documents the checkout-creation
operation and a status-check API but does **not** document a guaranteed
merchant-side hosted-checkout void/expiry operation. Its status guide says
`Unpaid` alone does not distinguish a payment that is pending, failed or
expired. The hosted-checkout `cancellationUrl` only sends a customer's
browser back to a page; it is **not** payment cancellation proof.

For a pending sale, an authorized business OWNER, ADMIN, MANAGER or ACCOUNTANT
can open the stock-impact assessment and submit a reasoned request for provider
investigation (20–700 characters). The server endpoint is
`POST /v1/sales/:saleId/hubtel/cancellation-investigation`, with the
authenticated `businessId` and `note`. The server locks sale, payment and
checkout in the same order as the independent paid verifier, checks strict
tenant/branch/payment consistency and records at most one immutable case per
sale. Concurrent retries and repeated calls return the same case, and the
request is audited once. The request appears in the preflight.

**This is an investigation request, not a checkout cancellation.** No provider
cancellation is claimed, no inventory or valuation changes are posted, and no
cashbook or payment status is changed. A paid sale cannot open a new case.
A prior request is a historical record even when Hubtel later confirms payment.

Outstanding launch gate: Hubtel must document or expressly supply an
authenticated provider-side cancellation/expiry confirmation that guarantees
the reference cannot subsequently settle, with a late-settlement recovery
policy. Only then can a separately controlled exact-once stock/valuation/COGS
compensation module be considered for rollout. Global Hubtel POS collection
must remain disabled until production-grade reconciliation and merchant pilot
have passed.

References: https://code.hubtel.com/docs/guides/online-checkout and
https://code.hubtel.com/docs/guides/reconciliation (retrieved November 2026).
