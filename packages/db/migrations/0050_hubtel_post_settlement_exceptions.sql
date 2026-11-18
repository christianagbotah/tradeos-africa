BEGIN;

-- A subsequent independently authenticated Hubtel status lookup can reveal
-- that a previously settled sale has been refunded or its status now differs.
-- These observations are investigations, not automatic money/stock reversals.
ALTER TABLE hubtel_sale_checkout_attempts
  ADD COLUMN last_post_settlement_checked_at timestamptz,
  ADD COLUMN post_settlement_status_checks integer NOT NULL DEFAULT 0
    CHECK (post_settlement_status_checks >= 0);

CREATE TABLE hubtel_pos_settlement_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES hubtel_sale_checkout_attempts(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  exception_kind text NOT NULL CHECK (exception_kind IN
    ('REFUND_REPORTED','STATUS_CONFLICT','TRANSACTION_CONFLICT','METHOD_CONFLICT')),
  client_reference varchar(32) NOT NULL,
  original_provider_transaction_id text NOT NULL,
  evidence_source text NOT NULL DEFAULT 'HUBTEL_STATUS_API'
    CHECK (evidence_source='HUBTEL_STATUS_API'),
  verified_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id,exception_kind)
);
CREATE INDEX idx_hubtel_settlement_exceptions_business
  ON hubtel_pos_settlement_exceptions(business_id,detected_at DESC);

CREATE FUNCTION guard_hubtel_settlement_exception()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Hubtel settlement exception evidence is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hubtel_sale_checkout_attempts a
    JOIN payments p ON p.id=a.payment_id
    JOIN sales s ON s.id=a.sale_id
    WHERE a.id=NEW.attempt_id AND a.state='RECONCILED'
      AND a.business_id=NEW.business_id AND a.branch_id=NEW.branch_id
      AND a.sale_id=NEW.sale_id AND a.payment_id=NEW.payment_id
      AND a.client_reference=NEW.client_reference
      AND a.verified_provider_transaction_id=NEW.original_provider_transaction_id
      AND p.provider_reference=NEW.original_provider_transaction_id
      AND p.status='SUCCEEDED' AND s.status='COMPLETED'
      AND p.business_id=NEW.business_id AND s.business_id=NEW.business_id
      AND p.branch_id=NEW.branch_id AND s.branch_id=NEW.branch_id
      AND p.amount_minor=a.expected_amount_minor AND s.total_minor=a.expected_amount_minor
      AND p.currency_code=a.currency_code AND s.currency_code=a.currency_code
  ) THEN
    RAISE EXCEPTION 'Hubtel post-settlement observation does not match paid original transaction';
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER hubtel_settlement_exception_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hubtel_pos_settlement_exceptions
  FOR EACH ROW EXECUTE FUNCTION guard_hubtel_settlement_exception();

COMMIT;
