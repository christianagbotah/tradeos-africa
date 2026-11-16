BEGIN;

-- Private, tenant-owned document delivery ledger, not the general event outbox.
-- A send request is never considered delivered until verifiable provider proof.
CREATE TABLE document_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  document_kind text NOT NULL CHECK
    (document_kind IN ('PURCHASE_ORDER','COMMERCIAL_DOCUMENT')),
  document_id uuid NOT NULL,
  document_number text NOT NULL,
  document_currency_code char(3) NOT NULL,
  document_total_minor bigint NOT NULL CHECK(document_total_minor>=0),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  channel text NOT NULL DEFAULT 'EMAIL' CHECK(channel='EMAIL'),
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  recipient_override_reason text,
  recipient_confirmed boolean NOT NULL CHECK(recipient_confirmed),
  sender_email text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK(
    status IN ('QUEUED','SENDING','ACCEPTED','FAILED','REVIEW_REQUIRED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  last_error_code text,
  created_by_staff_id uuid REFERENCES staff(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,client_request_id)
);
CREATE INDEX document_deliveries_document_lookup
  ON document_deliveries(business_id,document_kind,document_id,created_at DESC);
CREATE INDEX document_deliveries_review_queue
  ON document_deliveries(status,created_at)
  WHERE status IN ('SENDING','REVIEW_REQUIRED');

CREATE TABLE document_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  delivery_id uuid NOT NULL REFERENCES document_deliveries(id),
  attempt_number integer NOT NULL CHECK(attempt_number BETWEEN 1 AND 5),
  status text NOT NULL CHECK(status IN ('STARTED','ACCEPTED','REVIEW_REQUIRED')),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(delivery_id,attempt_number)
);

COMMIT;
