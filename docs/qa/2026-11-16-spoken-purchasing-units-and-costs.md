# Purchase-order speech: unit and supplier-cost suggestions

This release extends Speak an order on the Purchase Orders page. Speech
recognition depends on browser support (English Ghana by default); typed
transcripts remain available.

## Operational safeguards

- Only active inventory products with eligible purchasing units can
  become suggested lines. No catalog item, supplier or price is invented.
- Unit matching uses item-specific purchasing codes and labels. It does
  not treat carton, bag, crate or bottle as interchangeable or invent
  conversions. Unsupported units yield an explicit warning.
- Clear numeric supplier cost expressions such as "at ₵120.50 per carton",
  "unit cost 20.25" and "at 50 cedis each" are parsed from the original
  transcript into integer minor units. A numeric SKU is not treated as money.
- A supplier cost in speech is merely an unaccepted suggestion until the
  operator clicks Use suggested cost on its matching item line. Every line
  still requires an actual unit-cost amount and an overall review checkbox.
- Price mentions without a per-unit cue ("for 500 cedis") are not applied.
  Product-specific multi-unit conflicts, unknown units and multiple cost
  mentions do not populate costs. Changing selected product or purchasing
  unit clears costs and suggestions.
- Original purchase order save, issue, receiving, supplier payment, permissions,
  invoice matching, audit and other backend workflows remain untouched.
- No API calls occur when dictating, preparing or applying a voice suggestion
  to the purchase form. Creating the draft remains an explicit step.

## Test the workflow

1. Create products with purchasable BAG and CARTON units and a supplier in
   the authorized test merchant account. Speak "Order two cartons of
   cement at ₵120.50 per carton". Confirm CARTON and the suggested ₵120.50.
2. Verify initial cost field is unfilled. Click Use suggested cost and
   verify the field changes to ₵120.50. Manually edit it, then confirm
   supplier, quantity, cost and total before applying to purchase order form.
3. Say "Order cement at ₵120 per carton" without a preceding unit.
   Confirm that the price's explicit per-carton cue resolves the purchase unit.
4. Say "Two bags of cement at ₵120 per carton". A mismatched unit must
   suppress the supplier cost and show a warning.
5. Say "Two pallets of cement at ₵100 per pallet" when PALLET isn't
   configured. Do not auto-apply the unknown purchase unit or price.
6. Say "Order two cartons of cement for ₵500 total"; this is ambiguous
   unit-vs-total cost. Require manual entry; never divide the total.
7. Say "Buy cement at ₵120 per box" with another item having SKU 120.
   The monetary amount must not add an unrelated SKU product.
8. Test ₵1,250.50 and reject ₵120.500 without truncated or rounded
   minor units. Check that supplier cost doesn't reuse retail prices.
9. With the accepted supplier amount, change the product/unit. Verify
   the old cost and spoken proposal disappear and the review checkbox resets.
10. Check both mobile and desktop: cost suggestion must be legible,
    horizontally contained and scrollable within the dialog.
11. Confirm the final button only populates the order form, not stock,
    supplier debt, payment, issuance or delivery receipts. Use the separate
    Create draft order and Issue order actions to finish a test document.
