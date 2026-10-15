BEGIN;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_users_email_lower
  ON platform_users(lower(email));

CREATE TABLE platform_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  device_key text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WEB', 'WINDOWS', 'MACOS', 'ANDROID', 'IOS')),
  session_token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_admin_sessions_active
  ON platform_admin_sessions(session_token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_platform_admin_sessions_user
  ON platform_admin_sessions(platform_user_id, created_at DESC);

COMMIT;
