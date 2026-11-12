// Keeps every signature in the agents' own folders current (12 Nov 2026). The key behind the signed tool addresses can be changed
// (relay-keys.mjs, scripts/rotate-secrets.mjs). Most files are written again by their own loop, and reissue() replaces the old signature in the
// profile's settings and scripts once. What nothing replaced: the posting guard's file in the agent's workspace (.tools/posting-guard.json). After
// the 30-minute grace its signature was refused, the guard refused every post and the agent posted nothing for hours.
// Now one sweep reads every file where a signature can sit (the profile's scripts/ folders and each workspace's .tools/) and makes the signature
// again with the key in use. It does not need the old key, so it also repairs a file a rotation missed. Files that belong to the agent's own user
// are written in place (the owner and the access rules stay), and by that user over ssh when the app may not write them.
import {readdir,readFile,stat,lstat,open,writeFile,rename,realpath,readlink} from 'node:fs/promises';
import {constants as FS} from 'node:fs';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {healText,guardConf} from './relay-keys.mjs';

const MAX=1e6,SKIP=/\.(bak|tmp|orig)(-|\.|$)|\.bak-/,DENIED=['EACCES','EPERM','EROFS'];
const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const refuse=(code,file)=>Object.assign(Error('not a plain file of its own folder: '+file),{code});
// A workspace belongs to the agent's own user, and the app (a stronger user) reads and writes there. So a file there is opened ONCE, never through
// a link, and read and written through that one handle (review of 12 Nov 2026: posting-guard.json swapped for a link to a file of the app's was
// overwritten by the app; a link read in one step and a plain file written in the next would hand the agent a file it may not read).
// Refused: a symbolic link (O_NOFOLLOW), a second name of another file (a hard link), anything that is not a regular file, and a file that is not
// where its path says because a folder on the way is a link (on Linux the open handle's real path is compared with the path under the real root).
async function openOwn(root,file,flags){const want=path.join(await realpath(root),path.relative(root,file));
 if(process.platform!=='linux'){const st=await lstat(file).catch(e=>{if(e.code==='ENOENT'&&flags&FS.O_CREAT)return null;throw e});if(st&&!st.isFile())throw refuse('ELOOP',file);
  if(path.join(await realpath(path.dirname(file)),path.basename(file))!==want)throw refuse('EXDEV',file)}
 const h=await open(file,flags|(FS.O_NOFOLLOW||0),0o660);
 try{const st=await h.stat();if(!st.isFile()||st.nlink>1)throw refuse('EMLINK',file);
  if(process.platform==='linux'&&await readlink('/proc/self/fd/'+h.fd)!==want)throw refuse('EXDEV',file);return h}
 catch(e){await h.close().catch(()=>{});throw e}}
export function createRelayHeal({HERMES_HOME,WORK,sign,readConfig=async()=>null,pick=()=>null,run=null,log=()=>{}}){
 // write a file as the agent's own user (ssh to ag-<agent>, base64 so no quoting can go wrong); false when the agent has no user of its own
 const writeAs=async(agent,file,text)=>{const c=await readConfig(String(agent).split('--')[0]).catch(()=>null)||{},user=String(pick(c,'terminal.ssh_user')||'');if(!/^ag-[\w-]+$/.test(user))return false;
  const cmd='printf %s '+q(Buffer.from(text).toString('base64'))+' | base64 -d > '+q(file);
  const args=['-i',path.join(HERMES_HOME,'agent-ssh','id_ed25519'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=20',user+'@127.0.0.1',cmd];
  return new Promise(res=>(run||execFile)('ssh',args,{timeout:30e3},e=>res(!e)))};
 // a file of the app's own (a script of the profile; the engine's home is closed to the agents' users): replaced whole, so a run that reads it
 // right now never sees half of it
 async function putWhole(file,text){const st=await stat(file);const t=file+'.'+process.pid+'.rk.tmp';await writeFile(t,text,{mode:st.mode&0o777});await rename(t,file)}
 // a file in a workspace: fn(text) gives the new text, or null to leave it. In place (the owner and the access rules stay), through one handle; by
 // the agent's own user when the app may read but not write it (that user reaches only what is its own). True when it was written.
 async function edit(agent,file,fn){let h,ro=null;
  try{h=await openOwn(WORK,file,FS.O_RDWR)}catch(e){if(!DENIED.includes(e.code))throw e;ro=e;h=await openOwn(WORK,file,FS.O_RDONLY)}
  try{if((await h.stat()).size>MAX)return false;const t=await h.readFile('utf8'),n=fn(t);if(n==null||n===t)return false;
   if(ro){if(await writeAs(agent,file,n))return true;throw ro}
   await h.truncate(0);await h.write(n,0);return true}finally{await h.close()}}
 const filesIn=async d=>{const out=[];for(const f of await readdir(d).catch(()=>[])){if(SKIP.test(f))continue;const p=path.join(d,f),st=await lstat(p).catch(()=>null);if(st?.isFile()&&st.size<=MAX)out.push(p)}return out};
 // in a workspace only the signatures of that workspace's own agent are made again: a file there is the agent's to write, and a made-up address
 // that names ANOTHER agent must not come back carrying that agent's signature (review of 12 Nov 2026)
 const own=a=>(label,ag)=>ag===a||String(ag).startsWith(a+'--')?sign(label,ag):null;
 // the posting guard's file, made new: for an agent whose posting limits are on, also when it is missing next to an installed guard
 async function guardFile(agent,{base,sig}){const dir=path.join(WORK,agent,'.tools'),f=path.join(dir,'posting-guard.json');
  const want=guardConf({base,agent,sig});let same=false;
  try{if(await edit(agent,f,t=>{same=t===want;return want}))return 'written';if(same)return 'same';throw refuse('EFBIG',f)}catch(e){if(e.code!=='ENOENT')throw e}
  const here=await Promise.all(['posting_guard.py','posting-guard.py'].map(n=>stat(path.join(dir,n)).catch(()=>null)));if(!here.some(Boolean))return 'none';
  // missing next to an installed guard: made new, never through a link left in its place (O_EXCL) and never in a folder that is a link
  try{const h=await openOwn(WORK,f,FS.O_WRONLY|FS.O_CREAT|FS.O_EXCL);try{await h.write(want,0)}finally{await h.close()}}catch(e){if(!DENIED.includes(e.code)||!(await writeAs(agent,f,want)))throw e}
  return 'written'}
 // one pass. Returns {changed:[files], failed:[files]}; no signature is ever logged.
 async function sweep(){const changed=[],failed=[];const todo=[];
  const scripts=[path.join(HERMES_HOME,'scripts')];for(const p of await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[]))scripts.push(path.join(HERMES_HOME,'profiles',p,'scripts'));
  for(const d of scripts)for(const f of await filesIn(d))todo.push({f,agent:path.basename(path.dirname(d)),atomic:true});
  for(const a of await readdir(WORK).catch(()=>[]))for(const f of await filesIn(path.join(WORK,a,'.tools')))todo.push({f,agent:a});
  for(const {f,agent,atomic} of todo){
   try{if(atomic){const t=await readFile(f,'utf8').catch(()=>null);if(t==null||t.includes('\0'))continue;const h=healText(t,sign);if(!h.n)continue;await putWhole(f,h.text);changed.push(f)}
    else if(await edit(agent,f,t=>{if(t.includes('\0'))return null;const h=healText(t,own(agent));return h.n?h.text:null}))changed.push(f)}
   catch(e){if(!atomic&&(DENIED.includes(e.code)||e.code==='ENOENT'))continue;   // not the app's to read, or gone meanwhile: left alone, as before
    failed.push(f);log('relay heal: could not write '+f+': '+e.code)}}
  return {changed,failed}}
 return {sweep,guardFile,writeAs}}
