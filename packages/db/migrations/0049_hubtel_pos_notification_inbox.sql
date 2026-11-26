BEGIN;

-- Hubtel checkout callbacks have no authenticated signature in the published
-- Online Checkout v1 contract. An incoming callback is merely a notification
-- hint, NEVER proof of payment. Authoritative status comes from Hubtel's
-- independent server-to-server transaction-status API.
CREATE TABLE hubtel_pos_notification_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES hubtel_sale_checkout_attempts(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  client_reference varchar(32) NOT NULL CHECK(
    client_reference ~ '^TSP-[0-9a-f]{24}$'),
  notification_digest char(64) NOT NULL CHECK(
    notification_digest ~ '^[0-9a-f]{64}$'),
  status_hint text NOT NULL CHECK(status_hint IN
    ('SUCCESS_CLAIM','FAILED_CLAIM','REFUNDED_CLAIM','UNKNOWN_CLAIM')),
  trust_level text NOT NULL DEFAULT 'UNTRUSTED'
    CHECK(trust_level='UNTRUSTED'),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attempt_id,notification_digest)
);
CREATE INDEX idx_hubtel_notification_inbox_attempt
  ON hubtel_pos_notification_inbox(attempt_id,received_at DESC);
CREATE INDEX idx_hubtel_notification_inbox_business
  ON hubtel_pos_notification_inbox(business_id,received_at DESC);

CREATE FUNCTION guard_hubtel_notification_inbox()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Hubtel callback hints are append-only and never financial proof';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hubtel_sale_checkout_attempts a
    WHERE a.id=NEW.attempt_id AND a.business_id=NEW.business_id
      AND a.client_reference=NEW.client_reference
  ) THEN
    RAISE EXCEPTION 'Hubtel callback does not match the owning checkout';
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER hubtel_notification_inbox_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hubtel_pos_notification_inbox
  FOR EACH ROW EXECUTE FUNCTION guard_hubtel_notification_inbox();

COMMIT;
