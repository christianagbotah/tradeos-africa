BEGIN;

-- Merchant refund follow-up evidence is an append-only activity history.
-- These operator notes NEVER establish provider payout finality.
CREATE TABLE refund_followup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  refund_transaction_id uuid NOT NULL REFERENCES refund_transactions(id),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  client_request_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN (
    'INTERNAL_NOTE','CUSTOMER_CONTACTED','PROVIDER_CONTACTED',
    'ESCALATED','ESCALATION_REVIEWED')),
  evidence_reference varchar(160),
  note varchar(700) NOT NULL CHECK (char_length(btrim(note)) BETWEEN 20 AND 700),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (refund_transaction_id,client_request_id),
  CHECK (evidence_reference IS NULL OR (
    char_length(evidence_reference) BETWEEN 6 AND 160
    AND evidence_reference ~ '^[A-Za-z0-9][A-Za-z0-9 _.:/-]*$'
    AND evidence_reference !~ '://'))
);

CREATE INDEX idx_refund_followups_refund_timeline
 ON refund_followup_events(business_id,branch_id,refund_transaction_id,created_at DESC,id DESC);
CREATE INDEX idx_refund_followups_escalation
 ON refund_followup_events(business_id,branch_id,refund_transaction_id,created_at DESC,id DESC)
 WHERE event_kind IN ('ESCALATED','ESCALATION_REVIEWED');

CREATE FUNCTION guard_refund_followup_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Refund follow-up evidence is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM refund_transactions rt
    JOIN return_cases rc ON rc.id=rt.return_case_id AND rc.business_id=rt.business_id
    WHERE rt.id=NEW.refund_transaction_id
      AND rt.business_id=NEW.business_id AND rc.branch_id=NEW.branch_id
      AND rt.status IN ('PENDING','FAILED')
  ) THEN
    RAISE EXCEPTION 'Refund follow-up requires an unresolved refund in the same branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM business_memberships m
    WHERE m.business_id=NEW.business_id AND m.user_id=NEW.actor_user_id
      AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
  ) THEN
    RAISE EXCEPTION 'Refund follow-up requires an authorized active merchant member';
  END IF;
  -- An escalation can only be reviewed if the latest escalation action
  -- is outstanding; review cannot be used as fictitious payout confirmation.
  IF NEW.event_kind='ESCALATION_REVIEWED' AND COALESCE((
    SELECT e.event_kind='ESCALATED'
    FROM refund_followup_events e
    WHERE e.refund_transaction_id=NEW.refund_transaction_id
      AND e.event_kind IN ('ESCALATED','ESCALATION_REVIEWED')
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1
  ),false)=false THEN
    RAISE EXCEPTION 'There is no outstanding refund escalation to review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER refund_followup_event_guard
BEFORE INSERT OR UPDATE OR DELETE ON refund_followup_events
FOR EACH ROW EXECUTE FUNCTION guard_refund_followup_event();

COMMIT;
