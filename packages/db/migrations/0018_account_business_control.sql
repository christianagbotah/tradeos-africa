BEGIN;

ALTER TABLE app_users
  ADD COLUMN avatar_url text;

ALTER TABLE businesses
  ADD COLUMN legal_name text,
  ADD COLUMN email text,
  ADD COLUMN phone text,
  ADD COLUMN registration_number text,
  ADD COLUMN tax_id text,
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city text,
  ADD COLUMN region text,
  ADD COLUMN postal_code text,
  ADD COLUMN logo_url text;

ALTER TABLE branches
  ADD COLUMN email text,
  ADD COLUMN phone text,
  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city text,
  ADD COLUMN region text,
  ADD COLUMN postal_code text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

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
