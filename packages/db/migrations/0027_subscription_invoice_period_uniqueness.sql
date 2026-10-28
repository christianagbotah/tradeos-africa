BEGIN;

CREATE UNIQUE INDEX uq_subscription_invoice_active_period
  ON subscription_invoices(subscription_id, period_start, period_end)
  WHERE status <> 'VOID';

CREATE INDEX idx_subscription_invoices_subscription_status_due
  ON subscription_invoices(subscription_id, status, due_at)
  WHERE status IN ('OPEN','PARTIALLY_PAID');

COMMIT;
