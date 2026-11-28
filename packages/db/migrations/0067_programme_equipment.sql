BEGIN;
CREATE TABLE programme_equipment_units(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL REFERENCES programme_organisations(id) ON DELETE RESTRICT,
 asset_code text NOT NULL CHECK(length(trim(asset_code)) BETWEEN 1 AND 80),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 condition text NOT NULL CHECK(condition IN ('NEW','GOOD','REFURBISHED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,id), UNIQUE(organisation_id,asset_code)
);
CREATE TABLE programme_equipment_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 enrolment_id uuid NOT NULL,
 equipment_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','APPROVED','HANDED_OVER','CANCELLED')),
 reserved_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 approved_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
 acknowledged_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,
 handed_over_at timestamptz,
 cancelled_at timestamptz,
 UNIQUE(organisation_id,id),
 FOREIGN KEY(organisation_id,cohort_id,enrolment_id) REFERENCES programme_enrolments(organisation_id,cohort_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,equipment_id) REFERENCES programme_equipment_units(organisation_id,id) ON DELETE RESTRICT,
 CHECK(approved_by IS NULL OR approved_by<>reserved_by),
 CHECK((approved_by IS NULL)=(approved_at IS NULL)),
 CHECK((acknowledged_by IS NULL)=(handed_over_at IS NULL)),
 CHECK(status NOT IN ('APPROVED','HANDED_OVER') OR approved_at IS NOT NULL),
 CHECK((status='HANDED_OVER')=(handed_over_at IS NOT NULL)),
 CHECK((status='CANCELLED')=(cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX programme_equipment_one_active_allocation ON programme_equipment_allocations(organisation_id,equipment_id) WHERE status<>'CANCELLED';
CREATE INDEX programme_equipment_allocations_enrolment_idx ON programme_equipment_allocations(organisation_id,enrolment_id);
COMMIT;
