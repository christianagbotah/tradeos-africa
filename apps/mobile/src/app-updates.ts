export const updateRepository="christianagbotah/tradeos-africa";
export const updateFeed="https://api.github.com/repos/"+updateRepository+"/releases?per_page=100";
const apkName="TradeOS-Africa-Update.apk";
export type AndroidUpdate={build:number;commit:string;url:string;size:number;tag:string};
type Release={tag_name?:unknown;draft?:unknown;prerelease?:unknown;target_commitish?:unknown;assets?:unknown};
export function installedUpdateBuild(raw:string|undefined):number|null{
 if(!raw||!/^\d+$/.test(raw))return null;
 const n=Number(raw);return Number.isSafeInteger(n)&&n>=10000&&n<2100000000?n:null;
}
export function selectAndroidUpdate(input:unknown,installed:number):AndroidUpdate|null{
 if(!Array.isArray(input))throw new Error("Invalid release feed.");
 const matches:AndroidUpdate[]=[];
 for(const raw of input){
  if(!raw||typeof raw!=="object")continue;
  const r=raw as Release;
  if(r.draft!==false||r.prerelease!==true||typeof r.tag_name!=="string"||!Array.isArray(r.assets))continue;
  const match=/^android-update-preview-(\d+)-([a-f0-9]{12})$/.exec(r.tag_name);
  if(!match)continue;
  const build=installedUpdateBuild(match[1]);if(build===null||build<=installed)continue;
  if(typeof r.target_commitish!=="string"||!(/^[a-f0-9]{40}$/.test(r.target_commitish))||!r.target_commitish.startsWith(match[2]!))continue;
  const url="https://github.com/"+updateRepository+"/releases/download/"+r.tag_name+"/"+apkName;
  const asset=r.assets.find((a:unknown)=>a&&typeof a==="object"&&(a as Record<string,unknown>).name===apkName) as Record<string,unknown>|undefined;
  if(!asset||asset.browser_download_url!==url||asset.state!=="uploaded"||typeof asset.size!=="number"||!Number.isSafeInteger(asset.size)||asset.size<1_000_000||asset.size>500_000_000)continue;
  if(!r.assets.some((a:unknown)=>a&&typeof a==="object"&&(a as Record<string,unknown>).name==="SHA256SUMS.txt"&&(a as Record<string,unknown>).state==="uploaded"))continue;
  matches.push({build,commit:r.target_commitish,url,size:asset.size,tag:r.tag_name});
 }
 return matches.sort((a,b)=>b.build-a.build)[0]??null;
}
export async function checkAndroidUpdate(installed:number,fetcher:typeof fetch=fetch){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetcher(updateFeed,{headers:{Accept:"application/vnd.github+json"},signal:controller.signal});
  if(!response.ok)throw new Error("Update service unavailable.");
  return selectAndroidUpdate(await response.json(),installed);
 }finally{clearTimeout(timer);}
}
// Both automatic and manual panels use one in-flight request and one short-lived
// successful result. A failed refresh invalidates the previous result.
type CachedUpdate={build:number;checkedAt:number;update:AndroidUpdate|null};
let cache:CachedUpdate|null=null;
let inFlight:{build:number;promise:Promise<AndroidUpdate|null>}|null=null;
export function getSharedAndroidUpdate(build:number,force=false):Promise<AndroidUpdate|null>{
 if(inFlight?.build===build)return inFlight.promise;
 if(!force&&cache?.build===build&&Date.now()-cache.checkedAt<3600000)return Promise.resolve(cache.update);
 const promise=checkAndroidUpdate(build).then(update=>{
  cache={build,checkedAt:Date.now(),update};return update;
 }).catch(error=>{cache=null;throw error;}).finally(()=>{if(inFlight?.promise===promise)inFlight=null;});
 inFlight={build,promise};return promise;
}
export function canOfferUpdate(online:boolean,cart:number,pending:number,busy:boolean,failed=0,blocked=0){
 return online&&cart===0&&pending===0&&!busy&&failed===0&&blocked===0;
}
