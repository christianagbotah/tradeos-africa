BEGIN;

-- Internal durable subscriber for outbox events. This is NOT an external
-- webhook, SMS, provider settlement, or independent backup.
-- published_at is only updated after a verified insert of the SAME event
-- into this queryable, branch-scoped inbox in the SAME DB transaction.
CREATE TABLE business_event_feed (
  outbox_event_id uuid PRIMARY KEY REFERENCES outbox_events(id) ON DELETE RESTRICT,
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_event_feed_branch_scope
    FOREIGN KEY (business_id,branch_id) REFERENCES branches(business_id,id)
);

CREATE INDEX idx_business_event_feed_branch_recent
  ON business_event_feed(business_id,branch_id,occurred_at DESC,outbox_event_id DESC);

-- Prevent fabricated/mis-scoped feed events and modification of receipts.
-- No raw provider payload or customer personal data is copied into this feed.
CREATE FUNCTION guard_business_event_feed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Internal event feed is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM outbox_events o
    WHERE o.id=NEW.outbox_event_id AND o.business_id=NEW.business_id
      AND o.branch_id IS NOT DISTINCT FROM NEW.branch_id
      AND o.aggregate_type=NEW.aggregate_type
      AND o.aggregate_id=NEW.aggregate_id AND o.event_type=NEW.event_type
      AND o.occurred_at=NEW.occurred_at
  ) THEN
    RAISE EXCEPTION 'Event feed record must match its canonical outbox source';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_event_feed_guard
  BEFORE INSERT OR UPDATE OR DELETE ON business_event_feed
  FOR EACH ROW EXECUTE FUNCTION guard_business_event_feed();

COMMIT;
