import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const script=new URL('../ops/release/upgrade-root-signed-activate.sh',import.meta.url);
const source=readFileSync(script,'utf8');
const sha='a'.repeat(40);
test('malformed requests fail without privileged operations',()=>{
 for(const args of [[],['/tmp',sha],['relative',sha,'--upgrade'],['/tmp','bad','--check'],['/tmp',sha,'--delete']]){
  const r=spawnSync('/bin/bash',[script.pathname,...args],{encoding:'utf8',timeout:3000});
  assert.equal(r.status,64,r.stderr);
 }
});
test('upgrade scope is fixed and lock ordering matches activation',()=>{
 assert.match(source,/CURRENT="\$ROOT\/tradeos-signed-activate"/);
 assert.match(source,/BACKUP="\$ROOT\/tradeos-signed-activate-rollback"/);
 assert.match(source,/APP_LOCK="\$LOCK_DIR\/tradeos-africa\.staging\.lock"/);
 assert.match(source,/GLOBAL_LOCK="\$LOCK_DIR\/heavy-deploy\.lock"/);
 assert.ok(source.indexOf('flock -n "$global_fd"')<source.indexOf('flock -n "$app_fd"'));
 assert.ok(source.indexOf('flock -n "$app_fd"')<source.indexOf('mv -T -- "$CURRENT" "$BACKUP"'));
 assert.doesNotMatch(source,/rm -rf|rm -f|pm2 |systemctl |apply-migrations|activate_release_target/);
});
test('source identity, checksums, bounded rollback and explicit nonactivation are mandatory',()=>{
 assert.match(source,/source is not current GitHub main/);
 assert.match(source,/dirty source checkout/);
 assert.match(source,/sha256sum -c --status SHA256SUMS/);
 assert.match(source,/existing rollback or interrupted upgrade requires review/);
 assert.match(source,/trap restore_old EXIT/);
 assert.match(source,/release-retention-plan\.mjs/);
 assert.match(source,/no_activation=true/);
 assert.ok(source.indexOf('verify_install\ncheck_unused\n/bin/bash "$installer" "$checkout" "$sha" --check')<source.indexOf('mv -T -- "$CURRENT" "$BACKUP"'));
});
