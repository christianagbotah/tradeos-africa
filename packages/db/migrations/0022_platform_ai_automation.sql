BEGIN;

CREATE TABLE platform_attention_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  rule_code text NOT NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type text,
  entity_id text,
  severity text NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  title text NOT NULL,
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_platform_attention_open_scope
  ON platform_attention_items(source_key, business_id, entity_type, entity_id) NULLS NOT DISTINCT
  WHERE state = 'OPEN';
CREATE INDEX idx_platform_attention_state_severity_time
  ON platform_attention_items(state, severity, last_seen_at DESC);
CREATE INDEX idx_platform_attention_business_time
  ON platform_attention_items(business_id, last_seen_at DESC)
  WHERE business_id IS NOT NULL;

CREATE TABLE platform_automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL,
  action_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_class smallint NOT NULL CHECK (execution_class BETWEEN 0 AND 3),
  approval_role text CHECK (approval_role IS NULL OR approval_role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'DEVELOPER', 'SUPPORT', 'BILLING', 'OPERATIONS')),
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  created_by_platform_user_id uuid NOT NULL REFERENCES platform_users(id),
  updated_by_platform_user_id uuid NOT NULL REFERENCES platform_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_automation_policies_enabled_trigger
  ON platform_automation_policies(enabled, trigger_type);
CREATE INDEX idx_platform_automation_policies_business
  ON platform_automation_policies(business_id)
  WHERE business_id IS NOT NULL;

CREATE TABLE platform_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES platform_automation_policies(id),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  trigger_source text NOT NULL,
  trigger_correlation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED', 'EVALUATING', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELED')),
  execution_class smallint NOT NULL CHECK (execution_class BETWEEN 0 AND 3),
  structured_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by_platform_user_id uuid REFERENCES platform_users(id),
  executed_by_platform_user_id uuid REFERENCES platform_users(id),
  approval_requested_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, policy_version, trigger_correlation_id)
);

CREATE INDEX idx_platform_automation_runs_state_time
  ON platform_automation_runs(state, created_at DESC);
CREATE INDEX idx_platform_automation_runs_business_time
  ON platform_automation_runs(business_id, created_at DESC)
  WHERE business_id IS NOT NULL;
CREATE INDEX idx_platform_automation_runs_approval_queue
  ON platform_automation_runs(approval_requested_at, created_at DESC)
  WHERE state = 'WAITING_APPROVAL';

COMMIT;
