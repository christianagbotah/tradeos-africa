# Saved purchase-order draft editing — operational acceptance

## Scope

An authorized Owner, Admin, Manager or Inventory staff member can open a
saved purchase order while its status is **DRAFT**, then edit the supplier,
expected delivery date, notes, and purchase lines. No new payment or stock
movement is added. Issued and cancelled orders are immutable, including
orders with posted receipts or pending supplier-document deliveries.

## Test cases

1. Create an unissued draft with two catalog products and supplier prices.
   Open its Preview, then **Edit saved draft**. Confirm all saved lines,
   purchasing units, quantities, costs, notes and delivery date are populated.
2. Change an item or purchasing unit and confirm the old cost clears. Change
   the supplier and confirm *all* previously quoted costs clear. Ensure the
   Save button remains disabled until each line has an explicitly entered cost.
3. Change quantities, add or remove a line, set delivery date and notes, then
   save. Verify the original PO number and branch remain unchanged, the
   revised server total, supplier and lines appear in the preview, and the
   status remains DRAFT.
4. Verify explicitly entered zero supplier cost is allowed, but a blank
   cost, invalid buying unit, archived product, invalid quantity, or unsafe
   total is not allowed.
5. Open the same draft in two separate sessions. Save from the first, then
   try to save an older draft from the second. The second must get a 409
   conflict and must **not** overwrite the new document. Reload prompts to
   confirm discarding unsaved local changes.
6. After issuing a draft, verify **Edit saved draft** is hidden. Send a direct
   PATCH request to the issued/cancelled order and verify the server rejects
   it with PURCHASE_ORDER_NOT_DRAFT (409).
7. Check another merchant cannot see or edit this order, supplier or items.
   The API must check membership and use business-scoped identifiers.
8. Confirm each successful edit adds PURCHASE_ORDER_DRAFT_UPDATED to the
   audit log while purchases, receipts, inventory, supplier ledger and
   cashbook remain untouched.
9. Confirm mobile item rows remain in one horizontal scrollable row, the
   editor is hidden when printing the PO, and an edit is never interpreted
   as issuing or emailing the document.
10. Disconnect from the network. Saving edits must be disabled (no silent
    offline checkout, no local stock or supplier-credit mutation).

CI uses an isolated database for integration fixtures; do not execute tests
that truncate businesses on staging or production databases.
