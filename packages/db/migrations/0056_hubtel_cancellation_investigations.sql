BEGIN;

-- A merchant can request investigation of a pending Hubtel checkout.
-- This record is NOT a provider void, payment-finality certificate,
-- stock release instruction or authorization for an accounting reversal.
CREATE TABLE hubtel_pos_cancellation_investigations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  sale_id uuid NOT NULL REFERENCES sales(id),
  attempt_id uuid NOT NULL REFERENCES hubtel_sale_checkout_attempts(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  requested_by_user_id uuid NOT NULL REFERENCES app_users(id),
  reason varchar(700) NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 700),
  status text NOT NULL DEFAULT 'AWAITING_PROVIDER_INVESTIGATION'
    CHECK (status='AWAITING_PROVIDER_INVESTIGATION'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,sale_id),
  UNIQUE(attempt_id)
);
CREATE INDEX idx_hubtel_cancel_investigations_business
  ON hubtel_pos_cancellation_investigations(business_id,branch_id,created_at DESC);

CREATE FUNCTION guard_hubtel_cancel_investigation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Cancellation investigation requests are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hubtel_sale_checkout_attempts a
    JOIN sales s ON s.id=a.sale_id
    JOIN payments p ON p.id=a.payment_id AND p.sale_id=s.id
    WHERE a.id=NEW.attempt_id
      AND a.business_id=NEW.business_id
      AND a.branch_id=NEW.branch_id
      AND a.sale_id=NEW.sale_id
      AND p.id=NEW.payment_id
      AND s.business_id=NEW.business_id
      AND s.branch_id=NEW.branch_id
      AND p.business_id=NEW.business_id
      AND p.branch_id=NEW.branch_id
      AND s.status='OPEN' AND p.status='PENDING'
      AND a.state IN ('PREPARED','READY','PENDING_VERIFICATION','REVIEW_REQUIRED')
  ) THEN
    RAISE EXCEPTION 'Cancellation investigation must match an unresolved merchant checkout';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_memberships m
    WHERE m.business_id=NEW.business_id AND m.user_id=NEW.requested_by_user_id
      AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
  ) THEN
    RAISE EXCEPTION 'Cancellation investigation requires authorized active merchant membership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hubtel_cancel_investigation_guard
BEFORE INSERT OR UPDATE OR DELETE ON hubtel_pos_cancellation_investigations
FOR EACH ROW EXECUTE FUNCTION guard_hubtel_cancel_investigation();

COMMIT;
