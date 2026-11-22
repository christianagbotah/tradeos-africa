import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { inspectMigrationDirectory, assessMigrationLedger, validateBundleIdentity,
         queryLedgerReadOnly } from '../ops/release/check-promotion-migrations.mjs';

const sha = 'b'.repeat(40);
const sql = '-- example\nSELECT 1;\n';
const create = (fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeos-migration-gate-test-'));
  try {
    fs.mkdirSync(path.join(root, 'packages/db/migrations'), { recursive:true });
    fs.mkdirSync(path.join(root, 'apps/api/node_modules'), { recursive:true });
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, type:'TRADEOS_CI_RUNTIME_ARTIFACT_PILOT',
      deployable:false, requiredNodeMajor:22, sourceCommit:sha,
    }));
    fs.writeFileSync(path.join(root,'apps/api/package.json'),'{"name":"@tradeos/api"}\n');
    const dir = path.join(root,'packages/db/migrations');
    fs.writeFileSync(path.join(dir,'0001_initial.sql'),sql);
    return fn(root,dir);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
};
const row = (name, hash, state='APPLIED') => ({
  migration_name:name, checksum_sha256:hash, state,
});

test('read-only gate accepts matching exact released history, never grants activation',()=>create((root,dir)=>{
  assert.equal(validateBundleIdentity(root,sha),dir);
  const files=inspectMigrationDirectory(dir);
  const output=assessMigrationLedger(files,[row('0001_initial.sql',files.get('0001_initial.sql'))]);
  assert.equal(output.compatible,true);
  assert.deepEqual(output.pendingMigrations,[]);
  assert.equal(output.appliedMigrations,1);
}));

test('gate blocks any newly pending migration, without executing SQL',()=>create((_root,dir)=>{
  const output=assessMigrationLedger(inspectMigrationDirectory(dir),[]);
  assert.equal(output.compatible,false);
  assert.deepEqual(output.pendingMigrations,['0001_initial.sql']);
}));

test('gate blocks mutating an applied SQL checksum',()=>create((_root,dir)=>{
  const files=inspectMigrationDirectory(dir);
  const result=assessMigrationLedger(files,[row('0001_initial.sql','0'.repeat(64))]);
  assert.equal(result.compatible,false);
  assert.match(result.blockers.join(' '),/checksum mismatch/i);
}));

test('gate blocks APPLYING or FAILED ledger states',()=>create((_root,dir)=>{
  const files=inspectMigrationDirectory(dir);
  for(const state of ['APPLYING','FAILED']) {
    const result=assessMigrationLedger(files,[row('0001_initial.sql',files.get('0001_initial.sql'),state)]);
    assert.equal(result.compatible,false);
    assert.match(result.blockers.join(' '),/not successfully applied/);
  }
}));

test('gate blocks rollback SQL content absent from candidate',()=>create((_root,dir)=>{
  const files=inspectMigrationDirectory(dir);
  const result=assessMigrationLedger(files,[
    row('0001_initial.sql', files.get('0001_initial.sql')),
    row('0002_old_finance.sql','f'.repeat(64)),
  ]);
  assert.equal(result.compatible,false);
  assert.match(result.blockers.join(' '),/absent from candidate/);
}));

test('gate blocks duplicated ledger rows',()=>create((_root,dir)=>{
  const files=inspectMigrationDirectory(dir);
  const r=row('0001_initial.sql',files.get('0001_initial.sql'));
  assert.equal(assessMigrationLedger(files,[r,r]).compatible,false);
}));

test('gate refuses forged/deployable or mismatched manifest',()=>create((root)=>{
  for(const property of [{ deployable:true },{ sourceCommit:'a'.repeat(40) },
                         { requiredNodeMajor:20 },{ type:'TRADEOS_CI_RUNTIME_ARTIFACT_RELEASE' }]) {
    const f=path.join(root,'manifest.json');
    const m=JSON.parse(fs.readFileSync(f,'utf8'));
    const altered={...m,...property};
    fs.writeFileSync(f,JSON.stringify(altered));
    assert.throws(()=>validateBundleIdentity(root,sha));
    fs.writeFileSync(f,JSON.stringify(m));
  }
}));

test('gate blocks migration SQL symlinks without following them',()=>create((_root,dir)=>{
  fs.symlinkSync(path.join(dir,'0001_initial.sql'),path.join(dir,'0002_symlink.sql'));
  assert.throws(()=>inspectMigrationDirectory(dir));
}));

test('gate blocks duplicate sequence and malformed migration name',()=>create((_root,dir)=>{
  fs.writeFileSync(path.join(dir,'0001_alternative.sql'),'SELECT 2;');
  assert.throws(()=>inspectMigrationDirectory(dir),/Duplicate/);
  fs.rmSync(path.join(dir,'0001_alternative.sql'));
  fs.writeFileSync(path.join(dir,'foobar.sql'),'SELECT 2;');
  assert.throws(()=>inspectMigrationDirectory(dir),/Noncanonical/);
}));

test('gate blocks a symlinked migration directory',()=>create((root,dir)=>{
  const alt=path.join(root,'alternate');
  fs.renameSync(dir,alt);
  fs.symlinkSync(alt,dir);
  assert.throws(()=>validateBundleIdentity(root,sha));
  assert.throws(()=>inspectMigrationDirectory(dir));
}));

test('read-only SQL query uses BEGIN READ ONLY, SELECT and unconditional ROLLBACK',async()=>{
  const commands=[];
  let released=false;
  const fakePool={connect: async()=>({
    query:async(sql)=>{
      commands.push(sql);
      if(sql.startsWith('SELECT')) return {rows:[row('0001_initial.sql','e'.repeat(64))]};
      return {rows:[]};
    },
    release:()=>{released=true;},
  })};
  const rows=await queryLedgerReadOnly(fakePool);
  assert.equal(rows.length,1);
  assert.match(commands[0],/READ ONLY/);
  assert.match(commands[1],/^SELECT /);
  assert.equal(commands[2],'ROLLBACK');
  assert.equal(released,true);
  assert.equal(commands.some(c=>/INSERT|UPDATE|DELETE|CREATE|DROP/i.test(c)),false);
});

test('read-only query still rolls back after database SELECT failure',async()=>{
  const commands=[];
  let released=false;
  const fakePool={connect: async()=>({
    query:async(sql)=>{
      commands.push(sql);
      if(sql.startsWith('SELECT')) throw new Error('simulated failure');
      return {rows:[]};
    },
    release:()=>{released=true;},
  })};
  await assert.rejects(queryLedgerReadOnly(fakePool),/simulated failure/);
  assert.deepEqual(commands.slice(0,1),['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  assert.equal(commands.at(-1),'ROLLBACK');
  assert.equal(released,true);
});

test('read-only query never connects when no pool is supplied',async()=>{
  await assert.rejects(queryLedgerReadOnly({connect:async()=>{throw Error('connection refused');}}));
});
