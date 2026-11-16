# Purchase-order voice corrections — human-reviewed UAT

This release extends "Speak an order" on Purchase Orders. It corrects an
unposted local draft only. It neither creates nor issues purchase orders
and cannot receive stock, charge a supplier, post a payment or alter stock.

## Acceptance scenarios

1. Prepare an order with three purchase-enabled catalog products, saved
   supplier and unit costs.
2. Dictate "change item two quantity to five". Preview and confirm that
   only item two changes and the review checkbox resets.
3. Say "set item one unit to carton" with BAG and CARTON enabled.
   Confirm from actual units; old supplier cost must be cleared.
4. Say "change item two cost to ₵120.50". Confirm correct decimals;
   no amount is used without explicit confirmation.
5. Say "set item one unit cost to 1,250.05 cedis per bag". With a BAG
   purchasing unit it is accepted on confirmation, with CARTON it is
   rejected as mismatched.
6. Say "replace item one with SKU 058". Choose the exact catalog product;
   old price must be cleared, quantity reset to one, and the new purchasing unit reviewed.
7. Say "remove item three". Only that line is removed. An empty order
   cannot be submitted.
8. Say "change supplier to Comfort Supplies". Require selecting an active
   saved supplier. Do not invent an account. Changing supplier clears quoted supplier costs.
9. With a correction proposed, change the item, supplier, quantity or cost
   manually. The stale proposal must disappear.
10. Reject "issue the order", "pay the supplier", "receive stock" and
    commands without a specific item number.
11. With a pending correction, block "Use reviewed details in order form".
    Reset final review acknowledgement after every confirmed change.
12. Test Chrome Android microphone permissions and typed fallback,
    separate original/correction transcripts, readable mobile layout and
    independent scrolling within the dialog.

## Boundaries

- Only active purchase-enabled catalog items, configured units and active
  suppliers may be selected.
- The server-side order creation, issuance, receiving and supplier-payment
  APIs are unchanged by voice corrections.
- Users must still choose Create draft order, and authorized users issue it
  separately.
