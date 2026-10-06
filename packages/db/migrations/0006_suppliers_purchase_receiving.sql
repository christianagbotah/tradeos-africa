BEGIN;

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_business_name ON suppliers(business_id, is_active DESC, name);

CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  received_by_staff_id uuid NOT NULL REFERENCES staff(id),
  status text NOT NULL CHECK (status IN ('RECEIVED', 'VOIDED')),
  currency_code char(3) NOT NULL,
  settlement_method text NOT NULL CHECK (settlement_method IN ('CASH','MOMO','CARD','BANK','OTHER','SUPPLIER_CREDIT')),
  supplier_reference text,
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  client_mutation_id text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_mutation_id)
);

CREATE TABLE purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  item_name_snapshot text NOT NULL,
  purchase_unit_code text NOT NULL,
  purchase_quantity numeric(24,8) NOT NULL CHECK (purchase_quantity > 0),
  stock_unit_code text NOT NULL,
  stock_quantity numeric(24,8) NOT NULL CHECK (stock_quantity > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  line_cost_minor bigint NOT NULL CHECK (line_cost_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_business_branch_time ON purchases(business_id, branch_id, received_at DESC);
CREATE INDEX idx_purchases_supplier_time ON purchases(business_id, supplier_id, received_at DESC);
CREATE INDEX idx_purchase_lines_item ON purchase_lines(business_id, item_id, created_at DESC);

CREATE TABLE supplier_payable_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES businesses(id),
 branch_id uuid NOT NULL REFERENCES branches(id),
 supplier_id uuid NOT NULL REFERENCES suppliers(id),
 currency_code char(3) NOT NULL,
 balance_delta_minor bigint NOT NULL CHECK (balance_delta_minor <> 0),
 method text NOT NULL CHECK (method IN ('CASH','MOMO','CARD','BANK','OTHER','SUPPLIER_CREDIT')),
 source_type text NOT NULL CHECK (source_type IN ('PURCHASE','PAYMENT')),
 source_id uuid NOT NULL,
 actor_staff_id uuid NOT NULL REFERENCES staff(id),
 client_mutation_id text NOT NULL,
 occurred_at timestamptz NOT NULL,
 UNIQUE(business_id,client_mutation_id)
);
CREATE INDEX idx_supplier_payable ON supplier_payable_ledger(business_id,supplier_id);
CREATE TABLE inventory_valuations (
 business_id uuid NOT NULL REFERENCES businesses(id),
 branch_id uuid NOT NULL REFERENCES branches(id),
 item_id uuid NOT NULL REFERENCES catalog_items(id),
 location_type text NOT NULL CHECK (location_type IN ('AVAILABLE','QUARANTINE','DAMAGED','WASTE')),
 quantity numeric(24,8) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
 value_minor bigint NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
 PRIMARY KEY(business_id,branch_id,item_id,location_type)
);
ALTER TABLE sale_lines ADD COLUMN line_cost_minor bigint NOT NULL DEFAULT 0 CHECK (line_cost_minor >= 0);
COMMIT;
