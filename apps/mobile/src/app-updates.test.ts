import {describe,it,expect} from "vitest";
import {installedUpdateBuild,selectAndroidUpdate,canOfferUpdate} from "./app-updates";
const sha="abcdef123456"+"a".repeat(28);
function release(n:number){
 const tag="android-update-preview-"+n+"-"+sha.slice(0,12);
 return {tag_name:tag,draft:false,prerelease:true,target_commitish:sha,assets:[{name:"TradeOS-Africa-Update.apk",state:"uploaded",size:70000000,browser_download_url:"https://github.com/christianagbotah/tradeos-africa/releases/download/"+tag+"/TradeOS-Africa-Update.apk"},{name:"SHA256SUMS.txt",state:"uploaded"}]};
}
describe("Android update discovery",()=>{
 it("selects only newer signed-channel release identifiers",()=>{
  expect(installedUpdateBuild(undefined)).toBeNull();expect(installedUpdateBuild("1")).toBeNull();
  expect(selectAndroidUpdate([release(10001),release(10003),release(10002)],10001)?.build).toBe(10003);
  expect(selectAndroidUpdate([release(10001)],10001)).toBeNull();
  expect(selectAndroidUpdate([{...release(10003),tag_name:"android-preview-abcdef123456"}],10001)).toBeNull();
 });
 it("rejects drafts, non-pinned commits and unexpected download hosts",()=>{
  const r=release(10003);
  expect(selectAndroidUpdate([{...r,draft:true},{...r,target_commitish:"main"},{...r,assets:[{...r.assets[0],browser_download_url:"https://other.test/app.apk"},r.assets[1]]}],10001)).toBeNull();
 });
 it("does not offer installation during checkout or unsynced work",()=>{
  expect(canOfferUpdate(true,0,0,false)).toBe(true);
  expect(canOfferUpdate(true,1,0,false)).toBe(false);
  expect(canOfferUpdate(true,0,1,false)).toBe(false);
  expect(canOfferUpdate(true,0,0,true)).toBe(false);
 });
});
