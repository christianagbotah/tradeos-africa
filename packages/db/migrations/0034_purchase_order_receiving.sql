BEGIN;

-- Link actual goods received to the supplier's issued PO without introducing
-- stock/payable side effects when a purchase order is prepared or issued.
ALTER TABLE supplier_purchase_orders
  ADD CONSTRAINT supplier_po_business_id_unique UNIQUE(business_id,id);
ALTER TABLE supplier_purchase_order_lines
  ADD CONSTRAINT supplier_po_lines_business_id_unique UNIQUE(business_id,id);

ALTER TABLE purchases
  ADD COLUMN purchase_order_id uuid,
  ADD CONSTRAINT purchase_receipt_order_scope_fk
    FOREIGN KEY(business_id,purchase_order_id)
    REFERENCES supplier_purchase_orders(business_id,id);

ALTER TABLE purchase_lines
  ADD COLUMN purchase_order_line_id uuid,
  ADD CONSTRAINT purchase_receipt_po_line_scope_fk
    FOREIGN KEY(business_id,purchase_order_line_id)
    REFERENCES supplier_purchase_order_lines(business_id,id);

CREATE INDEX idx_purchase_po_receipts
  ON purchases(business_id,purchase_order_id,received_at DESC)
  WHERE purchase_order_id IS NOT NULL;
CREATE INDEX idx_purchase_line_po_totals
  ON purchase_lines(business_id,purchase_order_line_id)
  INCLUDE(purchase_quantity)
  WHERE purchase_order_line_id IS NOT NULL;

-- A purchase line must either be unlinked to a PO together with its receipt,
-- or refer to the exact PO line, product and purchasing unit of the receipt.
CREATE OR REPLACE FUNCTION validate_purchase_receipt_po_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_order uuid;
  parent_business uuid;
BEGIN
  SELECT purchase_order_id,business_id
  INTO parent_order,parent_business
  FROM purchases WHERE id=NEW.purchase_id;
  IF NOT FOUND OR parent_business IS DISTINCT FROM NEW.business_id THEN
    RAISE EXCEPTION 'Purchase receipt business scope mismatch';
  END IF;
  IF (parent_order IS NULL) <> (NEW.purchase_order_line_id IS NULL) THEN
    RAISE EXCEPTION 'Linked purchase receipt must reference an order line';
  END IF;
  IF parent_order IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM supplier_purchase_order_lines pol
    WHERE pol.id=NEW.purchase_order_line_id
      AND pol.business_id=NEW.business_id
      AND pol.order_id=parent_order
      AND pol.item_id=NEW.item_id
      AND pol.purchase_unit_code=NEW.purchase_unit_code
  ) THEN
    RAISE EXCEPTION 'Purchase line does not match the linked supplier order';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_receipt_po_line_scope
  BEFORE INSERT OR UPDATE ON purchase_lines
  FOR EACH ROW EXECUTE FUNCTION validate_purchase_receipt_po_line();

COMMIT;
