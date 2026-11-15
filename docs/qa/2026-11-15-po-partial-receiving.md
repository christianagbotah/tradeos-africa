# Supplier purchase orders — partial receiving UAT

## Goal and accounting boundary
A purchase order is a commitment. Goods received against an issued order must
be posted by the existing `PURCHASE_RECEIVE_CREATE` mutation, which alone
updates inventory movements, inventory valuation, supplier payables, credit
obligations and cashbook payments. Creating/issuing the PO does not post money
or stock. Unlinked purchase receipts remain supported.

## Delivered
- Migration `0034_purchase_order_receiving.sql`: nullable parent PO reference
  and per-line PO item reference, tenant-scope composite FKs and a trigger
  requiring linked lines to match the order, item and purchase unit.
- A single transactional, idempotent partial-receipt path: issued status and
  branch/supplier/tenant enforced; PO row locked before checking unreceived
  quantities; no more than the remaining amount can be received.
- Product/unit and cost are validated against the normal inventory-purchasing
  path, and multi-unit conversion reuses the existing costed stock journal.
- Duplicate receipt retries do not post stock or payables twice. Reusing
  the same receipt mutation ID with a changed linked quantity, unit, cost,
  supplier, reference or settlement method is rejected.
- Source PO details show each line's ordered, received, outstanding quantities,
  receipt references and totals, and actual-versus-issued unit cost variance.
  A cancelled order preserves its posted receipts but cannot receive more.
- The PO preview's Receive outstanding goods action opens the ordinary
  purchase receipt form, scoped to outstanding PO lines only. Each actual
  quantity starts at **0**: physically count received goods before posting.
  Unit costs are prefilled but editable, and mismatches are highlighted.
  A PO is only selectable for this flow when issued and not fully received.
- Purchase detail and list responses retain a link back to the original PO.

## Operator acceptance tests
1. Create a supplier and two purchasable catalog products, including a multi-unit
   conversion (e.g., box of 10 pieces).
2. Create a PO for ten pieces and three boxes; confirm no stock or payable yet.
3. Issue the PO. Open preview and choose **Receive outstanding goods**.
4. Enter actual quantities: four pieces, one box, leave other quantities zero.
   Select supplier credit (default) and optionally the supplier invoice/reference.
5. Check purchase receipt, stock in units (including box conversion), payable
   journal, and PO remaining quantities (six pieces, two boxes). There must
   be one payable entry and one stock movement per delivered line.
6. Receive six pieces and two boxes. The order should show **Fully received**,
   zero outstanding and two actual purchase receipts. Further receipt is blocked.
7. Modify one unit cost before posting a delivery; verify PO expected-versus-
   received price variance is shown. This is a warning, not a certified
   supplier invoice match.
8. Simulate replay using same clientMutationId: only one receipt exists.
   Attempt same ID with changed lines: explicit conflict.
9. Try to receive 11 pieces or concurrently post two final deliveries:
   the aggregate must never exceed the ordered quantity.
10. Cancel a partially delivered PO: historic inventory and payable stay,
    but outstanding delivery can no longer be posted.
11. Verify business B cannot receive business A's PO, including through
    a valid business B item and supplier.
12. On mobile, swipe the receipt row; all fields remain in a single row.
    On desktop, check the bright preview header total and print fidelity.

## Exclusions and next phase
- Receiving against a PO is tied to an *actual supplier receipt*. Purchase
  returns do not increase future order headroom; they remain separate reverse
  flows and do not erase the fact that goods were delivered.
- Price variance is recorded, but supplier invoice **three-way matching**,
  approvals for invoice discrepancies and separate AP invoice ledger posting
  still need development and formal testing.
- Offline queue supports the ordinary receipt mutation; PO-linked receipts
  should be performed while online so the server can verify current
  outstanding quantities. Rejected queued deliveries must not appear posted.
- Does not turn on Hubtel live POS. Its status API account authorization and
  cancellation/valuation reversal remain launch blockers in issue #134.
