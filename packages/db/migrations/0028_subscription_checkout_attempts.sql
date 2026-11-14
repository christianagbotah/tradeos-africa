BEGIN;

-- Composite tenant constraint: a checkout may never point at another business's invoice.
ALTER TABLE subscription_invoices
  ADD CONSTRAINT uq_subscription_invoice_business_id UNIQUE (business_id,id);

-- Checkout attempts are not payments. Nothing in this table activates a plan,
-- posts a receipt or grants entitlements.
CREATE TABLE subscription_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'HUBTEL' CHECK (provider='HUBTEL'),
  client_reference varchar(32) NOT NULL,
  merchant_account_number varchar(32) NOT NULL,
  expected_amount_minor bigint NOT NULL CHECK (expected_amount_minor>0),
  currency_code char(3) NOT NULL CHECK (currency_code='GHS'),
  state text NOT NULL DEFAULT 'PREPARED'
    CHECK (state IN (
      'PREPARED','READY','PENDING_VERIFICATION','RECONCILED','FAILED','CANCELED'
    )),
  checkout_id text,
  checkout_url text,
  checkout_direct_url text,
  checkout_created_at timestamptz,
  last_verified_at timestamptz,
  next_verify_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_checkout_invoice_business
    FOREIGN KEY (business_id,invoice_id)
    REFERENCES subscription_invoices(business_id,id),
  CONSTRAINT chk_checkout_url_fields
    CHECK (
      (checkout_id IS NULL AND checkout_url IS NULL AND checkout_direct_url IS NULL
        AND checkout_created_at IS NULL)
      OR (checkout_id IS NOT NULL AND checkout_url IS NOT NULL AND checkout_direct_url IS NOT NULL
        AND checkout_created_at IS NOT NULL)
    ),
  UNIQUE (business_id,client_request_id),
  UNIQUE (provider,client_reference)
);

CREATE UNIQUE INDEX uq_one_open_subscription_checkout_per_invoice
  ON subscription_checkout_attempts(invoice_id)
  WHERE state IN ('PREPARED','READY','PENDING_VERIFICATION');

CREATE UNIQUE INDEX uq_hubtel_checkout_id
  ON subscription_checkout_attempts(provider,checkout_id)
  WHERE checkout_id IS NOT NULL;

CREATE INDEX idx_subscription_checkout_business_created
  ON subscription_checkout_attempts(business_id,created_at DESC);

CREATE INDEX idx_subscription_checkout_reconcile
  ON subscription_checkout_attempts(next_verify_at)
  WHERE state IN ('READY','PENDING_VERIFICATION') AND next_verify_at IS NOT NULL;

COMMIT;
