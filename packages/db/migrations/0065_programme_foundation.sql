BEGIN;
-- Independent opt-in programme tenancy; no merchant membership or ledger changes.
CREATE TABLE programme_organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE programme_memberships (
  organisation_id uuid NOT NULL REFERENCES programme_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('ORG_ADMIN','COORDINATOR','MENTOR','PARTICIPANT','REPORT_VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  PRIMARY KEY (organisation_id,user_id)
);
CREATE TABLE programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES programme_organisations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  objective text NOT NULL DEFAULT '' CHECK (length(objective)<=1000),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,id)
);
CREATE TABLE programme_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,id),
  FOREIGN KEY (organisation_id,programme_id) REFERENCES programmes(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE programme_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
  consent_version text NOT NULL CHECK (consent_version='v1'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,user_id),
  FOREIGN KEY (organisation_id,user_id) REFERENCES programme_memberships(organisation_id,user_id) ON DELETE CASCADE
);
CREATE TABLE programme_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id,cohort_id,participant_id),
  FOREIGN KEY (organisation_id,cohort_id) REFERENCES programme_cohorts(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,participant_id) REFERENCES programme_participants(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE programme_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES programme_organisations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE programme_requests (
  organisation_id uuid NOT NULL REFERENCES programme_organisations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY (organisation_id,actor_user_id,request_id)
);
CREATE INDEX programme_cohorts_org_idx ON programme_cohorts(organisation_id,programme_id);
CREATE INDEX programme_enrolments_cohort_idx ON programme_enrolments(organisation_id,cohort_id);
CREATE INDEX programme_audit_org_idx ON programme_audit_events(organisation_id,occurred_at DESC);
COMMIT;
