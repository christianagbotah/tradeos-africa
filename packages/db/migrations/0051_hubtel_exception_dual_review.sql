BEGIN;

-- Investigation approval only. Neither approval nor referral is an instruction
-- to refund, disburse, alter a sale or post an accounting journal.
CREATE TABLE hubtel_pos_exception_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL UNIQUE REFERENCES hubtel_pos_settlement_exceptions(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','AWAITING_APPROVAL','APPROVED_ACCOUNTING_REVIEW','APPROVED_PROVIDER_INVESTIGATION')),
  recommended_action text CHECK (recommended_action IN
    ('ACCOUNTING_REVIEW','PROVIDER_INVESTIGATION')),
  evidence_reference varchar(160),
  investigator_note varchar(700),
  proposed_by_user_id uuid REFERENCES app_users(id),
  approved_by_user_id uuid REFERENCES app_users(id),
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hubtel_review_case_content CHECK (
    (status='OPEN' AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR
    (status<>'OPEN' AND recommended_action IS NOT NULL
      AND evidence_reference IS NOT NULL
      AND investigator_note IS NOT NULL AND proposed_by_user_id IS NOT NULL
      AND submitted_at IS NOT NULL
      AND (
        (status='AWAITING_APPROVAL' AND approved_by_user_id IS NULL AND approved_at IS NULL)
        OR
        (status='APPROVED_ACCOUNTING_REVIEW' AND recommended_action='ACCOUNTING_REVIEW'
          AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
        OR
        (status='APPROVED_PROVIDER_INVESTIGATION'
          AND recommended_action='PROVIDER_INVESTIGATION'
          AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
      )
    )
  ),
  CONSTRAINT hubtel_review_case_two_person CHECK (
    approved_by_user_id IS NULL OR
    approved_by_user_id <> proposed_by_user_id
  )
);
CREATE INDEX idx_hubtel_review_cases_business
  ON hubtel_pos_exception_review_cases(business_id,updated_at DESC);

CREATE FUNCTION guard_hubtel_exception_review_case()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
  SELECT e.exception_kind INTO k FROM hubtel_pos_settlement_exceptions e
  WHERE e.id=NEW.exception_id AND e.business_id=NEW.business_id
    AND e.branch_id=NEW.branch_id;
  IF k IS NULL THEN
    RAISE EXCEPTION 'Settlement review case is outside its original merchant and branch';
  END IF;
  IF NEW.proposed_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_memberships m WHERE m.business_id=NEW.business_id
      AND m.user_id=NEW.proposed_by_user_id AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
  ) THEN
    RAISE EXCEPTION 'Settlement investigator must be an active authorized business member';
  END IF;
  IF NEW.approved_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_memberships m WHERE m.business_id=NEW.business_id
      AND m.user_id=NEW.approved_by_user_id AND m.status='ACTIVE'
      AND m.role IN ('OWNER','ADMIN')
  ) THEN
    RAISE EXCEPTION 'Second approval requires an active owner or administrator';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.exception_id IS DISTINCT FROM OLD.exception_id OR
       NEW.business_id IS DISTINCT FROM OLD.business_id OR
       NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'Settlement review ownership is immutable';
    END IF;
    IF NEW.revision <> OLD.revision+1 THEN
      RAISE EXCEPTION 'Settlement review revision must advance exactly once';
    END IF;
    IF OLD.status LIKE 'APPROVED_%' THEN
      RAISE EXCEPTION 'Approved settlement review cannot be changed';
    END IF;
    IF (OLD.status='OPEN' AND NEW.status NOT IN ('OPEN','AWAITING_APPROVAL')) OR
       (OLD.status='AWAITING_APPROVAL' AND NEW.status NOT IN
        ('OPEN','APPROVED_ACCOUNTING_REVIEW','APPROVED_PROVIDER_INVESTIGATION')) THEN
      RAISE EXCEPTION 'Settlement review state transition is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER hubtel_exception_review_case_guard
  BEFORE INSERT OR UPDATE ON hubtel_pos_exception_review_cases
  FOR EACH ROW EXECUTE FUNCTION guard_hubtel_exception_review_case();

-- Immutable review trail ensures every submission, rejection and approval is
-- attributable to a named user identity and exact optimistic version.
CREATE TABLE hubtel_pos_exception_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_case_id uuid NOT NULL REFERENCES hubtel_pos_exception_review_cases(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  action text NOT NULL CHECK(action IN ('SUBMITTED','APPROVED','RETURNED')),
  recommended_action text CHECK(recommended_action IN
    ('ACCOUNTING_REVIEW','PROVIDER_INVESTIGATION')),
  evidence_reference varchar(160),
  reason varchar(700) NOT NULL,
  case_revision integer NOT NULL CHECK(case_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_case_id,case_revision)
);
CREATE INDEX idx_hubtel_exception_review_events
  ON hubtel_pos_exception_review_events(review_case_id,created_at DESC);

CREATE FUNCTION guard_hubtel_exception_review_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Settlement review events are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM hubtel_pos_exception_review_cases c
    WHERE c.id=NEW.review_case_id AND c.business_id=NEW.business_id
      AND c.revision=NEW.case_revision
  ) THEN
    RAISE EXCEPTION 'Settlement review event revision or tenant mismatch';
  END IF;
  RETURN NEW;
END;$$;
CREATE TRIGGER hubtel_exception_review_event_guard
  BEFORE INSERT OR UPDATE OR DELETE ON hubtel_pos_exception_review_events
  FOR EACH ROW EXECUTE FUNCTION guard_hubtel_exception_review_event();

COMMIT;
