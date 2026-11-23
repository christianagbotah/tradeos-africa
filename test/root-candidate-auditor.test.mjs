import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const BASE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const installer=path.join(BASE,'ops/release/install-root-candidate-auditor.sh');
const auditor=path.join(BASE,'ops/release/root-candidate-audit-entrypoint.sh');
const code=(p)=>readFileSync(p,'utf8');
const fakeSha='f'.repeat(40);
const run=(script,args=[])=>spawnSync('/bin/bash',[script,...args],{
  encoding:'utf8',timeout:5000,
  env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',
       BASH_ENV:'',TRADEOS_ENV_FILE:'SHOULD_NOT_BE_LOADED'},
});

test('privileged command rejects partial or malformed invocation before any network/database access',()=>{
  for(const args of [[],['help'],[fakeSha],['not-a-commit','123'],[fakeSha,'abc'],
                     [fakeSha,'1','--deploy'],[fakeSha,'-1'],[fakeSha,'0'.repeat(28)]]){
    const result=run(auditor,args);
    assert.equal(result.status,64,`${args} -> ${result.status}: ${result.stderr}`);
  }
  assert.equal(run(installer,[]).status,64);
  assert.equal(run(installer,['relative','b'.repeat(40),'--check']).status,64);
  assert.equal(run(installer,['/tmp','no','--install']).status,64);
  assert.equal(run(installer,['/tmp',fakeSha,'--deploy']).status,64);
});

test('installer rejects symlink source path without following it',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'tradeos-immutable-installer-'));
  const real=path.join(root,'real');
  const alias=path.join(root,'alias');
  try {
    mkdirSync(real);
    symlinkSync(real,alias);
    const result=run(installer,[alias,fakeSha,'--check']);
    assert.equal(result.status,65,result.stderr);
    assert.match(result.stderr,/Source must be an existing absolute canonical/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('candidate audit uses only immutable root-owned pinned scripts and an app-scoped release lock',()=>{
  const s=code(auditor);
  assert.match(s,/^#!\/bin\/bash/);
  assert.match(s,/INSTALL_DIR='\/usr\/local\/libexec\/lightworld-deploy\/tradeos-candidate-audit'/);
  assert.match(s,/LOCK_FILE='\/var\/lock\/lightworld-deploy\/tradeos-africa\.staging\.lock'/);
  assert.match(s,/sha256sum -c --status SHA256SUMS/);
  assert.match(s,/entrypoint-sha256/);
  assert.match(s,/flock -n "\$lock_fd"/);
  assert.match(s,/\/usr\/bin\/env -i HOME=\/root USER=root PATH=/);
  assert.match(s,/--rehearse --ledger-readonly --seal-candidate/);
  assert.match(s,/EUID != 0/);
  assert.doesNotMatch(s,/git -C|pnpm|npm install|next build|pm2|systemctl|psql|activate_release_target|restart_configured_processes|migrate\(/);
  assert.doesNotMatch(s,/\bsource\b.*\.env|eval\b|\bexec\s+\/bin\/bash\s+\$\{/);
});

test('installer accepts only a clean, exact verified GitHub main and never upgrades existing root tools',()=>{
  const s=code(installer);
  assert.match(s,/^#!\/bin\/bash/);
  assert.match(s,/rev-parse HEAD/);
  assert.match(s,/status --porcelain --untracked-files=all/);
  assert.match(s,/gh api repos\/christianagbotah\/tradeos-africa\/branches\/main/);
  assert.match(s,/ls-files --error-unmatch/);
  assert.match(s,/--check/);
  assert.match(s,/--install/);
  assert.match(s,/EUID == 0/);
  assert.match(s,/Root installation requires a root-owned source path/);
  assert.match(s,/Refusing writable candidate auditor source file/);
  assert.match(s,/INSTALL_ROOT='\/usr\/local\/libexec\/lightworld-deploy'/);
  assert.match(s,/INSTALL_DIR="\$INSTALL_ROOT\/tradeos-candidate-audit"/);
  assert.match(s,/ENTRYPOINT='\/usr\/local\/sbin\/lightworld-tradeos-candidate-audit'/);
  assert.match(s,/sha256sum "\$\{SCRIPT_FILES\[@\]\}" installer-source-commit entrypoint-sha256 > SHA256SUMS/);
  assert.match(s,/sha256sum -c --status SHA256SUMS/);
  assert.match(s,/Auditor already installed; no overwrite or auto-upgrade allowed/);
  assert.match(s,/Main advanced during installation; refusing to install/);
  assert.ok(s.indexOf('sha256sum -c --status SHA256SUMS') <
            s.indexOf('mv -T -- "$staged" "$INSTALL_DIR"'));
  assert.doesNotMatch(s,/pm2|systemctl|pnpm install|npm install|next build|applyMigrations|activate_release_target|restart_configured_processes/);
  assert.doesNotMatch(s,/\/home\/lightworld\/releases\/tradeos-staging\/|CURRENT_LINK|\/home\/lightworld\/webapps\/tradeos-staging/);
});

test('installed command tracks all six required, independently checked runtime audit scripts',()=>{
  const s=code(installer);
  const required=['audit-github-artifact-pilot.sh','verify-attested-artifact-pilot.sh',
    'inspect-ci-artifact-pilot.py','rehearse-ci-artifact-pilot.py',
    'check-promotion-migrations.mjs','seal-ci-artifact-candidate.py'];
  for(const name of required){
    assert.match(s,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(s,/install -o root -g root -m "\$mode"/);
  assert.match(s,/install -o root -g root -m 0755 .*root-candidate-audit-entrypoint\.sh/);
  assert.match(s,/mv -T -- "\$entry_temp" "\$ENTRYPOINT"/);
});
