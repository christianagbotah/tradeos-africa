BEGIN;

-- Claims are typed from an external provider document by a human.
-- A merchant claim, even if reviewed by another employee, is NOT provider
-- authentication and may never establish refund finality.
CREATE TABLE refund_provider_evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  refund_transaction_id uuid NOT NULL REFERENCES refund_transactions(id),
  submitted_by_user_id uuid NOT NULL REFERENCES app_users(id),
  client_request_id uuid NOT NULL,
  provider_code text NOT NULL CHECK (provider_code IN ('HUBTEL','PAYSTACK','FLUTTERWAVE','OTHER')),
  provider_ref varchar(140) NOT NULL CHECK (
    char_length(provider_ref) BETWEEN 8 AND 140
    AND provider_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
    AND provider_ref !~ '://'),
  reported_amount_minor bigint NOT NULL CHECK (reported_amount_minor > 0),
  reported_currency char(3) NOT NULL CHECK (reported_currency ~ '^[A-Z]{3}$'),
  recipient_last4 char(4) NOT NULL CHECK (recipient_last4 ~ '^[A-Za-z0-9]{4}$'),
  reported_status text NOT NULL CHECK (reported_status IN (
    'CLAIMED_SUCCESS','CLAIMED_PENDING','CLAIMED_FAILED')),
  provider_case_ref varchar(140),
  note varchar(700) NOT NULL CHECK (char_length(btrim(note)) BETWEEN 20 AND 700),
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL DEFAULT 'MERCHANT_SUPPLIED' CHECK (origin='MERCHANT_SUPPLIED'),
  provider_authenticated boolean NOT NULL DEFAULT false CHECK (provider_authenticated=false),
  payout_finality_established boolean NOT NULL DEFAULT false CHECK (payout_finality_established=false),
  UNIQUE(refund_transaction_id,client_request_id),
  CHECK (provider_case_ref IS NULL OR (
    char_length(provider_case_ref) BETWEEN 6 AND 140
    AND provider_case_ref ~ '^[A-Za-z0-9][A-Za-z0-9 _.:/-]*$'
    AND provider_case_ref !~ '://'))
);
-- A provider refund reference cannot be reused for two refund liabilities
-- within the same tenant. Case-insensitive to prevent accidental duplicates.
CREATE UNIQUE INDEX uq_refund_evidence_provider_reference
  ON refund_provider_evidence_claims(business_id,provider_code,lower(provider_ref));
CREATE INDEX idx_refund_evidence_timeline
  ON refund_provider_evidence_claims
  (business_id,branch_id,refund_transaction_id,created_at DESC,id DESC);

CREATE TABLE refund_provider_evidence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  evidence_claim_id uuid NOT NULL UNIQUE REFERENCES refund_provider_evidence_claims(id),
  reviewer_user_id uuid NOT NULL REFERENCES app_users(id),
  client_request_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN (
    'FIELDS_MATCHED_UNVERIFIED','DISCREPANCY_RECORDED','PROVIDER_CONFIRMATION_NEEDED')),
  note varchar(700) NOT NULL CHECK (char_length(btrim(note)) BETWEEN 20 AND 700),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_authenticated boolean NOT NULL DEFAULT false CHECK (provider_authenticated=false),
  payout_finality_established boolean NOT NULL DEFAULT false CHECK (payout_finality_established=false),
  UNIQUE(evidence_claim_id,client_request_id)
);
CREATE INDEX idx_refund_evidence_reviews_scope
  ON refund_provider_evidence_reviews (business_id,branch_id,evidence_claim_id);

CREATE FUNCTION guard_refund_provider_evidence_claim() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Merchant provider evidence claims are append-only and unverified';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM refund_transactions rt
    JOIN return_cases rc ON rc.id=rt.return_case_id
      AND rc.business_id=rt.business_id AND rc.branch_id=NEW.branch_id
    LEFT JOIN payments p ON p.id=rt.original_payment_id
      AND p.business_id=rt.business_id AND p.branch_id=rc.branch_id
      AND p.sale_id=rc.original_sale_id
    JOIN business_memberships bm ON bm.business_id=rt.business_id
      AND bm.user_id=NEW.submitted_by_user_id
      AND bm.status='ACTIVE'
      AND bm.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
    WHERE rt.id=NEW.refund_transaction_id AND rt.business_id=NEW.business_id
      AND rt.status IN ('PENDING','FAILED')
      AND (rt.method IN ('MOMO','CARD','BANK') OR
           (rt.method='ORIGINAL_METHOD' AND p.method IN ('MOMO','CARD','BANK')))
  ) THEN
    RAISE EXCEPTION 'Provider evidence requires an unresolved electronic refund in this branch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refund_provider_evidence_claim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON refund_provider_evidence_claims
  FOR EACH ROW EXECUTE FUNCTION guard_refund_provider_evidence_claim();

CREATE FUNCTION guard_refund_provider_evidence_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'Merchant provider evidence reviews are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM refund_provider_evidence_claims c
    JOIN refund_transactions rt ON rt.id=c.refund_transaction_id
      AND rt.business_id=c.business_id
    JOIN return_cases rc ON rc.id=rt.return_case_id
      AND rc.business_id=rt.business_id
      AND rc.branch_id=c.branch_id
    JOIN business_memberships bm ON bm.business_id=c.business_id
      AND bm.user_id=NEW.reviewer_user_id AND bm.status='ACTIVE'
      AND bm.role IN ('OWNER','ADMIN','MANAGER','ACCOUNTANT')
    WHERE c.id=NEW.evidence_claim_id
      AND c.business_id=NEW.business_id AND c.branch_id=NEW.branch_id
      AND c.submitted_by_user_id<>NEW.reviewer_user_id
      AND rt.status IN ('PENDING','FAILED')
      AND (
        NEW.decision<>'FIELDS_MATCHED_UNVERIFIED'
        OR (c.reported_amount_minor=rt.amount_minor
            AND c.reported_currency=rt.currency_code)
      )
  ) THEN
    RAISE EXCEPTION 'Evidence review requires separate authorized reviewer and matching liability';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER refund_provider_evidence_review_guard
  BEFORE INSERT OR UPDATE OR DELETE ON refund_provider_evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION guard_refund_provider_evidence_review();

COMMIT;
