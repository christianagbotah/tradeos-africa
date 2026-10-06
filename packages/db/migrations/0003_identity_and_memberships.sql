BEGIN;

ALTER TABLE businesses
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED'));

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text,
  phone_e164 text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX uq_app_users_email_lower
  ON app_users(lower(email))
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_app_users_phone
  ON app_users(phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE TABLE business_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN (
    'OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES', 'INVENTORY',
    'ACCOUNTANT', 'STAFF', 'VIEWER'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
  created_by_user_id uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  device_key text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WEB', 'WINDOWS', 'MACOS', 'ANDROID', 'IOS')),
  app_version text NOT NULL,
  access_token_hash char(64) NOT NULL UNIQUE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_memberships_user_status
  ON business_memberships(user_id, status, business_id);
CREATE INDEX idx_business_memberships_business_role
  ON business_memberships(business_id, status, role);
CREATE INDEX idx_auth_sessions_access_active
  ON auth_sessions(access_token_hash, access_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_refresh_active
  ON auth_sessions(refresh_token_hash, refresh_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_user
  ON auth_sessions(user_id, created_at DESC);

COMMIT;
