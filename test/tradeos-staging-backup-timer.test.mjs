import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const installerPath=path.join(root,'ops/release/install-tradeos-staging-backup-timer.sh');
const installer=read('ops/release/install-tradeos-staging-backup-timer.sh');
const service=read('ops/release/systemd/lightworld-tradeos-staging-backup.service');
const timer=read('ops/release/systemd/lightworld-tradeos-staging-backup.timer');
const backup=read('ops/release/tradeos-staging-backup-restore.sh');
const sha='a'.repeat(40);
const run=(args)=>spawnSync('bash',[installerPath,...args],{
  encoding:'utf8',timeout:5000,
  env:{PATH:'/usr/bin:/bin',HOME:'/tmp',GH_TOKEN:''},
});

test('new systemd and installer files pass Bash syntax and schema text checks',()=>{
  const r=spawnSync('bash',['-n',installerPath],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.match(installer,/^#!\/bin\/bash/);
  assert.match(service,/^\[Unit\]/);
  assert.match(service,/^\[Service\]/m);
  assert.match(timer,/^\[Timer\]/m);
  assert.match(timer,/^\[Install\]/m);
});
test('unexpected arguments fail before any filesystem changes',()=>{
  for(const args of [[],['--help'],['/tmp','bad','--install'],
    ['relative',sha,'--install'],['/tmp',sha,'--delete'],
    ['/tmp',sha,'--check','extra']]){
    const r=run(args);
    assert.equal(r.status,64,JSON.stringify(args)+': '+r.stderr);
  }
});
test('unsafe or nonexistent source fails closed without mutating service files',()=>{
  const r=run(['/tmp/nonexistent-tradeos-backup-source',sha,'--install']);
  assert.equal(r.status,65,r.stderr);
});
test('installer requires reviewed exact GitHub main, pristine root-only tracked source',()=>{
  assert.match(installer,/canonical.*realpath -e/);
  assert.match(installer,/canonical.*\/root\//);
  assert.match(installer,/git -C "\$source_dir" rev-parse --verify HEAD/);
  assert.match(installer,/git -C "\$source_dir" branch --show-current/);
  assert.match(installer,/git -C "\$source_dir" status --porcelain --untracked-files=all/);
  assert.match(installer,/gh api "repos\/\$REPO\/branches\/main"/);
  assert.match(installer,/git -C "\$source_dir" remote get-url origin/);
  assert.match(installer,/git -C "\$source_dir" ls-files --error-unmatch/);
  assert.match(installer,/stat -c '%u'/);
  assert.match(installer,/8#\$mode & 0022/);
});
test('installer is one-time, locked, atomic, checksum-verified and does not start timer',()=>{
  assert.match(installer,/TOOL_DIR='\/usr\/local\/libexec\/lightworld-deploy\/tradeos-staging-backup'/);
  assert.match(installer,/LOCK='\/var\/lock\/lightworld-deploy\/tradeos-staging-backup\.lock'/);
  assert.match(installer,/flock -n "\$lock_fd"/);
  assert.match(installer,/protected install destination already exists/);
  assert.match(installer,/mktemp -d \/usr\/local\/libexec\/lightworld-deploy\/\.tradeos-backup-stage/);
  assert.match(installer,/sha256sum -c --status SHA256SUMS/);
  assert.match(installer,/mv -T -- "\$STAGING" "\$TOOL_DIR"/);
  assert.match(installer,/trap cleanup_install EXIT/);
  assert.match(installer,/installed_tool=1/);
  assert.match(installer,/complete=1/);
  assert.match(installer,/timer_enabled=false no_backup_started=true offsite_verified=false/);
  assert.doesNotMatch(installer,/systemctl (enable|start|restart|stop)|pm2|applyMigrations|DROP DATABASE|lightworld-deploy-tradeos-staging/);
});
test('systemd service uses protected script, integrity verification and low IO priority',()=>{
  assert.match(service,/ExecStartPre=\/usr\/bin\/bash -c '.*sha256sum -c --status SHA256SUMS'/);
  assert.match(service,/ExecStart=\/usr\/local\/libexec\/lightworld-deploy\/tradeos-staging-backup\/run\.sh --backup-restore/);
  assert.match(service,/After=tradeos-staging-postgres\.service/);
  assert.match(service,/Type=oneshot/);
  assert.match(service,/UMask=0077/);
  assert.match(service,/TimeoutStartSec=15min/);
  assert.match(service,/Nice=10/);
  assert.match(service,/IOSchedulingPriority=7/);
  assert.match(service,/ProtectSystem=full/);
  assert.match(service,/PrivateTmp=true/);
  assert.doesNotMatch(service,/ExecStart.*(pg_ctl|systemctl|pm2|pnpm)/);
});
test('timer runs daily UTC without piling up skipped runs or changing VPS global schedule',()=>{
  assert.match(timer,/OnCalendar=\*-\*-\* 05:20:00 UTC/);
  assert.match(timer,/RandomizedDelaySec=10m/);
  assert.match(timer,/AccuracySec=2m/);
  assert.match(timer,/Persistent=false/);
  assert.match(timer,/Unit=lightworld-tradeos-staging-backup\.service/);
  assert.match(timer,/WantedBy=timers\.target/);
  assert.doesNotMatch(timer,/OnBootSec|OnUnitActiveSec|Persistent=true/);
});
test('backup runner itself protects original data, shared storage, retention and rollback',()=>{
  assert.match(backup,/tradeos-staging-postgres\.service/);
  assert.match(backup,/usage_pct < 90 && available_kib > 6291456/);
  assert.match(backup,/sha256sum -c --status SHA256SUMS/);
  assert.match(backup,/offsite_verified=false cutover_authorized=false/);
  assert.doesNotMatch(backup,/rm -rf.*\/home\/lightworld\/backups|systemctl restart|pm2 restart/);
});
