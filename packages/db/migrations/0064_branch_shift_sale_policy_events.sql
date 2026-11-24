BEGIN;
-- No backfill: existing shops remain unrestricted until explicitly opted in.
-- Append-only history evaluates offline sale time rather than sync arrival.
CREATE TABLE branch_shift_sale_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  required boolean NOT NULL,
  changed_by_staff_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT shift_sale_policy_branch_scope_fk
    FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id,id)
    ON DELETE CASCADE,
  CONSTRAINT shift_sale_policy_staff_scope_fk
    FOREIGN KEY (business_id, changed_by_staff_id) REFERENCES staff(business_id,id)
);
CREATE INDEX idx_branch_shift_sale_policy_asof
  ON branch_shift_sale_policy_events(business_id,branch_id,effective_at DESC,id DESC);
COMMIT;
