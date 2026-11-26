# TradeOS Africa — itemized supplier invoice matching & private evidence UAT
16 November 2026 · Lightworld Technologies Ltd.

## Delivery scope

This extends the issued Purchase Order → goods receipt → supplier invoice
matching sequence from PRs #139, #140 and #141. Users now enter each invoice
item's **invoiced quantity and unit price** against the genuine selected
receipt lines, see exact server-generated variances, and attach supplier
evidence privately. No stock, AP, tax or cashbook amount is posted twice.

### Three-way invoice item comparison

For each line the server snapshots:
- Original supplier purchase-order item/unit/unit price and expected line cost.
- Quantity physically received and actual receiving cost from selected,
  authenticated and tenant-scoped purchase receipts.
- Supplier invoice quantity, supplier unit price and calculated line total.
- Quantity difference (invoice minus actual receipts), value difference
  (invoice item line cost minus actual receiving cost), PO unit-price variance.
- Header total versus sum of itemized invoice lines: the residual is labelled
  **Other charges or discounts**. It is an exception, not automatic tax posting.

Server *requires every product line from the selected receipts* to be
represented once in a new itemized invoice; missing, duplicate and foreign
PO-line IDs are rejected. Qty 0 is allowed to make omitted billed items
visible as an exception. All amounts are in safe integer minor units;
quantities have at most eight decimal places. The manager must give >=12
characters explaining **any** item exception, invoice difference, PO price
difference, or other charges/discounts. Approval is immutable and remains a
reconciliation decision, not a second accounts-payable journal.

Old header-only matches (created before migration 0036) remain readable and
retain their existing approval rules. The merchant editor always uses the new
itemized matching route.

### Private supplier invoice evidence

Invoices can hold up to **three** files, each at most **3 MiB**, while DRAFT.
Files are PDF, PNG or JPEG, content-sniffed on the server; a renamed HTML/SVG
file is rejected. No SVG, executable files or URLs are accepted. The client
supports Android pickers that omit MIME types by deriving the *declared* MIME
from the file extension; the API still verifies actual file bytes.

Storage is in a tenant-scoped PostgreSQL bytea evidence table, distinct from
TradeOS's **public** business-logo/avatar image service. Every download
requires an authenticated business role. Reply headers require a file
download, private/no-store caching, nosniff and sandbox. Owner/admin/manager/
accountant/inventory can view; only those roles can add/remove while DRAFT.
After approval, files are immutable. Wrong-tenant and anonymous access
returns 404 / 401; duplicate exact uploads reuse the existing evidence ID.
Removing a draft file leaves an audit record. No file content is logged.
Conservative DB storage is sufficient for limited attachments; large-volume
storage should later be migrated to an encrypted private object store with
retention policies and malware scanning.

## User acceptance walkthrough

1. Login as merchant owner, navigate to Purchase Orders and create an order
   with two products (including a multi-unit product, e.g. box of screws).
2. Issue the PO. Verify issuing creates no stock or supplier debt.
3. Receive a partial delivery using the PO-linked **Receive delivery**
   action. Check actual stock movements and one supplier payable posting.
4. On the same PO choose the received receipt under Match supplier invoices.
   The new item table displays received quantities and original PO prices.
   All columns stay on one row; scroll sideways on mobile.
5. Enter supplier invoice quantity and price for each item exactly as on the
   supplied document. If quantities/prices differ, the exception count and
   highlighted differences should change.
6. Enter invoice reference/date and header amount. Check line subtotal and
   additional charges/discounts calculation. Save a match DRAFT.
7. Attach a valid PDF or photo. Download it; verify it opens from an
   authenticated response, NOT a public URL.
8. Try a wrong MIME file (e.g. HTML disguised as PDF), a 4 MiB file, or a
   fourth document: all are rejected without changes.
9. Correct an erroneous draft document by **Remove**, upload replacement.
10. Approve exact match without a note; approve a discrepancy only after a
    manager writes an adequate reason. Verify no additional payable, inventory,
    valuation, tax or cash posting on approval.
11. Try to change evidence on approved match: both upload and removal blocked.
12. Reuse the same request ID with changed item quantities/cost: conflict.
    Retry same payload: original match returned without double counting.
13. As another tenant, or without authentication, attempt to preview the
    invoice items or download evidence: rejected.
14. Try older unitemized invoice matches created before upgrade: still
    readable; the itemized table only appears on new invoices.

## Deliberate limits / next implementation

This is genuine PO↔receipts↔invoice line comparison, **not** automatic
payment of supplier invoices, accounting tax treatment, or certified
Ghana fiscal invoices. Manager approval records the reconciliation decision.
Any monetary adjustment requires a separate approved journal feature.

The application currently has no vetted transactional supplier email/
WhatsApp delivery integration. Do not mark documents SENT or disclose private
invoice files through unauthenticated URLs. Next should implement sender
identity, recipient consent, message queue/idempotency, delivery attempts
and provider status, audited per-tenant. Hubtel merchant POS collections
remain OFF pending issue #134.
