BEGIN;

-- Transactional delivery is not payment and does not modify inventory or AP.
-- Only issued supplier purchase orders may be delivered (enforced by service).
CREATE TABLE supplier_document_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  purchase_order_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL REFERENCES staff(id),
  authorized_by_staff_id uuid REFERENCES staff(id),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  channel text NOT NULL DEFAULT 'EMAIL' CHECK (channel = 'EMAIL'),
  status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN (
    'PREPARED','QUEUED','SENDING','ACCEPTED','REVIEW_REQUIRED','CANCELLED'
  )),
  recipient_email varchar(254) NOT NULL,
  recipient_name varchar(180) NOT NULL,
  sender_email varchar(254),
  document_number varchar(32) NOT NULL,
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 240),
  body_text text NOT NULL CHECK(length(body_text) BETWEEN 1 AND 40000),
  payload_snapshot jsonb NOT NULL CHECK(jsonb_typeof(payload_snapshot) = 'object'),
  content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  recipient_confirmed boolean NOT NULL DEFAULT false,
  consent_confirmed boolean NOT NULL DEFAULT false,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  provider_message_id varchar(255),
  last_error_code varchar(80),
  authorized_at timestamptz,
  last_attempt_at timestamptz,
  accepted_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,id),
  UNIQUE(business_id,client_request_id),
  FOREIGN KEY (business_id,purchase_order_id)
    REFERENCES supplier_purchase_orders(business_id,id),
  CHECK ((status IN ('QUEUED','SENDING','ACCEPTED','REVIEW_REQUIRED'))
    = (authorized_at IS NOT NULL)),
  CHECK (status NOT IN ('QUEUED','SENDING','ACCEPTED','REVIEW_REQUIRED')
    OR (recipient_confirmed AND consent_confirmed AND sender_email IS NOT NULL))
);
CREATE INDEX supplier_doc_delivery_po
  ON supplier_document_deliveries(business_id,purchase_order_id,created_at DESC);
CREATE INDEX supplier_doc_delivery_queue
  ON supplier_document_deliveries(next_attempt_at,created_at)
  WHERE status='QUEUED';
CREATE INDEX supplier_doc_delivery_stale
  ON supplier_document_deliveries(last_attempt_at)
  WHERE status='SENDING';

CREATE TABLE supplier_document_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  delivery_id uuid NOT NULL,
  attempt_number smallint NOT NULL CHECK(attempt_number BETWEEN 1 AND 3),
  status text NOT NULL CHECK(status IN ('STARTED','ACCEPTED','REVIEW_REQUIRED')),
  provider_message_id varchar(255),
  error_code varchar(80),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(business_id,delivery_id,attempt_number),
  FOREIGN KEY(business_id,delivery_id)
    REFERENCES supplier_document_deliveries(business_id,id)
);

CREATE OR REPLACE FUNCTION validate_supplier_delivery_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM supplier_purchase_orders o
      JOIN suppliers s ON s.id=o.supplier_id AND s.business_id=o.business_id
      JOIN branches b ON b.id=o.branch_id AND b.business_id=o.business_id
    WHERE o.id=NEW.purchase_order_id AND o.business_id=NEW.business_id
      AND o.branch_id=NEW.branch_id AND o.supplier_id=NEW.supplier_id
  ) THEN
    RAISE EXCEPTION 'Document delivery supplier, branch or order scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_delivery_scope
  BEFORE INSERT OR UPDATE ON supplier_document_deliveries
  FOR EACH ROW EXECUTE FUNCTION validate_supplier_delivery_scope();

COMMIT;
