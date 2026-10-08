BEGIN;

ALTER TABLE expense_categories
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE money_account_defaults
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
