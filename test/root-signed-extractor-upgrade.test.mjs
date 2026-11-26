import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const file=new URL('../ops/release/upgrade-root-signed-extractor.sh',import.meta.url);
const source=readFileSync(file,'utf8');
const sha='a'.repeat(40);
test('extractor upgrade rejects malformed requests and parses as Bash',()=>{
  assert.equal(spawnSync('/bin/bash',['-n',file.pathname]).status,0);
  for(const args of [[],['intake','/tmp',sha],['other','/tmp',sha,'--upgrade'],
    ['activate','relative',sha,'--upgrade'],['intake','/tmp','bad','--check'],
    ['activate','/tmp',sha,'--delete']]){
    const r=spawnSync('/bin/bash',[file.pathname,...args],{encoding:'utf8',timeout:3000});
    assert.equal(r.status,64,r.stderr);
  }
});
test('fixed paths and one-file scope, exact Git source, root ownership and manifest',()=>{
  for(const required of ['EXTRACTOR=rehearse-ci-artifact-pilot.py','trusted_chain "$checkout"',
    'source is not current GitHub main','installed source is not an ancestor',
    'unexpected checksum manifest entries','sha256sum -c --strict --status SHA256SUMS',
    'source bytes do not match reviewed Git object','installed extractor does not match recorded source',
    'non-extractor change requires a different reviewed upgrade','entrypoint requires a different reviewed upgrade',
    'existing rollback or interrupted upgrade requires review','unsafe lock directory alias','/run/lock/lightworld-deploy','no_activation=true'])
    assert.ok(source.includes(required),required);
  assert.doesNotMatch(source,/rm -rf|rm -f|pm2 |systemctl |pnpm install|apply-migrations/);
});
test('locks and staged verification precede bounded replacement',()=>{
  const at=s=>source.indexOf(s);
  assert.ok(at('flock -n "$global_fd"')<at('flock -n "$app_fd"'));
  assert.ok(at('flock -n "$app_fd"')<at('stage="$(mktemp'));
  assert.ok(at('validate_install "$stage"')<at('mv -T -- "$CURRENT" "$BACKUP"'));
  assert.ok(at('trap restore EXIT')<at('mv -T -- "$CURRENT" "$BACKUP"'));
  assert.ok(at('mv -T -- "$CURRENT" "$BACKUP"')<at('complete=1'));
});
