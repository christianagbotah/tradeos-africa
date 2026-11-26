#!/usr/bin/env bash
set -euo pipefail
# Explicitly restricted to disposable GitHub-hosted runners.
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tradeos PGPASSWORD=tradeos
export DATABASE_URL=postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_upgrade_ci
db=tradeos_upgrade_ci
base="$(mktemp -d)"
createdb "$db"
for f in packages/db/migrations/*.sql; do
  n="$(basename "$f" | cut -c1-4)"
  if (( 10#$n <= 60 )); then cp "$f" "$base/"; fi
done
test "$(find "$base" -name '*.sql' | wc -l)" -eq 60
pnpm --filter @tradeos/api exec tsx src/scripts/apply-migrations.ts "$base"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL'
INSERT INTO businesses(id,name,business_type) VALUES ('11111111-1111-4111-8111-111111111111','Rehearsal shop','RETAIL_HARDWARE'), ('22222222-2222-4222-8222-222222222222','Second shop','RETAIL_HARDWARE');
INSERT INTO branches(id,business_id,name,code) VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Main','MAIN'), ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','Main','MAIN');
INSERT INTO staff(id,business_id,display_name,role) VALUES ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','Owner','OWNER'), ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','Cashier','CASHIER');
INSERT INTO sales(id,business_id,branch_id,cashier_staff_id,status,currency_code,subtotal_net_minor,total_minor,client_mutation_id,completed_at) VALUES ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666','COMPLETED','GHS',2500,2500,'upgrade-sale',now());
INSERT INTO payments(id,business_id,branch_id,sale_id,amount_minor,currency_code,method,status,client_mutation_id) VALUES ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','88888888-8888-4888-8888-888888888888',2500,'GHS','CASH','SUCCEEDED','upgrade-payment');
INSERT INTO cashbook_entries(business_id,branch_id,amount_delta_minor,currency_code,method,entry_type,source_type,source_id,actor_staff_id,idempotency_key,occurred_at,money_account_id)
 SELECT business_id,branch_id,2500,'GHS','CASH','SALE_RECEIPT','PAYMENT','99999999-9999-4999-8999-999999999999','66666666-6666-4666-8666-666666666666','upgrade-payment',now(),money_account_id FROM money_account_defaults WHERE branch_id='33333333-3333-4333-8333-333333333333' AND method='CASH';
INSERT INTO outbox_events(business_id,branch_id,aggregate_type,aggregate_id,event_type,payload) VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','SALE','88888888-8888-4888-8888-888888888888','SALE_COMPLETED','{}');
SQL
pg_dump -Fc --no-owner --no-acl -d "$db" > "$base/baseline.dump"
createdb tradeos_upgrade_restored_ci
pg_restore --exit-on-error --no-owner --no-acl -d tradeos_upgrade_restored_ci "$base/baseline.dump"
psql -X -At -d "$db" -c "SELECT format('SELECT %L,count(*),md5(COALESCE(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'''')) FROM %I.%I t;',table_name,table_schema,table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'lightworld_schema_migrations' ORDER BY table_name" > "$base/fingerprint.sql"
for spec in "$db:before" tradeos_upgrade_restored_ci:restored; do
 psql -X -At -v ON_ERROR_STOP=1 -d "${spec%:*}" -f "$base/fingerprint.sql" > "$base/${spec#*:}"
done
cmp "$base/before" "$base/restored"
export DATABASE_URL=postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_upgrade_restored_ci
migration_dir="$(realpath packages/db/migrations)"
pnpm --filter @tradeos/api exec tsx src/scripts/apply-migrations.ts "$migration_dir"
test "$(psql -X -At -d tradeos_upgrade_restored_ci -c "SELECT count(*) FROM lightworld_schema_migrations WHERE state='APPLIED'")" -eq 64
test "$(psql -X -At -d tradeos_upgrade_restored_ci -c "SELECT count(*) FROM lightworld_schema_migrations")" -eq 64
psql -X -At -v ON_ERROR_STOP=1 -d tradeos_upgrade_restored_ci -f "$base/fingerprint.sql" > "$base/after"
cmp "$base/before" "$base/after"
pnpm --filter @tradeos/api exec tsx src/scripts/apply-migrations.ts "$migration_dir" | tee "$base/replay"
grep -F '0 applied, 64 already applied' "$base/replay"
psql -X -v ON_ERROR_STOP=1 -d tradeos_upgrade_restored_ci <<'SQL'
DO $$
BEGIN
 IF (SELECT role FROM staff WHERE id='66666666-6666-4666-8666-666666666666') <> 'CASHIER' THEN RAISE EXCEPTION 'cashier role changed'; END IF;
 IF EXISTS(SELECT 1 FROM branch_shift_sale_policy_events) OR EXISTS(SELECT 1 FROM pos_attendant_branch_assignments) THEN RAISE EXCEPTION 'unexpected opt-in/backfill'; END IF;
 IF (SELECT sum(amount_delta_minor) FROM cashbook_entries WHERE business_id='11111111-1111-4111-8111-111111111111') <> 2500 THEN RAISE EXCEPTION 'ledger balance changed'; END IF;
 INSERT INTO staff(id,business_id,display_name,role) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Attendant','POS_ATTENDANT');
 BEGIN
  INSERT INTO pos_attendant_branch_assignments(business_id,staff_id,branch_id,assigned_by_staff_id) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555');
  RAISE EXCEPTION 'cross-tenant assignment unexpectedly accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 INSERT INTO pos_attendant_branch_assignments(business_id,staff_id,branch_id,assigned_by_staff_id) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555');
END $$;
SQL
printf 'Upgrade rehearsal passed: 60 -> 64, existing table fingerprints preserved, replay and tenant constraints verified. Synthetic data only.\n'
