# TradeOS Africa — verified sales documents (2026-11-15)

## Scope
- New authenticated `/sales/receipt/[saleId]` route re-reads the canonical sale record, including exact line taxes and recorded payments.
- From completed Sales details and online checkout, `Print receipt` opens this isolated document instead of printing the POS shell. A dedicated 76-mm print layout also supports the browser's PDF printer.
- Printed details include the business and branch contact, 8-character display reference and full UUID audit reference, Ghana-style dd/mm/yyyy date, quantities, item amounts, payment methods, taxes and subsequent refunds. Money uses TradeOS currency metadata (`₵` for Ghana cedi).
- Statuses other than COMPLETED, unsynced offline mutations, pending Hubtel payments and incomplete data cannot produce a final receipt. Browser print on the blocked route never contains a valid receipt.
- A customer-credit sale is explicitly labeled **CREDIT SALE RECORD / PAYMENT DUE**, not a paid receipt. Customer credit is excluded from recorded money collected.
- Merchant POS collection is still feature-flagged OFF until its separate live readiness gates pass; these receipt updates do not enable Hubtel.

## QA
- `pnpm --filter @tradeos/web exec vitest run lib/receipt-document.test.ts`
- `pnpm --filter @tradeos/web typecheck` and `pnpm --filter @tradeos/web build`
- `pnpm --filter @tradeos/api typecheck`
- Manual pilot: open a completed cash sale, print 80-mm/PDF; compare line totals, taxes, credit and refund figures against Sales. Confirm unpaid Hubtel and offline queued sales have no final receipt action. Validate on mobile and Chrome/Firefox before merchant rollout.

## Not included
- This is not a tax-authority-certified electronic VAT invoice, an emailed document or a WhatsApp-delivered customer receipt. Official fiscal invoice numbers, QR verification, tax documentation and delivery workflow require a separate implementation and jurisdictional review.
