BEGIN;

ALTER TABLE app_users
  ADD COLUMN avatar_url text;

CREATE TABLE account_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_account_security_events_user_time
  ON account_security_events(user_id, occurred_at DESC);

COMMIT;
