BEGIN;

-- The reconciliation scheduler never assumes a payment is failed simply
-- because no callback arrived. Failed and unknown provider states stay
-- pending, with a separately persisted next-check time and review trail.
ALTER TABLE hubtel_sale_checkout_attempts
  ADD COLUMN status_check_attempts integer NOT NULL DEFAULT 0
    CHECK (status_check_attempts >= 0),
  ADD COLUMN last_status_checked_at timestamptz,
  ADD COLUMN last_status_check_result text
    CHECK (last_status_check_result IN (
      'PAID','UNPAID','REFUNDED','ERROR','REVIEW_REQUIRED'
    )),
  ADD COLUMN next_status_check_at timestamptz,
  ADD COLUMN last_status_error_code varchar(80),
  ADD COLUMN review_requested_at timestamptz;

-- DUE records can be processed by any API instance; the scheduler uses a
-- database advisory lock so two instances never process the batch together.
-- The status lookup is not eligible until five minutes after initiation.
CREATE INDEX idx_hubtel_pos_reconciliation_due
  ON hubtel_sale_checkout_attempts
    (next_status_check_at,created_at,id)
  WHERE state IN ('READY','PENDING_VERIFICATION');

-- A PREPARED record may have initiated a remote checkout despite a lost
-- response. Escalate it for human review; never auto-cancel its stock.
CREATE INDEX idx_hubtel_pos_prepared_stale
  ON hubtel_sale_checkout_attempts (created_at,id)
  WHERE state='PREPARED';

COMMIT;
