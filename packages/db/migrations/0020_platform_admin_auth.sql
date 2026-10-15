BEGIN;

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE platform_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
  device_key text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WEB', 'WINDOWS', 'MACOS', 'ANDROID', 'IOS')),
  access_token_hash char(64) NOT NULL UNIQUE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_admin_sessions_access_active
  ON platform_admin_sessions(access_token_hash, access_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_platform_admin_sessions_refresh_active
  ON platform_admin_sessions(refresh_token_hash, refresh_expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_platform_admin_sessions_user
  ON platform_admin_sessions(platform_user_id, created_at DESC);

COMMIT;
