BEGIN;
CREATE TABLE business_gateway_connections (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK(provider_code IN ('PAYSTACK','FLUTTERWAVE')),
  environment text NOT NULL DEFAULT 'TEST' CHECK(environment='TEST'),
  connection_status text NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK(connection_status IN ('PENDING_VERIFICATION','REVOKED')),
  encrypted_secret bytea, nonce bytea, auth_tag bytea,
  vault_key_version integer NOT NULL DEFAULT 1 CHECK(vault_key_version=1),
  enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  changed_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,provider_code),
  CHECK (
    (connection_status='PENDING_VERIFICATION' AND encrypted_secret IS NOT NULL
       AND octet_length(encrypted_secret)>0 AND octet_length(nonce)=12
       AND octet_length(auth_tag)=16)
    OR
    (connection_status='REVOKED' AND encrypted_secret IS NULL
       AND nonce IS NULL AND auth_tag IS NULL)
  )
);
CREATE TABLE business_gateway_connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK(provider_code IN ('PAYSTACK','FLUTTERWAVE')),
  environment text NOT NULL CHECK(environment='TEST'),
  event_type text NOT NULL CHECK(event_type IN ('TEST_KEY_SAVED','CONNECTION_REVOKED')),
  revision integer NOT NULL CHECK(revision>0),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,provider_code,revision)
);
CREATE INDEX idx_business_gateway_connection_audit
  ON business_gateway_connection_audit(business_id,occurred_at DESC);
COMMIT;
