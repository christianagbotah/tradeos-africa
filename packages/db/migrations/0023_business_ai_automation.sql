-- Tenant/business AI persistence. This layer stores evidence, recommendations,
-- policies, workflow runs and action queues only. It must never become a
-- shadow accounting, payment, inventory or sales ledger.

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_id_business
  ON branches(id, business_id);

CREATE TABLE IF NOT EXISTS business_attention_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  source_key text NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED','DISMISSED')),
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_attention_branch_scope
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
  CONSTRAINT ck_business_attention_resolution
    CHECK ((state = 'OPEN' AND resolved_at IS NULL) OR state <> 'OPEN')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_attention_id_business
  ON business_attention_items(id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_attention_open_source
  ON business_attention_items(business_id, branch_id, rule_code, source_key) NULLS NOT DISTINCT
  WHERE state = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_business_attention_queue
  ON business_attention_items(business_id, branch_id, state, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS business_automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  action_type text NOT NULL,
  action_configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(action_configuration) = 'object'),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_policy_branch_scope
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
  CONSTRAINT uq_business_policy_code UNIQUE (business_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_policy_id_business
  ON business_automation_policies(id, business_id);
CREATE INDEX IF NOT EXISTS idx_business_policy_enabled
  ON business_automation_policies(business_id, branch_id, enabled, trigger_type);

CREATE TABLE IF NOT EXISTS business_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  trigger_source text NOT NULL,
  trigger_correlation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED','EVALUATING','SUCCEEDED','FAILED','CANCELED')),
  structured_input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(structured_input) = 'object'),
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output_summary) = 'object'),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_run_branch_scope
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
  CONSTRAINT fk_business_run_policy_scope
    FOREIGN KEY (policy_id, business_id) REFERENCES business_automation_policies(id, business_id),
  CONSTRAINT uq_business_run_replay
    UNIQUE (business_id, policy_id, policy_version, trigger_correlation_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_run_id_business
  ON business_automation_runs(id, business_id);
CREATE INDEX IF NOT EXISTS idx_business_run_history
  ON business_automation_runs(business_id, branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  source_attention_item_id uuid,
  source_automation_run_id uuid,
  action_type text,
  title text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  assigned_user_id uuid REFERENCES app_users(id),
  assigned_staff_id uuid REFERENCES staff(id),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','SNOOZED','CANCELED')),
  snoozed_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_action_branch_scope
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
  CONSTRAINT fk_business_action_attention_scope
    FOREIGN KEY (source_attention_item_id, business_id) REFERENCES business_attention_items(id, business_id),
  CONSTRAINT fk_business_action_run_scope
    FOREIGN KEY (source_automation_run_id, business_id) REFERENCES business_automation_runs(id, business_id)
);

CREATE INDEX IF NOT EXISTS idx_business_action_queue
  ON business_action_items(business_id, branch_id, status, due_at, created_at DESC);
