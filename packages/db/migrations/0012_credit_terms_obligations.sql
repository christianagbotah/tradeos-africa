BEGIN;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS credit_terms_days integer NOT NULL DEFAULT 0
  CHECK (credit_terms_days >= 0 AND credit_terms_days <= 3650);

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0
  CHECK (payment_terms_days >= 0 AND payment_terms_days <= 3650);

CREATE TABLE customer_credit_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  currency_code char(3) NOT NULL,
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  open_minor bigint NOT NULL CHECK (open_minor >= 0),
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sale_id),
  CHECK (open_minor <= original_minor),
  CHECK (due_at >= issued_at)
);

CREATE INDEX idx_customer_credit_obligations_aging
  ON customer_credit_obligations(business_id, branch_id, customer_id, due_at, issued_at)
  WHERE open_minor > 0;

CREATE TABLE customer_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  obligation_id uuid NOT NULL REFERENCES customer_credit_obligations(id),
  source_type text NOT NULL CHECK (source_type IN ('PAYMENT','CREDIT_REFUND')),
  source_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  allocated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, source_type, source_id)
);

CREATE INDEX idx_customer_credit_allocations_source
  ON customer_credit_allocations(business_id, source_type, source_id);

CREATE TABLE supplier_credit_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_id uuid NOT NULL REFERENCES purchases(id),
  currency_code char(3) NOT NULL,
  original_minor bigint NOT NULL CHECK (original_minor > 0),
  open_minor bigint NOT NULL CHECK (open_minor >= 0),
  issued_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, purchase_id),
  CHECK (open_minor <= original_minor),
  CHECK (due_at >= issued_at)
);

CREATE INDEX idx_supplier_credit_obligations_aging
  ON supplier_credit_obligations(business_id, branch_id, supplier_id, due_at, issued_at)
  WHERE open_minor > 0;

CREATE TABLE supplier_credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  obligation_id uuid NOT NULL REFERENCES supplier_credit_obligations(id),
  source_type text NOT NULL CHECK (source_type IN ('PAYMENT','CREDIT_NOTE')),
  source_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  allocated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obligation_id, source_type, source_id)
);

CREATE INDEX idx_supplier_credit_allocations_source
  ON supplier_credit_allocations(business_id, source_type, source_id);

-- Backfill legacy credit obligations from the authoritative ledgers. Historical accounts did
-- not carry contractual due dates, so they retain the explicit zero-day legacy default rather
-- than inventing 30/60-day terms after the fact. Existing reductions are applied FIFO to
-- reproduce the current positive balance without rewriting ledger history.
WITH credits AS (
  SELECT cae.business_id,cae.branch_id,cae.customer_id,cae.currency_code,cae.source_id AS sale_id,
         cae.balance_delta_minor AS original_minor,cae.occurred_at AS issued_at,
         SUM(cae.balance_delta_minor) OVER (PARTITION BY cae.business_id,cae.customer_id ORDER BY cae.occurred_at,cae.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_positive
  FROM customer_account_entries cae
  WHERE cae.entry_type='CREDIT_SALE' AND cae.balance_delta_minor > 0
), reductions AS (
  SELECT business_id,customer_id,GREATEST(0,-SUM(LEAST(balance_delta_minor,0)))::bigint AS reduced_minor
  FROM customer_account_entries GROUP BY business_id,customer_id
)
INSERT INTO customer_credit_obligations (
  business_id,branch_id,customer_id,sale_id,currency_code,original_minor,open_minor,issued_at,due_at
)
SELECT c.business_id,c.branch_id,c.customer_id,c.sale_id,c.currency_code,c.original_minor,
       GREATEST(0,c.original_minor-GREATEST(0,COALESCE(r.reduced_minor,0)-COALESCE(c.prior_positive,0)))::bigint,
       c.issued_at,c.issued_at + make_interval(days => cu.credit_terms_days)
FROM credits c
JOIN customers cu ON cu.id=c.customer_id AND cu.business_id=c.business_id
LEFT JOIN reductions r ON r.business_id=c.business_id AND r.customer_id=c.customer_id
ON CONFLICT (business_id,sale_id) DO NOTHING;

WITH credits AS (
  SELECT spl.business_id,spl.branch_id,spl.supplier_id,spl.currency_code,spl.source_id AS purchase_id,
         spl.balance_delta_minor AS original_minor,spl.occurred_at AS issued_at,
         SUM(spl.balance_delta_minor) OVER (PARTITION BY spl.business_id,spl.supplier_id ORDER BY spl.occurred_at,spl.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_positive
  FROM supplier_payable_ledger spl
  WHERE spl.source_type='PURCHASE' AND spl.balance_delta_minor > 0
), reductions AS (
  SELECT business_id,supplier_id,GREATEST(0,-SUM(LEAST(balance_delta_minor,0)))::bigint AS reduced_minor
  FROM supplier_payable_ledger GROUP BY business_id,supplier_id
)
INSERT INTO supplier_credit_obligations (
  business_id,branch_id,supplier_id,purchase_id,currency_code,original_minor,open_minor,issued_at,due_at
)
SELECT c.business_id,c.branch_id,c.supplier_id,c.purchase_id,c.currency_code,c.original_minor,
       GREATEST(0,c.original_minor-GREATEST(0,COALESCE(r.reduced_minor,0)-COALESCE(c.prior_positive,0)))::bigint,
       c.issued_at,c.issued_at + make_interval(days => s.payment_terms_days)
FROM credits c
JOIN suppliers s ON s.id=c.supplier_id AND s.business_id=c.business_id
LEFT JOIN reductions r ON r.business_id=c.business_id AND r.supplier_id=c.supplier_id
ON CONFLICT (business_id,purchase_id) DO NOTHING;

COMMIT;
