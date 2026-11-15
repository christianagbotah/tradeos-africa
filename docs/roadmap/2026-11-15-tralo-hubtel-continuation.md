# TradeOS Africa vs Tralo — 15 Nov 2026 continuation and Hubtel integration gates

## Source / authorized scope
This programme continues the user-approved **Configure Email Sending** project conversation, including the Tralo feature comparison and twelve supplied Hubtel documents. Continue the broader competitive programme, not just printing receipts.

## Competitive positioning
TradeOS Africa already goes beyond Tralo in multi-business/multi-branch roles, resilient offline-first sales, bulk-to-unit conversion, returns/refunds/exchanges, cashbook and AI conversational business analysis. Competitive gaps in the comparison:
- Quotations, proforma invoices, regulated tax invoices, purchase orders, print/email delivery and customer documents.
- Reliable real payment collection (Tralo Pay / Paystack comparison), subscription onboarding/billing, and payment-status verification.
- Accessible/free-core merchant onboarding, imports/migrations, simplified first-run registration.
- A weekly trade index / market comparison with defensible, permissioned, aggregated data and clear non-representativeness warnings.
- Forecasting, alerts, multilingual AI, printer/scanner/cash drawer support, offline certification, Android/iOS distribution.
A future index must not fabricate market benchmark numbers or leak individual merchant sales.

## Hubtel supplied documentation and observed state
The user supplied 12 Hubtel API references, including Direct Receive Money, Transaction Status, Online Checkout, Direct Send Money/Send-to-Bank, Direct Debit, Quick Send SMS and mobile money Refund. Hubtel Sales APIs use Basic Auth. Direct Receive Money requires a security mechanism against unsolicited phone prompts (e.g. registered authenticated payer or phone OTP). Direct endpoints and status APIs require provider-side merchant authorization and allowlisted VPS egress IP. Hubtel documentation mandates a Transaction Status check if no callback arrives after five minutes, after provider authorization is active.

Previous VPS integration observation: hosted Online Checkout succeeded for a test ₵1.00 request (no payment completed); **Transaction Status returned 403**. Do not confuse checkout initiation with confirmed payment. Prior SMS accepted a test request and the user confirmed receiving the SMS, but delivery lookup returned 404; do not represent acceptance as verified delivery. Mobile money refunds are limited to the original Hubtel order and eligible payments within 45 days, with IP allowlisting. Live merchant collections are feature-flagged OFF. The existing deployment already separates platform subscription proceeds and merchant sale collection accounts and will not accept unauthenticated callbacks as proof of settlement. Credentials were configured securely on the VPS; never reveal secret values or move them into Git or web application responses.

The Variety Groceries deployment and its Hubtel integration are independent of TradeOS Africa. Do not copy credentials or re-use merchant accounts across them.

## Development track and gates
1. **Documents, phase 1 (this feature branch):** tenant-specific catalog-priced quotations and proforma invoices with draft/issue/cancel, idempotent creation, sequential annual numbers, immutable snapshots, customer selection, print and audit. No stock, debt or cashbook postings. Proforma is **not** a regulated tax invoice, receipt or confirmation of payment.
2. **Documents, phase 2:** customer purchase orders, supplier purchase orders, taxes/discounts, credit-note workflow, approved quote-to-sale and tax invoice workflows compliant with Ghana requirements. Add PDF/email delivery with opt-in and delivery audit trail, not implied automatic sending.
3. **Hubtel blocker:** get the merchant-specific Transaction Status service authorized/allowlisted and verify the exact merchant collection-account permissions with Hubtel; no real activation until that succeeds. Implement due-at (five-minute) reconciliation with provider outage/retry controls, cancellation/expiry stock valuation reversals, concurrent late-payment safety, refund reconciliation; see issue #134. Obtain approval and pass settlement pilot.
4. **Competitive weekly intelligence:** weekly trade trends, business-only comparisons and anonymized aggregated index, opt-in minimum-sample guardrails, source confidence, honest reporting of sparse samples.
5. **Growth:** registration friction, initial catalog import, stock migration validation, simple starter pricing, printable labels/barcodes, fast phone-first training.
6. **Cross-platform:** offline mutation acceptance/rejection/retry tests, device-based QA, cash drawer/printer/scanner drivers, Android/iOS release review, store listing and permission audits.
7. **Advanced AI:** forecast demand and stock-outs, explain revenue drivers with auditable evidence, multilingual local-language UX, only on authorized business data.

## Release verification
- Apply new SQL migration in a disposable PostgreSQL before any staging migration. Do not manually seed or change production customer data.
- API integration tests require a temporary test database; never run their TRUNCATE setup against TradeOS staging or production PostgreSQL.
- CI full test, typecheck, build and Visual QA must pass. Rollout through the same immutable SHA deployment pipeline and confirm local/public health and rollback record.
- Do not deploy Hubtel POS live flag just to make tests pass; configuration and provider access are independent gates.
