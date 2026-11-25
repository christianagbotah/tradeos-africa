import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyRuntimeTree} from '../ops/release/verify-runtime-tree.mjs';
function fixture(fn){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'tradeos-tree-test-')));
 try{fs.mkdirSync(path.join(root,'app'),{mode:0o755});fs.writeFileSync(path.join(root,'app','server.js'),'test',{mode:0o644});fn(root);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}
const uid=process.getuid();
test('accepts readable runtime and internal links',()=>fixture(root=>{
 fs.symlinkSync('app/server.js',path.join(root,'entry'));
 assert.deepEqual(verifyRuntimeTree(root,uid),{entries:3,verified:true});
}));
test('rejects writable directory or executable and special permission bits',()=>fixture(root=>{
 const p=path.join(root,'app','server.js');
 for(const mode of [0o666,0o4775,0o777]){fs.chmodSync(p,mode);assert.throws(()=>verifyRuntimeTree(root,uid),/permissions/);}
 fs.chmodSync(p,0o644);fs.chmodSync(path.join(root,'app'),0o775);
 assert.throws(()=>verifyRuntimeTree(root,uid),/permissions/);
}));
test('rejects external or dangling links and unexpected ownership',()=>fixture(root=>{
 const link=path.join(root,'entry');
 fs.symlinkSync('/etc',link);assert.throws(()=>verifyRuntimeTree(root,uid),/escapes/);
 fs.unlinkSync(link);fs.symlinkSync('missing',link);assert.throws(()=>verifyRuntimeTree(root,uid));
 fs.unlinkSync(link);assert.throws(()=>verifyRuntimeTree(root,uid+1),/ownership/);
}));
