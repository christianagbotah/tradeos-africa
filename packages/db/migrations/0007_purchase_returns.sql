BEGIN;
CREATE TABLE purchase_return_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES businesses(id),
 branch_id uuid NOT NULL REFERENCES branches(id),
 supplier_id uuid NOT NULL REFERENCES suppliers(id),
 original_purchase_id uuid NOT NULL REFERENCES purchases(id),
 returned_by_staff_id uuid NOT NULL REFERENCES staff(id),
 currency_code char(3) NOT NULL,
 recovery_method text NOT NULL CHECK (recovery_method IN ('CREDIT_NOTE','CASH','MOMO','CARD','BANK','OTHER')),
 supplier_recovery_minor bigint NOT NULL DEFAULT 0 CHECK (supplier_recovery_minor >= 0),
 inventory_value_removed_minor bigint NOT NULL DEFAULT 0 CHECK (inventory_value_removed_minor >= 0),
 purchase_price_variance_minor bigint NOT NULL DEFAULT 0,
 client_mutation_id text NOT NULL,
 occurred_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,client_mutation_id),
 CHECK (purchase_price_variance_minor = supplier_recovery_minor - inventory_value_removed_minor)
);
CREATE TABLE purchase_return_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 return_case_id uuid NOT NULL REFERENCES purchase_return_cases(id),
 purchase_line_id uuid NOT NULL REFERENCES purchase_lines(id),
 purchase_quantity numeric(24,8) NOT NULL CHECK (purchase_quantity > 0),
 stock_quantity numeric(24,8) NOT NULL CHECK (stock_quantity > 0),
 source_location text NOT NULL CHECK (source_location IN ('AVAILABLE','QUARANTINE')),
 supplier_recovery_minor bigint NOT NULL CHECK (supplier_recovery_minor >= 0),
 inventory_value_removed_minor bigint NOT NULL CHECK (inventory_value_removed_minor >= 0),
 purchase_price_variance_minor bigint NOT NULL,
 UNIQUE(return_case_id,purchase_line_id),
 CHECK (purchase_price_variance_minor = supplier_recovery_minor - inventory_value_removed_minor)
);
CREATE INDEX idx_purchase_returns_original ON purchase_return_cases(business_id,original_purchase_id,occurred_at DESC);
CREATE INDEX idx_purchase_return_lines_original ON purchase_return_lines(purchase_line_id);
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_reason_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_reason_check CHECK (reason IN (
 'OPENING_BALANCE','PURCHASE_RECEIPT','PURCHASE_RETURN','SALE','SALE_RETURN','TRANSFER',
 'TRANSFORMATION_INPUT','TRANSFORMATION_OUTPUT','SERVICE_CONSUMPTION','RECIPE_CONSUMPTION','WASTAGE','ADJUSTMENT'));
ALTER TABLE supplier_payable_ledger DROP CONSTRAINT IF EXISTS supplier_payable_ledger_method_check;
ALTER TABLE supplier_payable_ledger ADD CONSTRAINT supplier_payable_ledger_method_check CHECK (method IN ('CASH','MOMO','CARD','BANK','OTHER','SUPPLIER_CREDIT','CREDIT_NOTE'));
ALTER TABLE supplier_payable_ledger DROP CONSTRAINT IF EXISTS supplier_payable_ledger_source_type_check;
ALTER TABLE supplier_payable_ledger ADD CONSTRAINT supplier_payable_ledger_source_type_check CHECK (source_type IN ('PURCHASE','PAYMENT','RETURN'));
COMMIT;
