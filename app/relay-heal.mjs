// Keeps every signature in the agents' own folders current (12 Nov 2026). The key behind the signed tool addresses can be changed
// (relay-keys.mjs, scripts/rotate-secrets.mjs). Most files are written again by their own loop, and reissue() replaces the old signature in the
// profile's settings and scripts once. What nothing replaced: the posting guard's file in the agent's workspace (.tools/posting-guard.json). After
// the 30-minute grace its signature was refused, the guard refused every post and the agent posted nothing for hours.
// Now one sweep reads every file where a signature can sit (the profile's scripts/ folders and each workspace's .tools/) and makes the signature
// again with the key in use. It does not need the old key, so it also repairs a file a rotation missed. Files that belong to the agent's own user
// are written in place (the owner and the access rules stay), and by that user over ssh when the app may not write them.
import {readdir,readFile,stat,open,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {healText,guardConf} from './relay-keys.mjs';

const MAX=1e6,SKIP=/\.(bak|tmp|orig)(-|\.|$)|\.bak-/;
const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
export function createRelayHeal({HERMES_HOME,WORK,sign,readConfig=async()=>null,pick=()=>null,run=null,log=()=>{}}){
 // write a file as the agent's own user (ssh to ag-<agent>, base64 so no quoting can go wrong); false when the agent has no user of its own
 const writeAs=async(agent,file,text)=>{const c=await readConfig(String(agent).split('--')[0]).catch(()=>null)||{},user=String(pick(c,'terminal.ssh_user')||'');if(!/^ag-[\w-]+$/.test(user))return false;
  const cmd='printf %s '+q(Buffer.from(text).toString('base64'))+' | base64 -d > '+q(file);
  const args=['-i',path.join(HERMES_HOME,'agent-ssh','id_ed25519'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=20',user+'@127.0.0.1',cmd];
  return new Promise(res=>(run||execFile)('ssh',args,{timeout:30e3},e=>res(!e)))};
 // in place, as the app; as the agent's user when that is refused. The same file, never a new one beside it (the owner and the access rules stay).
 // atomic: a file the app wrote itself (a script of the profile) is replaced whole, so a run that reads it right now never sees half of it.
 async function put(agent,file,text,atomic=false){if(atomic){const st=await stat(file);const t=file+'.'+process.pid+'.rk.tmp';try{await writeFile(t,text,{mode:st.mode&0o777});await rename(t,file);return true}catch{}}
  try{const h=await open(file,'r+');try{await h.truncate(0);await h.write(text,0)}finally{await h.close()}return true}
  catch(e){if(!['EACCES','EPERM','EROFS'].includes(e.code))throw e;if(await writeAs(agent,file,text))return true;throw e}}
 const filesIn=async d=>{const out=[];for(const f of await readdir(d).catch(()=>[])){if(SKIP.test(f))continue;const p=path.join(d,f),st=await stat(p).catch(()=>null);if(st?.isFile()&&st.size<=MAX)out.push(p)}return out};
 // the posting guard's file, made new: for an agent whose posting limits are on, also when it is missing next to an installed guard
 async function guardFile(agent,{base,sig}){const dir=path.join(WORK,agent,'.tools'),f=path.join(dir,'posting-guard.json');
  const here=await Promise.all(['posting_guard.py','posting-guard.py'].map(n=>stat(path.join(dir,n)).catch(()=>null)));
  const have=await readFile(f,'utf8').catch(()=>null);if(have==null&&!here.some(Boolean))return 'none';
  const want=guardConf({base,agent,sig});if(have===want)return 'same';
  if(have==null){try{await writeFile(f,want,{mode:0o660})}catch(e){if(!(await writeAs(agent,f,want)))throw e}}else await put(agent,f,want);
  return 'written'}
 // one pass. Returns {changed:[files], failed:[files]}; no signature is ever logged.
 async function sweep(){const changed=[],failed=[];const todo=[];
  const scripts=[path.join(HERMES_HOME,'scripts')];for(const p of await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[]))scripts.push(path.join(HERMES_HOME,'profiles',p,'scripts'));
  for(const d of scripts)for(const f of await filesIn(d))todo.push({f,agent:path.basename(path.dirname(d)),atomic:true});
  for(const a of await readdir(WORK).catch(()=>[]))for(const f of await filesIn(path.join(WORK,a,'.tools')))todo.push({f,agent:a});
  for(const {f,agent,atomic} of todo){const t=await readFile(f,'utf8').catch(()=>null);if(t==null||t.includes('\0'))continue;const h=healText(t,sign);if(!h.n)continue;
   try{await put(agent,f,h.text,atomic);changed.push(f)}catch(e){failed.push(f);log('relay heal: could not write '+f+': '+e.code)}}
  return {changed,failed}}
 return {sweep,guardFile,writeAs}}
