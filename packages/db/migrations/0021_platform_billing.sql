BEGIN;

CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  subscription_id uuid NOT NULL REFERENCES business_subscriptions(id),
  invoice_number text NOT NULL UNIQUE,
  currency_code char(3) NOT NULL,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  amount_paid_minor bigint NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0 AND amount_paid_minor <= total_minor),
  status text NOT NULL CHECK (status IN ('DRAFT','OPEN','PARTIALLY_PAID','PAID','VOID','UNCOLLECTIBLE','REFUNDED')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  provider text,
  provider_invoice_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE TABLE subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_id uuid NOT NULL REFERENCES subscription_invoices(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL,
  method text NOT NULL,
  provider text NOT NULL,
  provider_event_reference text NOT NULL,
  provider_transaction_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REVERSED','REFUNDED','PARTIALLY_REFUNDED')),
  failure_code text,
  failure_message text,
  received_at timestamptz NOT NULL,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_payment_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  payment_id uuid NOT NULL REFERENCES subscription_payments(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency_code char(3) NOT NULL,
  provider text NOT NULL,
  provider_event_reference text NOT NULL,
  provider_refund_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('REQUESTED','SUCCEEDED','FAILED')),
  failure_code text,
  failure_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_subscription_invoice_provider_reference
  ON subscription_invoices(provider, provider_invoice_reference)
  WHERE provider IS NOT NULL AND provider_invoice_reference IS NOT NULL;
CREATE UNIQUE INDEX uq_subscription_payment_provider_event
  ON subscription_payments(provider, provider_event_reference);
CREATE UNIQUE INDEX uq_subscription_payment_provider_transaction
  ON subscription_payments(provider, provider_transaction_reference);
CREATE UNIQUE INDEX uq_subscription_refund_provider_event
  ON subscription_payment_refunds(provider, provider_event_reference);
CREATE UNIQUE INDEX uq_subscription_refund_provider_reference
  ON subscription_payment_refunds(provider, provider_refund_reference);

CREATE INDEX idx_subscription_invoices_business_status_due
  ON subscription_invoices(business_id, status, due_at DESC);
CREATE INDEX idx_subscription_invoices_subscription_time
  ON subscription_invoices(subscription_id, issued_at DESC);
CREATE INDEX idx_subscription_payments_invoice_time
  ON subscription_payments(invoice_id, received_at DESC);
CREATE INDEX idx_subscription_payments_business_status_time
  ON subscription_payments(business_id, status, received_at DESC);
CREATE INDEX idx_subscription_refunds_payment_time
  ON subscription_payment_refunds(payment_id, created_at DESC);

COMMIT;
