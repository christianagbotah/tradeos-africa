#!/bin/bash
set -euo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin
# Fixed-scope, operator-only consistent backup + isolated restore rehearsal.
# No writes to original databases, no service changes and no release activation.
ROOT=/home/lightworld/backups/tradeos-staging-databases
PARENT=/home/lightworld/backups
SOCKET=/home/lightworld/shared/tradeos-staging/pgsocket
PG=/usr/local/apps/pgsql18/bin
PORT=56380
TEST_PORT=56389
LOCK=/var/lock/lightworld-deploy/tradeos-staging-backup.lock
stage=''
drill=''
running=0
complete=0
fail() { echo "tradeos-backup-blocked: $1" >&2; exit 65; }
dbs() { printf '%s\n' tradeos_staging tradeos_account_ctrl_test tradeos_settings_v2_test; }
pg() { /usr/sbin/runuser -u postgres -- /usr/bin/env -i PATH=/usr/local/apps/pgsql18/bin:/usr/bin:/bin HOME=/var/lib/pgsql "$@"; }
if [[ $# != 1 || ( "$1" != '--check' && "$1" != '--backup-restore' ) ]]; then
  echo 'usage: tradeos-staging-backup-restore.sh --check|--backup-restore' >&2; exit 64
fi
(( EUID == 0 )) || fail 'root-only operator'
for dir in "$PARENT" /var/lock/lightworld-deploy "$SOCKET"; do
  [[ -d "$dir" && ! -L "$dir" ]] || fail 'untrusted or missing directory'
done
[[ "$(stat -c '%u' "$PARENT")" == 0 && "$(stat -c '%u' /var/lock/lightworld-deploy)" == 0 ]] ||
  fail 'untrusted root directory owner'
for dir in "$PARENT" /var/lock/lightworld-deploy; do
  mode="$(stat -c '%a' "$dir")"
  (( (8#$mode & 0022) == 0 )) || fail 'writable untrusted parent'
done
[[ "$(stat -c '%U' "$SOCKET")" == postgres && -S "$SOCKET/.s.PGSQL.$PORT" ]] ||
  fail 'source PostgreSQL socket is missing'
systemctl is-active --quiet tradeos-staging-postgres.service || fail 'TradeOS PostgreSQL is not running'
for tool in pg_dump pg_dumpall pg_restore initdb pg_ctl psql createdb; do
  [[ -x "$PG/$tool" && ! -L "$PG/$tool" ]] || fail 'missing verified PG 18 binary'
done
[[ "$("$PG/pg_dump" --version)" == *'18.'* ]] || fail 'requires PostgreSQL 18'
while read -r db; do
  found="$(pg "$PG/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$SOCKET" -p "$PORT" -U postgres -d postgres \
    -c "SELECT 1 FROM pg_database WHERE datname='$db' AND datallowconn" 2>/dev/null)" ||
    fail 'cannot connect to isolated TradeOS cluster'
  [[ "$found" == 1 ]] || fail 'expected TradeOS database missing'
done < <(dbs)
if [[ "$1" == '--check' ]]; then
  echo 'tradeos_backup_preflight=true databases=3 no_changes=true'
  exit 0
fi
usage_pct="$(df -P / | awk 'NR==2{gsub(/%/,"",$5);print $5}')"
available_kib="$(df -Pk / | awk 'NR==2{print $4}')"
[[ "$usage_pct" =~ ^[0-9]+$ && "$available_kib" =~ ^[0-9]+$ ]] ||
  fail 'shared VPS capacity unknown'
(( usage_pct < 90 && available_kib > 6291456 )) ||
  fail 'shared VPS too full for a backup and restore drill'
if [[ ! -e "$ROOT" && ! -L "$ROOT" ]]; then mkdir -m 0700 -- "$ROOT"; fi
[[ -d "$ROOT" && ! -L "$ROOT" && "$(stat -c '%u:%a' "$ROOT")" == 0:700 ]] ||
  fail 'unsafe backup directory permissions'
[[ ! -L "$LOCK" && ( ! -e "$LOCK" || -f "$LOCK" ) ]] || fail 'unsafe lock'
exec {lock_fd}>"$LOCK"
flock -n "$lock_fd" || { echo 'tradeos-backup-locked' >&2; exit 75; }
cleanup() {
  code=$?
  trap - EXIT
  if [[ "$running" == 1 && "$drill" == /tmp/tradeos-staging-restore.* ]]; then
    if pg "$PG/pg_ctl" -D "$drill/data" status >/dev/null 2>&1; then
      if pg "$PG/pg_ctl" -D "$drill/data" -m fast -w stop >/dev/null 2>&1; then
        running=0
      else
        code=65
        echo 'isolated restore server stop failed: isolated files retained' >&2
      fi
    else
      running=0
    fi
  fi
  if [[ "$running" == 0 && -d "$drill" && ! -L "$drill" &&
        "$drill" == /tmp/tradeos-staging-restore.* ]]; then
    rm -rf --one-file-system -- "$drill"
  fi
  if [[ "$complete" == 0 && -d "$stage" && ! -L "$stage" &&
        "$stage" == "$ROOT/.inprogress."* ]]; then
    rm -rf --one-file-system -- "$stage"
  fi
  exit "$code"
}
trap cleanup EXIT
stage="$(mktemp -d "$ROOT/.inprogress.XXXXXXXX")"
[[ "$(stat -c '%u:%a' "$stage")" == 0:700 ]] || fail 'unsafe staged backup ownership'
while read -r db; do
  # Source cluster is accessed ONLY through pg_dump (consistent MVCC snapshot).
  pg "$PG/pg_dump" -h "$SOCKET" -p "$PORT" -U postgres -d "$db" -Fc -Z 6 \
    --no-owner --no-acl > "$stage/$db.dump" 2>"$stage/dump-error.log" ||
    fail 'source backup failed'
  [[ -s "$stage/$db.dump" ]] || fail 'empty dump'
  "$PG/pg_restore" --list "$stage/$db.dump" > "$stage/$db.toc" 2>"$stage/toc-error.log" ||
    fail 'invalid backup TOC'
  [[ -s "$stage/$db.toc" ]] || fail 'empty backup TOC'
done < <(dbs)
# Globals may include password hashes: all files remain root-only 0600.
pg "$PG/pg_dumpall" --globals-only -h "$SOCKET" -p "$PORT" -U postgres \
  > "$stage/globals.sql" 2>"$stage/globals-error.log" || fail 'global roles backup failed'
[[ -s "$stage/globals.sql" ]] || fail 'empty global roles dump'
(cd "$stage"; sha256sum globals.sql tradeos_staging.dump tradeos_account_ctrl_test.dump tradeos_settings_v2_test.dump > SHA256SUMS
 sha256sum -c --status SHA256SUMS) || fail 'checksums failed'
drill="$(mktemp -d /tmp/tradeos-staging-restore.XXXXXXXX)"
chown postgres:postgres -- "$drill"; chmod 0700 -- "$drill"
pg mkdir -m 0700 -- "$drill/data" "$drill/socket"
pg "$PG/initdb" -D "$drill/data" --no-instructions --auth-local=trust --auth-host=reject \
  > "$stage/initdb.log" 2>&1 || fail 'isolated cluster init failed'
running=1
pg "$PG/pg_ctl" -D "$drill/data" -l "$drill/pg.log" \
  -o "-c listen_addresses='' -c unix_socket_directories=$drill/socket -p $TEST_PORT" -w start \
  > "$stage/start.log" 2>&1 || fail 'isolated cluster startup failed'
while read -r db; do
  pg "$PG/createdb" -h "$drill/socket" -p "$TEST_PORT" -U postgres "$db" \
    > "$stage/create.log" 2>&1 || fail 'isolated restore DB creation failed'
  # Root opens 0600 dump via stdin; postgres role has no durable backup access.
  pg "$PG/pg_restore" -h "$drill/socket" -p "$TEST_PORT" -U postgres -d "$db" \
    --exit-on-error --no-owner --no-acl < "$stage/$db.dump" \
    > "$stage/restore.log" 2>&1 || fail 'isolated restore failed'
  tables="$(pg "$PG/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$drill/socket" -p "$TEST_PORT" \
    -U postgres -d "$db" -c "SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')" 2>"$stage/verify.log")" ||
    fail 'isolated restore verification query failed'
  [[ "$tables" =~ ^[0-9]+$ && "$tables" -gt 0 ]] || fail 'restored database missing tables'
done < <(dbs)
ledger="$(pg "$PG/psql" -X -q -A -t -v ON_ERROR_STOP=1 -h "$drill/socket" -p "$TEST_PORT" \
 -U postgres -d tradeos_staging -c "SELECT (SELECT count(*) FROM lightworld_schema_migrations WHERE state='APPLIED') || '|' || (SELECT count(*) FROM lightworld_schema_migrations) || '|' || (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('payments','refund_transactions','sync_mutations','outbox_events','hubtel_sale_checkout_attempts'))" 2>"$stage/verify.log")" ||
 fail 'restored financial ledger verification failed'
IFS='|' read -r applied total tables <<< "$ledger"
[[ "$applied" =~ ^[0-9]+$ && "$total" =~ ^[0-9]+$ && "$applied" == "$total" &&
   "$total" -gt 0 && "$tables" == 5 ]] || fail 'restored staging financial schema invalid'
pg "$PG/pg_ctl" -D "$drill/data" -m fast -w stop > "$stage/stop.log" 2>&1 ||
  fail 'isolated cluster stop failed'
running=0
rm -rf --one-file-system -- "$drill"; drill=''
rm -f -- "$stage"/*.log
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$ROOT/$stamp"
[[ ! -e "$final" && ! -L "$final" ]] || fail 'duplicate timestamp backup'
printf '{"databaseCount":3,"isolatedRestoresVerified":3,"migrationRows":%d,"financialTablesVerified":5,"sourceDatabasesModified":false,"offsiteVerified":false,"cutoverAuthorized":false}\n' "$total" > "$stage/restore-status.json"
chmod 0600 -- "$stage"/*
mv -T -- "$stage" "$final"
complete=1
echo "tradeos_backup_restore_verified=true databases=3 migrations=$total path=$final offsite_verified=false cutover_authorized=false"
