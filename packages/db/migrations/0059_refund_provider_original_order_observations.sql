BEGIN;

-- Authenticated Hubtel ORIGINAL PAYMENT status observations. A refunded
-- order status is NOT refund-specific settlement or recipient proof.
CREATE TABLE refund_provider_order_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  refund_transaction_id uuid NOT NULL REFERENCES refund_transactions(id),
  original_payment_id uuid NOT NULL REFERENCES payments(id),
  checkout_attempt_id uuid NOT NULL REFERENCES hubtel_sale_checkout_attempts(id),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  client_request_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'HUBTEL' CHECK(provider='HUBTEL'),
  original_order_status text NOT NULL CHECK (
    original_order_status IN ('PAID','UNPAID','REFUNDED')),
  observation_kind text NOT NULL CHECK (observation_kind IN (
    'ORIGINAL_ORDER_PAID','ORIGINAL_ORDER_UNPAID_CONFLICT',
    'ORIGINAL_ORDER_REFUND_REPORTED','ORIGINAL_ORDER_REFERENCE_CONFLICT')),
  original_transaction_id text NOT NULL CHECK (
    char_length(original_transaction_id) BETWEEN 1 AND 128),
  provider_transaction_id text CHECK (
    provider_transaction_id IS NULL OR char_length(provider_transaction_id) BETWEEN 1 AND 128),
  original_payment_minor bigint NOT NULL CHECK (original_payment_minor > 0),
  refund_amount_minor bigint NOT NULL CHECK (refund_amount_minor > 0),
  currency_code char(3) NOT NULL CHECK (currency_code='GHS'),
  verified_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  refund_destination_verified boolean NOT NULL DEFAULT false CHECK(refund_destination_verified=false),
  refund_settlement_verified boolean NOT NULL DEFAULT false CHECK(refund_settlement_verified=false),
  UNIQUE(refund_transaction_id,client_request_id)
);

CREATE INDEX idx_refund_original_order_observations
  ON refund_provider_order_observations
  (business_id,branch_id,refund_transaction_id,recorded_at DESC,id DESC);

CREATE TABLE refund_provider_order_check_cooldowns (
  refund_transaction_id uuid PRIMARY KEY REFERENCES refund_transactions(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  last_claimed_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count > 0)
);

CREATE FUNCTION guard_refund_provider_original_order_observation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Provider original-order observations are immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM refund_transactions r
    JOIN return_cases rc ON rc.id=r.return_case_id
      AND rc.business_id=r.business_id AND rc.branch_id=NEW.branch_id
    JOIN payments p ON p.id=NEW.original_payment_id
      AND p.business_id=r.business_id AND p.branch_id=rc.branch_id
      AND p.sale_id=rc.original_sale_id
    JOIN hubtel_sale_checkout_attempts a ON a.id=NEW.checkout_attempt_id
      AND a.business_id=r.business_id AND a.branch_id=rc.branch_id
      AND a.payment_id=p.id AND a.sale_id=rc.original_sale_id
    JOIN business_memberships m ON m.business_id=r.business_id
      AND m.user_id=NEW.actor_user_id
      AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
    WHERE r.id=NEW.refund_transaction_id AND r.business_id=NEW.business_id
      AND r.original_payment_id=p.id
      AND r.status IN ('PENDING','FAILED')
      AND r.method='MOMO' AND p.method='MOMO'
      AND r.currency_code=NEW.currency_code
      AND p.currency_code=NEW.currency_code
      AND a.currency_code=NEW.currency_code
      AND p.amount_minor=NEW.original_payment_minor
      AND r.amount_minor=NEW.refund_amount_minor
      AND a.expected_amount_minor=NEW.original_payment_minor
      AND a.state='RECONCILED'
      AND a.verified_provider_transaction_id=NEW.original_transaction_id
      AND p.provider_reference=NEW.original_transaction_id
  ) THEN
    RAISE EXCEPTION 'Original-order observation does not match authenticated refund ownership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refund_provider_original_order_guard
BEFORE INSERT OR UPDATE OR DELETE ON refund_provider_order_observations
FOR EACH ROW EXECUTE FUNCTION guard_refund_provider_original_order_observation();

COMMIT;
