# TradeOS Africa: Hubtel integration, security gates and competitive launch roadmap

Date: 15 November 2026. Basis: 12 user-supplied Hubtel API documents, dated 12 October 2026.

## Global money movement rules
- Never mark invoices, sales, refunds or subscriptions paid based on a browser return URL, initial checkout creation, or unsigned provider callback.
- Verify payment identity, tenant, expected amount, currency and provider transaction ID with Hubtel server-side Status Check. Hubtel requires status checking after five minutes when no final callback is received.
- Preserve unique references and idempotency across requests, server restart and callbacks; append auditable economic movements exactly once.
- Payment credentials and account numbers must be configured server-side, not shipped to browsers, apps or Git.
- Provider downtime must never block offline POS or corrupt cashbook, stock, obligations or refunds.
- No payouts, direct debit, or recurring charges without specific customer consent, role approvals, verified recipient and settlement testing.

## User-supplied Hubtel documents: implementation decisions
| Source | Main capability | Priority and guardrail |
|---|---|---|
| Online Checkout | Hosted/onsite checkout; callbacks; transaction status | P0: hosted redirect, verified status before posting |
| Checkout SDK | Android, iOS, Flutter, JS | P1: reuse hosted checkout, never expose Basic API credentials in JS |
| Direct Receive Money | MoMo wallet prompt | P1: customer wallet ownership or OTP required to prevent unsolicited prompts |
| Direct Send Money | Disbursement to mobile wallets | P2: disabled until funding, approvals, recipient verification and idempotency |
| Direct Send-To-Bank | Bank payout | P2: disabled until approved beneficiary checks and settlement rules |
| Direct Debit Money | Wallet preapproval, OTP/USSD, debit | P2: consent, revocation and audit controls; confirm ambiguous charge URL with Hubtel |
| Recurring Invoice | OTP-verified repeated debit | P2: explicit recurring mandate, cancellation and delivery notices |
| Verification | MSISDN, MoMo wallet, Ghana Card, voter ID, bank name | P1: consent, retention policy, rate limits and appropriate scopes |
| Balance Query & Transfers | Collection/disbursement balances and internal transfer | P1: balance read-only first; transfers later with dual approval |
| SMS | Single/batch/personalized, status checks | P1: explicit opt-in, templates, delivery and budget controls |
| Programmable Services | USSD, Hubtel App, Web Mall fulfillment | P2: build after core POS is proven, with fulfillment deduplication |
| Refund API | Order-level MoMo refund within 45 days | P0 adapter only; never send unsupported partial refund or book pending as completed |

## Implemented in this increment
- Hubtel API adapters for checkout creation and independent status verification already existed; now connected behind tenant authorization to a feature-flagged merchant subscription checkout route.
- A durable checkout-attempt ledger and exclusive advisory lock prevent duplicate provider initiation across API processes. The backend determines invoice amounts and trusted callback/return URLs.
- An unsigned callback ingress acknowledges receipt but intentionally cannot post financial movements. Only independent status verification can settle an invoice.
- A verified paid status is posted through the existing idempotent subscription payment ledger. Unknown/unpaid/refunded statuses do not get treated as a new paid payment.
- Owner, admin and accountant billing UI can start and verify an invoice checkout only when server configuration says collections are enabled.
- Refund adapter validates an eligible full-order MoMo refund with at least ₵1.00 and original payment age at most 45 days. It returns a pending result; no refund ledger write or public payout endpoint.
- Unit/integration tests cover money invariants, tenant scopes, initial provider response, duplicate attempts and subscription reconciliation.

## Not yet ready: hard launch gates
1. Verify the real TradeOS Hubtel collection account, API ID/key and permissions. Provision server-side secrets without putting them in Git or support messages.
2. Whitelist the VPS public egress IP for Hubtel Transaction Status and other protected endpoints; verify reverse-proxy forwarding of Hubtel callbacks. The callback path is not equivalent to financial confirmation.
3. Implement scheduled server-side verification after five minutes without callback. Today, the authenticated billing Verify action must be used manually.
4. Run successful, failed, delayed, duplicate and spoofed payments in a nonproduction merchant environment. Reconcile provider settlement reports and actual bank/MoMo balances.
5. Finish **customer-sale** payment links and receivables, then store provider verified source references in the sale-payment ledger. Subscription checkout is not a full POS gateway.
6. Implement refund order mapping, separate refund verification ledger, return approvals and settlement. Hubtel reference does not provide an amount parameter for partial refund.
7. Validate clear subscriptions lifecycle after payment, customer notification, refunds and cancellations. A paid invoice is not automatically permission to add arbitrary entitlements.
8. Publish native mobile only after offline reboot recovery and stores certification, plus printing/document tests.

## Competition differentiation
P0: first-sale onboarding under ten minutes; CSV/XLSX stock import; printable invoices, purchase orders, quotations, QR and thermal receipts; safe offline resync; verified payments; real merchant pilots.
P1: industry-specific setups for salons, hardware, drinking spots and food preparation; stock conversions, recipes and wastage; contextual AI owner questions with evidence; permissioned purchase-order drafts; Twi/Ewe voice UX.
P2: permissioned market-price benchmarks, sourced demand forecasting, opt-in SMS reminders, balance/credit intelligence, native app distribution and merchant analytics.

Measure first-week activation, 7/30-day merchant retention, lost/duplicated transaction rate (target zero), real reconciliation accuracy, time-to-first-sale and support resolution time. Never advertise an untested module as production-ready.

## Server-only feature flag defaults
TRADEOS_HUBTEL_SUBSCRIPTIONS_ENABLED=false
TRADEOS_HUBTEL_API_ID=(set privately on the VPS)
TRADEOS_HUBTEL_API_KEY=(set privately on the VPS)
TRADEOS_HUBTEL_COLLECTION_ACCOUNT=(verified merchant collection account)

Default must remain disabled until all gateway approvals and UAT are complete.
