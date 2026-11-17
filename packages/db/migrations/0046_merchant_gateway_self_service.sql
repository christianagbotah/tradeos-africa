BEGIN;

-- Merchant-owned, provider-neutral encrypted credential records.
-- This is a provisioning and verification vault, NOT authority to charge.
-- Collection activation requires a separate audited payment release.
CREATE TABLE business_merchant_gateway_credentials (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK (provider_code IN
    ('HUBTEL','PAYSTACK','FLUTTERWAVE','STRIPE','PESAPAL','DPO','MPESA')),
  environment text NOT NULL CHECK (environment IN ('TEST','LIVE')),
  account_reference text,
  encrypted_credentials bytea,
  nonce bytea,
  auth_tag bytea,
  key_version integer NOT NULL DEFAULT 1 CHECK(key_version=1),
  status text NOT NULL DEFAULT 'SAVED_UNVERIFIED' CHECK
    (status IN ('SAVED_UNVERIFIED','VERIFIED','REVOKED')),
  verified_at timestamptz,
  activation_requested_at timestamptz,
  -- Database-enforced no-money boundary until POS release is fully audited.
  collection_enabled boolean NOT NULL DEFAULT false CHECK(collection_enabled=false),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  changed_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,provider_code,environment),
  CHECK(
    (status IN ('SAVED_UNVERIFIED','VERIFIED') AND
      encrypted_credentials IS NOT NULL AND octet_length(encrypted_credentials)>0
      AND octet_length(nonce)=12 AND octet_length(auth_tag)=16)
    OR
    (status='REVOKED' AND encrypted_credentials IS NULL AND
      nonce IS NULL AND auth_tag IS NULL)
  ),
  CHECK (status<>'VERIFIED' OR verified_at IS NOT NULL),
  CHECK (activation_requested_at IS NULL OR status='VERIFIED'),
  CHECK (provider_code<>'HUBTEL' OR
    (account_reference IS NOT NULL AND account_reference ~ '^[0-9]{3,32}$'))
);
-- Prevent multiple merchants from connecting a single payout destination
-- as their own Hubtel LIVE collection account.
CREATE UNIQUE INDEX unique_live_hubtel_merchant_collection_account
  ON business_merchant_gateway_credentials(account_reference)
  WHERE provider_code='HUBTEL' AND environment='LIVE' AND status<>'REVOKED';

CREATE TABLE business_merchant_gateway_credential_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK(provider_code IN
    ('HUBTEL','PAYSTACK','FLUTTERWAVE','STRIPE','PESAPAL','DPO','MPESA')),
  environment text NOT NULL CHECK(environment IN ('TEST','LIVE')),
  event_type text NOT NULL CHECK(event_type IN
    ('CREDENTIAL_SAVED','ACCOUNT_VERIFIED','ACTIVATION_REQUESTED',
      'CREDENTIAL_REVOKED')),
  revision integer NOT NULL CHECK(revision>0),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,provider_code,environment,revision,event_type)
);
CREATE INDEX idx_merchant_gateway_audit_business
  ON business_merchant_gateway_credential_audit(business_id,occurred_at DESC);

-- Audit records may not be silently changed or erased.
CREATE FUNCTION prevent_merchant_gateway_audit_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Merchant gateway credential audit is append-only';
END;$$;
CREATE TRIGGER merchant_gateway_audit_immutable
  BEFORE UPDATE OR DELETE ON business_merchant_gateway_credential_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_merchant_gateway_audit_change();

COMMIT;
