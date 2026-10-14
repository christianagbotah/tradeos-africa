BEGIN;

CREATE TABLE managed_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('AVATAR', 'BUSINESS_LOGO')),
  owner_user_id uuid REFERENCES app_users(id),
  business_id uuid REFERENCES businesses(id),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  storage_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  CHECK (
    (purpose='AVATAR' AND owner_user_id IS NOT NULL AND business_id IS NULL)
    OR
    (purpose='BUSINESS_LOGO' AND owner_user_id IS NULL AND business_id IS NOT NULL)
  )
);

CREATE INDEX idx_managed_media_owner_active
  ON managed_media(owner_user_id, created_at DESC)
  WHERE retired_at IS NULL AND owner_user_id IS NOT NULL;

CREATE INDEX idx_managed_media_business_active
  ON managed_media(business_id, created_at DESC)
  WHERE retired_at IS NULL AND business_id IS NOT NULL;

COMMIT;
