/** Deployment transaction coordinator. The privileged adapter must supply
 * fixed-path, authenticated operations; this module itself performs no I/O.
 * Schema expansion is forward-only. Rollback restores the old application,
 * never restores a historical database over newer business transactions.
 */
export class CutoverRejected extends Error {}
const required = ['preflight','stage','quiesce','backup','recheck','migrate','verifySchema','activate','restart','health','commit','restore','journal'];
export async function controlledCutover(ops, identity) {
  if (!identity || !/^[a-f0-9]{40}$/.test(identity.sha) ||
      !/^[a-f0-9]{40}$/.test(identity.previousSha) ||
      identity.sha===identity.previousSha ||
      identity.explicitApproval!==true ||
      required.some(name=>typeof ops?.[name]!=='function')) {
    throw new CutoverRejected('Missing exact release identity, operator approval or adapter');
  }
  const state={sha:identity.sha,previousSha:identity.previousSha,phase:'PREFLIGHT',migrationStarted:false,activated:false,committed:false};
  const advance=async phase=>{state.phase=phase;await ops.journal({...state});};
  let interruption=false;
  try {
    await advance('PREFLIGHT');
    const before=await ops.preflight(identity);
    if (before?.artifactVerified!==true||before?.scope!=='tradeos-africa/staging'||
        before?.storageReady!==true||before?.financeClear!==true||
        before?.migrationEligible!==true||before?.previousVerified!==true)
      throw new CutoverRejected('Preflight is not clear');
    await advance('STAGE');
    await ops.stage(identity);
    // Set before stopping anything: partial quiescence must still recover.
    interruption=true;
    await advance('QUIESCE');
    await ops.quiesce(identity);
    await advance('BACKUP');
    const backup=await ops.backup(identity);
    if(backup?.checksumsVerified!==true||backup?.isolatedRestoresVerified!==3||
        backup?.fresh!==true||![60,64].includes(backup?.migrationRows))
      throw new CutoverRejected('Fresh independently verified backup required');
    await advance('RECHECK');
    const snapshot=await ops.recheck(identity,backup);
    if(snapshot?.quiescent!==true||snapshot?.financeClear!==true||snapshot?.migrationEligible!==true||
       snapshot?.sourceCommit!==identity.sha||snapshot?.migrationRows!==backup.migrationRows||
       !['APPLY_REHEARSED_EXPANSION','NONE'].includes(snapshot?.migrationAction)||
       (snapshot.migrationAction==='APPLY_REHEARSED_EXPANSION'&&snapshot.migrationRows!==60)||
       (snapshot.migrationAction==='NONE'&&snapshot.migrationRows!==64))
       throw new CutoverRejected('Cutover snapshot no longer matches approved release and backup');
    if(snapshot.migrationAction==='APPLY_REHEARSED_EXPANSION'){
      state.migrationStarted=true;
      await advance('MIGRATE');
      await ops.migrate(identity);
    }
    await advance('VERIFY_SCHEMA');
    const schema=await ops.verifySchema(identity);
    if(schema?.appliedMigrations!==64||schema?.compatible!==true)
      throw new CutoverRejected('Final migration ledger not compatible');
    await advance('ACTIVATE');
    state.activated=true;
    await ops.activate(identity);
    await advance('RESTART');
    await ops.restart(identity);
    await advance('HEALTH');
    const health=await ops.health(identity);
    if(health?.api!==true||health?.web!==true||health?.admin!==true||health?.public!==true||health?.sourceIdentity!==true)
      throw new CutoverRejected('Release health or provenance check failed');
    await advance('COMMIT');
    await ops.commit(identity);
    state.committed=true;
    await advance('COMPLETE');
    return {...state};
  }catch(error){
    if(interruption&&!state.committed){
      // Must restore previous application even if the restart failed halfway.
      // Never infer successful rollback from a successful symlink write.
      const failedPhase=state.phase;
      try{
        await ops.restore(identity,{...state});
        await advance('ROLLED_BACK');
      }catch(rollback){
        state.phase='RECOVERY_REQUIRED';
        try{await ops.journal({...state});}catch{}
        throw new AggregateError([error,rollback], 'Cutover and application recovery failed; operator intervention required');
      }
      throw new CutoverRejected('Cutover failed at '+failedPhase+'; previous application restored; migration ledger retained',{cause:error});
    }
    if(!state.committed){try{await advance('HELD');}catch{}}
    throw error;
  }
}
