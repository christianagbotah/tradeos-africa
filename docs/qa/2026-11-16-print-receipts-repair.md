# TradeOS Africa — printing and blank receipts hotfix
16 November 2026 · Lightworld Technologies Ltd.

## Incident
Merchant reported that print previews did not load and some receipts were blank.
Investigation of code at deployed commit `4949972` identified:
1. Sales from Sales history and checkout opened receipt pages with
   `window.open(path, "_blank", "noopener,noreferrer")`; popup-blocking
   mobile browsers and desktop WebViews can suppress this new window.
2. All three document CSS modules used `body:has(...)*{visibility:hidden}`
   and then tried to restore visibility on the printable article. In nested
   grid/flex app shells or Chromium print previews this can produce a blank
   or clipped page. Their fixed/absolute-positioned print articles could
   also overlap and truncate multi-page documents.
3. Customer receipts were blocked after sale status changed to
   `PARTIALLY_REFUNDED` or `REFUNDED`, despite the original completed sale
   and refund records still being available.

## Fix
- Customer receipt links use **same-tab navigation** from POS success and sale
  details; no popup dependency. The receipt has a Back to Sales link.
- Print CSS on the authenticated app shell switches to a single-column document
  flow, hides navigation controls by `display:none` and keeps the document
  in normal flow. No descendant visibility blanket; sales receipts print at
  76mm document width while commercial documents and POs use A4 and can span
  multiple pages without fixed/absolute positioning.
- Customer receipts for originally completed but later refunded sales display
  clear `PARTIALLY REFUNDED` or `SALE REFUNDED` status and line-by-line
  payment/refund amounts. Original sale total is not rewritten; pending
  purchases/payments and offline/unverified sales remain blocked.
- Cross-tenant verified server reads and authenticated print eligibility
  remain unchanged. This is not automatic payment confirmation or
  unsupervised sending by email/WhatsApp.

## Verification
- `lib/receipt-document.test.ts` covers completed sale, refund states,
  original completion requirements, pending payments, credit, and date format.
- `app/components/workspace/print-layout-regression.test.ts` asserts all
  three printable routes expose the printable article, use normal-flow
  print layout, avoid blanking ancestor trees, and no longer use popup tabs.
- GitHub Visual QA starts an isolated DB, uses genuine authenticated API
  operations to create one completed cash sale, issued quotation and issued
  supplier PO, then uses Chromium on **each real browser route**. It checks
  document visibility, nonzero dimensions, hidden sidebar, business content
  and cedi totals, and generates print PDFs. When `pdftotext` is available
  it additionally checks document text extracted from the actual PDF.
  PDFs are captured as CI artifacts for manual review; never uploaded with
  real tenant data.
- Verify merchant route `/sales/receipt/:id`, `/documents/:id` and
  `/purchase-orders/:id` in a desktop browser, mobile browser and
  80mm receipt printer (if available).

## Honest limits
- Printing requires a successfully authenticated browser session and a
  completed/issued document. Invalid, unissued, unpaid or foreign-tenant
  references show a readable unavailable state instead of a printable
  document.
- This changes document print UX only; it does not address unrelated
  invoice tax compliance, printer driver selection, or external email and
  WhatsApp provider delivery. Those remain tracked separately (#143).
