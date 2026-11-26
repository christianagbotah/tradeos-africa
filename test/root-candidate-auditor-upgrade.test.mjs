import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const upgrade=path.join(base,'ops/release/upgrade-root-candidate-auditor.sh');
const audit=readFileSync(path.join(base,'ops/release/audit-github-artifact-pilot.sh'),'utf8');
const launcher=readFileSync(path.join(base,'ops/release/root-candidate-audit-entrypoint.sh'),'utf8');
const code=readFileSync(upgrade,'utf8');
const sha='a'.repeat(40);
const run=(args)=>spawnSync('/bin/bash',[upgrade,...args],{
  encoding:'utf8',timeout:3000,env:{PATH:'/usr/sbin:/usr/bin:/bin',HOME:'/tmp',GH_TOKEN:''},
});

test('root auditor upgrade rejects all malformed requests before root file changes',()=>{
  for(const args of [[],['help'],['/tmp',sha],['/tmp','bad','--upgrade'],
    ['relative',sha,'--upgrade'],['/tmp',sha,'--delete'],['/tmp',sha,'--rollback']]){
    const r=run(args);
    assert.equal(r.status,64,`${args} => ${r.status}: ${r.stderr}`);
  }
});

test('symlinked source checkout is rejected through the pinned installer before privilege changes',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'tradeos-upgrade-symlink-'));
  const real=path.join(root,'real'); const alias=path.join(root,'alias');
  try {
    mkdirSync(real);
    mkdirSync(path.join(real,'ops/release'),{recursive:true});
    // Alias is deliberately untrusted. No source installer is present.
    symlinkSync(real,alias);
    const r=run([alias,sha,'--check']);
    assert.equal(r.status,65,r.stderr);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('auditor upgrade pins fixed root paths, app lock and exactly one rollback',()=>{
  assert.match(code,/^#!\/bin\/bash/);
  assert.match(code,/ROOT='\/usr\/local\/libexec\/lightworld-deploy'/);
  assert.match(code,/CURRENT="\$ROOT\/tradeos-candidate-audit"/);
  assert.match(code,/BACKUP="\$ROOT\/tradeos-candidate-audit-rollback"/);
  assert.match(code,/ENTRY='\/usr\/local\/sbin\/lightworld-tradeos-candidate-audit'/);
  assert.match(code,/LOCK="\$LOCK_DIR\/tradeos-africa\.staging\.lock"/);
  assert.match(code,/flock -n "\$lock_fd"/);
  assert.match(code,/Existing backup or failed candidate; refuse unbounded upgrades/);
  assert.match(code,/restore_old_auditor/);
  assert.match(code,/if \(\( old_entry_moved == 1 \)\) && \[\[ -e \"\$ENTRY\"/);
  assert.match(code,/if \(\( old_directory_moved == 1 \)\) && \[\[ -e \"\$CURRENT\"/);
  assert.match(code,/trap restore_old_auditor EXIT/);
  assert.match(code,/old_auditor_preserved=/);
  assert.match(code,/upgrade_complete=1/);
  assert.doesNotMatch(code,/rm -rf|rm -f|pm2|systemctl|next build|pnpm install|applyMigrations|activate_release_target|restart_configured_processes/);
});

test('existing installed tools must verify signature and launcher digest before replacement',()=>{
  assert.match(code,/sha256sum -c --status SHA256SUMS/);
  assert.match(code,/entrypoint-sha256/);
  assert.match(code,/\/bin\/bash "\$installer" "\$checkout" "\$sha" --check/);
  assert.match(code,/\/bin\/bash "\$installer" "\$checkout" "\$sha" --install/);
  assert.ok(code.indexOf('sha256sum -c --status SHA256SUMS') <
    code.indexOf('mv -T -- "$CURRENT" "$BACKUP"'));
  assert.ok(code.indexOf('flock -n "$lock_fd"') <
    code.indexOf('mv -T -- "$CURRENT" "$BACKUP"'));
  assert.ok(code.indexOf('mv -T -- "$CURRENT" "$BACKUP"') <
    code.indexOf('/bin/bash "$installer" "$checkout" "$sha" --install'));
});

test('RHEL-compatible absolute runuser and clean PATH fix are explicit',()=>{
  assert.match(audit,/\[\[ -x \/usr\/sbin\/runuser \]\]/);
  assert.match(audit,/\/usr\/sbin\/runuser -u lightworld/);
  assert.match(launcher,/export PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/bin/);
  assert.match(launcher,/\/usr\/bin\/env -i HOME=\/root USER=root PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/bin/);
});
