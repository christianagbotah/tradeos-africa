BEGIN;

CREATE TABLE business_attention_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  rule_code text NOT NULL,
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

CREATE UNIQUE INDEX uq_business_attention_open_scope
  ON business_attention_items(business_id, branch_id, source_key) NULLS NOT DISTINCT
  WHERE state = 'OPEN';
CREATE INDEX idx_business_attention_business_state_time
  ON business_attention_items(business_id, state, severity, last_seen_at DESC);
CREATE INDEX idx_business_attention_branch_state_time
  ON business_attention_items(branch_id, state, last_seen_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE TABLE business_automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL,
  action_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  created_by_user_id uuid NOT NULL REFERENCES app_users(id),
  updated_by_user_id uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  UNIQUE (id, business_id)
);

CREATE INDEX idx_business_automation_policies_enabled_trigger
  ON business_automation_policies(business_id, enabled, trigger_type);
CREATE INDEX idx_business_automation_policies_branch
  ON business_automation_policies(branch_id)
  WHERE branch_id IS NOT NULL;

CREATE TABLE business_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  title text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'SNOOZED', 'CANCELED')),
  action_type text,
  assigned_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  due_at timestamptz,
  snoozed_until timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  created_by_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  source_policy_id uuid REFERENCES business_automation_policies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_action_items_business_status_due
  ON business_action_items(business_id, status, due_at);
CREATE INDEX idx_business_action_items_assignee_status
  ON business_action_items(assigned_user_id, status, created_at DESC)
  WHERE assigned_user_id IS NOT NULL;

CREATE TABLE business_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  trigger_source text NOT NULL,
  trigger_correlation_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('QUEUED', 'EVALUATING', 'WAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'CANCELED')),
  action_type text NOT NULL,
  structured_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_item_id uuid REFERENCES business_action_items(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (policy_id, business_id)
    REFERENCES business_automation_policies(id, business_id),
  UNIQUE (business_id, policy_id, policy_version, trigger_correlation_id)
);

CREATE INDEX idx_business_automation_runs_business_state_time
  ON business_automation_runs(business_id, state, created_at DESC);
CREATE INDEX idx_business_automation_runs_branch_time
  ON business_automation_runs(branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_business_ai_branch_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM branches b
    WHERE b.id = NEW.branch_id
      AND b.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'branch does not belong to business'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_attention_branch_scope
BEFORE INSERT OR UPDATE OF business_id, branch_id ON business_attention_items
FOR EACH ROW EXECUTE FUNCTION enforce_business_ai_branch_scope();

CREATE TRIGGER trg_business_policy_branch_scope
BEFORE INSERT OR UPDATE OF business_id, branch_id ON business_automation_policies
FOR EACH ROW EXECUTE FUNCTION enforce_business_ai_branch_scope();

CREATE TRIGGER trg_business_action_branch_scope
BEFORE INSERT OR UPDATE OF business_id, branch_id ON business_action_items
FOR EACH ROW EXECUTE FUNCTION enforce_business_ai_branch_scope();

CREATE TRIGGER trg_business_run_branch_scope
BEFORE INSERT OR UPDATE OF business_id, branch_id ON business_automation_runs
FOR EACH ROW EXECUTE FUNCTION enforce_business_ai_branch_scope();

CREATE OR REPLACE FUNCTION enforce_business_action_policy_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_policy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM business_automation_policies p
    WHERE p.id = NEW.source_policy_id
      AND p.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'automation policy does not belong to business'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_action_policy_scope
BEFORE INSERT OR UPDATE OF business_id, source_policy_id ON business_action_items
FOR EACH ROW EXECUTE FUNCTION enforce_business_action_policy_scope();

COMMIT;
