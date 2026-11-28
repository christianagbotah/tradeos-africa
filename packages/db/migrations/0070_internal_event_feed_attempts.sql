BEGIN;
-- Durable attempt state is separate from immutable delivered feed receipts.
-- No existing outbox records are marked delivered or backfilled.
CREATE TABLE internal_event_feed_attempts (
  outbox_event_id uuid PRIMARY KEY REFERENCES outbox_events(id) ON DELETE RESTRICT,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 1 AND 8),
  state text NOT NULL CHECK (state IN ('RETRY','REVIEW','DELIVERED')),
  next_retry_at timestamptz,
  last_error_code text NOT NULL CHECK (last_error_code='DELIVERY_NOT_VERIFIED'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state='RETRY' AND next_retry_at IS NOT NULL AND attempt_count<8)
    OR (state='REVIEW' AND next_retry_at IS NULL AND attempt_count=8)
    OR (state='DELIVERED' AND next_retry_at IS NULL))
);
CREATE INDEX internal_event_feed_retry_due ON internal_event_feed_attempts(next_retry_at)
  WHERE state='RETRY';
COMMIT;
