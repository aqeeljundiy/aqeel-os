// Backups (SYS-44): every night (03:00 by default, in the box's time zone) the AI box's own data is packed, encrypted
// with the backup key and uploaded to Google Drive (folder "aqeelOS backups" by default). Inside: the agents (settings,
// memories, skills, chats, sign-ins), aqeelOS's data and settings, people's files and the coding tools' sign-ins. Left
// out: programs, caches and browser data, which are reinstalled. The newest 14 are kept by default; older ones go to the
// Drive bin. A restore test downloads the newest backup, decrypts and unpacks it into a scratch folder and checks the
// important files. The Google account, the time, how many to keep and the Drive folder are settings (System › Health).
// Restoring: RESTORE.md.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,stat,lstat,readdir,chmod,rename,copyFile,symlink,readlink,utimes,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream,openSync,writeSync,closeSync,existsSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {localParts} from './tz.mjs';

export const DEFAULTS={account:'',hour:3,keep:14,folder:'aqeelOS backups'};
const INCLUDE=['.hermes','apps/hermes-ui-data','apps/hermes-ui.env','workspaces','people','.claude','.claude-accounts'];
export const EXCLUDE=['.hermes/installs','.hermes/hermes-agent','.hermes/tools','.hermes/cache','.hermes/lsp','*-venv','.hermes/bot-desktop','.hermes/profiles/*/cache','.hermes/profiles/*/bot-desktop',
 // each agent's map (agent-graph.mjs, 11 Nov 2026): copies of its documents and the graph, rebuilt by itself; its
 // reference folder (what a person moved out of its instructions) is not here, so that is backed up
 '.hermes/profiles/*/graph','.hermes/graph',
 '*/home/.cache','*/home/.npm','.hermes/home/.cache','.hermes/home/.npm','node_modules','*.log','apps/hermes-ui-data/desktop','.claude/projects','.claude/shell-snapshots','.claude/statsig','.claude/todos',
 // rebuildable or junk, so a backup is ~9 GB instead of ~35 GB and uploads in time (31 Oct 2026): build output, caches, browser
 // caches (the browser profiles with their logins stay), runtimes aqeelOS or the guard can install again, old exports
 // (not 'out', 'build' or 'dist': Continue social keeps its finished videos in work/**/out)
 '.cache','.npm','.next','.turbo','.vercel','playwright-report','test-results','__pycache__',
 'Cache','Code Cache','GPUCache','CacheStorage','ScriptCache','GrShaderCache','ShaderCache','*venv.broken*','.claude/remote',
 '.hermes/home/.local','.hermes/profile-exports','workspaces/.aqeelos-python'];

/* ---------- Restore (switched on 7 Nov 2026). Every finding of the 1 Nov reviews, and how it is handled now:
   - rsync is not needed any more: the copy is done here, file by file (copyOver), so it works on any box;
   - nothing is copied blind: "Prepare" downloads, decrypts and unpacks the backup into a scratch folder and compares it
     with the box (preview: agents that come back, agents made since that stay, files replaced, added and kept). Only
     "Restore now" on that preview changes the box;
   - every file the copy replaces is first renamed aside (<file>.aqeelos-held), and every file or folder it adds is
     written to a journal before it is made. Roll back is exact: what the copy added is removed and what it moved aside
     goes back, also when a path changed between file and folder. Only when the copy is complete are the held files
     deleted;
   - a restore cut off halfway (aqeelOS stopped) is rolled back from the journal when aqeelOS starts again (recover);
   - the agents, the dashboard and the WhatsApp bridges stop first (stopEngine checks the dashboard really ended), and
     aqeelOS's own writes to the engine's files (settings, keys, engine commands) wait while the copy runs (busy());
   - restarts asked for during the copy are left for the restore's own start at the end (busy.mjs mayStartAgents);
   - a safety copy of today's agents is packed first (the newest two are kept in the home folder, and they show in the
     Restore list, so going back is the same restore); files it could not read are counted and said;
   - nothing is deleted on purpose: an agent or file made after the backup stays, and a file deleted since comes back.
     The preview says both before anything changes;
   - free space is measured on the unpacked backup, not guessed. */
const HELD='.aqeelos-held';
const SKIPF=/\.(pid|lock|sock)$/;   // running programs' own files stay the box's
export const DB=/\.(db|sqlite3?)$/;
// a tar --exclude pattern (from EXCLUDE, about the home folder) as a test on a path inside .hermes
export function excluded(rel,exclude=EXCLUDE){return exclude.some(e=>{if(/^(apps|workspaces|\.claude)\//.test(e))return false;const top=e.startsWith('.hermes/');const p=top?e.slice(8):e;
 const re=new RegExp((top?'^':'(^|/)')+p.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$');return re.test(rel)})}
// what a restore would change, without changing anything: the backup's .hermes (src) against the box's (dest)
export async function preview(src,dest,{cap=200000}={}){
 const out={change:0,add:0,same:0,stay:0,bytes:0,copyBytes:0,boxBytes:0,sample:{change:[],add:[],stay:[]},agents:{back:[],stay:[],both:[]}};let seen=0;
 const note=(k,r)=>{out[k]++;if(out.sample[k]&&out.sample[k].length<6)out.sample[k].push(r)};
 async function boxOnly(rel){const s=await lstat(path.join(dest,rel)).catch(()=>null);if(!s||excluded(rel))return;
  if(s.isDirectory()){for(const n of await readdir(path.join(dest,rel)).catch(()=>[]))if(++seen<cap)await boxOnly(path.join(rel,n))}else if(s.isFile()&&!SKIPF.test(rel)&&!rel.endsWith(HELD)){note('stay',rel);out.boxBytes+=s.size}}
 async function walk(rel){const names=await readdir(path.join(src,rel));const have=new Set(names);
  for(const n of names){const r=rel?path.join(rel,n):n;if(SKIPF.test(n)||n.endsWith(HELD))continue;const s=await lstat(path.join(src,r));const d=await lstat(path.join(dest,r)).catch(()=>null);
   if(s.isDirectory()){if(d?.isDirectory())await walk(r);else{await count(r)}continue}
   if(!s.isFile()&&!s.isSymbolicLink())continue;out.bytes+=s.size;if(d?.isFile())out.boxBytes+=d.size;
   if(!d){note('add',r);out.copyBytes+=s.size}else if(!d.isFile()||d.size!==s.size||Math.abs(d.mtimeMs-s.mtimeMs)>2000){note('change',r);out.copyBytes+=s.size}else{out.same++;out.copyBytes+=s.size}}
  // on the box, not in the backup, in a folder the backup holds: it stays
  for(const n of await readdir(path.join(dest,rel)).catch(()=>[]))if(!have.has(n))await boxOnly(rel?path.join(rel,n):n)}
 // a whole folder the box does not have
 async function count(rel){for(const n of await readdir(path.join(src,rel))){const r=path.join(rel,n);const s=await lstat(path.join(src,r));if(s.isDirectory())await count(r);else if(s.isFile()||s.isSymbolicLink()){if(SKIPF.test(n))continue;note('add',r);out.bytes+=s.size;out.copyBytes+=s.size}}}
 await walk('');
 const ag=async d=>new Set(['default',...(await readdir(path.join(d,'profiles'),{withFileTypes:true}).catch(()=>[])).filter(x=>x.isDirectory()&&!x.name.startsWith('.')).map(x=>x.name)]);
 const a=await ag(src),b=await ag(dest);out.agents={back:[...a].filter(x=>!b.has(x)),stay:[...b].filter(x=>!a.has(x)),both:[...a].filter(x=>b.has(x))};return out}
/* The copy: src over dest, journaled (one JSON line per step, written before the step). {h:rel}: what was at rel is moved
   to rel.aqeelos-held; {a:rel}: rel is new. Running programs' pid, lock and socket files are left alone; a database the
   backup holds has the box's own -wal and -shm moved aside too (SQLite would replay today's changes into the old file). */
export async function copyOver({src,dest,journal,onStep=()=>{}}){const fd=openSync(journal,'a');const log=o=>writeSync(fd,JSON.stringify(o)+'\n');
 const n={files:0,added:0,replaced:0};
 const hold=async rel=>{const f=path.join(dest,rel);log({h:rel});await rm(f+HELD,{recursive:true,force:true});await rename(f,f+HELD)};
 async function walk(rel){const names=await readdir(path.join(src,rel));
  for(const nm of names){const r=rel?path.join(rel,nm):nm;if(SKIPF.test(nm)||nm.endsWith(HELD))continue;const s=await lstat(path.join(src,r)),D=path.join(dest,r);let d=await lstat(D).catch(()=>null);
   if(s.isDirectory()){if(d&&!d.isDirectory()){await hold(r);d=null}if(!d){log({a:r});await mkdir(D);n.added++}await walk(r);continue}
   if(!s.isFile()&&!s.isSymbolicLink())continue;   // sockets, pipes, devices
   if(d){await hold(r);n.replaced++}else{log({a:r});n.added++}
   if(s.isSymbolicLink())await symlink(await readlink(path.join(src,r)),D);else{await copyFile(path.join(src,r),D);await chmod(D,s.mode&0o7777).catch(()=>{});await utimes(D,s.atime,s.mtime).catch(()=>{})}
   n.files++;if(n.files%500===0)onStep(n);
   if(DB.test(nm))for(const x of ['-wal','-shm'])if(!names.includes(nm+x)&&await lstat(D+x).catch(()=>null))await hold(r+x)}}
 try{log({start:Date.now()});await walk('')}finally{closeSync(fd)}return n}
const steps=async journal=>(await readFile(journal,'utf8').catch(()=>'')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
// undo a copy from its journal, last step first (also a copy that was cut off: a step that never happened is skipped)
export async function rollBack({dest,journal}){const l=await steps(journal);let undone=0;
 for(const s of l.reverse()){if(s.a){await rm(path.join(dest,s.a),{recursive:true,force:true});undone++}
  else if(s.h){const f=path.join(dest,s.h);if(await lstat(f+HELD).catch(()=>null)){await rm(f,{recursive:true,force:true});await rename(f+HELD,f);undone++}}}
 await unlink(journal).catch(()=>{});return undone}
// the copy is complete: what was moved aside goes
export async function commit({dest,journal}){for(const s of await steps(journal))if(s.h)await rm(path.join(dest,s.h)+HELD,{recursive:true,force:true});await unlink(journal).catch(()=>{})}
// a bash command in cwd; rejects with its last error line and exit code
export const shell=(cmd,{cwd,env}={})=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let o='',e='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>e+=d);p.on('close',c=>c===0?res(o):rej(Object.assign(Error(e.trim().split('\n').pop()||'exit '+c),{code:c})))});
const sq=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
// the first bytes of an encrypted backup open with this key (a gzip header comes out): checks a typed key without a download
export function headOpens(buf,key){return new Promise(res=>{const p=spawn('openssl',['enc','-d','-aes-256-cbc','-pbkdf2','-iter','200000','-pass','env:AQ_BK'],{env:{...process.env,AQ_BK:key},stdio:['pipe','pipe','ignore']});const out=[];
 p.stdout.on('data',d=>out.push(d));p.on('error',()=>res(false));p.on('close',()=>{const o=Buffer.concat(out);res(o.length>=2&&o[0]===0x1f&&o[1]===0x8b)});p.stdin.on('error',()=>{});p.stdin.end(buf)})}
/* The part of a restore that changes the box, in this order, so a step that fails leaves the box as it was:
   1. the agents, the dashboard and the bridges stop (stopEngine throws when they don't: nothing is changed, they start again);
   2. today's agents are packed while stopped (so their databases are whole) into <name>.part, renamed only when complete;
      a failed pack is deleted and nothing is changed; the newest two complete copies are kept;
   3. copyOver, journaled; if it fails, rollBack puts every file back and says so; if even that fails, the error names the
      journal and the safety copy;
   4. the backup's settings must be in place (config.yaml), else the same roll back;
   5. commit: the files moved aside go;
   6. the agents start again, whatever happened after they stopped. */
export async function applyRestore({src,HERMES_HOME,HOME,journal,at=Date.now(),stopEngine,startEngine,tar='tar',run=shell,onSafety=()=>{},onStep,hold=()=>{}}){
 const parent=path.dirname(HERMES_HOME),base=path.basename(HERMES_HOME),safety=path.join(HOME,'aqeelos-before-restore-'+new Date(at).toISOString().slice(0,19).replace(/[:T]/g,'-')+'.tar.gz'),part=safety+'.part';
 if(existsSync(journal))throw Error('A restore that was cut off has not been rolled back yet. Restart aqeelOS first, so nothing was changed.');
 let stopped=false,unread=0;
 try{stopped=true;try{await stopEngine()}catch(e){throw Error('The agents did not stop ('+e.message+'), so nothing was changed.')}
  try{const err=part+'.err';await run('set -o pipefail; '+sq(tar)+' -czf '+sq(part)+' --ignore-failed-read '+EXCLUDE.filter(e=>!/^(apps|workspaces|\.claude)\//.test(e)).map(e=>sq('--exclude='+e.replace(/^\.hermes\//,base+'/'))).join(' ')+' -C '+sq(parent)+' '+sq(base)+' 2>'+sq(err)+'; c=$?; [ $c -le 1 ] || { tail -2 '+sq(err)+' >&2; exit $c; }; [ -s '+sq(part)+' ] || { echo "the copy came out empty" >&2; exit 1; }');
   unread=Number((await run('grep -c "Cannot open\\|Cannot stat\\|Cannot read" '+sq(err)+' || true')).trim())||0;await rm(err,{force:true});await rename(part,safety)}
  catch(e){await rm(part,{force:true});await rm(part+'.err',{force:true});throw Error('Today\'s agents could not be saved first ('+e.message+'), so nothing was changed.')}
  await run('ls -1t '+sq(HOME)+'/aqeelos-before-restore-*.tar.gz 2>/dev/null | tail -n +3 | xargs rm -f');await onSafety(safety);
  // aqeelOS's own writes to the engine's files wait from here until the copy is committed or rolled back
  hold(true);let n;try{n=await copyOver({src,dest:HERMES_HOME,journal,onStep});if(!await stat(path.join(HERMES_HOME,'config.yaml')).catch(()=>null))throw Error('the agents\' settings were missing afterwards')}
  catch(e){try{await rollBack({dest:HERMES_HOME,journal})}catch(e2){throw Error('Copying the backup failed ('+e.message+') and putting today\'s files back failed too ('+e2.message+'). Restart aqeelOS: it tries the roll back again on start. Today\'s copy is '+safety+'.')}
   throw Error('Copying the backup failed ('+e.message+'). Every file was put back as it was, so nothing changed.')}
  await commit({dest:HERMES_HOME,journal});return {safety,unread,...n}}
 finally{hold(false);if(stopped)await Promise.resolve().then(startEngine).catch(e=>console.warn('backup: starting the agents after the restore',e.message))}}
// what a restore test must find for the box to work
const MUST=['.hermes/config.yaml','.hermes/.env','apps/hermes-ui-data/users.json','apps/hermes-ui.env'];
const gb=n=>(n/1e9).toFixed(n<1e10?1:0)+' GB';
/* A 12.7 GB download filled the container's memory with file cache (7 Nov 2026: 28.9 of 30.1 GB, load 20), because the
   page cache counts toward the container's limit. Each piece written is now synced and dropped from the cache, and a
   prepare or restore test does not start while the container has less than 6 GB free. */
export const MEM_NEED=6e9;
// files (or every file under a folder) synced and dropped from the page cache; quiet where the system cannot (a Mac)
const DROP_PY="import os,sys\nfor a in sys.argv[1:]:\n  for r,_,fs in (os.walk(a) if os.path.isdir(a) else [('',[],[a])]):\n    for f in fs:\n      try:\n        fd=os.open(os.path.join(r,f),os.O_RDONLY)\n        try:\n          os.fdatasync(fd);os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED)\n        finally:\n          os.close(fd)\n      except Exception:\n        pass\n";
export const dropCache=paths=>new Promise(res=>{const p=spawn('python3',['-c',DROP_PY,...paths],{stdio:'ignore'});p.on('error',()=>res(false));p.on('close',c=>res(c===0))});
// free memory for this container (cgroup v2 memory.max minus memory.current), else the machine's MemAvailable; null when unknown
export async function memFree(root='/sys/fs/cgroup',meminfo='/proc/meminfo'){
 const max=(await readFile(path.join(root,'memory.max'),'utf8').catch(()=>'')).trim(),cur=Number((await readFile(path.join(root,'memory.current'),'utf8').catch(()=>'')).trim());
 if(/^\d+$/.test(max)&&cur>=0&&!Number.isNaN(cur))return Number(max)-cur;
 const m=/MemAvailable:\s+(\d+)\s*kB/.exec(await readFile(meminfo,'utf8').catch(()=>''));return m?Number(m[1])*1024:null}

// what a backup cut off by an app restart left in /tmp (its finally never ran): the archive and its .err/.skipped notes.
// Called when the app starts, before any backup can run (11 Nov 2026: 186 GB of them on Elkiya).
export const LEFTOVER=/^aqeelos-\d{4}-\d\d-\d\d-\d\d-\d\d\.tar\.gz\.enc(\.err|\.skipped|\.oerr|\.tcode)?$/;
/* No Google account (P&P never had one, so no backup was ever made there): the nightly backup stays on the box itself, in
   LOCALDIR, encrypted the same way. The newest LOCAL_KEEP are kept, none older than LOCAL_DAYS, all of them together under
   LOCAL_MAX bytes; the newest is never removed. A newest good backup (Drive or local) older than STALE_H hours is one
   standing Health item. Restoring a local one: RESTORE.md. */
export const LOCAL_KEEP=3,LOCAL_DAYS=14,LOCAL_MAX=60e9,STALE_H=48;
export const LOCAL_NAME=/^aqeelos-\d{4}-\d\d-\d\d-\d\d-\d\d\.tar\.gz\.enc$/;
// the names to remove, from [{name,size,at}]
export function pruneLocal(files,{keep=LOCAL_KEEP,days=LOCAL_DAYS,max=LOCAL_MAX,now=Date.now()}={}){
 const l=[...files].sort((a,b)=>b.at-a.at),out=[];let total=0;
 l.forEach((f,i)=>{if(i>0&&(i>=keep||now-f.at>days*864e5))out.push(f.name);else total+=f.size});
 for(let i=l.length-1;i>0&&total>max;i--){const f=l[i];if(out.includes(f.name))continue;out.push(f.name);total-=f.size}
 return out}
// the newest good backup (at, 0 = none yet; since = when aqeelOS first looked) is older than the limit: how old, else null
export const staleBackup=(at,since,now=Date.now(),hours=STALE_H)=>{const age=now-(at||since||now);return age>hours*3600e3?{hours:Math.round(age/3600e3),never:!at}:null};
export function createBackups({DATA,HOME,HERMES_HOME,tz=()=>'',ENV_ACCOUNT=process.env.BACKUP_GOOGLE_ACCOUNT||'',notify=()=>{},solved=()=>{},restored=()=>{},stopEngine=async()=>{},startEngine=async()=>{},fetchImpl=fetch,tar='tar',TMP='/tmp',LOCALDIR=path.join(HOME,'aqeelos-local-backups'),MIN=1e6,disk:diskImpl,mem=memFree,drop=dropCache,PIECE=64*1024*1024,
 detach=false,jobCmd=null,jobPoll=5000,jobQuiet=3*60e3,readOnly=false,now=()=>Date.now()}){   // detach: the backup runs in its own process (backup-job.mjs) and outlives an app restart; readOnly: that process never writes backups.json
 const STATE=path.join(DATA,'backups.json'),KEYF=path.join(DATA,'backup-key'),JOURNAL=path.join(DATA,'restore-journal.jsonl');let state=null,running=null,job=null,preparing=null,copying=false,held=false,testing=null,prep=null;   // prep: the running Prepare's stop switch
 const load=async()=>{if(!state){try{state=JSON.parse(await readFile(STATE,'utf8'))}catch{state={}}
   // the old switched-off restore's "running" mark (before 7 Nov 2026)
   if(state.restore?.running){state.restore={...state.restore,running:false,ok:false,phase:'failed',error:'Interrupted: aqeelOS stopped during the restore.'};await save().catch(()=>{})}
   if(state.restore?.phase==='preparing'){state.restore={...state.restore,phase:'failed',ok:false,error:'Interrupted: aqeelOS stopped while the backup was being prepared. Nothing on the box was changed.'};await save().catch(()=>{})}}return state};
 const save=async()=>{if(readOnly)return;await mkdir(DATA,{recursive:true});await writeFile(STATE,JSON.stringify(state,null,1))};
 const settings=()=>({...DEFAULTS,...(ENV_ACCOUNT?{account:'google_token_'+ENV_ACCOUNT+'.json'}:{}),...(state?.settings||{})});
 const tokenFile=()=>settings().account||'google_token.json';
 // the key that encrypts every backup (made once; admins see it under System › Health to keep it somewhere safe)
 // a key that went missing after backups were made is never silently replaced: the old backups need the old key
 const made=()=>!!(state?.made||state?.last?.ok||state?.test?.ok);
 const NOKEY='The backup key is missing, and the backups already in Google Drive can only be opened with it. Enter it under Backup key (from where you kept it); no new backup is made until then.';
 const readKey=async()=>{try{const k=(await readFile(KEYF,'utf8')).trim();if(k.length>=32)return k}catch{}return null};
 async function key(){await load();const have=await readKey();if(have)return have;if(made())throw Error(NOKEY);const k=randomBytes(24).toString('base64url');await mkdir(DATA,{recursive:true});await writeFile(KEYF,k,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});await chmod(KEYF,0o600).catch(()=>{});return (await readFile(KEYF,'utf8')).trim()}
 // an existing key typed in (a new box restoring an old one's backups, or the key file lost): checked against the newest
 // Drive backup when Google is connected
 async function setKey(k,{replace=false}={}){await load();k=String(k||'').trim();
  if(k.length<32||k.length>200||/\s/.test(k))throw Object.assign(Error('A backup key is one line of 32 or more letters and digits, with no spaces. Paste it exactly as you kept it.'),{status:400});
  const have=await readKey();if(have===k)return {saved:true,same:true,opens:await keyCheck(k)};
  if(have&&made()&&!replace)throw Object.assign(Error('There is already a backup key, and backups were made with it. Replacing it means those backups can only be opened with the old key.'),{status:409,replace:true});
  let opens=await keyCheck(k);if(opens===false&&!replace)throw Object.assign(Error('This key does not open the newest backup in Google Drive. Check it was copied whole.'),{status:400,replace:true});
  await mkdir(DATA,{recursive:true});await writeFile(KEYF+'.tmp',k,{mode:0o600});await rename(KEYF+'.tmp',KEYF);await chmod(KEYF,0o600).catch(()=>{});console.log('backup: key '+(have?'replaced':'entered')+' by hand');return {saved:true,opens}}
 async function keyCheck(k){try{const g=await google(),fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size)&pageSize=1');const f=l.files?.[0];if(!f)return null;
  const r=await fetchImpl('https://www.googleapis.com/drive/v3/files/'+f.id+'?alt=media',{headers:{authorization:'Bearer '+g.token,range:'bytes=0-65535'},signal:AbortSignal.timeout(30000)});if(!r.ok)return null;return await headOpens(Buffer.from(await r.arrayBuffer()),k)}catch{return null}}
 // Google: an access token from the stored sign-in (refreshed here, the file is left as it is)
 const NOGOOGLE='Connect Google first: backups go to Google Drive, and no Google account is connected for them yet.';
 async function google(){let t;try{t=JSON.parse(await readFile(path.join(HERMES_HOME,tokenFile()),'utf8'))}catch{throw Object.assign(Error(NOGOOGLE),{code:'NOGOOGLE'})}
  if(!t.refresh_token)throw Object.assign(Error('The Google account for backups ('+(t.account||tokenFile())+') has no lasting sign-in. Reconnect it under Connect Google.'),{code:'NOGOOGLE'});
  if(Array.isArray(t.scopes)&&t.scopes.length&&!t.scopes.some(s=>/\/auth\/drive(\.file)?$/.test(s)))throw Object.assign(Error((t.account||'The backup account')+' was connected without Drive. Reconnect it with Drive on, or pick another account in the backup settings.'),{code:'NOGOOGLE'});
  let cid=t.client_id,sec=t.client_secret;if(!cid||!sec){try{const c=JSON.parse(await readFile(path.join(HERMES_HOME,'google_client_secret.json'),'utf8'));const x=c.web||c.installed||{};cid||=x.client_id;sec||=x.client_secret}catch{}}
  const r=await fetchImpl(t.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cid||'',client_secret:sec||'',refresh_token:t.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  const j=await r.json();if(!j.access_token)throw Error('Google did not give access ('+String(j.error_description||j.error||r.status).replace(/\.$/,'')+'). Reconnect '+(t.account||'the backup account')+' under Connect Google.');return {token:j.access_token,account:t.account||''}}
 const drive=async(g,p,opt={})=>{const r=await fetchImpl('https://www.googleapis.com/'+p,{...opt,headers:{authorization:'Bearer '+g.token,...(opt.headers||{})},signal:AbortSignal.timeout(opt.long?3600000:30000)});
  if(!r.ok)throw Error('Google Drive said '+r.status+': '+(await r.text()).slice(0,200));return opt.raw?r:r.json()};
 async function folder(g){const name=settings().folder.replace(/'/g,"\\'");const q=encodeURIComponent("name='"+name+"' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents");
  const l=await drive(g,'drive/v3/files?q='+q+'&fields=files(id)');if(l.files?.[0])return l.files[0].id;
  return (await drive(g,'drive/v3/files',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:settings().folder,mimeType:'application/vnd.google-apps.folder'})})).id}
 const sh=(cmd,envx,ctl)=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{cwd:HOME,env:{...process.env,...envx},stdio:['ignore','ignore','pipe'],detached:!!ctl});if(ctl)ctl.child=p;let err='';p.stderr.on('data',d=>err+=d);p.on('close',c=>c===0?res():rej(Error(err.trim().split('\n').slice(-2).join(' ')||'exit '+c)))});
 const q=sq;
 // the upload in 64 MB pieces on Google's resumable session: one dropped connection no longer loses a multi-GB upload
 // ("fetch failed", "aborted due to timeout" on 30 and 31 Oct 2026). A failed piece asks Google how much it has and goes on
 // from there, up to 5 times in a row
 async function sendFile(loc,file,size){const PIECE=64*1024*1024;let at=0,fails=0;
  const have=async()=>{const r=await fetchImpl(loc,{method:'PUT',headers:{'content-length':'0','content-range':'bytes */'+size},signal:AbortSignal.timeout(60000)});
   if(r.ok)return {done:await r.json()};if(r.status!==308)throw Error('Google lost the upload ('+r.status+').');const g=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');return {at:g?Number(g[1])+1:0}};
  while(true){const end=Math.min(at+PIECE,size)-1;
   try{const r=await fetchImpl(loc,{method:'PUT',headers:{'content-length':String(end-at+1),'content-range':'bytes '+at+'-'+end+'/'+size,'content-type':'application/octet-stream'},body:Readable.toWeb(createReadStream(file,{start:at,end})),duplex:'half',signal:AbortSignal.timeout(15*60000)});
    if(r.ok)return await r.json();if(r.status!==308)throw Error('The upload stopped ('+r.status+').');const g=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');at=g?Number(g[1])+1:end+1;fails=0}
   catch(e){if(++fails>5)throw Error('The upload kept dropping: '+e.message);await new Promise(r=>setTimeout(r,fails*15000));const h=await have().catch(()=>null);if(h?.done)return h.done;if(h)at=h.at}}}
 // each isolated agent (terminal over SSH as its own ag-* user) re-grants aqeelOS read access to the files it owns
 async function grantRead(){const prof=path.join(HOME,'.hermes','profiles');for(const a of await readdir(prof).catch(()=>[])){
  const y=await readFile(path.join(prof,a,'config.yaml'),'utf8').catch(()=>'');const u=/\n\s*ssh_user:\s*['"]?(ag-[\w-]+)/.exec(y)?.[1],k=/\n\s*ssh_key:\s*['"]?([^'"\n]+)/.exec(y)?.[1]?.trim(),ws=path.join(HOME,'workspaces',a);
  if(!u||!k||!await stat(ws).catch(()=>null))continue;
  await sh('ssh -i '+q(k)+' -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 '+q(u+'@127.0.0.1')+' '+q('find '+q(ws)+' -user '+u+' \\( -type d -o -type f \\) -print0 2>/dev/null | xargs -0 -r setfacl -m u:claude:rwX,m::rwX 2>/dev/null; true')).catch(e=>console.warn('backup: read access for',a,e.message))}}
 /* One backup from start to end: pack, encrypt, upload (or keep on the box), prune. Returns {last, note}: what backups.json's "last" becomes
    and the log line; throws with the reason. It writes nothing to backups.json, so it runs the same in the app and in the detached job. */
 async function pack(why,at,name,onPhase=()=>{}){const tmp=path.join(TMP,name);let work=tmp;
  try{let g0=null,gwhy='';try{g0=await google()}catch(e){if(e.code!=='NOGOOGLE')throw e;if(!/Connect Google first/.test(e.message))gwhy=e.message}   // a Google account that cannot be used is said on the result, the backup still happens   // no Google: the backup stays on this box (LOCALDIR)
   const local=!g0,dest=path.join(LOCALDIR,name);
   if(local){await mkdir(LOCALDIR,{recursive:true,mode:0o700});work=dest+'.part'}
   // the disk first: a full one made openssl fail, tar got SIGPIPE and the cause was lost as "tar exit 141" (11 Nov 2026)
   {const need=Math.max(2e9,(state.last?.size||state.lastSize||0)*1.3),free=(await disk(path.dirname(work))).free;if(free<need)throw Error('Not enough free disk space for a backup: it needs about '+gb(need)+' in '+path.dirname(work)+', and there is '+gb(free)+'.')}
   const inc=[];for(const p of INCLUDE)if(await stat(path.join(HOME,p)).catch(()=>null))inc.push(p);
   // agents with their own Linux user own their workspace files, and some programs write them private, so tar could not
   // read them and every nightly backup failed from 24 Oct (30 Oct 2026). Before packing, each agent's own user (the SSH
   // login its terminal already uses) gives aqeelOS read access to its files again; the owner of a file may do that
   await grantRead();
   // tar exits 1 when a file changes while it reads (fine for a backup). A file that still can't be read (a browser's lock
   // link) is skipped and counted instead of failing the whole backup; anything else tar can't do still fails it
   const terr=q(work+'.err'),tcnt=q(work+'.skipped'),oerr=q(work+'.oerr'),tcode=q(work+'.tcode'),junk=[terr,oerr,tcode].join(' ');
   // tar and openssl each report on their own (PIPESTATUS): when openssl stops first (disk full, file unwritable) tar only gets
   // SIGPIPE, exit 141, and the old one-line check reported that instead of the cause (11 Nov 2026). openssl's own error comes first.
   await sh('{ tar -czf - --ignore-failed-read '+EXCLUDE.map(e=>'--exclude='+q(e)).join(' ')+' '+inc.map(q).join(' ')+' 2>'+terr+'; echo $? >'+tcode+'; } | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:AQ_BK -out '+q(work)+' 2>'+oerr+'; oc=${PIPESTATUS[1]}; tc=$(cat '+tcode+' 2>/dev/null); tc=${tc:-1}; '
    +'grep -c "Cannot open\\|Cannot stat\\|Cannot read" '+terr+' >'+tcnt+' 2>/dev/null; '
    +'[ "$oc" = 0 ] || { echo "encrypting the backup failed (openssl exit $oc): $(tail -c 300 '+oerr+' | tr "\\n" " ")" >&2; rm -f '+junk+'; exit 1; }; '
    +'[ "$tc" -le 1 ] || { grep -v "socket ignored\\|Cannot open\\|Cannot stat\\|Cannot read" '+terr+' | tail -2 >&2; echo "tar stopped (exit $tc)" >&2; rm -f '+junk+'; exit "$tc"; }; rm -f '+junk,{AQ_BK:await key()});
   const skipped=Number((await readFile(work+'.skipped','utf8').catch(()=>'0')).trim())||0;await rm(work+'.skipped',{force:true}).catch(()=>{});
   const size=(await stat(work)).size;if(size<MIN)throw Error('The backup came out too small ('+size+' bytes).');
   if(local){await rename(work,dest);const pruned=await pruneLocalDir();
    return {last:{at,ok:true,name,size,local:true,...(gwhy?{googleWhy:gwhy}:{}),why,secs:Math.round((Date.now()-at)/1000),skipped},
     note:name+' ('+Math.round(size/1e6)+' MB) kept on this box in '+LOCALDIR+' (no Google account)'+(pruned?', '+pruned+' older one(s) removed':'')+(skipped?', '+skipped+' unreadable file(s) skipped':'')}}
   onPhase('uploading');
   const g=await google().catch(()=>g0),fid=await folder(g);
   const start=await drive(g,'upload/drive/v3/files?uploadType=resumable',{method:'POST',raw:true,headers:{'content-type':'application/json; charset=UTF-8','x-upload-content-type':'application/octet-stream','x-upload-content-length':String(size)},body:JSON.stringify({name,parents:[fid]})});
   const file=await sendFile(start.headers.get('location'),tmp,size);
   // keep the newest N (older ones go to the Drive bin, where Google keeps them 30 more days)
   const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name)&pageSize=100');
   for(const f of (l.files||[]).slice(settings().keep))await drive(g,'drive/v3/files/'+f.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({trashed:true})}).catch(()=>{});
   await pruneLocalDir().catch(()=>{});return {last:{at,ok:true,name,size,id:file.id,account:g.account,why,secs:Math.round((Date.now()-at)/1000),skipped},note:name+' ('+Math.round(size/1e6)+' MB) uploaded to Google Drive'+(skipped?', '+skipped+' unreadable file(s) skipped':'')}}
  finally{await rm(work,{force:true}).catch(()=>{});await rm(work+'.skipped',{force:true}).catch(()=>{});await rm(tmp,{force:true}).catch(()=>{})}}
 const nameOf=at=>'aqeelos-'+new Date(at+7*3600e3).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.tar.gz.enc';
 const good=async r=>{state.last=r.last;state.lastOkAt=r.last.at;state.lastSize=r.last.size;state.made=true;delete state.staleTold;await save();console.log('backup: '+r.note);solved();return state.last};
 // a failed scheduled backup is tried again within the hour, 3 times a morning; only the third failure is told (a
 // dropped upload is usually gone an hour later). A manual one shows its result on Health, so it never goes to Bottlenecks.
 // No Google account is not a failure to tell about: the card says "Connect Google first"
 const bad=async(e,why,at)=>{state.last={at,ok:false,error:e.message,why,...(e.code==='NOGOOGLE'?{nogoogle:true}:{})};await save();console.warn('backup failed ('+(state.tries?.n||0)+' today):',e.message);if(why==='scheduled'&&state.tries?.n>=3&&e.code!=='NOGOOGLE')notify('Backup to Google Drive failed 3 times this morning',e.message)};
 /* A try counts when it starts (11 Nov 2026: each deploy restarted the app mid-backup, the cut-off run was never counted, and the next
    start tried again: seven 26 GB archives in /tmp filled Elkiya's disk to 99%). But a run that was CUT OFF (the app or the box restarted;
    its archive is found and removed at the next start) gets its try back, at most 6 times a day: on 9 to 12 Nov 2026 every night's three
    tries were used up by deploy restarts and no backup was made for three days, with nothing said (audit H2). */
 const giveBack=async()=>{const day=localParts(now(),tz()).day,t=state.tries;if(t?.day!==day||!(t.n>0)||(t.back||0)>=6)return false;state.tries={day,n:t.n-1,back:(t.back||0)+1};await save();return true};
 const CUT='The backup was cut off before it finished (aqeelOS or the server restarted). It is tried again.';
 /* The detached job (audit H2): a backup takes over an hour and the app is restarted by every deploy, so with detach the work runs in its
    own process (app/backup-job.mjs, its own session), which an app restart does not stop. DATA/backup-job.json is its lock and its state:
    {pid, at, name, why, phase, beat} while it runs (beat: written every 30 s), then {done, last, note} or {done, error, code}. The app only
    follows that file; after a restart it picks the same job up again (adopt), and its result goes into backups.json exactly once. */
 const JOB=path.join(DATA,'backup-job.json'),JOB_FILE=path.join(path.dirname(fileURLToPath(import.meta.url)),'backup-job.mjs');
 const readJob=async()=>{try{return JSON.parse(await readFile(JOB,'utf8'))}catch{return null}};
 const jobAlive=j=>{if(!j?.pid||j.done)return false;if(now()-(j.beat||j.at||0)>jobQuiet)return false;try{process.kill(j.pid,0);return true}catch(e){return e.code==='EPERM'}};
 async function follow(at,ctl={}){const t0=Date.now();for(;;){const j=await readJob();
   if(j&&j.at===at&&j.done){await rm(JOB,{force:true}).catch(()=>{});if(j.last)return {last:j.last,note:j.note||j.last.name};throw Object.assign(Error(j.error||'The backup failed.'),j.code?{code:j.code}:{})}
   if(ctl.error)throw Object.assign(Error('The backup could not be started: '+ctl.error),{cutOff:true});
   // no file yet: the job writes it first thing, give it half a minute; then a job that is gone or silent was cut off
   if(j&&j.at===at?!jobAlive(j):Date.now()-t0>30e3)throw Object.assign(Error(CUT),{cutOff:true});
   await new Promise(r=>setTimeout(r,jobPoll))}}
 async function viaJob(why,at,name){await rm(JOB,{force:true}).catch(()=>{});const [cmd,...args]=jobCmd||[process.execPath,JOB_FILE],ctl={};
  const child=spawn(cmd,args,{detached:true,stdio:'ignore',cwd:HOME,env:{...process.env,AQ_BACKUP_JOB:JSON.stringify({DATA,HOME,HERMES_HOME,TMP,LOCALDIR,MIN,tz:tz(),ENV_ACCOUNT,why,at,name})}});
  child.on('error',e=>{ctl.error=e.message});child.unref();return follow(at,ctl)}
 // what the job process runs (backup-job.mjs): the same pack(), its progress and result in the job file, never backups.json
 async function job2({why,at,name}){let phase='packing',end=null;const w=async()=>{const t=JOB+'.'+process.pid+'.tmp';await mkdir(DATA,{recursive:true});await writeFile(t,JSON.stringify({pid:process.pid,at,name,why,phase,beat:Date.now(),...(end||{})}),{mode:0o600});await rename(t,JOB)};
  await w();const hb=setInterval(()=>{if(!end)w().catch(()=>{})},Math.min(30e3,Math.max(50,jobQuiet/6)));
  try{await load();const r=await pack(why,at,name,p=>{phase=p});end={done:true,last:r.last,note:r.note}}catch(e){end={done:true,error:String(e?.message||e),code:e?.code||''}}
  clearInterval(hb);await w();return end}
 const cutOff=async(why,at)=>{const back=await giveBack();state.last={at,ok:false,error:CUT,why,cut:true};await save();console.warn('backup: a backup was cut off'+(back?'; its try is given back':''))};
 async function run(why='scheduled'){if(copying)throw Error('A restore is running. Back up after it finishes.');if(running)return running;running=(async()=>{await load();const at=now(),name=nameOf(at);
  {const day=localParts(at,tz()).day;state.tries=state.tries?.day===day?{...state.tries,n:state.tries.n+1}:{day,n:1};await save()}
  try{return await good(detach?await viaJob(why,at,name):await pack(why,at,name))}
  catch(e){if(e.cutOff)await cutOff(why,at);else await bad(e,why,at);throw e}
  finally{running=null}})();return running}
 /* When the app starts: a job that is still running (or finished while the app was away) is followed to its end; one that was cut off, or
    an archive an in-app backup left behind, gives its try back. Then what a cut-off backup left in /tmp is removed. */
 async function startUp(){await load();const j=detach?await readJob():null;let cut=false;
  if(j&&(j.done||jobAlive(j))){running=(async()=>{try{return await good(await follow(j.at))}catch(e){if(e.cutOff)await cutOff(j.why,j.at);else await bad(e,j.why,j.at);throw e}finally{running=null}})();running.catch(()=>{});console.log('backup: following the backup that was already running ('+j.name+')');return {adopted:true}}
  if(j){await rm(JOB,{force:true}).catch(()=>{});cut=true}
  const left=await dropLeftovers();if(cut||left.archives){const back=await giveBack();console.log('backup: the last backup was cut off'+(back?'; its try is given back':''));return {cut:true,back}}
  return {}}
 // the backups kept on this box (no Google account): newest first
 async function localBackups(){const out=[];for(const f of await readdir(LOCALDIR).catch(()=>[])){if(!LOCAL_NAME.test(f))continue;const st=await stat(path.join(LOCALDIR,f)).catch(()=>null);if(st?.isFile())out.push({name:f,size:st.size,at:st.mtimeMs})}return out.sort((a,b)=>b.at-a.at)}
 async function pruneLocalDir(){const gone=pruneLocal(await localBackups());for(const f of gone)await rm(path.join(LOCALDIR,f),{force:true}).catch(()=>{});
  for(const f of await readdir(LOCALDIR).catch(()=>[]))if(f.endsWith('.part')&&!running){const st=await stat(path.join(LOCALDIR,f)).catch(()=>null);if(st&&Date.now()-st.mtimeMs>864e5)await rm(path.join(LOCALDIR,f),{force:true}).catch(()=>{})}
  return gone.length}
 // a backup from Drive to a file, 256 MB at a time (each piece has 20 minutes and 5 tries), so a long download is never cut
 // off by one timeout (1 Nov 2026, second review)
 // 64 MB pieces, each synced and dropped from the page cache once written (MEM_NEED above); ctl.stop ends it at once
 const STOPPED='Stopped. Nothing on the box was changed.';
 async function download(g,id,file,size,ctl={}){await rm(file,{force:true});let at=0,fails=0;const t0=Date.now();
  while(at<size){if(ctl.stop)throw Error(STOPPED);const end=Math.min(at+PIECE,size)-1;
   try{const r=await fetchImpl('https://www.googleapis.com/drive/v3/files/'+id+'?alt=media',{headers:{authorization:'Bearer '+g.token,range:'bytes='+at+'-'+end},signal:ctl.ac?AbortSignal.any([ctl.ac.signal,AbortSignal.timeout(20*60000)]):AbortSignal.timeout(20*60000)});
    if(r.status!==206&&!(r.status===200&&at===0))throw Error('Google Drive said '+r.status);   // 200 is the whole file: only right from the start
    await pipeline(Readable.fromWeb(r.body),createWriteStream(file,{flags:'a'}));at=(await stat(file)).size;fails=0;await drop([file]);ctl.onPiece?.(at)}
   catch(e){if(ctl.stop)throw Error(STOPPED);if(++fails>5)throw Error('The download kept dropping: '+e.message);await new Promise(r=>setTimeout(r,fails*15000));at=(await stat(file).catch(()=>({size:0}))).size;if(e.message.includes('401'))g=await google()}}
  const secs=(Date.now()-t0)/1000;if(size>=256e6&&secs>0){state.speed=Math.round(size/secs);await save().catch(()=>{})}}   // the measured speed, for the next estimate
 // enough memory for a big download and unpack, said plainly when not
 async function memOk(){const f=await mem();if(f!=null&&f<MEM_NEED)throw Object.assign(Error('The box is short on memory right now: '+gb(Math.max(0,f))+' free, and this needs about '+gb(MEM_NEED)+'. Try again at night, when the agents are quiet. Nothing was changed.'),{status:409});return f}
 // a restore test: the newest backup from Drive, decrypted and unpacked into a scratch folder, with the must-have files checked
 async function test(){if(copying||preparing)throw Error('A restore is running. Test after it finishes.');if(testing)return testing;testing=(async()=>{await load();const at=Date.now();const dir=path.join(TMP,'aqeelos-restore-test-'+at),enc=dir+'.enc';
  try{await memOk();const g=await google(),fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size)&pageSize=1');const f=l.files?.[0];if(!f)throw Error('There is no backup in Google Drive yet.');
   await download(g,f.id,enc,Number(f.size)||0);
   await mkdir(dir,{recursive:true});await sh('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+q(enc)+' | tar -xzf - -C '+q(dir),{AQ_BK:await key()});
   const missing=[];for(const m of MUST){const s=await stat(path.join(dir,m)).catch(()=>null);if(!s||!s.size)missing.push(m)}
   let agents=0;try{agents=(await readdir(path.join(dir,'.hermes','profiles'))).length+1}catch{}
   if(missing.length)throw Error('Missing after restore: '+missing.join(', '));
   state.test={at,ok:true,name:f.name,detail:'Unpacked '+f.name+': settings, people, aqeelOS data and '+agents+' agents are all there.'};await save();return state.test}
  catch(e){state.test={at,ok:false,error:e.message};await save();if(e.code!=='NOGOOGLE')notify('The backup restore test failed',e.message);throw e}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});await rm(enc,{force:true}).catch(()=>{})}})().finally(()=>{testing=null});return testing}
 // the safety copies on the box (made before each restore), as restore sources too: going back is the same restore
 async function locals(){const out=[];for(const f of await readdir(HOME).catch(()=>[])){const m=/^aqeelos-before-restore-(\d{4}-\d\d-\d\d)-(\d\d)-(\d\d)-(\d\d)\.tar\.gz$/.exec(f);if(!m)continue;const s=await stat(path.join(HOME,f)).catch(()=>null);if(!s)continue;
  out.push({id:'local:'+f,name:f,size:s.size,at:Date.parse(m[1]+'T'+m[2]+':'+m[3]+':'+m[4]+'Z')||s.mtimeMs,local:true})}return out.sort((a,b)=>b.at-a.at)}
 // the backups in Drive, newest first, and the safety copies on the box
 async function list(){const loc=await locals();let g;try{g=await google()}catch(e){return {items:loc,google:false,error:e.message}}
  const fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size,createdTime)&pageSize=30');
  return {google:true,items:[...(l.files||[]).map(f=>({id:f.id,name:f.name,size:Number(f.size)||0,at:Date.parse(f.createdTime)||0})),...loc]}}
 // free space on the disk that holds dir (bytes), and which disk it is
 const disk=diskImpl||(async dir=>{const o=await new Promise(res=>{const p=spawn('df',['-Pk',dir]);let t='';p.stdout.on('data',d=>t+=d);p.on('close',()=>res(t));p.on('error',()=>res(''))});const l=o.trim().split('\n')[1]?.split(/\s+/)||[];return {free:Number(l[3])*1024||0,dev:l[0]||dir}});
 /* Restore, step 1, Prepare: the backup is downloaded, decrypted and unpacked (its .hermes part: the agents' settings,
    skills, memories, chats and sign-ins) into a scratch folder and compared with the box. Nothing on the box changes,
    the agents keep running. aqeelOS's own data and people's files are never restored here (nobody is signed out halfway);
    a whole new box: RESTORE.md. */
 const scratch=at=>path.join(TMP,'aqeelos-restore-'+at);
 // what Prepare will take, shown before it starts: the download, the time at the last measured speed, space and memory
 async function source(id){id=String(id||'');if(id.startsWith('local:')){const n=id.slice(6);if(!/^aqeelos-before-restore-[\d-]+\.tar\.gz$/.test(n))throw Error('That file is not one of the safety copies.');const s=await stat(path.join(HOME,n)).catch(()=>null);if(!s)throw Error('That safety copy is gone.');return {name:n,size:s.size,local:true}}
  const g=await google(),fid=await folder(g);const f=await drive(g,'drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,parents,size');if(!(f.parents||[]).includes(fid))throw Error('That file is not one of the backups.');f.size=Number(f.size)||0;return f}
 async function estimate(id){await load();const f=await source(id),t=await disk(TMP),m=await mem(),speed=state.speed||5e6,need=f.size*(f.local?2.5:3.5)+1e9;
  const why=t.free<need?'Not enough free space: it needs about '+gb(need)+' in '+TMP+', and there is '+gb(t.free)+'.':m!=null&&m<MEM_NEED?'The box is short on memory right now: '+gb(Math.max(0,m))+' free, and this needs about '+gb(MEM_NEED)+'. Try again at night, when the agents are quiet.':'';
  return {name:f.name,local:!!f.local,size:f.size,secs:f.local?Math.round(f.size/50e6)+30:Math.round(f.size/speed)+60,speed:f.local?null:speed,measured:!!state.speed,tmpNeed:need,tmpFree:t.free,memFree:m,memNeed:MEM_NEED,ok:!why,why}}
 async function prepare(id){await load();if(copying||preparing)throw Object.assign(Error('A restore is already running.'),{status:409});if(running)throw Object.assign(Error('A backup is running. Wait for it to finish.'),{status:409});if(testing)throw Object.assign(Error('A restore test is running. Wait for it to finish.'),{status:409});
  if(existsSync(JOURNAL))throw Object.assign(Error('A restore that was cut off is still being rolled back. Try again in a minute.'),{status:409});
  await cancel();id=String(id||'');const at=Date.now(),dir=scratch(at),enc=dir+'.enc';let f;
  let go;preparing=new Promise(r=>go=r);const ctl=prep={stop:false,ac:new AbortController(),child:null};
  try{f=await source(id);await memOk();
   const t=await disk(TMP);const need=f.size*(f.local?2.5:3.5)+1e9;
   if(t.free<need)throw Error('Not enough free space to prepare this backup: it needs about '+gb(need)+' in '+TMP+', and there is '+gb(t.free)+'. Nothing was changed.');
   state.restore={phase:'preparing',at,name:f.name,size:f.size,got:0};await save()}
  catch(e){preparing=null;prep=null;go();throw e}
  job=(async()=>{try{await mkdir(dir,{recursive:true});
    if(f.local)await sh('tar -xzf '+q(path.join(HOME,f.name))+' -C '+q(dir),{},ctl);   // one folder inside: the engine folder, whatever it was called
    else{await download(await google(),f.id,enc,f.size,{...ctl,get stop(){return ctl.stop},onPiece:n=>{if(state.restore?.at===at)state.restore.got=n}});if(ctl.stop)throw Error(STOPPED);state.restore.step='unpacking';
     await sh('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+q(enc)+' | tar -xzf - -C '+q(dir)+' .hermes',{AQ_BK:await key()},ctl).catch(e=>{if(ctl.stop)throw Error(STOPPED);throw Error(/bad decrypt|digital envelope/i.test(e.message)?'The backup key does not open this backup. Enter the key it was made with under Backup key.':e.message)});await rm(enc,{force:true})}
    if(ctl.stop)throw Error(STOPPED);await drop([dir]);
    const src=f.local?path.join(dir,(await readdir(dir,{withFileTypes:true})).find(x=>x.isDirectory())?.name||'.hermes'):path.join(dir,'.hermes');
    if(!(await stat(path.join(src,'config.yaml')).catch(()=>null))?.size)throw Error('The backup has no agent settings, so it cannot be restored.');
    const pv=await preview(src,HERMES_HOME);
    state.prepared={id,name:f.name,local:!!f.local,at:Date.now(),dir,src,preview:pv};state.restore={phase:'ready',at,name:f.name};await save();console.log('backup: prepared',f.name,'for a restore')}
   catch(e){await rm(dir,{recursive:true,force:true}).catch(()=>{});state.restore=ctl.stop?null:{phase:'failed',at,ok:false,name:f.name,error:e.message};delete state.prepared;await save();console.warn('backup: preparing a restore '+(ctl.stop?'stopped':'failed: '+e.message))}
   finally{await rm(enc,{force:true}).catch(()=>{});preparing=null;prep=null;go()}})();
  return {started:true,name:f.name}}
 // Cancel: stops a Prepare that is running (download or unpack) and throws away a prepared one
 async function cancel(){await load();if(prep&&preparing){const c=prep,w=preparing;c.stop=true;c.ac.abort();try{process.kill(-c.child?.pid,'SIGTERM')}catch{try{c.child?.kill('SIGTERM')}catch{}}await w;return {ok:true,stopped:true}}const p=state.prepared;if(!p)return {ok:true};await rm(p.dir,{recursive:true,force:true}).catch(()=>{});delete state.prepared;if(state.restore?.phase==='ready')state.restore=null;await save();return {ok:true}}
 // step 2, Restore now: only from a prepared backup, within 3 hours (the box keeps changing)
 async function apply(){await load();const p=state.prepared;if(copying||preparing)throw Object.assign(Error('A restore is already running.'),{status:409});if(running||testing)throw Object.assign(Error('A backup or a restore test is running. Wait for it to finish.'),{status:409});
  if(!p||!await stat(path.join(p.src,'config.yaml')).catch(()=>null)){if(p){delete state.prepared;await save()}throw Object.assign(Error('Prepare the backup first.'),{status:409})}
  if(Date.now()-p.at>3*3600e3){await cancel();throw Object.assign(Error('The prepared backup is more than 3 hours old. Prepare it again, so the preview is current.'),{status:409})}
  const h=await disk(HERMES_HOME),need=p.preview.copyBytes+p.preview.boxBytes*0.7+1e9;
  if(h.free<need)throw Object.assign(Error('Not enough free space: the restore needs about '+gb(need)+' next to the agents (the copy and today\'s safety copy), and there is '+gb(h.free)+'. Nothing was changed.'),{status:400});
  copying=true;const at=Date.now();state.restore={phase:'copying',at,name:p.name,step:'Stopping the agents'};await save();
  job=(async()=>{try{const r=await applyRestore({src:p.src,HERMES_HOME,HOME,journal:JOURNAL,at,stopEngine:async()=>{await stopEngine();state.restore.step='Saving today\'s agents';await save().catch(()=>{})},startEngine,tar,hold:on=>{held=on},
     onSafety:async x=>{state.restore={...state.restore,safety:x,step:'Copying the backup'};await save()},onStep:n=>{state.restore.done=n.files}});
    state.restore={phase:'done',at,ok:true,name:p.name,safety:r.safety,unread:r.unread,files:r.files,added:r.added,replaced:r.replaced,secs:Math.round((Date.now()-at)/1000)};await save();console.log('backup: restored the agents from',p.name);
    restored(true,'The agents were restored from '+p.name,'Today\'s agents before it are kept in '+r.safety+(r.unread?' ('+r.unread+' files could not be read for it)':'')+'.')}
   catch(e){state.restore={phase:'failed',at,ok:false,name:p.name,error:e.message,...(state.restore?.safety?{safety:state.restore.safety}:{})};await save();console.warn('backup: restore failed:',e.message);
    restored(false,'The restore from '+p.name+' did not finish',e.message)}
   finally{await rm(p.dir,{recursive:true,force:true}).catch(()=>{});delete state.prepared;await save().catch(()=>{});copying=false}})();
  return {started:true,name:p.name}}
 // a restore cut off halfway (aqeelOS stopped during the copy): rolled back from its journal on start, agents stopped meanwhile
 async function recover(){if(!existsSync(JOURNAL))return {recovered:false};await load();copying=true;let undone=0;
  try{await stopEngine().catch(e=>console.warn('backup: stopping the agents for the roll back',e.message));held=true;try{undone=await rollBack({dest:HERMES_HOME,journal:JOURNAL})}finally{held=false}
   state.restore={phase:'failed',ok:false,at:state.restore?.at||Date.now(),name:state.restore?.name||'',error:'Interrupted: aqeelOS stopped during the restore. Every file was put back as it was before it ('+undone+' steps undone).'};await save();console.warn('backup: rolled back a restore that was cut off,',undone,'steps')}
  finally{copying=false;await Promise.resolve().then(startEngine).catch(()=>{})}return {recovered:true,undone}}
 // the settings: which Google account (a sign-in of the main agent with Drive), the hour, how many to keep, the Drive folder
 async function setSettings(b={}){await load();const cur=settings(),n={...cur};
  if('account' in b){const a=String(b.account||'');if(a&&!/^google_token(_[\w.-]+)?\.json$/.test(a))throw Object.assign(Error('Pick one of the Google accounts.'),{status:400});if(a&&!await stat(path.join(HERMES_HOME,a)).catch(()=>null))throw Object.assign(Error('That Google account is not connected any more.'),{status:400});n.account=a}
  if('hour' in b){const h=Number(b.hour);if(!Number.isInteger(h)||h<0||h>23)throw Object.assign(Error('Pick an hour from 00 to 23.'),{status:400});n.hour=h}
  if('keep' in b){const k=Number(b.keep);if(!Number.isInteger(k)||k<1||k>60)throw Object.assign(Error('Keep between 1 and 60 backups.'),{status:400});n.keep=k}
  if('folder' in b){const f=String(b.folder||'').trim();if(!f||f.length>80||/[\/\\'"]/.test(f))throw Object.assign(Error('Give the Drive folder a plain name (no slashes or quotes).'),{status:400});n.folder=f}
  state.settings=n;await save();return n}
 // the main agent's Google accounts that a backup can use
 async function accounts(){const out=[];for(const f of (await readdir(HERMES_HOME).catch(()=>[])).filter(f=>/^google_token(_[\w.-]+)?\.json$/.test(f)).sort()){try{const t=JSON.parse(await readFile(path.join(HERMES_HOME,f),'utf8'));if(t.aqeelos_managed)continue;
  out.push({file:f,email:t.account||'',drive:!Array.isArray(t.scopes)||!t.scopes.length||t.scopes.some(s=>/\/auth\/drive(\.file)?$/.test(s)),renews:!!t.refresh_token})}catch{}}return out}
 // every 15 minutes: the backup is due from the set hour, for 6 hours; a restore test every Sunday after it
 async function dropLeftovers(){const out={n:0,archives:0};if(running)return out;let bytes=0;for(const f of (await readdir(TMP).catch(()=>[])).filter(f=>LEFTOVER.test(f))){const p=path.join(TMP,f);const st=await stat(p).catch(()=>null);if(!st?.isFile())continue;await rm(p,{force:true}).catch(()=>{});out.n++;if(LOCAL_NAME.test(f))out.archives++;bytes+=st.size}
  if(out.n)console.log('backup: removed '+out.n+' file(s) a cut-off backup left in '+TMP+' ('+Math.round(bytes/1e9)+' GB)');return out}
 // the newest good backup older than 48 h (or none since aqeelOS first looked): one Health item, said again at most once a day
  async function staleCheck(){await load();if(!state.since){state.since=Date.now();await save()}
  const at=Math.max(state.lastOkAt||0,state.last?.ok?state.last.at:0),s=staleBackup(at,state.since);
  if(!s){if(state.staleTold){delete state.staleTold;await save();solved()}return null}
  if(!state.staleTold||Date.now()-state.staleTold>864e5){state.staleTold=Date.now();await save();
   notify(s.never?'No backup has been made yet':'The newest good backup is '+s.hours+' hours old','Backups run every night, and the newest good one is more than '+STALE_H+' hours old'+(state.last&&!state.last.ok?'. The last try failed: '+String(state.last.error||'').slice(0,200):'')+'.')}
  return s}
 /* The night's window ended and no good backup was made in it: said once per night (audit H2: three nights without a backup and nothing
    said, the 48-hour alarm only fires two days later). state.window is the day a window was open; it is settled at the first check after it. */
 async function windowCheck(inWindow,today){if(inWindow){if(state.window?.day!==today){state.window={day:today,from:now()};await save()}return null}
  const w=state.window;if(!w||w.told||running)return null;const ok=(state.lastOkAt||0)>=w.from||state.last?.ok&&state.last.at>=w.from;w.told=now();await save();
  if(!ok)notify('Last night\'s backup was not made','No backup finished in the backup window that started '+new Date(w.from).toISOString().slice(0,16).replace('T',' ')+' UTC'+(state.last&&!state.last.ok?'. The last try said: '+String(state.last.error||'').slice(0,200):'')+'. It is tried again tonight; you can also run one now.');
  return {ok}}
 async function tick(){await load();const j=localParts(now(),tz());const today=j.day,H=settings().hour,inWindow=j.hour>=H&&j.hour<H+6;
  await staleCheck().catch(()=>{});await windowCheck(inWindow,today).catch(e=>console.warn('backup: window check',e.message));
  const tries=state.tries?.day===today?state.tries.n:0,doneToday=state.last?.ok&&localParts(state.last.at,tz()).day===today;
  // after a failure the next try waits an hour; after a cut-off run it does not (nothing is wrong with the backup itself)
  if(inWindow&&!doneToday&&tries<3&&!running&&!copying&&!preparing&&(!state.last||state.last.ok||state.last.cut||now()-state.last.at>3600e3)){try{await run();if(j.weekday===0)await test()}catch{}}}
 function schedule(){pruneLocalDir().catch(()=>{});recover().catch(e=>console.warn('backup: roll back on start',e.message));startUp().catch(e=>console.warn('backup: start-up',e.message));
  setInterval(()=>tick().catch(()=>{}),15*60e3).unref?.()}
 async function status(){await load();const keyError=made()&&!await readKey()?NOKEY:null,s=settings(),acc=await accounts(),pick=acc.find(a=>a.file===tokenFile());
  const r=state.restore||null,p=state.prepared;
  const loc=await localBackups();
  return {keyError,hasKey:!!await readKey(),last:state.last||null,local:{dir:LOCALDIR,count:loc.length,bytes:loc.reduce((n,f)=>n+f.size,0),newest:loc[0]?.at||0,keep:LOCAL_KEEP,active:!pick?.renews||!pick?.drive},stale:staleBackup(Math.max(state.lastOkAt||0,state.last?.ok?state.last.at:0),state.since||Date.now()),test:state.test||null,running:Boolean(running),testing:Boolean(testing),preparing:Boolean(preparing),restoring:copying,
   restore:r,prepared:p?{id:p.id,name:p.name,local:p.local,at:p.at,preview:p.preview}:null,
   settings:s,keep:s.keep,where:'Google Drive › '+s.folder,account:pick?.email||'',google:{connected:!!pick&&pick.renews&&pick.drive,file:tokenFile(),email:pick?.email||'',drive:!!pick?.drive,renews:!!pick?.renews},accounts:acc}}
 // settled(): resolves when the Prepare or Restore running in the background has finished (tests wait on this, not on a timer)
 return {settled:()=>job||Promise.resolve(),following:()=>running||Promise.resolve(),startUp,tick,job:o=>job2(o),run,staleCheck,test,status,key,setKey,schedule,list,estimate,prepare,cancel,apply,recover,setSettings,accounts,busy:()=>copying,writesHeld:()=>held}}
