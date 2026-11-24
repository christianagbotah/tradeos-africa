BEGIN;
-- Idempotent authorization model: no assignment means no POS branch access.
-- OWNER/ADMIN and existing CASHIER roles retain their previous permissions.
-- Compound foreign keys physically prevent cross-tenant staff/branch references.
ALTER TABLE staff ADD CONSTRAINT uq_staff_business_scope UNIQUE (business_id,id);

CREATE TABLE pos_attendant_branch_assignments (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  assigned_by_staff_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,staff_id,branch_id),
  CONSTRAINT pos_attendant_staff_scope_fk
    FOREIGN KEY (business_id,staff_id)
    REFERENCES staff(business_id,id) ON DELETE CASCADE,
  CONSTRAINT pos_attendant_branch_scope_fk
    FOREIGN KEY (business_id,branch_id)
    REFERENCES branches(business_id,id) ON DELETE CASCADE,
  CONSTRAINT pos_attendant_assigned_by_scope_fk
    FOREIGN KEY (business_id,assigned_by_staff_id)
    REFERENCES staff(business_id,id)
);
CREATE INDEX idx_pos_attendant_branches_by_branch
 ON pos_attendant_branch_assignments (business_id,branch_id,staff_id);
-- Never backfill a generic branch; assignments require explicit owner action.
COMMIT;
