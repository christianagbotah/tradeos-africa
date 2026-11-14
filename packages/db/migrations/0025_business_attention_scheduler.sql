BEGIN;

-- A bounded server-side cursor allows fair branch evaluation without client polling.
CREATE TABLE business_attention_schedule_checkpoints (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_result text CHECK (last_result IS NULL OR last_result IN ('SUCCESS','FAILED')),
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, branch_id),
  CONSTRAINT fk_attention_checkpoint_branch
    FOREIGN KEY (business_id,branch_id) REFERENCES branches(business_id,id)
);
CREATE INDEX idx_business_attention_checkpoints_due
  ON business_attention_schedule_checkpoints(next_due_at, business_id, branch_id);
COMMIT;
