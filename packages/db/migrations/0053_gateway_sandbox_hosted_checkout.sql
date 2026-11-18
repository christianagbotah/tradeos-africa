BEGIN;

-- One provider-hosted TEST checkout initiation per immutable merchant payment.
-- Once an external API has been called, an unknown outcome must never
-- automatically retry or reissue another checkout.
CREATE TABLE gateway_sandbox_hosted_checkouts (
  attempt_id uuid PRIMARY KEY REFERENCES gateway_collection_attempts(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  provider_code text NOT NULL CHECK (provider_code IN ('PAYSTACK','FLUTTERWAVE')),
  merchant_connection_revision integer NOT NULL CHECK (merchant_connection_revision>0),
  state text NOT NULL DEFAULT 'INITIATING'
    CHECK (state IN ('INITIATING','READY','OUTCOME_UNKNOWN')),
  checkout_url varchar(2048),
  initiated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state='READY' AND checkout_url IS NOT NULL) OR
    (state<>'READY' AND checkout_url IS NULL)
  )
);
CREATE INDEX gateway_sandbox_hosted_merchant_index
  ON gateway_sandbox_hosted_checkouts(business_id,initiated_at DESC);

CREATE FUNCTION guard_gateway_sandbox_hosted_checkout()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Provider TEST checkout evidence is not deletable';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'INITIATING' OR NEW.checkout_url IS NOT NULL THEN
      RAISE EXCEPTION 'Provider TEST checkout must begin as an unverified initiation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM gateway_collection_attempts a
      JOIN sales s ON s.id=a.sale_id AND s.business_id=a.business_id
      JOIN payments p ON p.id=a.payment_id AND p.business_id=a.business_id
      JOIN business_gateway_connections c
        ON c.business_id=a.business_id AND c.provider_code=a.provider_code
      WHERE a.id=NEW.attempt_id AND a.business_id=NEW.business_id
        AND a.provider_code=NEW.provider_code
        AND a.merchant_connection_revision=NEW.merchant_connection_revision
        AND a.environment='TEST' AND a.state='PREPARED'
        AND s.status='OPEN' AND p.status='PENDING'
        AND s.total_minor=a.expected_amount_minor
        AND p.amount_minor=a.expected_amount_minor
        AND c.environment='TEST' AND c.enabled=false
        AND c.connection_status='PENDING_VERIFICATION'
        AND c.revision=NEW.merchant_connection_revision
        AND NOT EXISTS(
          SELECT 1 FROM gateway_sandbox_verification_observations o
          WHERE o.attempt_id=a.id AND o.observation_kind='SANDBOX_PAID'
        )
    ) THEN
      RAISE EXCEPTION 'Only the same original merchant TEST attempt may initiate checkout';
    END IF;
  ELSE
    IF (NEW.attempt_id,NEW.business_id,NEW.provider_code,
        NEW.merchant_connection_revision,NEW.initiated_at)
       IS DISTINCT FROM
       (OLD.attempt_id,OLD.business_id,OLD.provider_code,
        OLD.merchant_connection_revision,OLD.initiated_at)
       OR OLD.state<>'INITIATING'
       OR NEW.state NOT IN ('READY','OUTCOME_UNKNOWN') THEN
      RAISE EXCEPTION 'Hosted TEST checkout identity or final state is immutable';
    END IF;
    IF NEW.state='READY' AND NOT (
      (NEW.provider_code='PAYSTACK' AND
       NEW.checkout_url ~ '^https://checkout[.]paystack[.]com/') OR
      (NEW.provider_code='FLUTTERWAVE' AND
       NEW.checkout_url ~ '^https://checkout[.]flutterwave[.]com/')
    ) THEN
      RAISE EXCEPTION 'Only provider-owned TEST checkout URLs are allowed';
    END IF;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER gateway_sandbox_hosted_guard
  BEFORE INSERT OR UPDATE OR DELETE ON gateway_sandbox_hosted_checkouts
  FOR EACH ROW EXECUTE FUNCTION guard_gateway_sandbox_hosted_checkout();

-- A generated external checkout link must not be presented as cancelled.
-- A merchant can instead escalate it for review; do not create a second link.
CREATE FUNCTION prevent_cancel_of_external_test_checkout()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='CANCELLED' AND OLD.state<>'CANCELLED'
    AND EXISTS(
      SELECT 1 FROM gateway_sandbox_hosted_checkouts h
      WHERE h.attempt_id=OLD.id
    ) THEN
    RAISE EXCEPTION 'A TEST checkout was already initiated; manual review is required';
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER gateway_prevent_issued_checkout_cancellation
  BEFORE UPDATE ON gateway_collection_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_cancel_of_external_test_checkout();

CREATE TABLE gateway_sandbox_hosted_checkout_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES gateway_sandbox_hosted_checkouts(attempt_id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  event_type text NOT NULL CHECK(event_type IN ('INITIATED','READY','OUTCOME_UNKNOWN')),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id,event_type)
);
CREATE INDEX gateway_sandbox_hosted_events_tenant
  ON gateway_sandbox_hosted_checkout_events(business_id,occurred_at DESC);
CREATE FUNCTION guard_gateway_sandbox_hosted_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'TEST checkout audit events are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM gateway_sandbox_hosted_checkouts h
    WHERE h.attempt_id=NEW.attempt_id AND h.business_id=NEW.business_id
      AND (NEW.event_type='INITIATED' AND h.state='INITIATING'
        OR NEW.event_type=h.state)
  ) THEN
    RAISE EXCEPTION 'TEST checkout event must belong to the exact merchant state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_memberships m
    WHERE m.business_id=NEW.business_id AND m.user_id=NEW.actor_user_id
      AND m.status='ACTIVE' AND m.role IN('OWNER','ADMIN')
  ) THEN
    RAISE EXCEPTION 'TEST checkout event requires a current merchant owner/admin';
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER gateway_sandbox_hosted_event_guard
  BEFORE INSERT OR UPDATE OR DELETE ON gateway_sandbox_hosted_checkout_events
  FOR EACH ROW EXECUTE FUNCTION guard_gateway_sandbox_hosted_event();

COMMIT;
