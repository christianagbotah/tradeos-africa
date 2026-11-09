CREATE TABLE IF NOT EXISTS business_intelligence_pulse_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_pulse_branch_scope
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id),
  CONSTRAINT fk_business_pulse_membership_scope
    FOREIGN KEY (business_id, user_id) REFERENCES business_memberships(business_id, user_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_pulse_state_scope
  ON business_intelligence_pulse_state(business_id, branch_id, user_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_business_pulse_user
  ON business_intelligence_pulse_state(user_id, business_id, branch_id);
