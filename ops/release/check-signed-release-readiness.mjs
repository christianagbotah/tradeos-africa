#!/usr/bin/env node
/** Read-only preflight for the dedicated, signed staging release format.
 * Must follow installed provenance verification and bounded extraction.
 * No artifact, backup or preflight result grants activation by itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {inspectMigrationDirectory,assessMigrationLedger,PromotionRejected} from './check-promotion-migrations.mjs';
import {FINANCE_QUERIES,assessFinanceSnapshot} from './check-promotion-finance.mjs';

export const APPROVED_EXPANSION=Object.freeze({
 '0061_business_event_feed.sql':'7e8075734c639d3c5ae78372c4b90eafaa4797e23164d0d663df71c8980fcd25',
 '0062_pos_attendant_role.sql':'15865b5ce04e68c9aea83bd8f0a379f3caa117a57b9d190d8d0a94daf39cfc11',
 '0063_pos_attendant_branch_assignments.sql':'0341cbe4eede9f5e17ca282c1ce7db765e29d3108693315190672c277deef845',
 '0064_branch_shift_sale_policy_events.sql':'73b5d0be1b5605dcf70c9c2c63c3ee63bbcb15ac4a8ff9133a81c028e275d3dd',
});
export function assessExpansion(files,rows){
 const ledger=assessMigrationLedger(files,rows);
 const pending=ledger.pendingMigrations;
 const exactInventory=files.size===64&&[...files.keys()].map(name=>Number(name.slice(0,4))).sort((a,b)=>a-b).every((n,i)=>n===i+1);
 const exactExpansion=Object.entries(APPROVED_EXPANSION).every(([name,hash])=>files.get(name)===hash);
 const baseline=ledger.recordedMigrations===60&&ledger.appliedMigrations===60&&pending.length===4&&
   pending.every(name=>Object.hasOwn(APPROVED_EXPANSION,name))&&
   ledger.blockers.length===1&&ledger.blockers[0]==='4 bundled migrations are not in the applied ledger';
 const fullyApplied=ledger.compatible&&ledger.recordedMigrations===64&&ledger.appliedMigrations===64;
 return {ledger,expansionEligible:exactInventory&&exactExpansion&&(baseline||fullyApplied),
   migrationAction:baseline&&exactInventory&&exactExpansion?'APPLY_REHEARSED_EXPANSION':fullyApplied&&exactInventory&&exactExpansion?'NONE':'HOLD'};
}
export function assessCutover(files,rows,counts,invalidScopes,backup){
 const migration=assessExpansion(files,rows);
 const finance=assessFinanceSnapshot(counts);
 if(!Number.isSafeInteger(invalidScopes)||invalidScopes<0||invalidScopes>counts.unpublishedOutboxEvents)
   throw new PromotionRejected('Invalid event scope count');
 const unresolved=finance.blockers.filter(x=>x.check!=='unpublishedOutboxEvents');
 const backupReady=backup?.checksumsVerified===true&&backup?.isolatedRestoresVerified===3&&backup?.migrationRows===migration.ledger.appliedMigrations&&
   Number.isFinite(backup?.ageSeconds)&&backup.ageSeconds>=0&&backup.ageSeconds<=3600;
 const blockers=[];
 if(!migration.expansionEligible)blockers.push('Unreviewed, partial or inconsistent migration history');
 if(unresolved.length)blockers.push('Unresolved payment, refund or synchronization work');
 if(invalidScopes)blockers.push('Internal events contain invalid tenant/branch scope');
 if(!backupReady)blockers.push('Fresh verified local backup/restore evidence required');
 return {migration,finance,invalidScopes,backupReady,blockers,
   checksClear:blockers.length===0,authorizedToDeploy:false,
   internalEventsRequireDelivery:counts.unpublishedOutboxEvents};
}
function realDir(root,rel){
 const p=path.join(root,rel);
 const stat=fs.lstatSync(p);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new PromotionRejected('Unsafe runtime directory');
 return p;
}
export function verifyReleaseManifest(root,sha){
 if(!path.isAbsolute(root)||!/^[0-9a-f]{40}$/.test(sha))throw new PromotionRejected('Invalid release identity');
 for(const rel of ['','packages','packages/db','packages/db/migrations','apps','apps/api','apps/api/node_modules'])realDir(root,rel);
 const file=path.join(root,'manifest.json'),stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw new PromotionRejected('Invalid release manifest');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.schemaVersion!==2||manifest.type!=='TRADEOS_SIGNED_RUNTIME_RELEASE'||manifest.deployable!==true||
   manifest.requiresOperatorApproval!==true||manifest.environment!=='staging'||manifest.sourceCommit!==sha||manifest.requiredNodeMajor!==22)
   throw new PromotionRejected('Expected exact operator-gated signed runtime release');
 const files=inspectMigrationDirectory(path.join(root,'packages/db/migrations'));
 if(!manifest.migrationChecksums||Object.keys(manifest.migrationChecksums).length!==files.size||
    [...files].some(([name,hash])=>manifest.migrationChecksums[name]!==hash))
   throw new PromotionRejected('Release migration manifest checksum mismatch');
 return files;
}
function count(response){
 const value=response.rows?.[0]?.total;
 if(response.rows?.length!==1||typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>BigInt(Number.MAX_SAFE_INTEGER))
   throw new PromotionRejected('Invalid aggregate response');
 return Number(value);
}
export async function readReleaseSnapshot(pool){
 const client=await pool.connect();let begun=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  const ledger=await client.query('SELECT migration_name,checksum_sha256,state FROM lightworld_schema_migrations ORDER BY migration_name');
  const counts={};
  for(const [key,sql] of FINANCE_QUERIES)counts[key]=count(await client.query(sql));
  const invalidScopes=count(await client.query("SELECT count(*)::text AS total FROM outbox_events o LEFT JOIN branches b ON b.id=o.branch_id AND b.business_id=o.business_id WHERE o.published_at IS NULL AND o.branch_id IS NOT NULL AND b.id IS NULL"));
  return {rows:ledger.rows,counts,invalidScopes};
 }finally{try{if(begun)await client.query('ROLLBACK');}finally{client.release();}}
}
async function main(){
 const [root,sha,...rest]=process.argv.slice(2);
 if(!root||!sha||rest.length||!process.env.DATABASE_URL)throw new PromotionRejected('Expected verified release root, exact SHA and external database environment');
 const files=verifyReleaseManifest(root,sha);
 const {Pool}=createRequire(path.join(root,'apps/api/package.json'))('pg');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:8000,query_timeout:8000,application_name:'tradeos-signed-release-readonly'});
 try{
  const {rows,counts,invalidScopes}=await readReleaseSnapshot(pool);
  // This app-principal CLI cannot attest to privileged backup files. A root
  // coordinator must supply independently checked backup evidence; no env override.
  const report=assessCutover(files,rows,counts,invalidScopes,null);
  console.log(JSON.stringify({sourceCommit:sha,readOnly:true,...report}));
  if(!report.checksClear)process.exitCode=65;
 }finally{await pool.end();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(error=>{console.error('release-preflight-blocked: '+(error instanceof PromotionRejected?error.message:'Read-only check failed'));process.exitCode=65;});
}
