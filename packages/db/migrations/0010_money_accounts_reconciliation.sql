BEGIN;
CREATE TABLE money_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid REFERENCES branches(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160), method text NOT NULL CHECK(method IN ('CASH','MOMO','CARD','BANK','OTHER')),
 kind text NOT NULL CHECK(kind IN ('CASH_DRAWER','MOMO_WALLET','BANK_ACCOUNT','CARD_CLEARING','OTHER')), currency_code char(3) NOT NULL,
 provider text CHECK(provider IS NULL OR length(provider)<=300), reference_label text CHECK(reference_label IS NULL OR length(reference_label)<=300), allow_negative boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(business_id,id),
 CHECK((kind='CASH_DRAWER' AND method='CASH') OR (kind='MOMO_WALLET' AND method='MOMO') OR (kind='BANK_ACCOUNT' AND method='BANK') OR (kind='CARD_CLEARING' AND method='CARD') OR kind='OTHER')
);
CREATE TABLE money_account_defaults (
 business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid NOT NULL REFERENCES branches(id), method text NOT NULL CHECK(method IN ('CASH','MOMO','CARD','BANK','OTHER')),
 money_account_id uuid NOT NULL, PRIMARY KEY(business_id,branch_id,method), FOREIGN KEY(business_id,money_account_id) REFERENCES money_accounts(business_id,id)
);
CREATE FUNCTION validate_money_account_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches WHERE id=NEW.branch_id AND business_id=NEW.business_id) THEN RAISE EXCEPTION 'Account branch belongs to another business'; END IF;
 IF NEW.currency_code<>(SELECT currency_code FROM businesses WHERE id=NEW.business_id) THEN RAISE EXCEPTION 'Account currency must match business'; END IF;
 IF EXISTS(SELECT 1 FROM money_account_defaults d WHERE d.business_id=NEW.business_id AND d.money_account_id=NEW.id AND (NOT NEW.active OR d.method<>NEW.method OR (NEW.branch_id IS NOT NULL AND d.branch_id<>NEW.branch_id))) THEN RAISE EXCEPTION 'Default account cannot be deactivated or moved'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER money_account_scope BEFORE INSERT OR UPDATE ON money_accounts FOR EACH ROW EXECUTE FUNCTION validate_money_account_scope();
CREATE FUNCTION validate_money_default() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM branches br JOIN money_accounts a ON a.business_id=br.business_id WHERE br.id=NEW.branch_id AND br.business_id=NEW.business_id AND a.id=NEW.money_account_id AND a.method=NEW.method AND a.active AND (a.branch_id IS NULL OR a.branch_id=br.id)) THEN RAISE EXCEPTION 'Invalid branch default account'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER money_default_scope BEFORE INSERT OR UPDATE ON money_account_defaults FOR EACH ROW EXECUTE FUNCTION validate_money_default();
CREATE FUNCTION ensure_branch_money_accounts(target_branch uuid) RETURNS void LANGUAGE plpgsql AS $$ DECLARE br record; m record; account_id uuid; BEGIN
 SELECT branches.*,businesses.currency_code INTO br FROM branches JOIN businesses ON businesses.id=branches.business_id WHERE branches.id=target_branch;
 FOR m IN SELECT * FROM (VALUES ('CASH','Cash drawer','CASH_DRAWER'),('MOMO','Mobile money wallet','MOMO_WALLET'),('CARD','Card clearing','CARD_CLEARING'),('BANK','Bank account','BANK_ACCOUNT'),('OTHER','Other money','OTHER')) AS defaults(method,name,kind) LOOP
 IF NOT EXISTS(SELECT 1 FROM money_account_defaults WHERE branch_id=br.id AND method=m.method) THEN
 INSERT INTO money_accounts(business_id,branch_id,name,method,kind,currency_code) VALUES(br.business_id,br.id,m.name,m.method,m.kind,br.currency_code) RETURNING id INTO account_id;
 INSERT INTO money_account_defaults VALUES(br.business_id,br.id,m.method,account_id);
 END IF; END LOOP; END $$;
SELECT ensure_branch_money_accounts(id) FROM branches;
CREATE FUNCTION seed_branch_money_accounts() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM ensure_branch_money_accounts(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER branch_money_defaults AFTER INSERT ON branches FOR EACH ROW EXECUTE FUNCTION seed_branch_money_accounts();
ALTER TABLE cashbook_entries ADD COLUMN money_account_id uuid;
ALTER TABLE expenses ADD COLUMN money_account_id uuid;
ALTER TABLE cashbook_adjustments ADD COLUMN money_account_id uuid;
UPDATE cashbook_entries e SET money_account_id=d.money_account_id FROM money_account_defaults d WHERE d.business_id=e.business_id AND d.branch_id=e.branch_id AND d.method=e.method;
UPDATE expenses e SET money_account_id=d.money_account_id FROM money_account_defaults d WHERE d.business_id=e.business_id AND d.branch_id=e.branch_id AND d.method=e.method;
UPDATE cashbook_adjustments e SET money_account_id=d.money_account_id FROM money_account_defaults d WHERE d.business_id=e.business_id AND d.branch_id=e.branch_id AND d.method=e.method;
ALTER TABLE cashbook_entries ALTER COLUMN money_account_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN money_account_id SET NOT NULL;
ALTER TABLE cashbook_adjustments ALTER COLUMN money_account_id SET NOT NULL;
ALTER TABLE cashbook_entries ADD FOREIGN KEY(business_id,money_account_id) REFERENCES money_accounts(business_id,id);
ALTER TABLE expenses ADD FOREIGN KEY(business_id,money_account_id) REFERENCES money_accounts(business_id,id);
ALTER TABLE cashbook_adjustments ADD FOREIGN KEY(business_id,money_account_id) REFERENCES money_accounts(business_id,id);
ALTER TABLE cashbook_entries DROP CONSTRAINT cashbook_entries_entry_type_check;
ALTER TABLE cashbook_entries ADD CHECK(entry_type IN ('SALE_RECEIPT','CUSTOMER_PAYMENT','PURCHASE_PAYMENT','SUPPLIER_PAYMENT','SALE_REFUND','PURCHASE_RETURN_RECOVERY','EXPENSE','OPENING_BALANCE','ADJUSTMENT','OWNER_INJECTION','OWNER_WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN'));
CREATE INDEX cashbook_account_time ON cashbook_entries(business_id,money_account_id,occurred_at);
CREATE INDEX money_accounts_scope_method ON money_accounts(business_id,branch_id,method,active);
CREATE TABLE money_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid NOT NULL REFERENCES branches(id),
 source_account_id uuid NOT NULL, destination_account_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>0), currency_code char(3) NOT NULL,
 actor_staff_id uuid NOT NULL REFERENCES staff(id), note text, client_mutation_id text NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,client_mutation_id), CHECK(source_account_id<>destination_account_id),
 FOREIGN KEY(business_id,source_account_id) REFERENCES money_accounts(business_id,id), FOREIGN KEY(business_id,destination_account_id) REFERENCES money_accounts(business_id,id)
);
CREATE INDEX money_transfers_business_time ON money_transfers(business_id,occurred_at DESC,id DESC);
CREATE TABLE money_reconciliations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES businesses(id), branch_id uuid NOT NULL REFERENCES branches(id), money_account_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('CASH_COUNT','STATEMENT')), period_start timestamptz NOT NULL, period_end timestamptz NOT NULL CHECK(period_end>=period_start),
 expected_balance_minor bigint NOT NULL, observed_balance_minor bigint NOT NULL, difference_minor bigint GENERATED ALWAYS AS (observed_balance_minor-expected_balance_minor) STORED,
 status text NOT NULL CHECK(status IN ('MATCHED','VARIANCE','RESOLVED')), actor_staff_id uuid NOT NULL REFERENCES staff(id), note text,
 client_mutation_id text NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 resolution_adjustment_id uuid UNIQUE REFERENCES cashbook_adjustments(id), resolved_by_staff_id uuid REFERENCES staff(id), resolved_at timestamptz, resolution_note text, resolution_client_mutation_id text,
 UNIQUE(business_id,client_mutation_id), FOREIGN KEY(business_id,money_account_id) REFERENCES money_accounts(business_id,id),
 CHECK((status='MATCHED' AND observed_balance_minor=expected_balance_minor AND resolution_adjustment_id IS NULL AND resolved_at IS NULL AND resolved_by_staff_id IS NULL) OR
       (status='VARIANCE' AND observed_balance_minor<>expected_balance_minor AND resolution_adjustment_id IS NULL AND resolved_at IS NULL AND resolved_by_staff_id IS NULL) OR
       (status='RESOLVED' AND observed_balance_minor<>expected_balance_minor AND resolution_adjustment_id IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_staff_id IS NOT NULL))
);
CREATE INDEX money_reconciliations_account_time ON money_reconciliations(business_id,money_account_id,period_end DESC,id DESC);
COMMIT;
