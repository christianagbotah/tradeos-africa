import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'ops/release/tradeos-staging-backup-restore.sh');
const source=fs.readFileSync(file,'utf8');
test('backup and recovery shell script parses without executing any backup',()=>{
  const r=spawnSync('bash',['-n',file],{encoding:'utf8',timeout:3000});
  assert.equal(r.status,0,r.stderr);
});
test('malformed requests fail before touching paths or invoking PostgreSQL',()=>{
  for(const args of [[],['--restore'],['--delete'],['--backup-restore','extra'],['--check','--backup-restore']]){
    const r=spawnSync('bash',[file,...args],{encoding:'utf8',timeout:3000});
    assert.equal(r.status,64,JSON.stringify(args)+': '+r.status+' '+r.stderr);
  }
});
test('source always fixed to TradeOS dedicated PostgreSQL, never other projects',()=>{
  assert.match(source,/SOCKET=\/home\/lightworld\/shared\/tradeos-staging\/pgsocket/);
  assert.match(source,/PORT=56380/);
  assert.match(source,/systemctl is-active --quiet tradeos-staging-postgres\.service/);
  assert.match(source,/dbs\(\) \{ printf '%s\\n' tradeos_staging tradeos_account_ctrl_test tradeos_settings_v2_test/);
  assert.doesNotMatch(source,/\/home\/lightworld\/shared\/iedupro|\/home\/lightworld\/webapps\/irexpro/);
});
test('backup is root private, app specific, locked and never prunes durable backups',()=>{
  assert.match(source,/ROOT=\/home\/lightworld\/backups\/tradeos-staging-databases/);
  assert.match(source,/umask 077/);
  assert.match(source,/flock -n "\$lock_fd"/);
  assert.match(source,/mkdir -m 0700/);
  assert.match(source,/stat -c '%u:%a'/);
  assert.match(source,/chmod 0600 -- "\$stage"\/\*/);
  assert.match(source,/sha256sum -c --status SHA256SUMS/);
  assert.match(source,/mv -T -- "\$stage" "\$final"/);
  assert.doesNotMatch(source,/find.+-delete|rm -rf.+\/home\/lightworld|--prune|DROP DATABASE/);
});
test('uses fixed PostgreSQL 18 binaries and consistent database snapshots with no source write',()=>{
  assert.match(source,/PG=\/usr\/local\/apps\/pgsql18\/bin/);
  assert.match(source,/pg\(\) \{ \/usr\/sbin\/runuser -u postgres/);
  assert.match(source,/\/usr\/bin\/env -i/);
  assert.match(source,/usage_pct < 90 && available_kib > 6291456/);
  assert.match(source,/pg_dump" -h "\$SOCKET".+-Fc -Z 6/);
  assert.match(source,/pg_dumpall" --globals-only/);
  assert.doesNotMatch(source,/psql.+(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE TABLE)/);
  assert.doesNotMatch(source,/pg_ctl.+SOURCE_SOCKET|systemctl restart|systemctl stop/);
});
test('isolated restore listens on Unix socket only, not a TCP interface',()=>{
  assert.match(source,/mktemp -d \/tmp\/tradeos-staging-restore\.XXXXXXXX/);
  assert.match(source,/chown postgres:postgres -- "\$drill"/);
  assert.match(source,/chmod 0700 -- "\$drill"/);
  assert.match(source,/"\$drill" == \/tmp\/tradeos-staging-restore\.\*/);
  assert.match(source,/listen_addresses=''/);
  assert.match(source,/unix_socket_directories=\$drill\/socket/);
  assert.match(source,/--auth-host=reject/);
  assert.match(source,/--exit-on-error --no-owner --no-acl/);
  assert.match(source,/pg_ctl" -D "\$drill\/data" -m fast -w stop/);
});
test('recovery checks migration ledger and payment, refund, sync and outbox schema',()=>{
  assert.match(source,/lightworld_schema_migrations/);
  for(const table of ['payments','refund_transactions','sync_mutations','outbox_events','hubtel_sale_checkout_attempts']){
    assert.ok(source.includes(table),table);
  }
  assert.match(source,/"\$applied" == "\$total"/);
  assert.match(source,/isolatedRestoresVerified/);
});
test('backup success never implies offsite recovery or cutover authorization',()=>{
  assert.match(source,/"offsiteVerified":false/);
  assert.match(source,/"cutoverAuthorized":false/);
  assert.match(source,/offsite_verified=false cutover_authorized=false/);
  assert.doesNotMatch(source,/lightworld-deploy-tradeos-staging|pm2 restart|activate_release_target|change_owner|git clone|pnpm install/);
});
