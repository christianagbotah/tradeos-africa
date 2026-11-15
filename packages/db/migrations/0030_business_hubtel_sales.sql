BEGIN;

-- Each merchant's POS receipts MUST go to its own verified collection account.
-- Never reuse the platform's TradeOS subscription-collection account.
-- Credentials live in the server's protected secret environment, not the DB.
CREATE TABLE business_hubtel_sales_accounts (
  business_id uuid PRIMARY KEY REFERENCES businesses(id),
  collection_account varchar(32) NOT NULL CHECK (collection_account ~ '^[0-9]{3,32}$'),
  credential_alias varchar(80) NOT NULL CHECK (credential_alias ~ '^[A-Za-z0-9_-]{3,80}$'),
  approval_status text NOT NULL DEFAULT 'PENDING'
    CHECK (approval_status IN ('PENDING','VERIFIED','REVOKED')),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by_platform_user_id uuid REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (approval_status='VERIFIED' AND verified_at IS NOT NULL)),
  UNIQUE (credential_alias),
  UNIQUE (collection_account)
);

-- A Hubtel intent is not a sale receipt. The real payment remains PENDING
-- in payments, and the sale remains OPEN until independently verified PAID.
CREATE TABLE hubtel_sale_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  client_request_id uuid NOT NULL,
  client_reference varchar(32) NOT NULL UNIQUE,
  merchant_collection_account varchar(32) NOT NULL,
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor>0),
  currency_code char(3) NOT NULL CHECK (currency_code='GHS'),
  state text NOT NULL DEFAULT 'PREPARED'
    CHECK (state IN ('PREPARED','READY','PENDING_VERIFICATION','RECONCILED','REVIEW_REQUIRED')),
  checkout_id text,
  checkout_url text,
  checkout_direct_url text,
  verified_provider_transaction_id text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,client_request_id),
  UNIQUE (business_id,sale_id),
  UNIQUE (merchant_collection_account,verified_provider_transaction_id),
  CHECK (
    (checkout_id IS NULL AND checkout_url IS NULL AND checkout_direct_url IS NULL)
    OR
    (checkout_id IS NOT NULL AND checkout_url IS NOT NULL AND checkout_direct_url IS NOT NULL)
  )
);
CREATE INDEX idx_hubtel_pos_attempts_business
  ON hubtel_sale_checkout_attempts(business_id,created_at DESC);
CREATE INDEX idx_hubtel_pos_pending
  ON hubtel_sale_checkout_attempts(state,created_at)
  WHERE state IN ('READY','PENDING_VERIFICATION');

-- The original canonical sale table has no business-scoped composite FK.
-- Foreign keys plus this guard explicitly reject cross-tenant or cross-branch
-- attempts even if an internal caller passes mismatched entity identifiers.
CREATE OR REPLACE FUNCTION validate_hubtel_sale_checkout_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM payments p JOIN sales s ON s.id=p.sale_id
    WHERE p.id=NEW.payment_id AND p.sale_id=NEW.sale_id
      AND p.business_id=NEW.business_id AND s.business_id=NEW.business_id
      AND p.branch_id=NEW.branch_id AND s.branch_id=NEW.branch_id
      AND p.method='MOMO' AND p.currency_code='GHS'
      AND s.currency_code='GHS' AND p.amount_minor=NEW.expected_amount_minor
  ) THEN
    RAISE EXCEPTION 'Hubtel checkout must match the owning sale and pending payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_hubtel_sales_accounts a
    WHERE a.business_id=NEW.business_id
      AND a.collection_account=NEW.merchant_collection_account
  ) THEN
    RAISE EXCEPTION 'Hubtel merchant account does not match the sale owner';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hubtel_sale_scope
BEFORE INSERT OR UPDATE ON hubtel_sale_checkout_attempts
FOR EACH ROW EXECUTE FUNCTION validate_hubtel_sale_checkout_scope();

COMMIT;
