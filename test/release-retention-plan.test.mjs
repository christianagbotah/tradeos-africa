import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessReleaseRetention} from '../ops/release/release-retention-plan.mjs';
const active='a'.repeat(40),rollback='b'.repeat(40),old='c'.repeat(40);
const directory=name=>({name,kind:'directory'});
const base={active,rollback,current:active,entries:[active,rollback,'.lightworld'].map(directory)};
test('only active rollback and metadata allow a new release',()=>{
 const r=assessReleaseRetention(base);
 assert.equal(r.readyForNewRelease,true);
 assert.equal(r.automaticDeletionAuthorized,false);
});
test('an older SHA is never considered disposable merely by its name',()=>{
 const r=assessReleaseRetention({...base,entries:[...base.entries,directory(old)]});
 assert.equal(r.readyForNewRelease,false);
 assert.deepEqual(r.unmanaged,[{name:old,kind:'directory',reason:'INDEPENDENT_RECOVERY_REVIEW_REQUIRED'}]);
});
test('unknown files and symbolic links require review',()=>{
 const r=assessReleaseRetention({...base,entries:[...base.entries,{name:'archive.tar.gz',kind:'file'},{name:'other',kind:'symlink'}]});
 assert.equal(r.readyForNewRelease,false);assert.equal(r.unmanaged.length,2);
});
test('wrong active link, missing rollback, duplicate entry and linked rollback fail closed',()=>{
 for(const input of [
  {...base,current:rollback},
  {...base,entries:base.entries.filter(e=>e.name!==rollback)},
  {...base,entries:[...base.entries,directory(active)]},
  {...base,entries:base.entries.map(e=>e.name===rollback?{...e,kind:'symlink'}:e)}
 ])assert.throws(()=>assessReleaseRetention(input));
});
