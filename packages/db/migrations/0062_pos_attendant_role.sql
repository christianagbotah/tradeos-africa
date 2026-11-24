BEGIN;

-- A distinct, least-privilege point-of-sale staff role. Existing CASHIER
-- accounts retain their historical permissions: no surprise downgrade.
ALTER TABLE business_memberships DROP CONSTRAINT IF EXISTS business_memberships_role_check;
ALTER TABLE business_memberships
  ADD CONSTRAINT business_memberships_role_check CHECK (role IN (
    'OWNER','ADMIN','MANAGER','CASHIER','POS_ATTENDANT','SALES','INVENTORY',
    'ACCOUNTANT','STAFF','VIEWER'
  ));

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role IN (
  'OWNER','ADMIN','MANAGER','CASHIER','POS_ATTENDANT','SALES','INVENTORY',
  'ACCOUNTANT','STAFF','VIEWER'
));

ALTER TABLE staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_check;
ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_role_check CHECK (role IN (
    'OWNER','ADMIN','MANAGER','CASHIER','POS_ATTENDANT','SALES','INVENTORY',
    'ACCOUNTANT','STAFF','VIEWER'
  ));

COMMIT;
