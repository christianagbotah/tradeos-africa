BEGIN;

-- Historical investigation case comments and support references. An entry is
-- NOT provider-authenticated settlement/cancellation proof and never permits
-- stock release, receipt creation, valuation changes or payment mutation.
CREATE TABLE hubtel_pos_cancellation_investigation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid NOT NULL REFERENCES hubtel_pos_cancellation_investigations(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  client_request_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN (
    'PROVIDER_CONTACTED','PROVIDER_REPLY_RECORDED',
    'CUSTOMER_FOLLOWUP','INTERNAL_NOTE')),
  provider_report text NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (provider_report IN (
      'NOT_APPLICABLE','UNPAID_REPORTED','PAID_REPORTED','INCONCLUSIVE')),
  evidence_reference varchar(160),
  note varchar(700) NOT NULL CHECK (char_length(btrim(note)) BETWEEN 20 AND 700),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id,client_request_id),
  CHECK (
    (event_kind='PROVIDER_REPLY_RECORDED'
      AND evidence_reference IS NOT NULL
      AND provider_report<>'NOT_APPLICABLE')
    OR (event_kind<>'PROVIDER_REPLY_RECORDED'
      AND provider_report='NOT_APPLICABLE')
  ),
  CHECK(evidence_reference IS NULL OR
    (char_length(evidence_reference) BETWEEN 6 AND 160
     AND evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9 _.:/-]*$'))
);

CREATE INDEX idx_hubtel_cancellation_investigation_events_case
  ON hubtel_pos_cancellation_investigation_events
  (business_id,investigation_id,created_at,id);

CREATE FUNCTION guard_hubtel_cancellation_investigation_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Hubtel investigation evidence events are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hubtel_pos_cancellation_investigations c
    WHERE c.id=NEW.investigation_id AND c.business_id=NEW.business_id
      AND c.branch_id=NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Investigation event does not match its merchant branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_memberships m
    WHERE m.business_id=NEW.business_id AND m.user_id=NEW.actor_user_id
      AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
  ) THEN
    RAISE EXCEPTION 'Investigation evidence requires an authorized merchant member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hubtel_cancellation_investigation_event_guard
BEFORE INSERT OR UPDATE OR DELETE ON hubtel_pos_cancellation_investigation_events
FOR EACH ROW EXECUTE FUNCTION guard_hubtel_cancellation_investigation_event();

COMMIT;
