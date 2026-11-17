BEGIN;

-- Evidence from independently polled provider TEST APIs, not financial finality.
-- Never treat these rows as authorization to complete sales or book money.
CREATE TABLE gateway_sandbox_verification_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES gateway_collection_attempts(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  provider_code text NOT NULL CHECK (provider_code IN ('PAYSTACK','FLUTTERWAVE')),
  environment text NOT NULL DEFAULT 'TEST' CHECK (environment='TEST'),
  merchant_connection_revision integer NOT NULL CHECK (merchant_connection_revision > 0),
  observation_kind text NOT NULL CHECK (observation_kind IN ('SANDBOX_PAID','SANDBOX_UNPAID')),
  provider_transaction_id text,
  amount_minor bigint,
  currency_code char(3),
  payment_method text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id,observation_kind),
  UNIQUE (provider_code,provider_transaction_id),
  CHECK (
    (observation_kind='SANDBOX_UNPAID' AND provider_transaction_id IS NULL
      AND amount_minor IS NULL AND currency_code IS NULL AND payment_method IS NULL)
    OR
    (observation_kind='SANDBOX_PAID' AND provider_transaction_id IS NOT NULL
      AND provider_transaction_id ~ '^[A-Za-z0-9_-]{1,128}$'
      AND amount_minor > 0 AND currency_code IS NOT NULL
      AND payment_method IN ('MOMO','CARD'))
  )
);
CREATE INDEX idx_gateway_sandbox_observations_business
  ON gateway_sandbox_verification_observations(business_id,observed_at DESC);

-- DB guard ensures even a mistaken internal caller cannot write different
-- merchant/provider/reference amount evidence or fabricated financial finality.
CREATE FUNCTION validate_gateway_sandbox_observation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gateway_collection_attempts a
    WHERE a.id=NEW.attempt_id AND a.business_id=NEW.business_id
      AND a.provider_code=NEW.provider_code
      AND a.environment=NEW.environment
      AND a.merchant_connection_revision=NEW.merchant_connection_revision
      AND a.state='PREPARED'
      AND (
        NEW.observation_kind='SANDBOX_UNPAID' OR
        (a.expected_amount_minor=NEW.amount_minor
          AND a.currency_code=NEW.currency_code
          AND a.payment_method=NEW.payment_method)
      )
  ) THEN
    RAISE EXCEPTION 'Sandbox observation does not match original merchant payment attempt';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gateway_sandbox_observation_scope
BEFORE INSERT ON gateway_sandbox_verification_observations
FOR EACH ROW EXECUTE FUNCTION validate_gateway_sandbox_observation();

CREATE FUNCTION reject_gateway_sandbox_observation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sandbox payment evidence is immutable';
END;
$$;
CREATE TRIGGER gateway_sandbox_observation_immutable
BEFORE UPDATE OR DELETE ON gateway_sandbox_verification_observations
FOR EACH ROW EXECUTE FUNCTION reject_gateway_sandbox_observation_change();

COMMIT;
