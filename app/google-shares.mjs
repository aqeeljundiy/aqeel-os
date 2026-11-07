// Shared Google logins without copies (5 Nov 2026, brief item 2). Before this, sharing a Google account copied the owner's
// whole sign-in (its refresh token, every scope) into the other agent's folder, and the Read level was only checked
// by one helper script, so any code an agent ran could send mail with it. Now only the owner's main agent holds
// the sign-in. An agent it is shared with gets a short-lived key Google itself limits to the agent's level, renewed
// by aqeelOS every 20 minutes; it holds no refresh token, so nothing can renew it but aqeelOS, and taking the share
// away ends it within the hour (the file goes at once). The key file looks like a normal sign-in file
// (google_token*.json) to every Google script the agents use, with "aqeelos_managed": true.
// Levels (Connections), as Google scopes (a subset of what the owner signed in with):
//   read  read mail and contacts
//   edit  + edit Sheets and Docs
//   draft + mail drafts, Drive, Calendar (not sending)
//   full  everything the owner signed in with
// 5 Nov 2026 (Phase 1 finish): agents also kept hand-placed full copies in their own workspace, where their commands run
// as the agent's own user: <workspace>/.tools/google_token*.json (read by .tools/sheet) and <workspace>/.hermes/ files the
// engine does not copy in itself. Those places get managed keys too (readable by the agent's user), renewed and removed
// with the rest. Note Google refuses read-only Sheets keys (the owner never signed in with them), so reading Sheets needs
// the edit level.
import {readFile,writeFile,rename,readdir,unlink,mkdir,copyFile,stat,chmod} from 'node:fs/promises';
import path from 'node:path';

const G='https://www.googleapis.com/auth/';
export const SCOPES={read:['gmail.readonly','contacts.readonly'],edit:['gmail.readonly','contacts.readonly','spreadsheets','documents'],
 draft:['gmail.readonly','contacts.readonly','spreadsheets','documents','gmail.modify','drive','calendar']};
export const RENEW_BEFORE=40*60e3;   // keys live 60 minutes; renewed when under 40 are left (every 20 minutes)
export const levelOfCan=can=>{const c=new Set(can||[]);return c.has('send')?'full':c.has('draft')?'draft':c.has('edit')?'edit':'read'};
// the scopes to ask Google for: the level's, limited to what the owner has (Google refuses anything else)
export function scopesFor(level,ownerScopes){const own=(ownerScopes||[]).map(String);if(level==='full')return own;
 const want=(SCOPES[level]||SCOPES.read).map(s=>G+s);return want.filter(s=>own.includes(s))}
const isToken=f=>/^google_token(_[\w.-]+)?\.json$/.test(f);

// held(agent): an agent locked to its own files (google-files.mjs) gets no key file at all; aqeelOS calls Google for it
export function createGoogleShares({HERMES_HOME,DATA,WORK=path.join(path.dirname(HERMES_HOME),'workspaces'),agents,levelOf,held=async()=>false,fetchImpl=fetch,now=()=>Date.now(),log=m=>console.log(m)}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 // a workspace file must stay readable by the agent's own user (the folder's shared group), a profile file only by aqeelOS
 const inWork=f=>f.startsWith(WORK+path.sep);
 const put=async(f,v)=>{const t=f+'.'+process.pid+'.'+Math.random().toString(36).slice(2,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,2),{mode:0o600});if(inWork(f))await chmod(t,0o660);await rename(t,f)};
 // the files the engine copies from the profile into the workspace .hermes itself (terminal.credential_files in config.yaml)
 async function engineCopies(a){const t=await readFile(path.join(home(a),'config.yaml'),'utf8').catch(()=>'');const m=/\n\s*credential_files:\s*\n((?:\s+-\s*\S+\s*\n)+)/.exec('\n'+t+'\n');
  return m?m[1].split('\n').map(l=>l.replace(/^\s*-\s*/,'').trim().replace(/^['"]|['"]$/g,'')).filter(Boolean):[]}
 // where an agent's key files can be: its profile, its workspace .tools, and workspace .hermes files the engine does not copy in
 async function places(a){const out=(await readdir(home(a)).catch(()=>[])).filter(isToken).map(f=>({dir:home(a),file:f,where:''}));const eng=await engineCopies(a);
  for(const sub of ['.tools','.hermes']){const d=path.join(WORK,a,sub);for(const f of (await readdir(d).catch(()=>[])).filter(isToken))if(sub==='.tools'||!eng.includes(f))out.push({dir:d,file:f,where:sub+'/'})}
  return out}
 // a migrate step's file: a key file name in the profile, or .tools/<name> or .hermes/<name> in the agent's workspace
 const where=(a,file)=>{const m=/^(?:(\.tools|\.hermes)\/)?(google_token(?:_[\w.-]+)?\.json)$/.exec(String(file||''));if(!m)throw Error('file is a google_token*.json name, or .tools/ or .hermes/ and one');
  return m[1]?path.join(WORK,a,m[1],m[2]):path.join(home(a),m[2])};
 // the owner's sign-ins (the main agent's own files, never a managed key), by email
 async function owners(){const out={};for(const f of (await readdir(HERMES_HOME).catch(()=>[])).filter(isToken)){const d=await readJson(path.join(HERMES_HOME,f));
  if(d&&!d.aqeelos_managed&&d.refresh_token&&d.account)out[String(d.account).toLowerCase()]={file:f,data:d}}return out}
 // every managed key on every agent: {agent,file,email,level,expiry}
 async function list(){const out=[];for(const a of await agents()){if(a==='default'||a.includes('--'))continue;
  for(const p of await places(a)){const d=await readJson(path.join(p.dir,p.file));if(d?.aqeelos_managed)out.push({agent:a,file:p.where+p.file,path:path.join(p.dir,p.file),email:String(d.account||'').toLowerCase(),level:d.aqeelos_level||'read',expiry:Date.parse(d.expiry||'')||0})}}
  return out}
 async function mint(owner,level){const d=owner.data;const scopes=scopesFor(level,d.scopes);if(!scopes.length)throw Error('The owner\'s Google sign-in has none of the scopes this level needs.');
  let cid=d.client_id,sec=d.client_secret;if(!cid||!sec){const c=await readJson(path.join(HERMES_HOME,'google_client_secret.json'));const x=c?.installed||c?.web||c||{};cid=cid||x.client_id;sec=sec||x.client_secret}
  const r=await fetchImpl(d.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:cid,client_secret:sec,refresh_token:d.refresh_token,grant_type:'refresh_token',scope:scopes.join(' ')}).toString(),signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.access_token)throw Error('Google refused a key ('+r.status+(j.error?' '+j.error:'')+')');
  return {type:'authorized_user',account:d.account,client_id:cid,client_secret:'',refresh_token:'',token:j.access_token,token_uri:d.token_uri||'https://oauth2.googleapis.com/token',
   universe_domain:d.universe_domain||'googleapis.com',scopes:String(j.scope||scopes.join(' ')).split(' ').filter(Boolean),expiry:new Date(now()+(Number(j.expires_in)||3600)*1000).toISOString().replace(/\.\d+Z$/,'.000000Z'),
   aqeelos_managed:true,aqeelos_level:level,aqeelos_note:'A short-lived key from aqeelOS (shared by the owner agent). It renews itself; do not copy it.'}}
 // share an account with an agent: a managed key file (never over a file that is not managed)
 async function share(email,agent){email=String(email).toLowerCase();const own=(await owners())[email];if(!own)throw Error('The owner agent has no Google sign-in for '+email+'.');
  if(await held(agent)){await unshare(email,agent);return {file:null,changed:false,held:true}}
  const dir=home(agent);await mkdir(dir,{recursive:true});const files=(await readdir(dir).catch(()=>[])).filter(isToken);
  for(const f of files){const d=await readJson(path.join(dir,f));if(String(d?.account||'').toLowerCase()===email){if(d.aqeelos_managed)return {file:f,changed:false};throw Error('This agent still has its own copy of '+email+' ('+f+'). Move it to a share first.')}}
  // the owner's own file name (the agents pick an account by it: --account elmora reads google_token_elmora.json)
  let f=own.file;if(files.includes(f)){const base='google_token_'+email.replace(/[^\w-]/g,'_');f=base+'.json';for(let n=2;files.includes(f);n++)f=base+'_'+n+'.json'}
  const level=await levelOf(email,agent);await put(path.join(dir,f),await mint(own,level));log('google share: '+email+' for '+agent+' ('+level+')');return {file:f,changed:true}}
 async function unshare(email,agent){email=String(email).toLowerCase();let n=0;
  for(const k of (await list()).filter(k=>k.agent===agent&&k.email===email)){await unlink(k.path).catch(()=>{});n++}return n}
 // keys near their end, or whose level changed, are renewed; a key whose owner sign-in is gone is removed
 // the owner's own sign-ins are aqeelOS's only: the engine rewrites them when it refreshes a sign-in and can leave them
 // group-readable (7 Nov 2026: 664), so every renewal locks them to the owner again
 async function renew(){const own=await owners();let renewed=0,removed=0;
  for(const o of Object.values(own)){const f=path.join(HERMES_HOME,o.file);try{if(((await stat(f)).mode&0o077)!==0){await chmod(f,0o600);log('google shares: '+o.file+' locked to the owner again')}}catch{}}
  for(const k of await list()){if(await held(k.agent)){await unlink(k.path).catch(()=>{});removed++;log('google share: '+k.email+' key removed from '+k.agent+' (locked to its own files; aqeelOS calls Google for it)');continue}
   const o=own[k.email];if(!o){await unlink(k.path).catch(()=>{});removed++;log('google share: '+k.email+' removed from '+k.agent+' (the owner has no sign-in for it any more)');continue}
   const level=await levelOf(k.email,k.agent).catch(()=>k.level);if(k.level===level&&k.expiry-now()>RENEW_BEFORE)continue;
   try{await put(k.path,await mint(o,level));renewed++}catch(e){log('google share: '+k.email+' for '+k.agent+': '+e.message)}}
  return {renewed,removed}}
 // an agent's own full copy of an account the owner has: kept in aqeelOS's backup, replaced by a managed key
 // a copy aqeelOS cannot read (a hand-placed file only the agent's user may open) is moved whole into the backup when the
 // step names its email; the folder lets aqeelOS move it, and the agent's user can still read the backup's owner field
 async function migrate(agent,file,email0){const p=where(agent,file);const d=await readJson(p);if(d?.aqeelos_managed)return {changed:false};
  let unreadable=false;if(!d){if(!email0)throw Error('The copy at '+file+' is missing or unreadable; name its email to replace it.');await stat(p);unreadable=true}
  const email=String(d?.account||email0||'').toLowerCase();if(d&&email0&&email!==String(email0).toLowerCase())throw Error('The copy at '+file+' is for '+email+', not '+email0+'.');
  const own=(await owners())[email];if(!own)throw Error('The owner agent has no sign-in for '+email+'; the copy stays.');
  const bk=path.join(DATA,'google-copies-backup');await mkdir(bk,{recursive:true,mode:0o700});const to=path.join(bk,agent+'__'+String(file).replace(/\//g,'_')+'.'+new Date(now()).toISOString().slice(0,10));
  const level=await levelOf(email,agent);const key=await mint(own,level);
  if(unreadable)await rename(p,to);else await copyFile(p,to);await put(p,key);log('google share: '+agent+'\'s own copy of '+email+' ('+file+') replaced by a shared key ('+level+')');return {changed:true,email,level,backup:path.basename(to)}}
 // a key kept in aqeelOS only (google-files.mjs), never written to an agent's folder; cached until 10 minutes before its end
 const cache=new Map();
 async function keyFor(email,level){email=String(email).toLowerCase();const c=cache.get(email+'|'+level);if(c&&c.until-now()>10*60e3)return c.token;
  const own=(await owners())[email];if(!own)throw Error('the owner agent has no Google sign-in for '+email);const k=await mint(own,level);
  cache.set(email+'|'+level,{token:k.token,until:Date.parse(k.expiry)||now()+3000e3});return k.token}
 return {owners,list,share,unshare,renew,migrate,keyFor}}
