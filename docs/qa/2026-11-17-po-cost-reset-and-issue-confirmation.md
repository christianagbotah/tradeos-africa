# Purchase order form — supplier cost reset and issue confirmation

These safeguards apply to the standard purchase-order creation form as well
as drafts prepared by voice. They do not change the server-side purchase
order, receiving, stock or settlement operations.

## Acceptance checklist

1. Open Purchase Orders and add an active, stock-tracked purchasable product.
   Its supplier unit-cost field is **blank**, not an assumed zero. The Create
   draft order button remains disabled until the required fields are complete.
2. Enter a supplier price, a quantity and a saved active supplier. Confirm
   the price and estimated total, then switch product in the same row. The
   previous unit cost clears and quantity resets to one.
3. Enter a different price and select another configured purchasing unit.
   Price clears; quantity remains unchanged for the same product. The
   estimated subtotal is marked incomplete until a fresh price is entered.
4. Change the supplier after entering one or several item prices. **All**
   previous supplier-specific quoted costs must clear; item and quantity
   selections remain. Choosing the same supplier must not clear quotes.
5. Explicitly type `0` as the unit cost (a free sample): zero remains valid
   and distinct from an unfilled field. Do not auto-set zero for blank input.
6. Try an inactive item, unavailable purchasing unit, invalid decimal
   quantity and an overflowed line total. The Create draft order action
   must remain disabled. The API repeats all business validation.
7. With an authorized Manager/Owner/Admin account, press Issue order on a
   saved DRAFT purchase order. Verify a confirmation dialog lists the
   actual PO number, supplier, server-sourced total and delivery date.
8. Click Keep as draft or Escape. The status must remain DRAFT and no
   issue request is sent. Click Confirm issue order to invoke the existing
   authorized issue endpoint. Verify the status changes to ISSUED.
9. Verify issuing does **not** post stock, supplier debt or payment, and
   does not automatically email the supplier. Unauthorized roles must not
   see an Issue order button or issue dialog.
10. Check all one-row item fields on desktop and horizontal scrolling on
    mobile; verify the distinct unit-cost input IDs and amount readability.
11. With a reviewed voice order, copying into the form must populate only
    the values actually confirmed in the voice assistant. Changing the
    supplier, product or unit afterward must invalidate earlier prices.
12. On failed issue API response, surface the error in the dialog, keep
    the order available for review, and never claim successful issuance.

## Safety properties

No automatic purchase order creation, issue, stock receipt, supplier debt
or payment is introduced. User confirmation is required before issuing;
server-side authorization, idempotency and status checks remain authoritative.
