BEGIN;

-- Dedicated non-economic automation audit events, with tenant-scoped references.
CREATE TABLE business_automation_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  run_id uuid,
  actor_user_id uuid REFERENCES app_users(id),
  actor_type text NOT NULL CHECK (actor_type IN ('USER','SYSTEM')),
  event_type text NOT NULL CHECK (event_type IN (
    'POLICY_CREATED','POLICY_UPDATED','RUN_PROPOSED','RUN_APPROVED','RUN_REJECTED'
  )),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_automation_audit_policy FOREIGN KEY (business_id, policy_id)
    REFERENCES business_automation_policies(business_id,id),
  CONSTRAINT fk_business_automation_audit_run FOREIGN KEY (business_id, run_id)
    REFERENCES business_automation_runs(business_id,id),
  CONSTRAINT ck_business_automation_audit_actor CHECK (
    (actor_type='SYSTEM' AND actor_user_id IS NULL AND event_type='RUN_PROPOSED')
    OR (actor_type='USER' AND actor_user_id IS NOT NULL AND event_type<>'RUN_PROPOSED')
  )
);
CREATE INDEX idx_business_automation_audit_history
  ON business_automation_audit_events(business_id, occurred_at DESC, id);
ALTER TABLE business_automation_runs
  ADD COLUMN rejected_by_user_id uuid REFERENCES app_users(id);

COMMIT;
