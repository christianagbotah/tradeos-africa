BEGIN;

-- Preference is NOT a live provider connection: no API key, merchant account,
-- bank details, webhook secret, card details or payment instruction is stored.
-- The legacy Hubtel collection connection and past attempts remain untouched.
CREATE TABLE business_payment_gateway_preferences (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  provider_code text NOT NULL CHECK (
    provider_code IN ('HUBTEL','PAYSTACK','FLUTTERWAVE','STRIPE','PESAPAL','DPO','MPESA')
  ),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  changed_by_user_id uuid NOT NULL REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE business_payment_gateway_preference_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  previous_provider_code text,
  provider_code text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  revision integer NOT NULL CHECK (revision > 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider_code IN ('HUBTEL','PAYSTACK','FLUTTERWAVE','STRIPE','PESAPAL','DPO','MPESA')),
  CHECK (previous_provider_code IS NULL OR
    previous_provider_code IN ('HUBTEL','PAYSTACK','FLUTTERWAVE','STRIPE','PESAPAL','DPO','MPESA'))
);
CREATE INDEX idx_business_gateway_preference_audit
  ON business_payment_gateway_preference_audit(business_id,occurred_at DESC);

COMMIT;
