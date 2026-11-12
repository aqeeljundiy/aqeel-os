// An update is only unpacked when it is what GitHub's main holds (security audit H-7, 12 Nov 2026).
//
// Code on a person's computer used to unzip whatever its aqeelOS server handed it over its own program files. A server
// that was broken into (or anyone between it and the computer) could so run code on every paired computer. Now the
// server's word is not enough: the version it names must be a commit on the main branch of the app's source repository
// on GitHub (named once, when the app was installed, and kept in data/update-source: an update cannot change it), and
// every file in the zip must be byte for byte the file GitHub lists for code/ at that commit (git's own content hash).
// GitHub is asked directly over https, so the server cannot answer in its place. No answer from GitHub: no update.
// The one file the server writes itself, aqeelos.json, may only hold this install's own address and the version.
import {createHash} from 'node:crypto';
const API=process.env.CBA_UPDATE_API||'https://api.github.com';
export const blobSha=data=>createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
// files: [[name, Buffer]] as unzipped; version: what the server said; base: the address this app is paired with.
// Resolves to the number of files checked, or throws with the reason. Nothing is written by this function.
export const repoOk=r=>new RegExp('^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$').test(String(r||''));
// the source named in an update's own aqeelos.json (used only the first time, when nothing is pinned yet)
export const repoIn=files=>{try{const f=files.find(([n])=>n==='aqeelos.json');const r=JSON.parse(f[1].toString('utf8'))?.aqeelos?.repo;return repoOk(r)?r:''}catch{return ''}};
export async function verifyUpdate(files,version,base,{fetchFn=(...a)=>fetch(...a),repo=process.env.CBA_UPDATE_REPO||'',api=API}={}){
 if(!repoOk(repo))throw Error('this app does not know which GitHub repository its updates come from');
 if(!/^[0-9a-f]{7,40}$/.test(String(version||'')))throw Error('the version is not a commit id');
 const get=async p=>{let r;try{r=await fetchFn(api+'/repos/'+repo+p,{headers:{accept:'application/vnd.github+json','user-agent':'aqeelos-code-update'},signal:AbortSignal.timeout(30000)})}catch{throw Error('GitHub could not be reached to check the update')}
  if(!r.ok)throw Error('GitHub did not confirm the update ('+r.status+')');return r.json()};
 const c=await get('/commits/'+version),sha=String(c?.sha||''),tree=String(c?.commit?.tree?.sha||'');if(!/^[0-9a-f]{40}$/.test(sha)||!sha.startsWith(version)||!/^[0-9a-f]{40}$/.test(tree))throw Error('GitHub does not know this version');
 // on main: main is at this commit or ahead of it, never beside it (a commit of a fork or a side branch is refused)
 const cmp=await get('/compare/'+sha+'...main');if(!['ahead','identical'].includes(cmp?.status)||cmp.behind_by!==0)throw Error('this version is not on the main branch');
 const top=await get('/git/trees/'+tree),dir=(top?.tree||[]).find(e=>e.path==='code'&&e.type==='tree');if(!dir)throw Error('this version has no Code in it');
 const all=await get('/git/trees/'+dir.sha+'?recursive=1');if(all?.truncated||!Array.isArray(all?.tree))throw Error('GitHub\'s list of files is incomplete');
 const want=new Map(all.tree.filter(e=>e.type==='blob').map(e=>[e.path,e.sha]));let n=0;
 for(const [name,data] of files){
  if(name.includes('..')||name.startsWith('/')||name.includes('\\')||name.includes('\0'))throw Error('a file name in the update is not allowed: '+name.slice(0,80));
  if(name==='aqeelos.json'){let j;try{j=JSON.parse(data.toString('utf8'))}catch{throw Error('aqeelos.json in the update is not readable')}
   const a=j?.aqeelos||{},keys=Object.keys(j||{}).concat(Object.keys(a));if(keys.some(k=>!['aqeelos','base','origins','version','brand','repo'].includes(k))||(a.repo!==undefined&&a.repo!==repo)||a.base!==base||!Array.isArray(a.origins)||a.origins.some(o=>o!==base)||a.version!==version)throw Error('aqeelos.json in the update names another address or version');continue}
  const s=want.get(name);if(!s)throw Error(name+' is not part of this version on GitHub');if(blobSha(data)!==s)throw Error(name+' differs from this version on GitHub');n++}
 if(!n)throw Error('the update is empty');return n}
