// Connect Google in the app (7 Nov 2026): the owner uploads the OAuth client (one JSON file from Google Cloud), then
// "Connect Google" opens Google's sign-in and aqeelOS writes the sign-in itself, in the same file and format the Google
// Workspace skill writes (google_token[_<name>].json in the agent's engine home, type authorized_user), so the agents'
// Google tools, Google shares (google-shares.mjs) and Backups (backup.mjs) all use it with no agent, file or command.
// - A "Web application" client comes back to <PUBLIC_URL>/google-oauth/callback and finishes by itself.
// - A "Desktop app" client can only go back to http://localhost: the browser then shows an error page and the owner
//   pastes that page's address into the dialog, which finishes the same way.
// Reconnect signs the same account in again into the same file; Remove deletes the file (Google is not told, so other
// agents that use the same Google account keep working).
import {readFile,writeFile,mkdir,rename,unlink,readdir,chmod} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';

export const SERVICES={
 gmail:{label:'Gmail',scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify']},
 calendar:{label:'Calendar',scopes:['https://www.googleapis.com/auth/calendar']},
 drive:{label:'Drive',scopes:['https://www.googleapis.com/auth/drive']},
 sheets:{label:'Sheets',scopes:['https://www.googleapis.com/auth/spreadsheets']},
 docs:{label:'Docs',scopes:['https://www.googleapis.com/auth/documents']},
 contacts:{label:'Contacts',scopes:['https://www.googleapis.com/auth/contacts.readonly']}};
const ID_SCOPES=['openid','https://www.googleapis.com/auth/userinfo.email'];
const AUTH='https://accounts.google.com/o/oauth2/v2/auth',TOKEN='https://oauth2.googleapis.com/token';
const TTL=20*60e3;
export const isTokenFile=f=>/^google_token(?:_[\w.-]+)?\.json$/.test(f);
export const fileFor=name=>'google_token'+(name?'_'+name:'')+'.json';
// a short account name people type ("Work", "client a") as the skill's --account name: work, client-a
export const cleanName=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
// what a sign-in may do, in words: the services its scopes cover
export function servicesOf(scopes=[]){const s=new Set(scopes.map(String));return Object.entries(SERVICES).filter(([,v])=>v.scopes.some(x=>s.has(x))).map(([k])=>k)}
export function scopesFor(services){const l=(services?.length?services:Object.keys(SERVICES)).filter(k=>SERVICES[k]);if(!l.length)throw Error('Pick at least one Google service.');return [...new Set([...ID_SCOPES,...l.flatMap(k=>SERVICES[k].scopes)])]}
// the client file Google gives you: {"web":{...}} or {"installed":{...}}; anything else is said plainly
export function parseClient(text){let j;try{j=typeof text==='string'?JSON.parse(text):text}catch{throw Error('That is not the JSON file from Google Cloud. Download it again with the download button next to the client.')}
 const type=j?.web?'web':j?.installed?'installed':null,c=j?.web||j?.installed;
 if(!type||!c?.client_id||!c?.client_secret)throw Error(j?.type==='service_account'?'That is a service account key. Make an OAuth client ID instead (step 3).':'The file has no client ID and secret. Download the OAuth client JSON from Google Cloud › Credentials.');
 if(!/\.apps\.googleusercontent\.com$/.test(c.client_id))throw Error('The client ID in that file does not look like a Google OAuth client.');
 return {type,client_id:c.client_id,client_secret:c.client_secret,project:c.project_id||'',redirects:c.redirect_uris||[]}}
const b64u=b=>Buffer.from(b).toString('base64url');
// the email inside Google's id_token (it comes straight from Google over TLS, so it is read, not verified again)
export function emailOf(idToken){try{return String(JSON.parse(Buffer.from(String(idToken).split('.')[1],'base64url').toString('utf8')).email||'').toLowerCase()}catch{return ''}}
// code and state from the address the browser ended on (a pasted http://localhost/?state=…&code=… or the callback's search)
export function codeFrom(input){const s=String(input||'').trim();let q;try{q=new URL(s).searchParams}catch{q=new URLSearchParams(s.replace(/^[^?]*\?/,''))}
 return {code:q.get('code')||'',state:q.get('state')||'',error:q.get('error')||'',scope:q.get('scope')||''}}

export function createGoogleConnect({HERMES_HOME,DATA,PUBLIC_URL,homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),fetchImpl=fetch,now=()=>Date.now(),log=()=>{}}){
 const CLIENT=path.join(HERMES_HOME,'google_client_secret.json'),PEND=path.join(DATA,'google-connect.json');
 // the address is read each time (it can be an app setting, or an object that reads as the current address)
 const redirectUri=()=>String(typeof PUBLIC_URL==='function'?PUBLIC_URL():PUBLIC_URL).replace(/\/$/,'')+'/google-oauth/callback';
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 const put=async(f,v)=>{await mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(v,null,2),{mode:0o600});await chmod(t,0o600).catch(()=>{});await rename(t,f)};
 let pend=null;const load=async()=>{pend??=(await readJson(PEND))||{};const t=now();for(const [k,v] of Object.entries(pend))if(t-(v.at||0)>TTL)delete pend[k];return pend};
 const saveP=()=>put(PEND,pend);
 async function client(){const j=await readJson(CLIENT);if(!j)return null;try{return parseClient(j)}catch{return null}}
 // what the setup dialog shows: whether there is a client, which kind, and the address to give Google
 async function info(){const c=await client(),REDIRECT=redirectUri();return {client:c?{type:c.type,id:c.client_id.replace(/^(\d{4})\d*/,'$1…'),project:c.project,redirectOk:c.type!=='web'||!c.redirects.length||c.redirects.includes(REDIRECT)}:null,redirect:REDIRECT,services:Object.fromEntries(Object.entries(SERVICES).map(([k,v])=>[k,v.label]))}}
 async function saveClient(text){const c=parseClient(text);const j=typeof text==='string'?JSON.parse(text):text;await put(CLIENT,j);log('google: OAuth client saved ('+c.type+', '+c.project+')');return info()}
 async function removeClient(){await unlink(CLIENT).catch(()=>{});log('google: OAuth client removed');return info()}
 // every sign-in an agent has (never a share: those are short-lived keys aqeelOS makes from the owner's)
 async function accounts(agent){const home=homeOf(agent),out=[];
  for(const f of (await readdir(home).catch(()=>[])).filter(isTokenFile).sort()){const d=await readJson(path.join(home,f));if(!d||d.aqeelos_managed)continue;
   const name=/^google_token(?:_([\w.-]+))?\.json$/.exec(f)[1]||'';out.push({agent,name,file:f,email:String(d.account||'').toLowerCase(),services:servicesOf(d.scopes||[]),scopes:(d.scopes||[]).map(s=>String(s).split('/').pop()),renews:!!d.refresh_token,by:d.aqeelos_connected?'app':'agent'})}
  return out}
 // Connect / Reconnect: Google's sign-in address for this agent and account name
 async function start({agent='default',name='',services,reconnect=false}){const c=await client();if(!c)throw Error('Add the Google client file first (step 1).');
  name=cleanName(name);const have=await accounts(agent);let hint='';
  if(reconnect){const x=have.find(a=>a.name===name);if(!x)throw Error('That Google account is not on this agent any more. Reload the page.');hint=x.email;if(!services?.length)services=x.services}
  else if(have.some(a=>a.name===name)&&(name||have.length))throw Error(name?'This agent already has a Google account called '+name+'. Pick another name, or use Reconnect on it.':'This agent already has a main Google account. Give this one a short name, like work.');
  const scopes=scopesFor(services),state=b64u(randomBytes(18)),verifier=b64u(randomBytes(40)),challenge=b64u(createHash('sha256').update(verifier).digest());
  const redirect=c.type==='web'?redirectUri():'http://localhost';
  await load();pend[state]={agent,name,scopes,verifier,redirect,reconnect,hint,at:now()};await saveP();
  const q=new URLSearchParams({client_id:c.client_id,redirect_uri:redirect,response_type:'code',scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent',include_granted_scopes:'true',...(hint?{login_hint:hint}:{})});
  return {url:AUTH+'?'+q,state,paste:c.type!=='web'}}
 const has=async state=>!!(await load())[state]?.verifier;
 // the code back from Google (the callback, or the address the owner pasted): the sign-in file is written
 async function finish(input){const {code,state,error}=codeFrom(input);await load();const p=pend[state];
  if(!p||!p.verifier)throw Error('This sign-in link has expired or was already used. Press Connect again.');
  const done=(r)=>{pend[state]={...p,verifier:null,result:r,at:now()};return saveP().then(()=>r)};
  if(error){await done({ok:false,error:error==='access_denied'?'You pressed Cancel on Google, so nothing was connected.':'Google said '+error+'.'});throw Error(pend[state].result.error)}
  if(!code)throw Error('That address has no sign-in code in it. Copy the whole address from the page Google sent you to.');
  const c=await client();if(!c){await done({ok:false,error:'The Google client file was removed meanwhile.'});throw Error('The Google client file was removed meanwhile.')}
  const r=await fetchImpl(TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:c.client_id,client_secret:c.client_secret,redirect_uri:p.redirect,grant_type:'authorization_code',code_verifier:p.verifier}).toString(),signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token){const why=j.error==='invalid_grant'?'The code was already used or is too old. Press Connect again.':j.error==='redirect_uri_mismatch'?'Google does not know this address as a redirect. Add '+p.redirect+' to the client (step 4).':'Google refused the sign-in ('+(j.error_description||j.error||r.status)+').';await done({ok:false,error:why});throw Error(why)}
  const email=emailOf(j.id_token)||String(await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:'Bearer '+j.access_token},signal:AbortSignal.timeout(15000)}).then(x=>x.json()).then(x=>x.email||'',()=>'')).toLowerCase();
  const home=homeOf(p.agent),have=await accounts(p.agent);
  if(p.reconnect&&p.hint&&email&&email!==p.hint){const why='You signed in as '+email+', but this account is '+p.hint+'. Press Reconnect and pick '+p.hint+' on Google.';await done({ok:false,error:why});throw Error(why)}
  // the same Google account already on this agent under another name: that file is renewed, never a second copy
  const same=!p.reconnect&&email&&have.find(a=>a.email===email);const name=same?same.name:p.name;
  const granted=String(j.scope||p.scopes.join(' ')).split(' ').filter(Boolean);
  if(!j.refresh_token){const why='Google gave no lasting sign-in. Remove aqeelOS under myaccount.google.com › Security › Third-party access, then press Connect again.';await done({ok:false,error:why});throw Error(why)}
  const tok={type:'authorized_user',account:email,client_id:c.client_id,client_secret:c.client_secret,refresh_token:j.refresh_token,token:j.access_token,token_uri:TOKEN,universe_domain:'googleapis.com',
   scopes:granted,expiry:new Date(now()+(Number(j.expires_in)||3600)*1000).toISOString().replace(/\.\d+Z$/,'.000000Z'),aqeelos_connected:now()};
  await mkdir(home,{recursive:true});await put(path.join(home,fileFor(name)),tok);
  log('google: '+(email||'an account')+' connected to '+p.agent+' as '+fileFor(name)+(p.reconnect?' (reconnect)':''));
  return done({ok:true,agent:p.agent,name,file:fileFor(name),email,services:servicesOf(granted),renewed:!!same})}
 // the dialog asks until the sign-in is done (the tab with Google is another window)
 async function result(state){const p=(await load())[state];if(!p)return {ok:false,error:'This sign-in expired. Press Connect again.'};return p.result||{waiting:true}}
 // a sign-in still works: Google gives a new access token from it (nothing is written)
 async function check(agent,name){const f=path.join(homeOf(agent),fileFor(cleanName(name)));const d=await readJson(f);if(!d)throw Error('That Google account is gone. Reload the page.');
  if(!d.refresh_token)return {ok:false,why:'It has no lasting sign-in. Press Reconnect.'};
  let cid=d.client_id,sec=d.client_secret;if(!cid||!sec){const c=await client();cid||=c?.client_id;sec||=c?.client_secret}
  const r=await fetchImpl(d.token_uri||TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cid||'',client_secret:sec||'',refresh_token:d.refresh_token,grant_type:'refresh_token'}).toString(),signal:AbortSignal.timeout(20000)}).catch(e=>({ok:false,json:async()=>({error:e.message})}));
  const j=await r.json().catch(()=>({}));if(j.access_token)return {ok:true};
  return {ok:false,why:j.error==='invalid_grant'?'Google ended this sign-in (password changed, access removed, or unused for 6 months). Press Reconnect.':j.error==='invalid_client'||j.error==='unauthorized_client'?'The Google client it was made with is gone or changed. Press Reconnect.':'Google did not answer ('+(j.error_description||j.error||r.status)+').'}}
 async function remove(agent,name){name=cleanName(name);const f=path.join(homeOf(agent),fileFor(name));const d=await readJson(f);if(!d)return {ok:true};if(d.aqeelos_managed)throw Error('That is a share. Change it under Connections.');await unlink(f);log('google: '+(d.account||fileFor(name))+' removed from '+agent);return {ok:true,email:d.account||''}}
 return {info,saveClient,removeClient,accounts,start,has,finish,result,check,remove,redirectUri}}
