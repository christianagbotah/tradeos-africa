import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectMigrationDirectory} from '../ops/release/check-promotion-migrations.mjs';
import {FINANCE_QUERIES} from '../ops/release/check-promotion-finance.mjs';
import {assessExpansion,assessCutover,readReleaseSnapshot} from '../ops/release/check-signed-release-readiness.mjs';
import {fileURLToPath} from 'node:url';
const actualFiles=inspectMigrationDirectory(fileURLToPath(new URL('../packages/db/migrations',import.meta.url)));
// Exercise the exact previously approved release inventory separately from
// development-only migrations. Unknown files must remain ineligible.
const files=new Map([...actualFiles].filter(([name])=>Number(name.slice(0,4))<=64));
const rows=[...files].filter(([name])=>Number(name.slice(0,4))<=60).map(([migration_name,checksum_sha256])=>({migration_name,checksum_sha256,state:'APPLIED'}));
const counts=Object.fromEntries(FINANCE_QUERIES.map(([key])=>[key,0]));
const backup={checksumsVerified:true,isolatedRestoresVerified:3,migrationRows:60,ageSeconds:1};
test('only the rehearsed four-migration expansion is eligible',()=>{
 assert.equal(assessExpansion(files,rows).migrationAction,'APPLY_REHEARSED_EXPANSION');
 const changed=new Map(files);changed.set('0061_business_event_feed.sql','0'.repeat(64));
 assert.equal(assessExpansion(changed,rows).migrationAction,'HOLD');
 const partial=[...rows,{migration_name:'0061_business_event_feed.sql',checksum_sha256:files.get('0061_business_event_feed.sql'),state:'APPLIED'}];
 assert.equal(assessExpansion(files,partial).migrationAction,'HOLD');
 const drift=rows.map((r,i)=>i===0?{...r,checksum_sha256:'0'.repeat(64)}:r);
 assert.equal(assessExpansion(files,drift).migrationAction,'HOLD');
});
test('complete ledger is accepted without rerunning migrations',()=>{
 const all=[...files].map(([migration_name,checksum_sha256])=>({migration_name,checksum_sha256,state:'APPLIED'}));
 assert.equal(assessExpansion(files,all).migrationAction,'NONE');
});
test('valid unpublished events are preserved; unresolved finance and invalid scope block',()=>{
 const eligible=assessCutover(files,rows,{...counts,unpublishedOutboxEvents:5},0,backup);
 assert.equal(eligible.checksClear,true);assert.equal(eligible.authorizedToDeploy,false);
 assert.equal(eligible.internalEventsRequireDelivery,5);
 assert.equal(assessCutover(files,rows,{...counts,pendingRefunds:1},0,backup).checksClear,false);
 assert.equal(assessCutover(files,rows,{...counts,unpublishedOutboxEvents:5},1,backup).checksClear,false);
});
test('stale, absent or mismatched backup evidence cannot authorize deployment',()=>{
 for(const bad of [null,{...backup,ageSeconds:3601},{...backup,migrationRows:64},{...backup,checksumsVerified:false}]){
  const result=assessCutover(files,rows,counts,0,bad);assert.equal(result.checksClear,false);assert.equal(result.authorizedToDeploy,false);
 }
});
test('database read uses a single read-only snapshot and rolls back',async()=>{
 const commands=[];let released=false;
 const pool={connect:async()=>({query:async sql=>{commands.push(sql);return {rows:sql.includes('migration_name')?rows:[{total:'0'}]};},release:()=>{released=true;}})};
 const result=await readReleaseSnapshot(pool);
 assert.equal(result.rows.length,60);assert.equal(result.invalidScopes,0);assert.match(commands[0],/READ ONLY/);assert.equal(commands.at(-1),'ROLLBACK');assert.equal(released,true);
});

test('development programme migration is deliberately not approved for live promotion',()=>{
 assert.equal(actualFiles.size,67);
 assert.ok(actualFiles.has('0067_programme_equipment.sql'));
 assert.ok(actualFiles.has('0066_programme_apprenticeship.sql'));
 assert.ok(actualFiles.has('0065_programme_foundation.sql'));
 assert.equal(assessExpansion(actualFiles,rows).migrationAction,'HOLD');
 const all=[...actualFiles].map(([migration_name,checksum_sha256])=>({migration_name,checksum_sha256,state:'APPLIED'}));
 assert.equal(assessExpansion(actualFiles,all).migrationAction,'HOLD');
 const blocked=assessCutover(actualFiles,rows,counts,0,backup);
 assert.equal(blocked.checksClear,false);
 assert.equal(blocked.authorizedToDeploy,false);
});
