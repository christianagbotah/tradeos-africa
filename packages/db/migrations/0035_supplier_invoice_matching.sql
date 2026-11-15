BEGIN;

-- An invoice match is an audit/reconciliation document, not a second supplier
-- payable or a second goods receipt. Original receipts own accounting entries.
ALTER TABLE purchases
  ADD CONSTRAINT purchases_business_id_id_unique UNIQUE(business_id,id);

CREATE TABLE supplier_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL REFERENCES staff(id),
  approved_by_staff_id uuid REFERENCES staff(id),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  invoice_reference varchar(120) NOT NULL CHECK(length(trim(invoice_reference))>0),
  invoice_date date NOT NULL,
  currency_code char(3) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','APPROVED','CANCELLED')),
  invoice_total_minor bigint NOT NULL CHECK(invoice_total_minor>=0),
  receipt_total_minor bigint NOT NULL CHECK(receipt_total_minor>=0),
  invoice_variance_minor bigint NOT NULL,
  po_price_variance_minor bigint NOT NULL,
  receipt_count integer NOT NULL CHECK(receipt_count BETWEEN 1 AND 100),
  notes text NOT NULL DEFAULT '',
  approval_note text NOT NULL DEFAULT '',
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,client_request_id),
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,purchase_order_id)
    REFERENCES supplier_purchase_orders(business_id,id),
  CHECK(invoice_variance_minor=invoice_total_minor-receipt_total_minor),
  CHECK((status='APPROVED')=(approved_at IS NOT NULL))
);
-- A supplier must not present the same invoice number twice in one business.
CREATE UNIQUE INDEX supplier_invoice_ref_unique
  ON supplier_invoice_matches(business_id,supplier_id,lower(invoice_reference))
  WHERE status <> 'CANCELLED';
CREATE INDEX supplier_invoice_po_status
  ON supplier_invoice_matches(business_id,purchase_order_id,created_at DESC);

CREATE TABLE supplier_invoice_match_receipts (
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_match_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  purchase_total_minor bigint NOT NULL CHECK(purchase_total_minor>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,purchase_id),
  UNIQUE(invoice_match_id,purchase_id),
  FOREIGN KEY(business_id,invoice_match_id)
    REFERENCES supplier_invoice_matches(business_id,id),
  FOREIGN KEY(business_id,purchase_id)
    REFERENCES purchases(business_id,id)
);
CREATE INDEX supplier_invoice_receipt_lookup
  ON supplier_invoice_match_receipts(business_id,invoice_match_id);

-- The service deletes receipt claims only when cancelling an unapproved draft.
-- Approval is immutable and never changes the original stock/accounting entry.
CREATE OR REPLACE FUNCTION validate_supplier_invoice_receipt_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supplier_invoice_matches im
    JOIN purchases p ON p.id=NEW.purchase_id AND p.business_id=NEW.business_id
    WHERE im.id=NEW.invoice_match_id AND im.business_id=NEW.business_id
      AND p.business_id=im.business_id AND p.branch_id=im.branch_id
      AND p.supplier_id=im.supplier_id
      AND p.purchase_order_id=im.purchase_order_id AND p.status='RECEIVED'
  ) THEN
    RAISE EXCEPTION 'Supplier invoice receipt scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_invoice_receipt_scope
  BEFORE INSERT OR UPDATE ON supplier_invoice_match_receipts
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_invoice_receipt_scope();

COMMIT;
