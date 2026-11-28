BEGIN;
ALTER TABLE programme_enrolments ADD CONSTRAINT programme_enrolment_scope_key UNIQUE(organisation_id,cohort_id,id);
CREATE TABLE programme_training_pathways(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 planned_hours integer NOT NULL CHECK(planned_hours BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,cohort_id,id),
 UNIQUE(organisation_id,cohort_id,name),
 FOREIGN KEY(organisation_id,cohort_id) REFERENCES programme_cohorts(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE programme_training_placements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 enrolment_id uuid NOT NULL,
 pathway_id uuid NOT NULL,
 mentor_user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ASSIGNED' CHECK(status IN ('ASSIGNED','IN_PROGRESS','COMPLETED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,id),
 UNIQUE(organisation_id,enrolment_id,pathway_id),
 FOREIGN KEY(organisation_id,cohort_id,enrolment_id) REFERENCES programme_enrolments(organisation_id,cohort_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organisation_id,cohort_id,pathway_id) REFERENCES programme_training_pathways(organisation_id,cohort_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organisation_id,mentor_user_id) REFERENCES programme_memberships(organisation_id,user_id)
);
CREATE TABLE programme_training_progress(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 placement_id uuid NOT NULL,
 actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
 status text NOT NULL CHECK(status IN ('IN_PROGRESS','COMPLETED')),
 note text NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organisation_id,placement_id) REFERENCES programme_training_placements(organisation_id,id) ON DELETE CASCADE
);
CREATE INDEX programme_training_placements_mentor_idx ON programme_training_placements(organisation_id,mentor_user_id);
CREATE INDEX programme_training_progress_placement_idx ON programme_training_progress(organisation_id,placement_id,created_at);
COMMIT;
