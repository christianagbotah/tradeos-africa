BEGIN;
CREATE TABLE programme_literacy_lessons(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
 topic text NOT NULL CHECK(topic IN ('RECORD_KEEPING','COSTING_PRICING','BUDGETING','SAVINGS','CASH_RECONCILIATION','BUSINESS_FINANCE','STOCK_CONTROL','CREDIT_BASICS')),
 lesson_text text NOT NULL CHECK(length(trim(lesson_text)) BETWEEN 1 AND 4000),
 question text NOT NULL CHECK(length(trim(question)) BETWEEN 1 AND 500),
 options jsonb NOT NULL CHECK(jsonb_typeof(options)='array' AND jsonb_array_length(options)=3),
 correct_option integer NOT NULL CHECK(correct_option BETWEEN 0 AND 2),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000),
 created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,cohort_id,id),
 UNIQUE(organisation_id,cohort_id,title,version),
 FOREIGN KEY(organisation_id,cohort_id) REFERENCES programme_cohorts(organisation_id,id) ON DELETE RESTRICT
);
CREATE TABLE programme_literacy_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 lesson_id uuid NOT NULL,
 enrolment_id uuid NOT NULL,
 answer_option integer NOT NULL CHECK(answer_option BETWEEN 0 AND 2),
 passed boolean NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organisation_id,cohort_id,lesson_id) REFERENCES programme_literacy_lessons(organisation_id,cohort_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organisation_id,cohort_id,enrolment_id) REFERENCES programme_enrolments(organisation_id,cohort_id,id) ON DELETE RESTRICT
);
CREATE INDEX programme_literacy_attempt_scope ON programme_literacy_attempts(organisation_id,enrolment_id,lesson_id,submitted_at);
COMMIT;
