BEGIN;

CREATE TABLE platform_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'DEVELOPER', 'SUPPORT', 'BILLING', 'OPERATIONS')),
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  currency_code char(3) NOT NULL DEFAULT 'GHS',
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  billing_interval text NOT NULL CHECK (billing_interval IN ('MONTHLY', 'ANNUAL', 'CUSTOM')),
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_entitlements (
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  entitlement_code text NOT NULL,
  entitlement_value jsonb NOT NULL DEFAULT 'true'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, entitlement_code)
);

CREATE TABLE business_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  status text NOT NULL CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED')),
  provider text,
  provider_customer_reference text,
  provider_subscription_reference text,
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_business_current_subscription
  ON business_subscriptions(business_id)
  WHERE status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED');

CREATE TABLE business_entitlement_overrides (
  business_id uuid NOT NULL REFERENCES businesses(id),
  entitlement_code text NOT NULL,
  entitlement_value jsonb NOT NULL,
  reason text NOT NULL,
  expires_at timestamptz,
  updated_by_platform_user_id uuid REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, entitlement_code)
);

CREATE TABLE registered_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  device_key text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('WEB', 'WINDOWS', 'MACOS', 'ANDROID', 'IOS')),
  app_version text NOT NULL,
  release_channel text NOT NULL DEFAULT 'STABLE' CHECK (release_channel IN ('STABLE', 'BETA', 'INTERNAL')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'RETIRED')),
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, device_key)
);

CREATE TABLE client_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('WEB', 'WINDOWS', 'MACOS', 'ANDROID', 'IOS')),
  version text NOT NULL,
  build_number text,
  release_channel text NOT NULL DEFAULT 'STABLE' CHECK (release_channel IN ('STABLE', 'BETA', 'INTERNAL')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ROLLOUT', 'ACTIVE', 'WITHDRAWN')),
  minimum_supported_version text,
  rollout_percent numeric(5,2) NOT NULL DEFAULT 100 CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  release_notes text,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, version, release_channel)
);

CREATE TABLE platform_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  business_id uuid REFERENCES businesses(id),
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_platform_user_id uuid REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_platform_global_feature_flag
  ON platform_feature_flags(code)
  WHERE business_id IS NULL;

CREATE UNIQUE INDEX uq_platform_business_feature_flag
  ON platform_feature_flags(code, business_id)
  WHERE business_id IS NOT NULL;

CREATE TABLE platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid REFERENCES platform_users(id),
  business_id uuid REFERENCES businesses(id),
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_subscriptions_business_time
  ON business_subscriptions(business_id, created_at DESC);
CREATE INDEX idx_registered_devices_business_status
  ON registered_devices(business_id, status, last_seen_at DESC);
CREATE INDEX idx_client_releases_platform_channel
  ON client_releases(platform, release_channel, created_at DESC);
CREATE INDEX idx_platform_audit_events_business_time
  ON platform_audit_events(business_id, occurred_at DESC);
CREATE INDEX idx_platform_audit_events_user_time
  ON platform_audit_events(platform_user_id, occurred_at DESC);

COMMIT;
