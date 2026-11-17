BEGIN;

-- Provider-neutral, immutable payment-intent snapshot. PREPARATION IS NOT A
-- CHARGE OR A PAYMENT. This release admits TEST records only, and explicitly
-- has no PAID/SUCCEEDED state or path to cashbook/stock finality.
CREATE TABLE gateway_collection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  provider_code text NOT NULL CHECK(provider_code IN ('PAYSTACK','FLUTTERWAVE')),
  environment text NOT NULL DEFAULT 'TEST' CHECK(environment='TEST'),
  merchant_connection_revision integer NOT NULL CHECK(merchant_connection_revision>0),
  client_request_id uuid NOT NULL,
  client_reference varchar(36) NOT NULL CHECK(
    client_reference ~ '^TSP-[0-9a-f]{24}$'
  ),
  expected_amount_minor bigint NOT NULL CHECK(expected_amount_minor>0),
  currency_code char(3) NOT NULL,
  payment_method text NOT NULL CHECK(payment_method IN ('MOMO','CARD')),
  state text NOT NULL DEFAULT 'PREPARED'
    CHECK(state IN ('PREPARED','CANCELLED','REVIEW_REQUIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,client_request_id),
  UNIQUE (provider_code,client_reference),
  UNIQUE (payment_id),
  UNIQUE (business_id,sale_id)
);
CREATE INDEX idx_gateway_collection_attempt_monitor
  ON gateway_collection_attempts(business_id,created_at DESC,id DESC);

-- Guard both INSERT and updates against mismatching the canonical sale and
-- payment. Existing Hubtel attempts are intentionally not rewritten.
CREATE FUNCTION verify_gateway_collection_attempt_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (
      NEW.business_id,NEW.branch_id,NEW.sale_id,NEW.payment_id,
      NEW.provider_code,NEW.environment,NEW.merchant_connection_revision,
      NEW.client_request_id,NEW.client_reference,NEW.expected_amount_minor,
      NEW.currency_code,NEW.payment_method,NEW.created_at
    ) IS DISTINCT FROM (
      OLD.business_id,OLD.branch_id,OLD.sale_id,OLD.payment_id,
      OLD.provider_code,OLD.environment,OLD.merchant_connection_revision,
      OLD.client_request_id,OLD.client_reference,OLD.expected_amount_minor,
      OLD.currency_code,OLD.payment_method,OLD.created_at
    ) THEN
      RAISE EXCEPTION 'Gateway payment attempt identity is immutable';
    END IF;
    IF OLD.state <> 'PREPARED' AND NEW.state <> OLD.state THEN
      RAISE EXCEPTION 'Final gateway test attempt state cannot be reopened';
    END IF;
    RETURN NEW;
  END IF;
  -- Connection authorization and canonical amount are checked on creation;
  -- later cancellation/review must remain possible even after key rotation
  -- or merchant account suspension.
  IF NOT EXISTS (
    SELECT 1 FROM sales s
    JOIN payments p ON p.sale_id=s.id AND p.business_id=s.business_id
    WHERE s.id=NEW.sale_id AND p.id=NEW.payment_id
      AND s.business_id=NEW.business_id AND p.business_id=NEW.business_id
      AND s.branch_id=NEW.branch_id AND p.branch_id=NEW.branch_id
      AND s.currency_code=NEW.currency_code AND p.currency_code=NEW.currency_code
      AND p.amount_minor=NEW.expected_amount_minor
      AND s.total_minor=NEW.expected_amount_minor
      AND s.status='OPEN' AND p.status='PENDING'
      AND p.method=NEW.payment_method
  ) THEN
    RAISE EXCEPTION 'Gateway attempt must match one open canonical sale/payment';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_gateway_connections c
    WHERE c.business_id=NEW.business_id AND c.provider_code=NEW.provider_code
      AND c.environment='TEST' AND c.connection_status='PENDING_VERIFICATION'
      AND c.revision=NEW.merchant_connection_revision
      AND c.enabled=false
  ) THEN
    RAISE EXCEPTION 'Gateway attempt must bind a tenant TEST connection revision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gateway_collection_attempt_scope
BEFORE INSERT OR UPDATE ON gateway_collection_attempts
FOR EACH ROW EXECUTE FUNCTION verify_gateway_collection_attempt_scope();

CREATE TABLE gateway_collection_attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES gateway_collection_attempts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  event_type text NOT NULL CHECK(event_type IN (
    'PREPARED','CANCELLED','FLAGGED_FOR_REVIEW'
  )),
  event_time timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES app_users(id),
  note_code text,
  CHECK(note_code IS NULL OR note_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
CREATE INDEX idx_gateway_collection_events
  ON gateway_collection_attempt_events(business_id,event_time DESC);

-- Attempts never change ownership through an event; do not accept a forged
-- business_id even from a trusted internal caller.
CREATE FUNCTION verify_gateway_attempt_event_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM gateway_collection_attempts a
    WHERE a.id=NEW.attempt_id AND a.business_id=NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Gateway audit event must belong to its attempt owner';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER gateway_attempt_event_scope
BEFORE INSERT ON gateway_collection_attempt_events
FOR EACH ROW EXECUTE FUNCTION verify_gateway_attempt_event_scope();

-- Ledger audit cannot be amended or erased through ordinary mutations.
CREATE FUNCTION reject_gateway_attempt_event_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Gateway attempt event history is append-only';
END;
$$;
CREATE TRIGGER gateway_attempt_event_immutable
BEFORE UPDATE OR DELETE ON gateway_collection_attempt_events
FOR EACH ROW EXECUTE FUNCTION reject_gateway_attempt_event_change();

COMMIT;
