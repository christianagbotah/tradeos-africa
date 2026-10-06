BEGIN;
CREATE TABLE operating_days (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid NOT NULL REFERENCES branches(id), business_date date NOT NULL,
 currency_code char(3) NOT NULL, status text NOT NULL CHECK(status IN ('OPEN','CLOSED')),
 opened_by_staff_id uuid NOT NULL REFERENCES staff(id), closed_by_staff_id uuid REFERENCES staff(id),
 opening_client_mutation_id text NOT NULL, closing_client_mutation_id text,
 opened_at timestamptz NOT NULL, closed_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,branch_id,business_date), UNIQUE(business_id,opening_client_mutation_id), UNIQUE(business_id,closing_client_mutation_id),
 CHECK(closed_at IS NULL OR closed_at >= opened_at),
 CHECK((status='OPEN' AND closed_at IS NULL AND closing_client_mutation_id IS NULL) OR (status='CLOSED' AND closed_at IS NOT NULL AND closing_client_mutation_id IS NOT NULL AND closed_by_staff_id IS NOT NULL))
);
CREATE TABLE operating_day_method_balances (
 operating_day_id uuid NOT NULL REFERENCES operating_days(id), method text NOT NULL CHECK(method IN ('CASH','MOMO','CARD','BANK','OTHER')),
 opening_counted_minor bigint NOT NULL CHECK(opening_counted_minor BETWEEN 0 AND 9007199254740991), movement_minor bigint NOT NULL DEFAULT 0 CHECK(abs(movement_minor::numeric)<=9007199254740991),
 expected_closing_minor bigint NOT NULL CHECK(abs(expected_closing_minor::numeric)<=9007199254740991), closing_counted_minor bigint CHECK(closing_counted_minor BETWEEN 0 AND 9007199254740991),
 variance_minor bigint CHECK(abs(variance_minor::numeric)<=9007199254740991), PRIMARY KEY(operating_day_id,method)
);
CREATE INDEX idx_operating_days_interval ON operating_days(business_id,branch_id,opened_at DESC);
CREATE TABLE staff_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid NOT NULL REFERENCES branches(id), operating_day_id uuid NOT NULL REFERENCES operating_days(id), staff_id uuid NOT NULL REFERENCES staff(id),
 currency_code char(3) NOT NULL, status text NOT NULL CHECK(status IN ('OPEN','CLOSED')),
 opened_by_staff_id uuid NOT NULL REFERENCES staff(id), closed_by_staff_id uuid REFERENCES staff(id),
 opening_client_mutation_id text NOT NULL, closing_client_mutation_id text,
 opened_at timestamptz NOT NULL, closed_at timestamptz, note text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,opening_client_mutation_id), UNIQUE(business_id,closing_client_mutation_id),
 CHECK(closed_at IS NULL OR closed_at >= opened_at),
 CHECK((status='OPEN' AND closed_at IS NULL AND closing_client_mutation_id IS NULL) OR (status='CLOSED' AND closed_at IS NOT NULL AND closing_client_mutation_id IS NOT NULL AND closed_by_staff_id IS NOT NULL))
);
CREATE TABLE staff_shift_method_balances (
 staff_shift_id uuid NOT NULL REFERENCES staff_shifts(id), method text NOT NULL CHECK(method IN ('CASH','MOMO','CARD','BANK','OTHER')),
 opening_counted_minor bigint NOT NULL CHECK(opening_counted_minor BETWEEN 0 AND 9007199254740991), movement_minor bigint NOT NULL DEFAULT 0 CHECK(abs(movement_minor::numeric)<=9007199254740991),
 expected_closing_minor bigint NOT NULL CHECK(abs(expected_closing_minor::numeric)<=9007199254740991), closing_counted_minor bigint CHECK(closing_counted_minor BETWEEN 0 AND 9007199254740991),
 variance_minor bigint CHECK(abs(variance_minor::numeric)<=9007199254740991), PRIMARY KEY(staff_shift_id,method)
);
CREATE INDEX idx_staff_shifts_interval ON staff_shifts(business_id,branch_id,opened_at DESC);
CREATE UNIQUE INDEX one_open_operating_day ON operating_days(business_id,branch_id) WHERE status='OPEN';
CREATE UNIQUE INDEX one_open_staff_shift ON staff_shifts(business_id,branch_id,staff_id) WHERE status='OPEN';
ALTER TABLE cashbook_entries ADD operating_day_id uuid REFERENCES operating_days(id), ADD staff_shift_id uuid REFERENCES staff_shifts(id);
CREATE INDEX cashbook_day_method ON cashbook_entries(operating_day_id,method);
CREATE INDEX cashbook_shift_method ON cashbook_entries(staff_shift_id,method);
COMMIT;
