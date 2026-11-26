/** Fixed-scope root adapter. Invoked only by the installed, provenance-verified
 * activation entrypoint while it holds the existing global/app release locks. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {controlledCutover} from './controlled-cutover.mjs';
import {assessReleaseRetention} from './release-retention-plan.mjs';
import {verifyRuntimeTree} from './verify-runtime-tree.mjs';
const [sha,quarantine,approved,...extra]=process.argv.slice(2);
const releases='/home/lightworld/releases/tradeos-staging';
const current='/home/lightworld/webapps/tradeos-staging';
const meta=path.join(releases,'.lightworld');
const envFile='/home/lightworld/shared/tradeos-staging/.env.staging';
const repo='christianagbotah/tradeos-africa';
const scripts=path.dirname(new URL(import.meta.url).pathname);
const names=['tradeos-staging-api','tradeos-staging-web','tradeos-staging-admin'];
const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/bin',HOME:'/root',USER:'root',PYTHONDONTWRITEBYTECODE:'1'};
function fail(message){throw Error(message)}
function run(file,args,opts={}){
 try{return execFileSync(file,args,{env,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe'],...opts}).trim();}
 catch{fail('Controlled operation failed: '+path.basename(file));}
}
function mainIdentity(){return run('/usr/bin/gh',['api','repos/'+repo+'/branches/main','--jq','.commit.sha']);}
function rootDir(dir){
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.uid!==0||(st.mode&0o022))fail('Untrusted directory');
}
function rootFile(file){
 const st=fs.lstatSync(file);if(!st.isFile()||st.uid!==0||(st.mode&0o022))fail('Untrusted metadata');
 return fs.readFileSync(file,'utf8').trim();
}
function writeAtomic(name,content){
 rootDir(meta);const out=path.join(meta,name),tmp=out+'.'+process.pid+'.tmp';
 const fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,out);
 const dir=fs.openSync(meta,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function common(fn,args=[]){
 // fn is a fixed internal operation, not user input. Reuse protected registry,
 // PM2 process names, health checks and atomic symlink implementation.
 if(!['activate_release_target','restart_configured_processes','verify_configured_health'].includes(fn))fail('Invalid operation');
 run('/bin/bash',['-c','set -euo pipefail; source /usr/local/libexec/lightworld-deploy/common.sh; load_app_config tradeos-africa staging; require_release_config; "$@"','bash',fn,...args],{timeout:180000});
}
function dbQuiet(){
 return run('/usr/sbin/runuser',['-u','postgres','--','/usr/local/apps/pgsql18/bin/psql','-X','-At','-v','ON_ERROR_STOP=1','-h','/home/lightworld/shared/tradeos-staging/pgsocket','-p','56380','-U','postgres','-d','tradeos_staging','-c',"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"])==='0';
}
function snapshot(root){
 const args=['-u','lightworld','--','/usr/bin/env','-i','HOME=/home/lightworld','PATH=/usr/bin:/bin','/usr/bin/node','--env-file='+envFile,path.join(scripts,'check-signed-release-readiness.mjs'),root,sha];
 let output;
 try{output=execFileSync('/usr/sbin/runuser',args,{env,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});}
 catch(error){if(error.status!==65||!error.stdout)fail('Database readiness check failed');output=error.stdout;}
 const report=JSON.parse(output);
 if(report.sourceCommit!==sha||report.readOnly!==true||report.authorizedToDeploy!==false)fail('Invalid readiness report');
 return report;
}
function financeClear(report){return report.invalidScopes===0&&Array.isArray(report.finance?.blockers)&&report.finance.blockers.every(x=>x.check==='unpublishedOutboxEvents');}
function pids(){
 const list=JSON.parse(run('/usr/bin/pm2',['jlist']));
 return names.map(name=>list.filter(p=>p.name===name));
}
function retention(active,rollback){
 const linked=fs.realpathSync(current);
 if(path.dirname(linked)!==releases)fail('Active release escapes registered root');
 return assessReleaseRetention({active,rollback,current:path.basename(linked),entries:fs.readdirSync(releases,{withFileTypes:true}).map(e=>({name:e.name,kind:e.isSymbolicLink()?'symlink':e.isDirectory()?'directory':e.isFile()?'file':'other'}))});
}
function healthyAt(target){
 common('verify_configured_health');
 return fs.realpathSync(current)===target&&pids().every(group=>group.length===1&&group[0].pm2_env?.status==='online'&&Number.isInteger(group[0].pid)&&group[0].pid>0&&
  [target,target+'/'].some((prefix,i)=>{const cwd=fs.realpathSync('/proc/'+group[0].pid+'/cwd');return i?cwd.startsWith(prefix):cwd===prefix;}));
}
function restart(){
 // Remove only the three registered TradeOS processes so PM2 cannot retain
 // obsolete cwd/launch arguments after stopping them. No other app is touched.
 for(const group of pids()){
  if(group.length>1)fail('Ambiguous TradeOS process identity');
  if(group.length===1)run('/usr/bin/pm2',['delete',group[0].name]);
 }
 common('restart_configured_processes');
}
try{
 if(scripts!=='/usr/local/libexec/lightworld-deploy/tradeos-signed-activate'||process.getuid()!==0||extra.length||!sha?.match(/^[0-9a-f]{40}$/)||approved!==sha||
    !quarantine?.match(/^\/tmp\/tradeos-activation\.[A-Za-z0-9]+\/tradeos-rehearsal-[a-f0-9]{40}$/)||
    path.basename(quarantine)!=='tradeos-rehearsal-'+sha)fail('Invalid activation scope or approval');
 rootDir(releases);rootDir(meta);rootDir(path.dirname(quarantine));rootDir(quarantine);
 const previousSha=rootFile(path.join(meta,'last-successful-release'));
 const oldRollback=rootFile(path.join(meta,'previous-release'));
 if(![previousSha,oldRollback].every(s=>/^[a-f0-9]{40}$/.test(s)))fail('Invalid rollback metadata');
 const previous=path.join(releases,previousSha),rollback=path.join(releases,oldRollback),target=path.join(releases,sha);
 if(!fs.lstatSync(current).isSymbolicLink()||fs.realpathSync(current)!==previous||!fs.lstatSync(previous).isDirectory()||!fs.lstatSync(rollback).isDirectory()||fs.existsSync(target))fail('Release or rollback identity mismatch');
 if(mainIdentity()!==sha)fail('Main advanced');
 const inventory=retention(previousSha,oldRollback);
 if(!inventory.readyForNewRelease)fail('Unmanaged release inventory requires independent recovery review before staging');
 const journalFile=path.join(meta,'activation-journal.json');
 if(fs.existsSync(journalFile)){
  const old=JSON.parse(rootFile(journalFile));
  if(!['HELD','COMPLETE','ROLLED_BACK'].includes(old.phase))fail('Unresolved prior activation journal');
 }
 let stoppedAt=0;
 const ops={
  journal:async state=>writeAtomic('activation-journal.json',JSON.stringify({...state,updatedAt:new Date().toISOString()})+'\n'),
  preflight:async()=>{
   const capacity=run('/bin/df',['-Pk','/']).split('\n').at(-1).trim().split(/\s+/);
   const storageReady=Number(capacity[4].replace('%',''))<90&&Number(capacity[3])>6291456;
   if(!storageReady) return {storageReady:false};
   if(mainIdentity()!==sha||!healthyAt(previous))fail('Previous runtime or source not verified');
   const report=snapshot(quarantine);
   return {artifactVerified:true,scope:'tradeos-africa/staging',storageReady,financeClear:financeClear(report),migrationEligible:report.migration.expansionEligible,previousVerified:true};
  },
  stage:async()=>{
   if(mainIdentity()!==sha)fail('Main advanced before staging');
   // Remove inherited ACLs before the same-filesystem rename; the runtime
   // remains root-owned and app-readable, with no dependency installation.
   // Strip access AND default ACLs without following symbolic links.
   // Verify ownership, modes and internal links before introducing the
   // separately trusted environment link or moving into the release root.
   run('/usr/bin/setfacl',['-R','-P','-b','-k','--',quarantine]);
   fs.chmodSync(quarantine,0o755);
   verifyRuntimeTree(quarantine);
   fs.symlinkSync(envFile,path.join(quarantine,'.env.staging'));
   fs.renameSync(quarantine,target);
  },
  quiesce:async()=>{
   if(mainIdentity()!==sha)fail('Main advanced before maintenance');
   for(const name of names)run('/usr/bin/pm2',['stop',name]);
   if(!pids().every(g=>g.length===1&&g[0].pm2_env?.status==='stopped'))fail('Processes not stopped');
   if(!dbQuiet())fail('Database still has active client sessions');
   stoppedAt=Date.now();
  },
  backup:async()=>{
   run('/usr/bin/systemctl',['start','lightworld-tradeos-staging-backup.service'],{timeout:960000});
   const report=JSON.parse(run('/usr/bin/python3',['-B',path.join(scripts,'check-root-backup-evidence.py')]));
   if(Date.now()-report.ageSeconds*1000<stoppedAt-1000)fail('Backup not created during maintenance');
   return report;
  },
  recheck:async()=>{
   if(mainIdentity()!==sha||!dbQuiet())fail('Source or database state changed');
   const report=snapshot(target);
   return {quiescent:dbQuiet(),financeClear:financeClear(report),migrationEligible:report.migration.expansionEligible,sourceCommit:report.sourceCommit,migrationRows:report.migration.ledger.appliedMigrations,migrationAction:report.migration.migrationAction};
  },
  migrate:async()=>{
   if(mainIdentity()!==sha||!dbQuiet())fail('Source or database state changed before migration');
   run('/usr/sbin/runuser',['-u','lightworld','--','/usr/bin/env','-i','HOME=/home/lightworld','PATH=/usr/bin:/bin','TRADEOS_RELEASE_SHA='+sha,'PGOPTIONS=-c lock_timeout=5000 -c statement_timeout=60000','/usr/bin/node','--env-file='+envFile,path.join(target,'apps/api/dist/scripts/apply-migrations.js'),path.join(target,'packages/db/migrations')],{timeout:120000});
  },
  verifySchema:async()=>{if(!dbQuiet())fail('Database not quiescent');const r=snapshot(target);return {appliedMigrations:r.migration.ledger.appliedMigrations,compatible:r.migration.ledger.compatible&&financeClear(r)};},
  activate:async()=>{if(mainIdentity()!==sha)fail('Main advanced before activation');common('activate_release_target',[target]);},
  restart:async()=>restart(),
  health:async()=>{const ok=healthyAt(target);return {api:ok,web:ok,admin:ok,public:ok,sourceIdentity:ok};},
  commit:async()=>{writeAtomic('previous-release',previousSha+'\n');writeAtomic('last-successful-release',sha+'\n');},
  restore:async()=>{common('activate_release_target',[previous]);restart();if(!healthyAt(previous))fail('Rollback health failed');writeAtomic('last-successful-release',previousSha+'\n');writeAtomic('previous-release',oldRollback+'\n');},
 };
 const result=await controlledCutover(ops,{sha,previousSha,explicitApproval:true});
 // Report the old rollback for review. A completed cutover is not an
 // authorization to delete historical runtimes. A later activation must
 // not stage another release until the inventory is reconciled.
 console.log(JSON.stringify({...result,retention:retention(sha,previousSha)}));
}catch(error){console.error('Activation held or failed: '+(error instanceof AggregateError?'Recovery required':error.message));process.exitCode=65;}
