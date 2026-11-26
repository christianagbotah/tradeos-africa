BEGIN;

-- Invoice line snapshots are immutable reconciliation evidence. The existing
-- purchase receipt remains the ONLY source for stock, valuation and AP postings.
ALTER TABLE supplier_invoice_matches
  ADD COLUMN itemized boolean NOT NULL DEFAULT false,
  ADD COLUMN invoice_lines_subtotal_minor bigint NOT NULL DEFAULT 0
    CHECK (invoice_lines_subtotal_minor >= 0),
  ADD COLUMN invoice_adjustment_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN line_discrepancy_count integer NOT NULL DEFAULT 0
    CHECK (line_discrepancy_count >= 0),
  ADD CONSTRAINT invoice_match_itemized_total_check CHECK (
    NOT itemized OR
      invoice_total_minor = invoice_lines_subtotal_minor + invoice_adjustment_minor
  );

CREATE TABLE supplier_invoice_match_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_match_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  item_name_snapshot text NOT NULL,
  purchase_unit_code text NOT NULL,
  invoice_quantity numeric(24,8) NOT NULL CHECK (invoice_quantity >= 0),
  invoice_unit_cost_minor bigint NOT NULL CHECK (invoice_unit_cost_minor >= 0),
  invoice_line_total_minor bigint NOT NULL CHECK (invoice_line_total_minor >= 0),
  received_quantity numeric(24,8) NOT NULL CHECK (received_quantity > 0),
  received_cost_minor bigint NOT NULL CHECK (received_cost_minor >= 0),
  po_unit_cost_minor bigint NOT NULL CHECK (po_unit_cost_minor >= 0),
  po_expected_total_minor bigint NOT NULL CHECK (po_expected_total_minor >= 0),
  quantity_variance numeric(24,8) NOT NULL,
  value_variance_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,invoice_match_id,purchase_order_line_id),
  FOREIGN KEY(business_id,invoice_match_id)
    REFERENCES supplier_invoice_matches(business_id,id),
  FOREIGN KEY(business_id,purchase_order_line_id)
    REFERENCES supplier_purchase_order_lines(business_id,id),
  CHECK (quantity_variance=invoice_quantity-received_quantity),
  CHECK (value_variance_minor=invoice_line_total_minor-received_cost_minor)
);
CREATE INDEX supplier_invoice_match_lines_lookup
  ON supplier_invoice_match_lines(business_id,invoice_match_id,sort_order);

CREATE OR REPLACE FUNCTION validate_supplier_invoice_item_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supplier_invoice_matches im
    JOIN supplier_purchase_order_lines pol
      ON pol.id=NEW.purchase_order_line_id AND pol.business_id=NEW.business_id
    WHERE im.id=NEW.invoice_match_id AND im.business_id=NEW.business_id
      AND im.purchase_order_id=pol.order_id AND im.itemized=true
  ) THEN
    RAISE EXCEPTION 'Supplier invoice line does not belong to this purchase order';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_invoice_match_line_scope
  BEFORE INSERT OR UPDATE ON supplier_invoice_match_lines
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_invoice_item_scope();

COMMIT;
