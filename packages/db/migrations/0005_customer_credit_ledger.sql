BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL,
  method text NOT NULL CHECK (method IN ('CASH', 'MOMO', 'CARD', 'BANK', 'OTHER')),
  provider_reference text,
  status text NOT NULL DEFAULT 'SUCCEEDED' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED')),
  actor_staff_id uuid REFERENCES staff(id),
  client_mutation_id text NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_mutation_id)
);

CREATE TABLE customer_account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  currency_code char(3) NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('CREDIT_SALE', 'PAYMENT', 'CREDIT_REFUND', 'ADJUSTMENT')),
  balance_delta_minor bigint NOT NULL CHECK (balance_delta_minor <> 0),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  actor_staff_id uuid REFERENCES staff(id),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, idempotency_key)
);

CREATE INDEX idx_customer_payments_customer_time
  ON customer_payments(business_id, customer_id, received_at DESC);
CREATE INDEX idx_customer_account_customer_time
  ON customer_account_entries(business_id, customer_id, occurred_at DESC, id DESC);
CREATE INDEX idx_customer_account_branch_time
  ON customer_account_entries(business_id, branch_id, occurred_at DESC);

COMMIT;
