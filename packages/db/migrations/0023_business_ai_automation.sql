BEGIN;

-- Business-facing intelligence is isolated from platform administration.
-- A branch reference must always belong to the same business as the parent record.
ALTER TABLE branches ADD CONSTRAINT uq_tradeos_branch_business_id UNIQUE (business_id, id);

CREATE TABLE business_attention_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  rule_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED','DISMISSED')),
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence)='array'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_attention_branch FOREIGN KEY (business_id, branch_id)
    REFERENCES branches(business_id, id)
);

CREATE UNIQUE INDEX uq_business_attention_open_source
  ON business_attention_items(business_id, branch_id, source_key) NULLS NOT DISTINCT
  WHERE state='OPEN';
CREATE INDEX idx_business_attention_open_priority
  ON business_attention_items(business_id, branch_id, severity, last_seen_at DESC)
  WHERE state='OPEN';
CREATE INDEX idx_business_attention_recent
  ON business_attention_items(business_id, created_at DESC);

-- Automation policies only control advisory or non-economic workflow operations.
-- Economic mutations remain accessible solely through canonical domain services.
CREATE TABLE business_automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  trigger_type text NOT NULL CHECK (trigger_type IN ('ATTENTION','SCHEDULED','MANUAL')),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions)='object'),
  action_type text NOT NULL CHECK (action_type IN ('CREATE_ACTION_ITEM','SEND_BRIEFING','DRAFT_RECOMMENDATION')),
  action_configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action_configuration)='object'),
  execution_class smallint NOT NULL CHECK (execution_class BETWEEN 0 AND 2),
  approval_role text CHECK (approval_role IS NULL OR approval_role IN ('OWNER','ADMIN')),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version>0),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_business_automation_policy_code UNIQUE (business_id, code),
  CONSTRAINT uq_business_automation_policy_id_scope UNIQUE (business_id, id),
  CONSTRAINT fk_business_automation_policy_branch FOREIGN KEY (business_id, branch_id)
    REFERENCES branches(business_id, id),
  CONSTRAINT ck_business_automation_policy_approval
    CHECK (execution_class <> 2 OR approval_role IS NOT NULL)
);
CREATE INDEX idx_business_automation_policy_enabled
  ON business_automation_policies(business_id, trigger_type)
  WHERE enabled=true;

CREATE TABLE business_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version>0),
  trigger_source text NOT NULL,
  trigger_correlation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED','EVALUATING','WAITING_APPROVAL','APPROVED','EXECUTING','SUCCEEDED','FAILED','REJECTED','CANCELED')),
  execution_class smallint NOT NULL CHECK (execution_class BETWEEN 0 AND 2),
  approval_role text CHECK (approval_role IS NULL OR approval_role IN ('OWNER','ADMIN')),
  structured_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(structured_input)='object'),
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_summary)='object'),
  proposed_action jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(proposed_action)='object'),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence)='array'),
  approved_by_user_id uuid REFERENCES app_users(id),
  executed_by_user_id uuid REFERENCES app_users(id),
  approval_requested_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_automation_run_policy
    FOREIGN KEY (business_id, policy_id) REFERENCES business_automation_policies(business_id, id),
  CONSTRAINT fk_business_automation_run_branch
    FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id, id),
  CONSTRAINT uq_business_automation_run_trigger
    UNIQUE (business_id, policy_id, policy_version, trigger_correlation_id),
  CONSTRAINT ck_business_automation_run_approval
    CHECK (execution_class<>2 OR approval_role IS NOT NULL)
);
CREATE INDEX idx_business_automation_run_queue
  ON business_automation_runs(business_id, state, created_at DESC);
CREATE INDEX idx_business_automation_run_approvals
  ON business_automation_runs(business_id, approval_requested_at)
  WHERE state='WAITING_APPROVAL';

-- Action items are review/follow-up records, never financial postings.
CREATE TABLE business_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  title text NOT NULL,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','DONE','SNOOZED','CANCELED')),
  assigned_user_id uuid REFERENCES app_users(id),
  due_at timestamptz,
  source_attention_id uuid,
  source_automation_run_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT uq_business_action_item_scope UNIQUE (business_id, id),
  CONSTRAINT fk_business_action_item_branch
    FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id, id),
  CONSTRAINT fk_business_action_item_attention
    FOREIGN KEY (source_attention_id) REFERENCES business_attention_items(id),
  CONSTRAINT fk_business_action_item_run
    FOREIGN KEY (source_automation_run_id) REFERENCES business_automation_runs(id)
);
CREATE UNIQUE INDEX uq_business_action_idempotency
  ON business_action_items(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_business_action_due
  ON business_action_items(business_id, state, due_at)
  WHERE state IN ('OPEN','SNOOZED');

COMMIT;
