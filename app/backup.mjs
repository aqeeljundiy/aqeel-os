// Backups (SYS-44): every night at 03:00 Jakarta time the AI box's own data is packed, encrypted with the backup key
// and uploaded to Google Drive (folder "aqeelOS backups"). Inside: the agents (settings, memories, skills, chats,
// sign-ins), aqeelOS's data and settings, people's files and the coding tools' sign-ins. Left out: programs, caches and
// browser data, which are reinstalled. The newest 14 are kept; older ones go to the Drive bin. A restore test
// downloads the newest backup, decrypts and unpacks it into a scratch folder and checks the important files.
// Restoring a whole box: RESTORE.md.
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,rm,stat,readdir,chmod} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const KEEP=14;
const INCLUDE=['.hermes','apps/hermes-ui-data','apps/hermes-ui.env','workspaces','people','.claude','.claude-accounts'];
const EXCLUDE=['.hermes/installs','.hermes/hermes-agent','.hermes/tools','.hermes/cache','.hermes/lsp','*-venv','.hermes/bot-desktop','.hermes/profiles/*/cache','.hermes/profiles/*/bot-desktop',
 '*/home/.cache','*/home/.npm','.hermes/home/.cache','.hermes/home/.npm','node_modules','*.log','apps/hermes-ui-data/desktop','.claude/projects','.claude/shell-snapshots','.claude/statsig','.claude/todos',
 // rebuildable or junk, so a backup is ~9 GB instead of ~35 GB and uploads in time (31 Oct 2026): build output, caches, browser
 // caches (the browser profiles with their logins stay), runtimes aqeelOS or the guard can install again, old exports
 // (not 'out', 'build' or 'dist': Continue social keeps its finished videos in work/**/out)
 '.cache','.npm','.next','.turbo','.vercel','playwright-report','test-results','__pycache__',
 'Cache','Code Cache','GPUCache','CacheStorage','ScriptCache','GrShaderCache','ShaderCache','*venv.broken*','.claude/remote',
 '.hermes/home/.local','.hermes/profile-exports','workspaces/.aqeelos-python'];
/* Restore rules (1 Nov 2026, review). A restore copies the backup's .hermes over the box's with rsync and never deletes:
   - no --delete: a file that is on the box but not in the backup stays. That keeps agents made after the backup, files
     tar could not read when the backup was made (it skips them), sockets and everything the backup leaves out; what the
     backup holds goes back to how it was then. The price: a file deleted since the backup comes back.
   - the backup's left-out parts are not copied either: tar's --exclude lets * match /, rsync's does not, so a pattern with
     a / gets ** (profiles/*\/cache is any cache folder under profiles, like tar), and a .hermes/ path is anchored at the top.
   - running programs' pid and lock files and sockets stay the box's own.
   - a database file the backup holds has the box's -wal and -shm removed first, or SQLite would replay today's changes
     into the old file.
   - --ignore-times: every file the backup holds is copied, even one whose size and time match today's. */
export function restoreRules(exclude=EXCLUDE){
 const pats=exclude.filter(e=>!/^(apps|workspaces|\.claude)\//.test(e)).map(e=>{const top=e.startsWith('.hermes/');let x=top?e.slice(8):e;if(x.includes('/'))x=x.replace(/\*+/g,'**');return top&&!x.startsWith('**')?'/'+x:x});
 return ['-a','--ignore-times','--no-specials','--no-devices',...[...pats,'*.pid','*.lock','*.sock'].map(x=>'--exclude='+x)]}
// the database files in the backup whose -wal and -shm on the box must go before they are copied
export const dbFiles=paths=>paths.filter(f=>/\.(db|sqlite3?)$/.test(f));
// the space a restore needs before it starts (bytes): the download and the unpacked agents in /tmp (unpacked is up to about 2
// times the packed size, plus room to spare) and the safety copy of today's agents in the home folder (about the backup's size)
export function spaceNeeded(size,sameDisk){const tmp=size+size*2+2e9,home=size*1.2+1e9;return sameDisk?{tmp:tmp+home,home:tmp+home}:{tmp,home}}
// what a restore must bring back for the box to work
const MUST=['.hermes/config.yaml','.hermes/.env','apps/hermes-ui-data/users.json','apps/hermes-ui.env'];

export function createBackups({DATA,HOME,HERMES_HOME,TOKEN='google_token_elkiya.json',notify=()=>{},solved=()=>{},restored=()=>{},stopEngine=async()=>{},startEngine=async()=>{}}){
 const STATE=path.join(DATA,'backups.json'),KEYF=path.join(DATA,'backup-key');let state=null,running=null,restoring=null,testing=null;
 // a restore that was cut off (aqeelOS stopped halfway) is said so, and its leftovers in /tmp go
 const load=async()=>{if(!state){try{state=JSON.parse(await readFile(STATE,'utf8'))}catch{state={}}
   if(state.restore?.running){state.restore={...state.restore,running:false,ok:false,error:'Interrupted: aqeelOS stopped during the restore. If the agents are stopped, press Start under Start and stop agents'+(state.restore.safety?'; today\'s agents before it are in '+state.restore.safety:'')+'.'};await save().catch(()=>{});
    for(const f of await readdir('/tmp').catch(()=>[]))if(/^aqeelos-restore-\d+(\.enc)?$/.test(f))await rm(path.join('/tmp',f),{recursive:true,force:true}).catch(()=>{})}}return state};
 const save=async()=>{await writeFile(STATE,JSON.stringify(state,null,1))};
 // the key that encrypts every backup (made once; admins see it under System › Health to keep it somewhere safe)
 // a key that went missing after backups were made is never silently replaced: the old backups need the old key
 const made=()=>!!(state?.made||state?.last?.ok||state?.test?.ok);
 const NOKEY='The backup key file ('+KEYF+') is missing, and the backups already in Google Drive can only be opened with that key. Put it back from where you kept it; no new backup is made until then.';
 async function key(){await load();try{const k=(await readFile(KEYF,'utf8')).trim();if(k.length>=32)return k}catch{}if(made())throw Error(NOKEY);const k=randomBytes(24).toString('base64url');await writeFile(KEYF,k,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});await chmod(KEYF,0o600).catch(()=>{});return (await readFile(KEYF,'utf8')).trim()}
 // Google: an access token from the stored sign-in (refreshed here, the file is left as it is)
 async function google(){const t=JSON.parse(await readFile(path.join(HERMES_HOME,TOKEN),'utf8'));
  const r=await fetch(t.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:t.client_id,client_secret:t.client_secret,refresh_token:t.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  const j=await r.json();if(!j.access_token)throw Error('Google did not give access ('+String(j.error_description||j.error||r.status).replace(/\.$/,'')+'). Sign in to Google again for '+(t.account||'the backup account')+'.');return {token:j.access_token,account:t.account||''}}
 const drive=async(g,p,opt={})=>{const r=await fetch('https://www.googleapis.com/'+p,{...opt,headers:{authorization:'Bearer '+g.token,...(opt.headers||{})},signal:AbortSignal.timeout(opt.long?3600000:30000)});
  if(!r.ok)throw Error('Google Drive said '+r.status+': '+(await r.text()).slice(0,200));return opt.raw?r:r.json()};
 async function folder(g){const q=encodeURIComponent("name='aqeelOS backups' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents");
  const l=await drive(g,'drive/v3/files?q='+q+'&fields=files(id)');if(l.files?.[0])return l.files[0].id;
  return (await drive(g,'drive/v3/files',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'aqeelOS backups',mimeType:'application/vnd.google-apps.folder'})})).id}
 const sh=(cmd,envx)=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{cwd:HOME,env:{...process.env,...envx},stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d);p.on('close',c=>c===0?res():rej(Error(err.trim().split('\n').slice(-2).join(' ')||'exit '+c)))});
 const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
 const sh2=cmd=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{cwd:HOME,stdio:['ignore','pipe','pipe']});let o='',err='';p.stdout.on('data',d=>o+=d);p.stderr.on('data',d=>err+=d);p.on('close',c=>c===0?res(o):rej(Error(err.trim().split('\n').pop()||'exit '+c)))});
 // the upload in 64 MB pieces on Google's resumable session: one dropped connection no longer loses a multi-GB upload
 // ("fetch failed", "aborted due to timeout" on 30 and 31 Oct 2026). A failed piece asks Google how much it has and goes on
 // from there, up to 5 times in a row
 async function sendFile(loc,file,size){const PIECE=64*1024*1024;let at=0,fails=0;
  const have=async()=>{const r=await fetch(loc,{method:'PUT',headers:{'content-length':'0','content-range':'bytes */'+size},signal:AbortSignal.timeout(60000)});
   if(r.ok)return {done:await r.json()};if(r.status!==308)throw Error('Google lost the upload ('+r.status+').');const g=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');return {at:g?Number(g[1])+1:0}};
  while(true){const end=Math.min(at+PIECE,size)-1;
   try{const r=await fetch(loc,{method:'PUT',headers:{'content-length':String(end-at+1),'content-range':'bytes '+at+'-'+end+'/'+size,'content-type':'application/octet-stream'},body:Readable.toWeb(createReadStream(file,{start:at,end})),duplex:'half',signal:AbortSignal.timeout(15*60000)});
    if(r.ok)return await r.json();if(r.status!==308)throw Error('The upload stopped ('+r.status+').');const g=/bytes=0-(\d+)/.exec(r.headers.get('range')||'');at=g?Number(g[1])+1:end+1;fails=0}
   catch(e){if(++fails>5)throw Error('The upload kept dropping: '+e.message);await new Promise(r=>setTimeout(r,fails*15000));const h=await have().catch(()=>null);if(h?.done)return h.done;if(h)at=h.at}}}
 // each isolated agent (terminal over SSH as its own ag-* user) re-grants aqeelOS read access to the files it owns
 async function grantRead(){const prof=path.join(HOME,'.hermes','profiles');for(const a of await readdir(prof).catch(()=>[])){
  const y=await readFile(path.join(prof,a,'config.yaml'),'utf8').catch(()=>'');const u=/\n\s*ssh_user:\s*['"]?(ag-[\w-]+)/.exec(y)?.[1],k=/\n\s*ssh_key:\s*['"]?([^'"\n]+)/.exec(y)?.[1]?.trim(),ws=path.join(HOME,'workspaces',a);
  if(!u||!k||!await stat(ws).catch(()=>null))continue;
  await sh('ssh -i '+q(k)+' -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=15 '+q(u+'@127.0.0.1')+' '+q('find '+q(ws)+' -user '+u+' \\( -type d -o -type f \\) -print0 2>/dev/null | xargs -0 -r setfacl -m u:claude:rwX,m::rwX 2>/dev/null; true')).catch(e=>console.warn('backup: read access for',a,e.message))}}
 // pack, encrypt, upload, prune
 async function run(why='scheduled'){if(restoring)throw Error('A restore is running. Back up after it finishes.');if(running)return running;running=(async()=>{await load();const at=Date.now();const name='aqeelos-'+new Date(at+7*3600e3).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.tar.gz.enc';const tmp=path.join('/tmp',name);
  try{const inc=[];for(const p of INCLUDE)if(await stat(path.join(HOME,p)).catch(()=>null))inc.push(p);
   // agents with their own Linux user own their workspace files, and some programs write them private, so tar could not
   // read them and every nightly backup failed from 24 Oct (30 Oct 2026). Before packing, each agent's own user (the SSH
   // login its terminal already uses) gives aqeelOS read access to its files again; the owner of a file may do that
   await grantRead();
   // tar exits 1 when a file changes while it reads (fine for a backup). A file that still can't be read (a browser's lock
   // link) is skipped and counted instead of failing the whole backup; anything else tar can't do still fails it
   const terr=q(tmp+'.err'),tcnt=q(tmp+'.skipped');
   await sh('set -o pipefail; { tar -czf - --ignore-failed-read '+EXCLUDE.map(e=>'--exclude='+q(e)).join(' ')+' '+inc.map(q).join(' ')+' 2>'+terr+'; c=$?; grep -c "Cannot open\\|Cannot stat\\|Cannot read" '+terr+' >'+tcnt+'; [ $c -le 1 ] || { grep -v "socket ignored\\|Cannot open\\|Cannot stat\\|Cannot read" '+terr+' | tail -2 >&2; rm -f '+terr+'; exit $c; }; rm -f '+terr+'; } | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:AQ_BK -out '+q(tmp),{AQ_BK:await key()});
   const skipped=Number((await readFile(tmp+'.skipped','utf8').catch(()=>'0')).trim())||0;await rm(tmp+'.skipped',{force:true}).catch(()=>{});
   const size=(await stat(tmp)).size;if(size<1e6)throw Error('The backup came out too small ('+size+' bytes).');
   const g=await google(),fid=await folder(g);
   const start=await drive(g,'upload/drive/v3/files?uploadType=resumable',{method:'POST',raw:true,headers:{'content-type':'application/json; charset=UTF-8','x-upload-content-type':'application/octet-stream','x-upload-content-length':String(size)},body:JSON.stringify({name,parents:[fid]})});
   const file=await sendFile(start.headers.get('location'),tmp,size);
   // keep the newest 14 (older ones go to the Drive bin, where Google keeps them 30 more days)
   const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name)&pageSize=100');
   for(const f of (l.files||[]).slice(KEEP))await drive(g,'drive/v3/files/'+f.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({trashed:true})}).catch(()=>{});
   state.last={at,ok:true,name,size,id:file.id,account:g.account,why,secs:Math.round((Date.now()-at)/1000),skipped};state.made=true;await save();console.log('backup: '+name+' ('+Math.round(size/1e6)+' MB) uploaded to Google Drive'+(skipped?', '+skipped+' unreadable file(s) skipped':''));solved();return state.last}
  // a failed scheduled backup is tried again within the hour, 3 times a morning; only the third failure is told (a
  // dropped upload is usually gone an hour later). A manual one shows its result on Health, so it never goes to Bottlenecks
  catch(e){const day=new Date(at+7*3600e3).toISOString().slice(0,10);state.tries=state.tries?.day===day?{day,n:state.tries.n+1}:{day,n:1};
   state.last={at,ok:false,error:e.message,why};await save();console.warn('backup failed ('+state.tries.n+' today):',e.message);if(why==='scheduled'&&state.tries.n>=3)notify('Backup to Google Drive failed 3 times this morning',e.message);throw e}
  finally{await rm(tmp,{force:true}).catch(()=>{});running=null}})();return running}
 // a restore test: the newest backup from Drive, decrypted and unpacked into a scratch folder, with the must-have files checked
 async function test(){if(restoring)throw Error('A restore is running. Test after it finishes.');if(testing)return testing;testing=(async()=>{await load();const at=Date.now();const dir=path.join('/tmp','aqeelos-restore-test-'+at),enc=dir+'.enc';
  try{const g=await google(),fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size)&pageSize=1');const f=l.files?.[0];if(!f)throw Error('There is no backup in Google Drive yet.');
   const r=await drive(g,'drive/v3/files/'+f.id+'?alt=media',{raw:true,long:true});await pipeline(Readable.fromWeb(r.body),createWriteStream(enc));
   await mkdir(dir,{recursive:true});await sh('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+q(enc)+' | tar -xzf - -C '+q(dir),{AQ_BK:await key()});
   const missing=[];for(const m of MUST){const s=await stat(path.join(dir,m)).catch(()=>null);if(!s||!s.size)missing.push(m)}
   let agents=0;try{agents=(await readdir(path.join(dir,'.hermes','profiles'))).length+1}catch{}
   if(missing.length)throw Error('Missing after restore: '+missing.join(', '));
   state.test={at,ok:true,name:f.name,detail:'Unpacked '+f.name+': settings, people, aqeelOS data and '+agents+' agents are all there.'};await save();return state.test}
  catch(e){state.test={at,ok:false,error:e.message};await save();notify('The backup restore test failed',e.message);throw e}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});await rm(enc,{force:true}).catch(()=>{})}})().finally(()=>{testing=null});return testing}
 // the backups in Drive, newest first, for Restore… on System › Health (1 Nov 2026)
 async function list(){const g=await google(),fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size,createdTime)&pageSize=30');
  return (l.files||[]).map(f=>({id:f.id,name:f.name,size:Number(f.size)||0,at:Date.parse(f.createdTime)||0}))}
 /* Restore (1 Nov 2026, one Restore… for every backup): the agents come back from one Drive backup: their settings, skills,
    memories, chats and sign-ins (the .hermes part). It is downloaded, decrypted and unpacked into a scratch folder first and
    checked like a restore test; only then the agents stop, their files are replaced (programs, caches and logs, which a
    backup leaves out, stay as they are) and they start again. aqeelOS's own data and people's files are left alone, so
    nobody is signed out halfway; a whole new box is set up from a backup by hand. */
 // free space on the disk that holds dir (bytes), and which disk it is
 const disk=async dir=>{const o=await new Promise(res=>{const p=spawn('df',['-Pk',dir]);let t='';p.stdout.on('data',d=>t+=d);p.on('close',()=>res(t))});const l=o.trim().split('\n')[1]?.split(/\s+/)||[];return {free:Number(l[3])*1024||0,dev:l[0]||dir}};
 async function restore(id){if(restoring||running||testing)throw Error(restoring?'A restore is already running.':running?'A backup is running. Wait for it to finish.':'A restore test is running. Wait for it to finish.');
  // taken before the first wait, so a second click (or a backup) can't slip in while Drive is asked
  let go;restoring=new Promise(r=>go=r);const at=Date.now(),dir=path.join('/tmp','aqeelos-restore-'+at),enc=dir+'.enc';let f;
  try{await load();const g=await google(),fid=await folder(g);f=await drive(g,'drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,parents,size');if(!(f.parents||[]).includes(fid))throw Error('That file is not one of the backups.');
   const size=Number(f.size)||0,[t,h]=await Promise.all([disk('/tmp'),disk(HOME)]),need=spaceNeeded(size,t.dev===h.dev),gb=n=>(n/1e9).toFixed(1)+' GB';
   if(t.free<need.tmp||h.free<need.home)throw Error('Not enough free space: a restore of this backup needs about '+gb(need.tmp)+' in /tmp'+(t.dev===h.dev?'':' and '+gb(need.home)+' in the home folder')+', and there is '+gb(t.free)+(t.dev===h.dev?'':' and '+gb(h.free))+'. Nothing was changed.');
   state.restore={at,running:true,name:f.name};await save()}
  catch(e){restoring=null;go();throw e}
  (async()=>{let stopped=false;try{const r=await drive(await google(),'drive/v3/files/'+f.id+'?alt=media',{raw:true,long:true});await pipeline(Readable.fromWeb(r.body),createWriteStream(enc));
    await mkdir(dir,{recursive:true});await sh('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+q(enc)+' | tar -xzf - -C '+q(dir)+' .hermes',{AQ_BK:await key()});await rm(enc,{force:true});
    const s=await stat(path.join(dir,'.hermes','config.yaml')).catch(()=>null);if(!s?.size)throw Error('The backup has no agent settings, so nothing was changed.');
    // a restore can't be undone, so today's agents are packed first (1 Nov 2026, review): the same parts a backup takes,
    // into the home folder outside .hermes (the restore never touches it); the newest two such copies are kept
    const safety=path.join(HOME,'aqeelos-before-restore-'+new Date(at+7*3600e3).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.tar.gz');
    await sh('set -o pipefail; tar -czf '+q(safety)+' --ignore-failed-read '+EXCLUDE.filter(e=>!/^(apps|workspaces|\.claude)\//.test(e)).map(e=>'--exclude='+q(e)).join(' ')+' .hermes; c=$?; [ $c -le 1 ] || exit $c');
    await sh('ls -1t '+q(HOME)+'/aqeelos-before-restore-*.tar.gz 2>/dev/null | tail -n +3 | xargs -r rm -f');
    state.restore={...state.restore,safety};await save();
    const dbs=dbFiles((await sh2('cd '+q(path.join(dir,'.hermes'))+' && find . -type f')).split('\n').map(x=>x.replace(/^\.\//,'')).filter(Boolean));
    // the agents and the engine's dashboard both keep the databases and settings open: both stop, both start after
    stopped=true;await stopEngine();
    for(const d of dbs)for(const x of ['-wal','-shm'])await rm(path.join(HERMES_HOME,d+x),{force:true});
    await sh('command -v rsync >/dev/null || { echo "rsync is not installed on the box" >&2; exit 1; }; rsync '+restoreRules().map(q).join(' ')+' '+q(path.join(dir,'.hermes')+'/')+' '+q(HERMES_HOME+'/'));
    state.restore={at,ok:true,name:f.name,safety,secs:Math.round((Date.now()-at)/1000)};await save();console.log('backup: restored the agents from',f.name);
    restored(true,'The agents were restored from '+f.name,'Today\'s agents before it are kept in '+safety+'.')}
   catch(e){state.restore={at,ok:false,name:f.name,error:e.message,...(state.restore?.safety?{safety:state.restore.safety}:{})};await save();console.warn('backup: restore failed:',e.message);
    restored(false,'The restore from '+f.name+' did not finish',e.message+(stopped?' The agents were started again.':' Nothing was changed.'))}
   finally{if(stopped)await startEngine().catch(e=>console.warn('backup: starting the agents after the restore',e.message));await rm(dir,{recursive:true,force:true}).catch(()=>{});await rm(enc,{force:true}).catch(()=>{});restoring=null;go()}})();
  return {started:true,name:f.name}}
 // 03:00 Jakarta every night; a restore test every Sunday after it
 function schedule(){const tick=async()=>{await load();const j=new Date(Date.now()+7*3600e3);const today=j.toISOString().slice(0,10);
   const tries=state.tries?.day===today?state.tries.n:0,doneToday=state.last?.ok&&new Date(state.last.at+7*3600e3).toISOString().slice(0,10)===today;
   if(j.getUTCHours()>=3&&j.getUTCHours()<9&&!doneToday&&tries<3&&(!state.last||state.last.ok||Date.now()-state.last.at>3600e3)){try{await run();if(j.getUTCDay()===0)await test()}catch{}}};
  setInterval(()=>tick().catch(()=>{}),15*60e3).unref?.()}
 async function status(){await load();const keyError=made()&&!await readFile(KEYF,'utf8').then(k=>k.trim().length>=32,()=>false)?NOKEY:null;return {keyError,last:state.last||null,test:state.test||null,running:Boolean(running),testing:Boolean(testing),restoring:Boolean(restoring),restore:restoring?state.restore:state.restore?.running?null:state.restore||null,keep:KEEP,where:'Google Drive › aqeelOS backups',account:await readFile(path.join(HERMES_HOME,TOKEN),'utf8').then(t=>JSON.parse(t).account||'').catch(()=>'')}}
 return {run,test,status,key,schedule,list,restore,busy:()=>!!restoring}}
