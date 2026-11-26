BEGIN;

-- Human approval of merchant BENEFICIARY / settlement-account evidence.
-- This does not activate the merchant's payment collection or change
-- platform-owned Hubtel POS account mappings. Money remains fail-closed.
CREATE TABLE hubtel_merchant_account_reviews (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  account_reference varchar(32) NOT NULL CHECK (account_reference ~ '^[0-9]{3,32}$'),
  credential_revision integer NOT NULL CHECK (credential_revision > 0),
  review_version integer NOT NULL DEFAULT 1 CHECK(review_version > 0),
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  beneficiary_ownership_confirmed boolean NOT NULL DEFAULT false,
  evidence_reference varchar(180) NOT NULL
    CHECK (length(btrim(evidence_reference)) BETWEEN 8 AND 180),
  rationale varchar(500) NOT NULL
    CHECK (length(btrim(rationale)) BETWEEN 12 AND 500),
  reviewed_by_platform_user_id uuid NOT NULL REFERENCES platform_users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'APPROVED' OR beneficiary_ownership_confirmed = true)
);

CREATE TABLE hubtel_merchant_account_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_reference varchar(32) NOT NULL,
  credential_revision integer NOT NULL CHECK(credential_revision > 0),
  review_version integer NOT NULL CHECK(review_version > 0),
  decision text NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
  beneficiary_ownership_confirmed boolean NOT NULL,
  evidence_reference varchar(180) NOT NULL,
  rationale varchar(500) NOT NULL,
  reviewed_by_platform_user_id uuid NOT NULL REFERENCES platform_users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,review_version)
);
CREATE INDEX idx_hubtel_merchant_review_events_business
  ON hubtel_merchant_account_review_events(business_id,reviewed_at DESC);

-- Prevent an administrator workflow from approving a merchant account
-- that has not requested activation or whose credentials were rotated.
CREATE FUNCTION verify_hubtel_merchant_review_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM business_merchant_gateway_credentials c
    JOIN businesses b ON b.id=c.business_id
    WHERE c.business_id=NEW.business_id AND c.provider_code='HUBTEL'
      AND c.environment='LIVE' AND c.status='VERIFIED'
      AND c.verified_at IS NOT NULL AND c.activation_requested_at IS NOT NULL
      AND c.revision=NEW.credential_revision
      AND c.account_reference=NEW.account_reference
      AND c.collection_enabled=false AND b.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Hubtel review must match a verified current merchant activation request';
  END IF;
  -- Review approval is entirely separate from activating the old Hubtel
  -- collection account or enabling the new merchant checkout route.
  RETURN NEW;
END;
$$;
CREATE TRIGGER hubtel_merchant_review_scope
  BEFORE INSERT OR UPDATE ON hubtel_merchant_account_reviews
  FOR EACH ROW EXECUTE FUNCTION verify_hubtel_merchant_review_scope();

CREATE FUNCTION block_hubtel_merchant_review_event_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hubtel merchant account review history is append-only';
END;
$$;
CREATE TRIGGER hubtel_merchant_review_events_immutable
  BEFORE UPDATE OR DELETE ON hubtel_merchant_account_review_events
  FOR EACH ROW EXECUTE FUNCTION block_hubtel_merchant_review_event_changes();

COMMIT;
