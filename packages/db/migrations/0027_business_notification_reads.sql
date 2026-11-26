BEGIN;

-- User-specific, tenant/branch-scoped acknowledgement of advisory notifications.
-- Read receipts never alter alerts, approvals, economic ledgers or sales.
CREATE TABLE business_notification_reads (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('ATTENTION','APPROVAL')),
  source_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, branch_id, user_id, source_type, source_id),
  CONSTRAINT fk_business_notification_read_branch
    FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id,id)
);

CREATE INDEX idx_business_notification_reads_user
  ON business_notification_reads(user_id,business_id,branch_id,read_at DESC);

COMMIT;
