BEGIN;

-- Business-scoped, negotiated catalog prices. No global catalog price
-- mutation occurs when a special customer rate is created or retired.
CREATE TABLE customer_special_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  sale_unit_code text NOT NULL,
  unit_price_minor bigint NOT NULL CHECK(unit_price_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_by_membership_id uuid REFERENCES business_memberships(id),
  updated_by_membership_id uuid REFERENCES business_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,customer_id,item_id,sale_unit_code),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX idx_special_prices_customer ON customer_special_prices(
  business_id, customer_id, active, item_id
);

-- One-off special price per exact sale line. A request belongs to one
-- requesting membership, branch, customer, item, unit and quantity.
-- Cross-branch and cross-customer reuse is rejected at sale posting.
CREATE TABLE sale_price_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  client_request_id uuid NOT NULL,
  customer_id uuid REFERENCES customers(id),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  sale_unit_code text NOT NULL,
  quantity numeric(24,8) NOT NULL CHECK(quantity > 0 AND quantity <= 100000),
  base_unit_price_minor bigint NOT NULL CHECK(base_unit_price_minor >= 0),
  requested_unit_price_minor bigint NOT NULL CHECK(requested_unit_price_minor >= 0),
  reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 500),
  requested_by_membership_id uuid NOT NULL REFERENCES business_memberships(id),
  requested_by_staff_id uuid REFERENCES staff(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN (
    'PENDING','APPROVED','REJECTED','USED','CANCELLED'
  )),
  reviewed_by_membership_id uuid REFERENCES business_memberships(id),
  reviewed_by_staff_id uuid REFERENCES staff(id),
  reviewed_at timestamptz,
  review_note text,
  expires_at timestamptz,
  used_sale_id uuid REFERENCES sales(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,client_request_id),
  CHECK(requested_unit_price_minor < base_unit_price_minor),
  CHECK((status <> 'APPROVED') OR
    (reviewed_by_membership_id IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK((status <> 'USED') OR
    (used_sale_id IS NOT NULL AND used_at IS NOT NULL))
);
CREATE INDEX idx_discount_pending ON sale_price_approval_requests(
  business_id,status,created_at DESC
);
CREATE INDEX idx_discount_requester ON sale_price_approval_requests(
  business_id,requested_by_membership_id,created_at DESC
);

COMMIT;
