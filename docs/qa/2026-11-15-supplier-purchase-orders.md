# Supplier Purchase Orders — TradeOS Africa UAT (15 Nov 2026)

## Scope and competitive parity
This is the distinct supplier purchase-order document workflow requested during
TradeOS Africa's Tralo comparison. It is separate from the existing Purchase
Receipts/Receiving feature. Order creation or issuance is not receiving stock,
not a supplier bill, not settlement and not a tax invoice.

First phase implements:
- Merchant-scoped numbered PO-YYYY-NNNNNN documents; annual sequences.
- Supplier/business/branch snapshots, line item purchasing units, quantity,
  unit cost and server-calculated totals, notes and expected delivery date.
- Draft, issue and cancel lifecycle, auditable and idempotent creation.
- An authenticated PO preview that prints an A4 document and offers Save PDF.
- Explicit high-contrast total amount (white on navy) in preview and
  printable black text on white paper.
- A permanent single-row editor: number, item, purchase unit, quantity,
  unit cost, line total and remove; scroll sideways on narrow devices.
- A purchase-orders entry button in Purchases & Suppliers.

## Accounting and security
A PO never writes to purchases, purchase_lines, inventory_movements,
inventory_valuations, supplier_payable_ledger or cashbook_entries. This
prevents supplier commitments appearing as received stock or paid expenses.

Only OWNER/ADMIN/MANAGER/INVENTORY can prepare documents. Only OWNER/ADMIN/
MANAGER can issue/cancel them. Other authorized business staff may read.
API checks supplier, branch and catalog item/unit against the authenticated
business before storing them. Postgres additionally enforces line-item tenant
scope. PO numbering and clientRequestId conflicts are serialized and safe on
lost/retried network responses.

## Manual UAT instructions
1. Open Purchases & Suppliers, then Purchase orders.
2. Choose an active supplier and optionally a delivery date.
3. Add two catalog products with purchasable units, quantity and unit costs.
   Observe that selecting a product NEVER creates a second field row.
   On a narrow phone, swipe the row horizontally to find cost and remove.
4. Create draft. Confirm PO number, supplier snapshots and all line amounts.
5. Select Preview and verify the amount is bright white above the navy header.
   DRAFT is clearly marked and cannot be printed as an issued order.
6. As an OWNER/ADMIN/MANAGER, issue the draft; open preview and Print /
   Save as PDF. Confirm date format DD/MM/YYYY and clear ₵ formatting.
7. Cancel an order; it cannot be reissued. Read-only staff cannot issue.
8. Verify stock, supplier payables and cashbook remain unchanged.
9. Simulate a lost response using same clientRequestId: no duplicate order.
   Reuse same ID with different content: explicit HTTP 409.
10. Verify business B cannot list or read business A's POs.

## Follow-up deliverables
- Draft editing with optimistic concurrency and approval/authorization history.
- Linked goods-receiving against PO lines, including partial receipts, batch/
  serial traceability, delivery discrepancy checks and supplier return paths.
- Configured taxes, discounts, delivery charges, attachments and supplier
  price lists; do not claim tax compliance without Ghana regulatory review.
- Controlled supplier delivery by email/WhatsApp with consent and audit logs;
  do not mark messages as sent on draft creation.
- AI demand forecast and suggested PO drafts with human review, tied to
  actual replenishment rules and stock availability.

Provider Hubtel POS merchant payments remain OFF until issue #134 closes.
