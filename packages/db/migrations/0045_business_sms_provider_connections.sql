BEGIN;

-- Merchant-owned SMS provider credential vault; storage DOES NOT authorize
-- delivery. No SMS send or bulk campaign route is introduced by this schema.
CREATE TABLE business_sms_provider_connections (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK (
    provider_code IN ('ARKESEL','NALO','HUBTEL_SMS','TWILIO')),
  account_id text,
  sender_id text NOT NULL CHECK(
    length(sender_id) BETWEEN 1 AND 40 AND
    sender_id ~ '^[A-Za-z0-9+_-]+$'),
  credential_status text NOT NULL DEFAULT 'SAVED_UNVERIFIED'
    CHECK (credential_status IN ('SAVED_UNVERIFIED','REVOKED')),
  encrypted_secret bytea,
  nonce bytea,
  auth_tag bytea,
  vault_key_version integer NOT NULL DEFAULT 1 CHECK(vault_key_version=1),
  enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  changed_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,provider_code),
  CHECK(
    (credential_status='SAVED_UNVERIFIED' AND
      encrypted_secret IS NOT NULL AND octet_length(encrypted_secret)>0
      AND octet_length(nonce)=12 AND octet_length(auth_tag)=16)
    OR
    (credential_status='REVOKED' AND encrypted_secret IS NULL
      AND nonce IS NULL AND auth_tag IS NULL)
  )
);
CREATE TABLE business_sms_provider_connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK (
    provider_code IN ('ARKESEL','NALO','HUBTEL_SMS','TWILIO')),
  event_type text NOT NULL CHECK (
    event_type IN ('CREDENTIAL_SAVED','CREDENTIAL_REVOKED')),
  revision integer NOT NULL CHECK(revision > 0),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,provider_code,revision)
);
CREATE INDEX idx_sms_provider_audit_business
  ON business_sms_provider_connection_audit(business_id,occurred_at DESC);

COMMIT;
