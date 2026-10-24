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
 '*/home/.cache','*/home/.npm','.hermes/home/.cache','.hermes/home/.npm','node_modules','*.log','apps/hermes-ui-data/desktop','.claude/projects','.claude/shell-snapshots','.claude/statsig','.claude/todos'];
// what a restore must bring back for the box to work
const MUST=['.hermes/config.yaml','.hermes/.env','apps/hermes-ui-data/users.json','apps/hermes-ui.env'];

export function createBackups({DATA,HOME,HERMES_HOME,TOKEN='google_token_elkiya.json',notify=()=>{}}){
 const STATE=path.join(DATA,'backups.json'),KEYF=path.join(DATA,'backup-key');let state=null,running=null;
 const load=async()=>{if(!state){try{state=JSON.parse(await readFile(STATE,'utf8'))}catch{state={}}}return state};
 const save=async()=>{await writeFile(STATE,JSON.stringify(state,null,1))};
 // the key that encrypts every backup (made once; admins see it under System › Health to keep it somewhere safe)
 // a key that went missing after backups were made is never silently replaced: the old backups need the old key
 const made=()=>!!(state?.made||state?.last?.ok||state?.test?.ok);
 const NOKEY='The backup key file ('+KEYF+') is missing, and the backups already in Google Drive can only be opened with that key. Put it back from where you kept it; no new backup is made until then.';
 async function key(){await load();try{const k=(await readFile(KEYF,'utf8')).trim();if(k.length>=32)return k}catch{}if(made())throw Error(NOKEY);const k=randomBytes(24).toString('base64url');await writeFile(KEYF,k,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});await chmod(KEYF,0o600).catch(()=>{});return (await readFile(KEYF,'utf8')).trim()}
 // Google: an access token from the stored sign-in (refreshed here, the file is left as it is)
 async function google(){const t=JSON.parse(await readFile(path.join(HERMES_HOME,TOKEN),'utf8'));
  const r=await fetch(t.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:t.client_id,client_secret:t.client_secret,refresh_token:t.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  const j=await r.json();if(!j.access_token)throw Error('Google did not give access ('+(j.error_description||j.error||r.status)+'). Sign in to Google again for '+(t.account||'the backup account')+'.');return {token:j.access_token,account:t.account||''}}
 const drive=async(g,p,opt={})=>{const r=await fetch('https://www.googleapis.com/'+p,{...opt,headers:{authorization:'Bearer '+g.token,...(opt.headers||{})},signal:AbortSignal.timeout(opt.long?3600000:30000)});
  if(!r.ok)throw Error('Google Drive said '+r.status+': '+(await r.text()).slice(0,200));return opt.raw?r:r.json()};
 async function folder(g){const q=encodeURIComponent("name='aqeelOS backups' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents");
  const l=await drive(g,'drive/v3/files?q='+q+'&fields=files(id)');if(l.files?.[0])return l.files[0].id;
  return (await drive(g,'drive/v3/files',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'aqeelOS backups',mimeType:'application/vnd.google-apps.folder'})})).id}
 const sh=(cmd,envx)=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{cwd:HOME,env:{...process.env,...envx},stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',d=>err+=d);p.on('close',c=>c===0?res():rej(Error(err.trim().split('\n').slice(-2).join(' ')||'exit '+c)))});
 const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
 // pack, encrypt, upload, prune
 async function run(why='scheduled'){if(running)return running;running=(async()=>{await load();const at=Date.now();const name='aqeelos-'+new Date(at+7*3600e3).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.tar.gz.enc';const tmp=path.join('/tmp',name);
  try{const inc=[];for(const p of INCLUDE)if(await stat(path.join(HOME,p)).catch(()=>null))inc.push(p);
   // tar exits 1 when a file changes while it reads (fine for a backup); 2 means it could not read something, so the backup fails with tar's own words
   const terr=q(tmp+'.err');
   await sh('set -o pipefail; { tar -czf - '+EXCLUDE.map(e=>'--exclude='+q(e)).join(' ')+' '+inc.map(q).join(' ')+' 2>'+terr+'; c=$?; [ $c -le 1 ] || { tail -2 '+terr+' >&2; rm -f '+terr+'; exit $c; }; rm -f '+terr+'; } | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:AQ_BK -out '+q(tmp),{AQ_BK:await key()});
   const size=(await stat(tmp)).size;if(size<1e6)throw Error('The backup came out too small ('+size+' bytes).');
   const g=await google(),fid=await folder(g);
   const start=await drive(g,'upload/drive/v3/files?uploadType=resumable',{method:'POST',raw:true,headers:{'content-type':'application/json; charset=UTF-8','x-upload-content-type':'application/octet-stream','x-upload-content-length':String(size)},body:JSON.stringify({name,parents:[fid]})});
   const up=await fetch(start.headers.get('location'),{method:'PUT',headers:{'content-length':String(size),'content-type':'application/octet-stream'},body:Readable.toWeb(createReadStream(tmp)),duplex:'half',signal:AbortSignal.timeout(3600000)});
   if(!up.ok)throw Error('The upload stopped ('+up.status+').');const file=await up.json();
   // keep the newest 14 (older ones go to the Drive bin, where Google keeps them 30 more days)
   const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name)&pageSize=100');
   for(const f of (l.files||[]).slice(KEEP))await drive(g,'drive/v3/files/'+f.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({trashed:true})}).catch(()=>{});
   state.last={at,ok:true,name,size,id:file.id,account:g.account,why,secs:Math.round((Date.now()-at)/1000)};state.made=true;await save();console.log('backup: '+name+' ('+Math.round(size/1e6)+' MB) uploaded to Google Drive');return state.last}
  catch(e){state.last={at,ok:false,error:e.message,why};await save();console.warn('backup failed:',e.message);notify('Backup to Google Drive failed',e.message);throw e}
  finally{await rm(tmp,{force:true}).catch(()=>{});running=null}})();return running}
 // a restore test: the newest backup from Drive, decrypted and unpacked into a scratch folder, with the must-have files checked
 async function test(){await load();const at=Date.now();const dir=path.join('/tmp','aqeelos-restore-test-'+at),enc=dir+'.enc';
  try{const g=await google(),fid=await folder(g);const l=await drive(g,'drive/v3/files?q='+encodeURIComponent("'"+fid+"' in parents and trashed=false")+'&orderBy=createdTime desc&fields=files(id,name,size)&pageSize=1');const f=l.files?.[0];if(!f)throw Error('There is no backup in Google Drive yet.');
   const r=await drive(g,'drive/v3/files/'+f.id+'?alt=media',{raw:true,long:true});await pipeline(Readable.fromWeb(r.body),createWriteStream(enc));
   await mkdir(dir,{recursive:true});await sh('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+q(enc)+' | tar -xzf - -C '+q(dir),{AQ_BK:await key()});
   const missing=[];for(const m of MUST){const s=await stat(path.join(dir,m)).catch(()=>null);if(!s||!s.size)missing.push(m)}
   let agents=0;try{agents=(await readdir(path.join(dir,'.hermes','profiles'))).length+1}catch{}
   if(missing.length)throw Error('Missing after restore: '+missing.join(', '));
   state.test={at,ok:true,name:f.name,detail:'Unpacked '+f.name+': settings, people, aqeelOS data and '+agents+' agents are all there.'};await save();return state.test}
  catch(e){state.test={at,ok:false,error:e.message};await save();notify('The backup restore test failed',e.message);throw e}
  finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});await rm(enc,{force:true}).catch(()=>{})}}
 // 03:00 Jakarta every night; a restore test every Sunday after it
 function schedule(){const tick=async()=>{await load();const j=new Date(Date.now()+7*3600e3);const today=j.toISOString().slice(0,10);
   if(j.getUTCHours()===3&&(!state.last||new Date(state.last.at+7*3600e3).toISOString().slice(0,10)!==today||!state.last.ok&&Date.now()-state.last.at>3600e3)){try{await run();if(j.getUTCDay()===0)await test()}catch{}}};
  setInterval(()=>tick().catch(()=>{}),15*60e3).unref?.()}
 async function status(){await load();const keyError=made()&&!await readFile(KEYF,'utf8').then(k=>k.trim().length>=32,()=>false)?NOKEY:null;return {keyError,last:state.last||null,test:state.test||null,running:Boolean(running),keep:KEEP,where:'Google Drive › aqeelOS backups',account:await readFile(path.join(HERMES_HOME,TOKEN),'utf8').then(t=>JSON.parse(t).account||'').catch(()=>'')}}
 return {run,test,status,key,schedule}}
