# TradeOS Africa — Supplier invoice matching (15 November 2026)

This work continues the user's *Configure Email Sending / Tralo competitive parity*
programme (#136) on top of issued Purchase Orders (#139) and partial receiving
(#140). It adds a controlled **invoice reconciliation document**, rather than
creating a second stock receipt, supplier liability or payment.

## Merchant workflow

1. Create a supplier purchase order with items, units, quantities and PO prices,
   issue it, and physically receive some or all goods.
2. Open the PO preview and find **Match supplier invoices** under the printed
   purchase-order document. The section is excluded from the printout.
3. Select one or more posted delivery receipts covered by the supplier's
   invoice. The same receipt cannot be claimed by two active invoice matches.
4. Enter the supplier's own invoice number and date, and **actual invoice total**
   in ₵ (including any charges or tax shown, which are NOT automatically
   accounted for in this phase).
5. Review the receipt total, invoice difference and goods-received cost versus
   original purchase-order unit price by item.
6. Save as **DRAFT**. Only OWNER / ADMIN / MANAGER can approve. If invoice totals
   or PO prices differ, manager justification with at least 12 characters is
   required; a variance is not silently accepted.
7. If incorrect and still draft, cancel. The receipt claims are released so a
   corrected invoice can be submitted. Approved records cannot be cancelled
   through this workflow.
8. Previously posted receipts continue owning actual inventory changes,
   supplier payable ledger postings and settlements. **Approval of an invoice
   match does NOT write another payable, stock adjustment, cashbook entry,
   payment, or tax posting.**

## Isolation and audit

- Business-scoped request IDs and content fingerprints guarantee idempotent
  invoice capture across retries.
- Each supplier invoice number is unique case-insensitively within the active
  supplier invoice match records of one business; cancelled drafts can be
  corrected and re-registered with the same number.
- Business, supplier, branch and PO scope are checked before receipt claiming;
  receipt references are additionally bound by database foreign keys and
  cross-business trigger.
- Concurrent registrations of one receipt are protected by a database primary
  key. A PO row lock stabilizes selected deliveries while reconciling.
- Event trail records creation, manager approval and cancelled drafts.
- All 15 Nov 2026 date labels use DD/MM/YYYY for merchants.
- No provider-specific Hubtel collection or refund code is activated.

## Economic validation cases

1. Two deliveries of the same PO, matched separately, must show original
   quantity and actual cost without adding or subtracting inventory twice.
2. A supplier invoice with exactly the receipt total, and no change from PO
   unit prices, can be approved without an exception note.
3. A changed receipt cost and/or invoice total must be visible, retained and
   require a manager explanation on approval.
4. Verify the same receipt cannot be added to another invoice.
5. Duplicate supplier invoice numbers (including case changes) are rejected.
6. A lost response retried with the same clientRequestId and payload replays
   the same match. A changed payload with that ID is a conflict.
7. Wrong-business receipt or PO lookup never reveals or allocates another
   tenant's goods; missing invoices cannot be approved.
8. Cancelling DRAFT releases claims but never reverses stock/payables.
   Approved matches are immutable to prevent off-ledger changes.
9. Matching against a PO with *partial* receipts is allowed: only delivered
   quantities and actual received amounts are compared.
10. Verify invoice match approval causes zero additional changes to
    `purchase_lines`, `inventory_movements`, `inventory_valuations`,
    `supplier_payable_ledger`, `supplier_credit_obligations` and
    `cashbook_entries`.

## Deliberate limits and further work

This release is **invoice-header/receipt-line reconciliation**. It does **not**
yet digitize supplier invoice itemized lines or Ghana-certified fiscal invoices;
invoice taxes, discounts, freight and credit notes need separate controlled
posting and compliance review. Where supplier tax is reflected in the invoice
total, the difference remains flagged for manager review, not auto-posted.
A reviewed invoice does not mean the supplier has been paid or that all
outstanding tax and billing liabilities are settled.

Next: invoice-line itemization and real three-way PO ↔ receipt ↔ invoice
line matching; invoice attachment capture/OCR with human validation; controlled
supplier email/WhatsApp deliveries; supplier credit note and disputed invoice
resolution with accounting journal adjustment approval. Hubtel merchant POS
remains OFF pending #134 finality and valuation reversal.
