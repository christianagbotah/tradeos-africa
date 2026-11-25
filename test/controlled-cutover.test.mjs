import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlledCutover} from '../ops/release/controlled-cutover.mjs';
const id={sha:'b'.repeat(40),previousSha:'a'.repeat(40),explicitApproval:true};
function fixture(overrides={}){
 const calls=[],state=[];
 const values={
 preflight:{artifactVerified:true,scope:'tradeos-africa/staging',storageReady:true,financeClear:true,migrationEligible:true,previousVerified:true},
 backup:{checksumsVerified:true,isolatedRestoresVerified:3,fresh:true,migrationRows:60},
 recheck:{quiescent:true,financeClear:true,migrationEligible:true,sourceCommit:id.sha,migrationRows:60,migrationAction:'APPLY_REHEARSED_EXPANSION'},
 verifySchema:{appliedMigrations:64,compatible:true},
 health:{api:true,web:true,admin:true,public:true,sourceIdentity:true}};
 const ops=Object.fromEntries(['preflight','stage','quiesce','backup','recheck','migrate','verifySchema','activate','restart','health','commit','restore'].map(n=>[n,async()=>{calls.push(n);return values[n]}]));
 ops.journal=async s=>state.push(s.phase);
 return {ops:{...ops,...overrides},calls,state};
}
test('successful cutover runs all gates, backup before migration and commits only after health',async()=>{
 const f=fixture();const result=await controlledCutover(f.ops,id);
 assert.equal(result.committed,true);assert.equal(result.phase,'COMPLETE');
 assert.deepEqual(f.calls,['preflight','stage','quiesce','backup','recheck','migrate','verifySchema','activate','restart','health','commit']);
});
test('storage hold never stages or interrupts live service',async()=>{
 const f=fixture({preflight:async()=>({storageReady:false})});
 await assert.rejects(controlledCutover(f.ops,id),/Preflight/);
 assert.deepEqual(f.calls,[]);assert.equal(f.state.at(-1),'HELD');
});
test('stale backup resumes previous service without migration',async()=>{
 const f=fixture({backup:async()=>({fresh:false})});
 await assert.rejects(controlledCutover(f.ops,id),/BACKUP/);
 assert.equal(f.calls.includes('migrate'),false);assert.equal(f.calls.at(-1),'restore');
 assert.equal(f.state.at(-1),'ROLLED_BACK');
});
test('partial quiescence failure still restores previous app',async()=>{
 const f=fixture({quiesce:async()=>{throw new Error('partial stop')}});
 await assert.rejects(controlledCutover(f.ops,id),/QUIESCE/);
 assert.equal(f.calls.at(-1),'restore');
});
test('health or migration failure rolls back application, never commits new metadata',async()=>{
 for(const phase of ['migrate','restart','health','commit']){
  const f=fixture({[phase]:async()=>{throw new Error('injected failure')}});
  await assert.rejects(controlledCutover(f.ops,id),/previous application restored/);
  assert.equal(f.calls.at(-1),'restore');
  assert.equal(f.state.at(-1),'ROLLED_BACK');
 }
});
test('rollback failure is an explicit recovery-required state',async()=>{
 const f=fixture({restart:async()=>{throw Error('restart')},restore:async()=>{throw Error('restore')}});
 await assert.rejects(controlledCutover(f.ops,id),AggregateError);
 assert.equal(f.state.at(-1),'RECOVERY_REQUIRED');
});
test('approved no-op schema avoids rerunning migrations',async()=>{
 const f=fixture({backup:async()=>({checksumsVerified:true,isolatedRestoresVerified:3,fresh:true,migrationRows:64}),recheck:async()=>({quiescent:true,financeClear:true,migrationEligible:true,sourceCommit:id.sha,migrationRows:64,migrationAction:'NONE'})});
 await controlledCutover(f.ops,id);
 assert.equal(f.calls.includes('migrate'),false);
});
test('missing explicit approval prevents any operations',async()=>{
 const f=fixture();await assert.rejects(controlledCutover(f.ops,{...id,explicitApproval:false}));
 assert.deepEqual(f.calls,[]);
});
