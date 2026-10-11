BEGIN;

ALTER TABLE supplier_payable_ledger
  ADD COLUMN provider_reference text;

ALTER TABLE supplier_payable_ledger
  ADD CONSTRAINT supplier_payable_ledger_provider_reference_length
  CHECK (provider_reference IS NULL OR (char_length(provider_reference) >= 1 AND char_length(provider_reference) <= 200));

COMMIT;
