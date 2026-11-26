BEGIN;

-- One-use, short-lived recovery secrets are stored as SHA-256 hashes only.
-- Merchant and platform-administrator identities never share tokens or scope.
CREATE TABLE password_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_kind text NOT NULL CHECK (account_kind IN ('MERCHANT','PLATFORM_ADMIN')),
  app_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  platform_user_id uuid REFERENCES platform_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  email_snapshot text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT chk_password_recovery_owner CHECK (
    (account_kind='MERCHANT' AND app_user_id IS NOT NULL AND platform_user_id IS NULL)
    OR (account_kind='PLATFORM_ADMIN' AND platform_user_id IS NOT NULL AND app_user_id IS NULL)
  ),
  CONSTRAINT chk_password_recovery_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_password_recovery_app_user
  ON password_recovery_tokens(app_user_id,created_at DESC)
  WHERE app_user_id IS NOT NULL;
CREATE INDEX idx_password_recovery_admin_user
  ON password_recovery_tokens(platform_user_id,created_at DESC)
  WHERE platform_user_id IS NOT NULL;
CREATE INDEX idx_password_recovery_expiry
  ON password_recovery_tokens(expires_at)
  WHERE consumed_at IS NULL;

COMMIT;
