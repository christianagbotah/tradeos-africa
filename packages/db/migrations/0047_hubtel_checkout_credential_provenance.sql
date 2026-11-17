BEGIN;

-- Every Hubtel checkout stays bound to the credential authority that
-- initiated it. Historical attempts retain PLATFORM_ALIAS by default.
ALTER TABLE hubtel_sale_checkout_attempts
  ADD COLUMN credential_source text NOT NULL DEFAULT 'PLATFORM_ALIAS'
    CHECK(credential_source IN ('PLATFORM_ALIAS','MERCHANT_VAULT')),
  ADD COLUMN merchant_credential_revision integer,
  ADD CONSTRAINT hubtel_checkout_credential_provenance_ck CHECK(
    (credential_source='PLATFORM_ALIAS' AND merchant_credential_revision IS NULL)
    OR
    (credential_source='MERCHANT_VAULT' AND
      merchant_credential_revision IS NOT NULL AND merchant_credential_revision>0)
  );

CREATE FUNCTION hubtel_checkout_credential_provenance_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (
    NEW.credential_source IS DISTINCT FROM OLD.credential_source OR
    NEW.merchant_credential_revision IS DISTINCT FROM OLD.merchant_credential_revision
  ) THEN
    RAISE EXCEPTION 'Hubtel payment credential provenance cannot be changed';
  END IF;
  IF NEW.credential_source='MERCHANT_VAULT' AND NOT EXISTS(
    SELECT 1 FROM business_merchant_gateway_credentials c
    JOIN business_hubtel_sales_accounts a
      ON a.business_id=c.business_id
    WHERE c.business_id=NEW.business_id AND c.provider_code='HUBTEL'
      AND c.environment='LIVE' AND c.status='VERIFIED'
      AND c.verified_at IS NOT NULL
      AND c.activation_requested_at IS NOT NULL
      AND c.collection_enabled=true
      AND c.revision=NEW.merchant_credential_revision
      AND c.account_reference=NEW.merchant_collection_account
      AND a.collection_account=NEW.merchant_collection_account
      AND a.approval_status='VERIFIED' AND a.enabled=true
      AND a.verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Merchant Hubtel checkout must have a verified authorized credential snapshot';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hubtel_checkout_credential_provenance
  BEFORE INSERT OR UPDATE ON hubtel_sale_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION hubtel_checkout_credential_provenance_guard();

COMMIT;
