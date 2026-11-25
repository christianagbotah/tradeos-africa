// Inspect an already extracted candidate; never follows a directory symlink
// during enumeration and never changes the filesystem.
import fs from 'node:fs';
import path from 'node:path';
export function verifyRuntimeTree(root,uid=0){
 if(typeof root!=='string'||!path.isAbsolute(root)||root==='/'||
    !Number.isInteger(uid)||uid<0)throw Error('Invalid candidate identity');
 if(fs.realpathSync(root)!==root)throw Error('Candidate is not canonical');
 const dirs=[root];let entries=0;
 while(dirs.length){
  const dir=dirs.pop();
  const info=fs.lstatSync(dir);
  if(!info.isDirectory()||info.uid!==uid||(info.mode&0o7022))
   throw Error('Unsafe runtime directory ownership or permissions');
  for(const name of fs.readdirSync(dir)){
   if(++entries>150000)throw Error('Runtime entry limit exceeded');
   const item=path.join(dir,name),st=fs.lstatSync(item);
   if(st.uid!==uid)throw Error('Unexpected runtime owner');
   if(st.isSymbolicLink()){
    const target=fs.realpathSync(item);
    if(target!==root&&!target.startsWith(root+path.sep))
     throw Error('Runtime link escapes candidate');
   }else{
    if(st.mode&0o7022)throw Error('Unsafe runtime item permissions');
    if(st.isDirectory())dirs.push(item);
    else if(!st.isFile())throw Error('Unsupported runtime file type');
   }
  }
 }
 return {entries,verified:true};
}
