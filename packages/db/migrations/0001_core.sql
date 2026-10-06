BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'GH',
  currency_code char(3) NOT NULL DEFAULT 'GHS',
  business_type text NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Accra',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  code text NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Accra',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  display_name text NOT NULL,
  phone text,
  email text,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  phone text,
  email text,
  credit_limit_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  sku text,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PRODUCT', 'SERVICE', 'PREPARED_PRODUCT')),
  stock_unit_code text,
  track_stock boolean NOT NULL DEFAULT false,
  tax_category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku)
);

CREATE TABLE catalog_item_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  unit_code text NOT NULL,
  unit_label text NOT NULL,
  can_purchase boolean NOT NULL DEFAULT false,
  can_sell boolean NOT NULL DEFAULT false,
  can_stock boolean NOT NULL DEFAULT false,
  default_sale_price_minor bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, unit_code)
);

CREATE TABLE item_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  from_unit_code text NOT NULL,
  to_unit_code text NOT NULL,
  factor numeric(24,10) NOT NULL CHECK (factor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_unit_code <> to_unit_code),
  UNIQUE (item_id, from_unit_code, to_unit_code)
);

CREATE TABLE consumption_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  output_item_id uuid NOT NULL REFERENCES catalog_items(id),
  output_quantity numeric(24,8) NOT NULL DEFAULT 1 CHECK (output_quantity > 0),
  output_unit_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consumption_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES consumption_definitions(id) ON DELETE CASCADE,
  component_item_id uuid NOT NULL REFERENCES catalog_items(id),
  stock_unit_code text NOT NULL,
  quantity_per_output numeric(24,8) NOT NULL CHECK (quantity_per_output >= 0),
  expected_waste_percent numeric(8,4) NOT NULL DEFAULT 0 CHECK (expected_waste_percent >= 0 AND expected_waste_percent < 100)
);

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid REFERENCES customers(id),
  cashier_staff_id uuid REFERENCES staff(id),
  status text NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  currency_code char(3) NOT NULL,
  subtotal_net_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  client_mutation_id text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_mutation_id)
);

CREATE TABLE sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  item_name_snapshot text NOT NULL,
  item_kind text NOT NULL CHECK (item_kind IN ('PRODUCT', 'SERVICE', 'PREPARED_PRODUCT')),
  quantity numeric(24,8) NOT NULL CHECK (quantity > 0),
  sale_unit_code text NOT NULL,
  stock_quantity numeric(24,8),
  stock_unit_code text,
  unit_net_minor bigint NOT NULL,
  unit_tax_minor bigint NOT NULL DEFAULT 0,
  unit_cost_minor bigint NOT NULL DEFAULT 0,
  line_net_minor bigint NOT NULL,
  line_tax_minor bigint NOT NULL DEFAULT 0,
  line_total_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH', 'MOMO', 'CARD', 'BANK', 'CUSTOMER_CREDIT', 'OTHER')),
  provider_reference text,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED', 'PARTIALLY_REVERSED')),
  client_mutation_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_mutation_id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  stock_unit_code text NOT NULL,
  quantity_delta numeric(24,8) NOT NULL CHECK (quantity_delta <> 0),
  location_type text NOT NULL CHECK (location_type IN ('AVAILABLE', 'QUARANTINE', 'DAMAGED', 'WASTE')),
  reason text NOT NULL CHECK (reason IN (
    'OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'SALE_RETURN', 'TRANSFER',
    'TRANSFORMATION_INPUT', 'TRANSFORMATION_OUTPUT', 'SERVICE_CONSUMPTION',
    'RECIPE_CONSUMPTION', 'WASTAGE', 'ADJUSTMENT'
  )),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  actor_staff_id uuid REFERENCES staff(id),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, idempotency_key)
);

CREATE TABLE return_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  original_sale_id uuid NOT NULL REFERENCES sales(id),
  customer_id uuid REFERENCES customers(id),
  initiated_by_staff_id uuid REFERENCES staff(id),
  approved_by_staff_id uuid REFERENCES staff(id),
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'FAILED')),
  reason text NOT NULL,
  refund_method text NOT NULL CHECK (refund_method IN ('CASH', 'MOMO', 'CARD', 'BANK', 'CUSTOMER_CREDIT', 'ORIGINAL_METHOD')),
  currency_code char(3) NOT NULL,
  net_revenue_reversal_minor bigint NOT NULL DEFAULT 0,
  tax_reversal_minor bigint NOT NULL DEFAULT 0,
  refund_total_minor bigint NOT NULL DEFAULT 0,
  cogs_reversal_minor bigint NOT NULL DEFAULT 0,
  discarded_cost_minor bigint NOT NULL DEFAULT 0,
  client_mutation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (business_id, client_mutation_id)
);

CREATE TABLE return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_case_id uuid NOT NULL REFERENCES return_cases(id),
  original_sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
  quantity numeric(24,8) NOT NULL CHECK (quantity > 0),
  disposition text NOT NULL CHECK (disposition IN ('RESTOCK', 'QUARANTINE', 'DISCARD', 'NOT_APPLICABLE')),
  net_revenue_reversal_minor bigint NOT NULL,
  tax_reversal_minor bigint NOT NULL DEFAULT 0,
  cogs_reversal_minor bigint NOT NULL DEFAULT 0,
  discarded_cost_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refund_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  return_case_id uuid NOT NULL REFERENCES return_cases(id),
  original_payment_id uuid REFERENCES payments(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH', 'MOMO', 'CARD', 'BANK', 'CUSTOMER_CREDIT', 'ORIGINAL_METHOD')),
  provider_reference text,
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (business_id, idempotency_key)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  actor_staff_id uuid REFERENCES staff(id),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  client_id text NOT NULL,
  client_mutation_id text NOT NULL,
  mutation_type text NOT NULL,
  request_payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('RECEIVED', 'APPLIED', 'REJECTED')),
  result_payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (business_id, client_id, client_mutation_id)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX idx_catalog_items_business ON catalog_items(business_id, is_active);
CREATE INDEX idx_sales_business_branch_time ON sales(business_id, branch_id, created_at DESC);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_payments_sale ON payments(sale_id);
CREATE INDEX idx_inventory_balance_lookup ON inventory_movements(business_id, branch_id, item_id, stock_unit_code, location_type);
CREATE INDEX idx_return_cases_sale ON return_cases(original_sale_id);
CREATE INDEX idx_return_lines_sale_line ON return_lines(original_sale_line_id);
CREATE INDEX idx_audit_events_entity ON audit_events(business_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_outbox_unpublished ON outbox_events(occurred_at) WHERE published_at IS NULL;
CREATE INDEX idx_sync_mutations_client ON sync_mutations(business_id, client_id, received_at DESC);

COMMIT;
