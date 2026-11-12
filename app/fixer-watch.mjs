// What the on-box fixer may not change by itself (security audit CR-7, 12 Nov 2026).
//
// The fixer is an engine run as the box's own user with a terminal. Its written rules were checked only against the
// files it chose to list. This watch does not take its word: before a fix run every protected file (keys, sign-ins,
// engine settings, start-up files, the people file) is copied aside; after the run each one is compared. A protected
// file the run changed, added or removed is put back at once unless the run was allowed to (issues.mjs decides: it
// listed the file AND the issue was typed by an admin or approved by the owner). The fixer's version is kept in the
// run folder so a person can look at what it wanted.
import {readFile,writeFile,mkdir,readdir,copyFile,lstat,rm,chmod} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const ls=async d=>(await readdir(d,{withFileTypes:true}).catch(()=>[]));
// The protected files of an install, as they are now: [{file, shared}]. Folders are listed one level deep (a new file in
// them counts). shared: aqeelOS and the engine write these too while a run is going (settings, keys files, the people file,
// refreshed sign-ins), so a difference cannot be pinned on the run: they are held only when the run LISTS them, and
// otherwise reported, never put back blindly (an older copy of users.json or of a refreshed token would do harm).
export async function protectedFiles({HOME,HERMES_HOME,DATA}){const out=new Map(),add=(f,shared=false)=>out.set(path.resolve(f),shared);
 const dir=async(d,shared=false,ok=()=>true)=>{for(const e of await ls(d))if(!e.isDirectory()&&ok(e.name))add(path.join(d,e.name),shared)};
 for(const f of ['.env','config.yaml'])add(path.join(HERMES_HOME,f),true);
 for(const e of await ls(path.join(HERMES_HOME,'profiles')))if(e.isDirectory())for(const f of ['.env','config.yaml'])add(path.join(HERMES_HOME,'profiles',e.name,f),true);
 for(const d of ['agent-ssh','secrets'])await dir(path.join(HERMES_HOME,d));
 await dir(path.join(HOME,'.ssh'));await dir(path.join(HOME,'apps'),false,n=>/\.env$/.test(n));
 for(const f of ['.bashrc','.profile','.bash_profile','.bash_login','.npmrc','.gitconfig','services.sh','nightly-engine-restart.sh','.aqeelos-agent-ports','.aqeelos-vpn'])add(path.join(HOME,f));
 for(const f of ['ui-secret','backup-key','local-owner.key','fixer-github-token'])add(path.join(DATA,f));
 for(const f of ['users.json','team-policy.json','agent-trust.json','cloud-fixer.json','live.json'])add(path.join(DATA,f),true);
 return [...out].map(([file,shared])=>({file,shared}))}
// a path a fix run lists that is protected by its name alone, wherever it is
export const protectedPath=f=>/(^|\/)\.env(\.|$)|(^|\/)config\.ya?ml$|\/\.ssh\/|\/agent-ssh\/|\/secrets\/|(^|\/)(authorized_keys|ui-secret|users\.json|team-policy\.json|agent-trust\.json|cloud-fixer\.json|backup-key|local-owner\.key|\.bashrc|\.profile|services\.sh)$/.test(String(f).replace(/\\/g,'/'));
const state=async f=>{const s=await lstat(f).catch(()=>null);if(!s)return {file:f,gone:true};if(s.isSymbolicLink())return {file:f,link:true,hash:'link'};if(!s.isFile())return {file:f,gone:true};
 if(s.size>8e6)return {file:f,hash:'big:'+s.size+':'+s.mtimeMs,mode:s.mode&0o777,big:true};const b=await readFile(f).catch(()=>null);return b?{file:f,hash:sha(b),mode:s.mode&0o777,b}:{file:f,gone:true}};

export function createFixerWatch({list=async()=>[],log=()=>{}}={}){
 // before the run: a copy of every protected file in <dir>/watch (mode 700/600)
 async function snapshot(dir){const w=path.join(dir,'watch');await mkdir(w,{recursive:true,mode:0o700});const idx=[];let k=0;
  for(const {file:f,shared} of await list()){const s=await state(f);const e={file:f,shared:!!shared,gone:!!s.gone,hash:s.hash||null,mode:s.mode||null};if(s.b){e.copy='f'+(k++);await writeFile(path.join(w,e.copy),s.b,{mode:0o600})}idx.push(e)}
  await writeFile(path.join(w,'index.json'),JSON.stringify(idx),{mode:0o600});return idx.length}
 // after the run: [{file, how:'changed'|'removed'|'added', shared}] for what differs (new files in the protected folders included)
 async function changed(dir){const w=path.join(dir,'watch');let idx;try{idx=JSON.parse(await readFile(path.join(w,'index.json'),'utf8'))}catch{return []}
  const out=[],known=new Set(idx.map(e=>e.file));
  for(const e of idx){const s=await state(e.file);if(e.gone&&s.gone)continue;const o=how=>out.push({file:e.file,how,shared:!!e.shared});if(e.gone)o('added');else if(s.gone)o('removed');else if(s.hash!==e.hash||s.mode!==e.mode)o('changed')}
  for(const {file:f,shared} of await list())if(!known.has(f)){const s=await state(f);if(!s.gone)out.push({file:f,how:'added',shared:!!shared})}
  return out}
 // put the protected files back as they were; what the run left is kept in <dir>/held. Returns the files put back.
 async function restore(dir,items){const w=path.join(dir,'watch'),held=path.join(dir,'held');let idx=[];try{idx=JSON.parse(await readFile(path.join(w,'index.json'),'utf8'))}catch{}
  await mkdir(held,{recursive:true,mode:0o700});const done=[];let k=0;
  for(const c of items){const e=idx.find(x=>x.file===c.file),s=await state(c.file);
   if(s.b)await writeFile(path.join(held,'h'+(k++)+'-'+path.basename(c.file).replace(/[^\w.-]/g,'_')),s.b,{mode:0o600}).catch(()=>{});
   try{if(!e||e.gone){await rm(c.file,{force:true})}else if(e.copy){if(s.link)await rm(c.file,{force:true});await copyFile(path.join(w,e.copy),c.file);if(e.mode!=null)await chmod(c.file,e.mode)}else continue;done.push(c.file)}catch(er){log('fixer watch: could not put back '+c.file+': '+er.message)}}
  return done}
 return {snapshot,changed,restore}}
