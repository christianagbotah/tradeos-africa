BEGIN;

-- Public demo tenant used only by the login-page demo selector.
-- Credentials intentionally share one public password; authorization still flows
-- through the normal app_users/auth_sessions/business_memberships model.
INSERT INTO businesses (
  id,name,country_code,currency_code,business_type,timezone,status
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'TradeOS Demo Company',
  'GH',
  'GHS',
  'DISTRIBUTION',
  'Africa/Accra',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,
  country_code=EXCLUDED.country_code,
  currency_code=EXCLUDED.currency_code,
  business_type=EXCLUDED.business_type,
  timezone=EXCLUDED.timezone,
  status='ACTIVE',
  updated_at=now();

INSERT INTO branches (
  id,business_id,name,code,timezone,is_active
) VALUES (
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'Main Demo Branch',
  'MAIN',
  'Africa/Accra',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name,
  timezone=EXCLUDED.timezone,
  is_active=true;

INSERT INTO staff (id,business_id,display_name,email,role,is_active) VALUES
  ('70000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000001','Demo Business Owner','demo.owner@tradeos.africa','OWNER',true),
  ('70000000-0000-4000-8000-000000000102','70000000-0000-4000-8000-000000000001','Demo Business Admin','demo.admin@tradeos.africa','ADMIN',true),
  ('70000000-0000-4000-8000-000000000103','70000000-0000-4000-8000-000000000001','Demo Branch Manager','demo.manager@tradeos.africa','MANAGER',true),
  ('70000000-0000-4000-8000-000000000104','70000000-0000-4000-8000-000000000001','Demo Cashier','demo.cashier@tradeos.africa','CASHIER',true),
  ('70000000-0000-4000-8000-000000000105','70000000-0000-4000-8000-000000000001','Demo Sales Officer','demo.sales@tradeos.africa','SALES',true),
  ('70000000-0000-4000-8000-000000000106','70000000-0000-4000-8000-000000000001','Demo Inventory Officer','demo.inventory@tradeos.africa','INVENTORY',true),
  ('70000000-0000-4000-8000-000000000107','70000000-0000-4000-8000-000000000001','Demo Accountant','demo.accountant@tradeos.africa','ACCOUNTANT',true),
  ('70000000-0000-4000-8000-000000000108','70000000-0000-4000-8000-000000000001','Demo Staff','demo.staff@tradeos.africa','STAFF',true),
  ('70000000-0000-4000-8000-000000000109','70000000-0000-4000-8000-000000000001','Demo Viewer','demo.viewer@tradeos.africa','VIEWER',true)
ON CONFLICT (id) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  email=EXCLUDED.email,
  role=EXCLUDED.role,
  is_active=true;

WITH demo_users(display_name,email) AS (
  VALUES
    ('Demo Business Owner','demo.owner@tradeos.africa'),
    ('Demo Business Admin','demo.admin@tradeos.africa'),
    ('Demo Branch Manager','demo.manager@tradeos.africa'),
    ('Demo Cashier','demo.cashier@tradeos.africa'),
    ('Demo Sales Officer','demo.sales@tradeos.africa'),
    ('Demo Inventory Officer','demo.inventory@tradeos.africa'),
    ('Demo Accountant','demo.accountant@tradeos.africa'),
    ('Demo Staff','demo.staff@tradeos.africa'),
    ('Demo Viewer','demo.viewer@tradeos.africa')
)
UPDATE app_users AS u SET
  display_name=d.display_name,
  password_hash='scrypt:v1:KNN83qcT2ixSLCdnbKqrDg:EH4qec8K_nzJ9x8vtrRFOHBu8mw5w6-g7kBqI1-gFTzhUmrUPthLGmyzcCUkEW9mHwmZfvrv-im4izq4-CogYA',
  status='ACTIVE',
  email_verified_at=COALESCE(u.email_verified_at,now()),
  updated_at=now()
FROM demo_users AS d
WHERE lower(u.email)=lower(d.email);

WITH demo_users(display_name,email) AS (
  VALUES
    ('Demo Business Owner','demo.owner@tradeos.africa'),
    ('Demo Business Admin','demo.admin@tradeos.africa'),
    ('Demo Branch Manager','demo.manager@tradeos.africa'),
    ('Demo Cashier','demo.cashier@tradeos.africa'),
    ('Demo Sales Officer','demo.sales@tradeos.africa'),
    ('Demo Inventory Officer','demo.inventory@tradeos.africa'),
    ('Demo Accountant','demo.accountant@tradeos.africa'),
    ('Demo Staff','demo.staff@tradeos.africa'),
    ('Demo Viewer','demo.viewer@tradeos.africa')
)
INSERT INTO app_users (display_name,email,password_hash,status,email_verified_at)
SELECT
  d.display_name,
  d.email,
  'scrypt:v1:KNN83qcT2ixSLCdnbKqrDg:EH4qec8K_nzJ9x8vtrRFOHBu8mw5w6-g7kBqI1-gFTzhUmrUPthLGmyzcCUkEW9mHwmZfvrv-im4izq4-CogYA',
  'ACTIVE',
  now()
FROM demo_users AS d
WHERE NOT EXISTS (
  SELECT 1 FROM app_users AS u WHERE lower(u.email)=lower(d.email)
);

WITH demo_members(email,role,staff_id) AS (
  VALUES
    ('demo.owner@tradeos.africa','OWNER','70000000-0000-4000-8000-000000000101'::uuid),
    ('demo.admin@tradeos.africa','ADMIN','70000000-0000-4000-8000-000000000102'::uuid),
    ('demo.manager@tradeos.africa','MANAGER','70000000-0000-4000-8000-000000000103'::uuid),
    ('demo.cashier@tradeos.africa','CASHIER','70000000-0000-4000-8000-000000000104'::uuid),
    ('demo.sales@tradeos.africa','SALES','70000000-0000-4000-8000-000000000105'::uuid),
    ('demo.inventory@tradeos.africa','INVENTORY','70000000-0000-4000-8000-000000000106'::uuid),
    ('demo.accountant@tradeos.africa','ACCOUNTANT','70000000-0000-4000-8000-000000000107'::uuid),
    ('demo.staff@tradeos.africa','STAFF','70000000-0000-4000-8000-000000000108'::uuid),
    ('demo.viewer@tradeos.africa','VIEWER','70000000-0000-4000-8000-000000000109'::uuid)
)
INSERT INTO business_memberships (
  business_id,user_id,staff_id,role,status,created_by_user_id
)
SELECT
  '70000000-0000-4000-8000-000000000001'::uuid,
  u.id,
  d.staff_id,
  d.role,
  'ACTIVE',
  (SELECT id FROM app_users WHERE lower(email)='demo.owner@tradeos.africa' LIMIT 1)
FROM demo_members AS d
JOIN app_users AS u ON lower(u.email)=lower(d.email)
ON CONFLICT (business_id,user_id) DO UPDATE SET
  staff_id=EXCLUDED.staff_id,
  role=EXCLUDED.role,
  status='ACTIVE',
  updated_at=now();

COMMIT;
