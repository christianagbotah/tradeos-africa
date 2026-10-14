BEGIN;

ALTER TABLE staff
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE staff
  ADD CONSTRAINT staff_role_check CHECK (role IN (
    'OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES', 'INVENTORY',
    'ACCOUNTANT', 'STAFF', 'VIEWER'
  ));

CREATE TABLE staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  invited_email text,
  invited_phone_e164 text,
  role text NOT NULL CHECK (role IN (
    'OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'SALES', 'INVENTORY',
    'ACCOUNTANT', 'STAFF', 'VIEWER'
  )),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_by_staff_id uuid REFERENCES staff(id),
  accepted_by_user_id uuid REFERENCES app_users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (invited_email IS NOT NULL OR invited_phone_e164 IS NOT NULL)
);

CREATE UNIQUE INDEX uq_staff_invitations_live_pending
  ON staff_invitations(staff_id)
  WHERE status='PENDING';

CREATE INDEX idx_staff_invitations_business_created
  ON staff_invitations(business_id, created_at DESC);

CREATE INDEX idx_staff_invitations_expiry_pending
  ON staff_invitations(expires_at)
  WHERE status='PENDING';

COMMIT;
