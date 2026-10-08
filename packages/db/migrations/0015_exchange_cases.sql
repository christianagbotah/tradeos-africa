BEGIN;

ALTER TABLE return_cases DROP CONSTRAINT return_cases_refund_method_check;
ALTER TABLE return_cases ADD CONSTRAINT return_cases_refund_method_check CHECK (refund_method IN ('CASH','MOMO','CARD','BANK','CUSTOMER_CREDIT','ORIGINAL_METHOD','EXCHANGE_CREDIT'));

CREATE TABLE exchange_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  original_sale_id uuid NOT NULL REFERENCES sales(id),
  return_case_id uuid NOT NULL REFERENCES return_cases(id),
  replacement_sale_id uuid NOT NULL REFERENCES sales(id),
  customer_id uuid REFERENCES customers(id),
  initiated_by_staff_id uuid REFERENCES staff(id),
  status text NOT NULL CHECK (status IN ('PROCESSING','COMPLETED')),
  currency_code char(3) NOT NULL,
  reason text NOT NULL,
  settlement_method text NOT NULL CHECK (settlement_method IN ('CASH','MOMO','CARD','BANK','CUSTOMER_CREDIT','OTHER','ORIGINAL_METHOD')),
  return_total_minor bigint NOT NULL CHECK (return_total_minor >= 0),
  replacement_total_minor bigint NOT NULL CHECK (replacement_total_minor >= 0),
  net_difference_minor bigint NOT NULL,
  client_mutation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (business_id, client_mutation_id),
  UNIQUE (return_case_id),
  UNIQUE (replacement_sale_id)
);

CREATE INDEX idx_exchange_cases_original_sale ON exchange_cases(business_id, original_sale_id, created_at DESC);

COMMIT;
