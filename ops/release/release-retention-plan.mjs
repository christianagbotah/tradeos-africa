// Pure retention planning: a source SHA or successful CI run is not proof
// that a historical runtime is recoverable. Never delete anything here.
const shaPattern=/^[a-f0-9]{40}$/;
export function assessReleaseRetention({active,rollback,current,entries}){
 if(![active,rollback,current].every(s=>typeof s==='string'&&shaPattern.test(s))||
    active===rollback||current!==active||!Array.isArray(entries))
   throw Error('Release identity or rollback metadata is invalid');
 const byName=new Map();
 for(const entry of entries){
   if(!entry||typeof entry.name!=='string'||byName.has(entry.name))
     throw Error('Invalid release inventory');
   byName.set(entry.name,entry.kind);
 }
 for(const sha of [active,rollback])
   if(byName.get(sha)!=='directory')throw Error('Active or rollback release is not a real directory');
 if(byName.get('.lightworld')!=='directory')throw Error('Release metadata directory is missing');
 const unmanaged=entries.filter(e=>![active,rollback,'.lightworld'].includes(e.name))
   .map(e=>({name:e.name,kind:e.kind,reason:'INDEPENDENT_RECOVERY_REVIEW_REQUIRED'}))
   .sort((a,b)=>a.name.localeCompare(b.name));
 return {active,rollback,readyForNewRelease:unmanaged.length===0,unmanaged,automaticDeletionAuthorized:false};
}
