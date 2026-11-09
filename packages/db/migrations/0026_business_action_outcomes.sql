BEGIN;

ALTER TABLE business_action_items
  ADD COLUMN IF NOT EXISTS completion_outcome text,
  ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES app_users(id);

UPDATE business_action_items
SET completion_outcome = 'RESOLVED',
    completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status = 'DONE' AND completion_outcome IS NULL;

ALTER TABLE business_action_items
  DROP CONSTRAINT IF EXISTS ck_business_action_completion_outcome,
  ADD CONSTRAINT ck_business_action_completion_outcome CHECK (
    (
      status = 'DONE'
      AND completion_outcome IN ('RESOLVED','ALREADY_HANDLED','NOT_RELEVANT','NO_ACTION_NEEDED')
      AND completed_at IS NOT NULL
    )
    OR
    (
      status <> 'DONE'
      AND completion_outcome IS NULL
      AND completed_by_user_id IS NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_business_action_feedback_recent
  ON business_action_items(
    business_id,
    branch_id,
    source_attention_item_id,
    completion_outcome,
    completed_at DESC
  )
  WHERE status = 'DONE'
    AND source_attention_item_id IS NOT NULL
    AND source_automation_run_id IS NOT NULL;

COMMIT;
