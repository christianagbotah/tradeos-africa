BEGIN;

-- Supplier purchase orders are commercial commitments, NOT goods receipts.
-- Creating or issuing an order never moves stock, adds supplier payables,
-- posts a cashbook entry or changes inventory valuation.
CREATE TABLE supplier_purchase_order_sequences (
  business_id uuid NOT NULL REFERENCES businesses(id),
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 9999),
  last_number integer NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (business_id,year)
);

CREATE TABLE supplier_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  created_by_staff_id uuid REFERENCES staff(id),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  order_number varchar(32) NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ISSUED','CANCELLED')),
  currency_code char(3) NOT NULL,
  supplier_name_snapshot varchar(180) NOT NULL,
  supplier_phone_snapshot varchar(40),
  supplier_email_snapshot varchar(180),
  supplier_address_snapshot text,
  business_name_snapshot varchar(180) NOT NULL,
  branch_name_snapshot varchar(180) NOT NULL,
  expected_delivery_at date,
  notes text NOT NULL DEFAULT '',
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,order_number),
  UNIQUE (business_id,client_request_id),
  CHECK (total_minor=subtotal_minor+tax_minor)
);
CREATE INDEX idx_supplier_po_business_branch_created
  ON supplier_purchase_orders(business_id,branch_id,created_at DESC,id DESC);
CREATE INDEX idx_supplier_po_supplier_created
  ON supplier_purchase_orders(business_id,supplier_id,created_at DESC,id DESC);

CREATE TABLE supplier_purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  order_id uuid NOT NULL REFERENCES supplier_purchase_orders(id),
  sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 49),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  item_name_snapshot varchar(240) NOT NULL,
  item_sku_snapshot varchar(120),
  purchase_unit_code varchar(40) NOT NULL,
  purchase_unit_label_snapshot varchar(120) NOT NULL,
  quantity numeric(24,8) NOT NULL CHECK (quantity>0 AND quantity<=1000000),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor>=0),
  line_net_minor bigint NOT NULL CHECK (line_net_minor>=0),
  line_tax_minor bigint NOT NULL DEFAULT 0 CHECK (line_tax_minor>=0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(order_id,sort_order),
  CHECK(line_total_minor=line_net_minor+line_tax_minor)
);

-- Ensure no internal caller can silently associate an order line with
-- a product from another business, even if the application misses a guard.
CREATE OR REPLACE FUNCTION validate_supplier_po_line_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM supplier_purchase_orders o
    JOIN catalog_items i ON i.id=NEW.item_id
    WHERE o.id=NEW.order_id AND o.business_id=NEW.business_id
      AND i.business_id=NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Supplier purchase order line business scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_po_line_scope
  BEFORE INSERT OR UPDATE ON supplier_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_po_line_scope();

COMMIT;
