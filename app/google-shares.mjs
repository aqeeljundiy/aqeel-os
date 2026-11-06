// Shared Google logins without copies (5 Nov 2026, brief item 2). Before this, sharing a Google account copied the owner's
// whole sign-in (its refresh token, every scope) into the other agent's folder, and the Read level was only checked
// by one helper script, so any code an agent ran could send mail with it. Now only the owner's agent (Donna) holds
// the sign-in. An agent it is shared with gets a short-lived key Google itself limits to the agent's level, renewed
// by aqeelOS every 20 minutes; it holds no refresh token, so nothing can renew it but aqeelOS, and taking the share
// away ends it within the hour (the file goes at once). The key file looks like a normal sign-in file
// (google_token*.json) to every Google script the agents use, with "aqeelos_managed": true.
// Levels (Connections), as Google scopes (a subset of what the owner signed in with):
//   read  read mail and contacts
//   edit  + edit Sheets and Docs
//   draft + mail drafts, Drive, Calendar (not sending)
//   full  everything the owner signed in with
import {readFile,writeFile,rename,readdir,unlink,mkdir,copyFile,stat} from 'node:fs/promises';
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
export function createGoogleShares({HERMES_HOME,DATA,agents,levelOf,held=async()=>false,fetchImpl=fetch,now=()=>Date.now(),log=m=>console.log(m)}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 const put=async(f,v)=>{const t=f+'.'+process.pid+'.'+Math.random().toString(36).slice(2,8)+'.tmp';await writeFile(t,JSON.stringify(v,null,2),{mode:0o600});await rename(t,f)};
 // the owner's sign-ins (the main agent's own files, never a managed key), by email
 async function owners(){const out={};for(const f of (await readdir(HERMES_HOME).catch(()=>[])).filter(isToken)){const d=await readJson(path.join(HERMES_HOME,f));
  if(d&&!d.aqeelos_managed&&d.refresh_token&&d.account)out[String(d.account).toLowerCase()]={file:f,data:d}}return out}
 // every managed key on every agent: {agent,file,email,level,expiry}
 async function list(){const out=[];for(const a of await agents()){if(a==='default'||a.includes('--'))continue;
  for(const f of (await readdir(home(a)).catch(()=>[])).filter(isToken)){const d=await readJson(path.join(home(a),f));if(d?.aqeelos_managed)out.push({agent:a,file:f,email:String(d.account||'').toLowerCase(),level:d.aqeelos_level||'read',expiry:Date.parse(d.expiry||'')||0})}}
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
  // the owner's own file name (the agents pick an account by it: --account elkiya reads google_token_elkiya.json)
  let f=own.file;if(files.includes(f)){const base='google_token_'+email.replace(/[^\w-]/g,'_');f=base+'.json';for(let n=2;files.includes(f);n++)f=base+'_'+n+'.json'}
  const level=await levelOf(email,agent);await put(path.join(dir,f),await mint(own,level));log('google share: '+email+' for '+agent+' ('+level+')');return {file:f,changed:true}}
 async function unshare(email,agent){email=String(email).toLowerCase();let n=0;
  for(const k of (await list()).filter(k=>k.agent===agent&&k.email===email)){await unlink(path.join(home(agent),k.file)).catch(()=>{});n++}return n}
 // keys near their end, or whose level changed, are renewed; a key whose owner sign-in is gone is removed
 async function renew(){const own=await owners();let renewed=0,removed=0;
  for(const k of await list()){if(await held(k.agent)){await unlink(path.join(home(k.agent),k.file)).catch(()=>{});removed++;log('google share: '+k.email+' key removed from '+k.agent+' (locked to its own files; aqeelOS calls Google for it)');continue}
   const o=own[k.email];if(!o){await unlink(path.join(home(k.agent),k.file)).catch(()=>{});removed++;log('google share: '+k.email+' removed from '+k.agent+' (the owner has no sign-in for it any more)');continue}
   const level=await levelOf(k.email,k.agent).catch(()=>k.level);if(k.level===level&&k.expiry-now()>RENEW_BEFORE)continue;
   try{await put(path.join(home(k.agent),k.file),await mint(o,level));renewed++}catch(e){log('google share: '+k.email+' for '+k.agent+': '+e.message)}}
  return {renewed,removed}}
 // an agent's own full copy of an account the owner has: kept in aqeelOS's backup, replaced by a managed key
 async function migrate(agent,file){const p=path.join(home(agent),file);const d=await readJson(p);if(!d||d.aqeelos_managed)return {changed:false};
  const email=String(d.account||'').toLowerCase();const own=(await owners())[email];if(!own)throw Error('The owner agent has no sign-in for '+email+'; the copy stays.');
  const bk=path.join(DATA,'google-copies-backup');await mkdir(bk,{recursive:true,mode:0o700});await copyFile(p,path.join(bk,agent+'__'+file+'.'+new Date(now()).toISOString().slice(0,10)));
  const level=await levelOf(email,agent);await put(p,await mint(own,level));log('google share: '+agent+'\'s own copy of '+email+' replaced by a shared key ('+level+')');return {changed:true,email,level}}
 // a key kept in aqeelOS only (google-files.mjs), never written to an agent's folder; cached until 10 minutes before its end
 const cache=new Map();
 async function keyFor(email,level){email=String(email).toLowerCase();const c=cache.get(email+'|'+level);if(c&&c.until-now()>10*60e3)return c.token;
  const own=(await owners())[email];if(!own)throw Error('the owner agent has no Google sign-in for '+email);const k=await mint(own,level);
  cache.set(email+'|'+level,{token:k.token,until:Date.parse(k.expiry)||now()+3000e3});return k.token}
 return {owners,list,share,unshare,renew,migrate,keyFor}}
