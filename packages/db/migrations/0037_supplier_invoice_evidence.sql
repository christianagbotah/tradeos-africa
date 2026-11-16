BEGIN;

-- Evidence is never publicly exposed under /v1/media. Binary receipts are
-- fetched only through authenticated business-scoped invoice routes.
-- Conservative inline storage until tenant-private object storage is available.
CREATE TABLE supplier_invoice_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  invoice_match_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL REFERENCES staff(id),
  filename varchar(120) NOT NULL CHECK(length(trim(filename))>0),
  mime_type text NOT NULL CHECK(
    mime_type IN ('application/pdf','image/png','image/jpeg')),
  size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 3145728),
  sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  file_bytes bytea NOT NULL CHECK(octet_length(file_bytes)=size_bytes),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(business_id,invoice_match_id)
    REFERENCES supplier_invoice_matches(business_id,id),
  UNIQUE(business_id,invoice_match_id,sha256)
);
CREATE INDEX supplier_invoice_evidence_lookup
  ON supplier_invoice_evidence(business_id,invoice_match_id,created_at);

COMMIT;
