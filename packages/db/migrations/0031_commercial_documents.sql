BEGIN;

-- Issued quotations and proforma invoices are commercial documents only.
-- They do not recognize accounting revenue, transfer inventory, or create a receivable.
CREATE TABLE commercial_document_sequences (
  business_id uuid NOT NULL REFERENCES businesses(id),
  kind text NOT NULL CHECK (kind IN ('QUOTATION','PROFORMA')),
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2200),
  last_number integer NOT NULL CHECK (last_number > 0),
  PRIMARY KEY (business_id, kind, year)
);

CREATE TABLE commercial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  customer_id uuid REFERENCES customers(id),
  created_by_staff_id uuid REFERENCES staff(id),
  client_request_id uuid NOT NULL,
  request_fingerprint char(64) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('QUOTATION','PROFORMA')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','CANCELLED')),
  document_number text NOT NULL,
  currency_code char(3) NOT NULL,
  customer_name_snapshot text NOT NULL,
  customer_phone_snapshot text,
  customer_email_snapshot text,
  notes text NOT NULL DEFAULT '',
  expires_at timestamptz,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, document_number),
  UNIQUE (business_id, client_request_id),
  CHECK (total_minor = subtotal_minor + tax_minor),
  CHECK ((status <> 'ISSUED') OR issued_at IS NOT NULL),
  CHECK ((status <> 'CANCELLED') OR cancelled_at IS NOT NULL)
);
CREATE INDEX commercial_documents_recent_idx
  ON commercial_documents (business_id, branch_id, created_at DESC);
CREATE INDEX commercial_documents_customer_idx
  ON commercial_documents (business_id, customer_id, created_at DESC);

CREATE TABLE commercial_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  document_id uuid NOT NULL REFERENCES commercial_documents(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  item_name_snapshot text NOT NULL,
  item_kind_snapshot text NOT NULL,
  sale_unit_code text NOT NULL,
  quantity numeric(24,8) NOT NULL CHECK (quantity > 0),
  unit_net_minor bigint NOT NULL CHECK (unit_net_minor >= 0),
  line_net_minor bigint NOT NULL CHECK (line_net_minor >= 0),
  line_tax_minor bigint NOT NULL DEFAULT 0 CHECK (line_tax_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  CHECK (line_total_minor = line_net_minor + line_tax_minor),
  UNIQUE (document_id, sort_order)
);
CREATE INDEX commercial_document_lines_idx
  ON commercial_document_lines (business_id, document_id, sort_order);

COMMIT;
