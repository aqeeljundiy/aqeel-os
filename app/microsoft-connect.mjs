// Connect Microsoft 365 in the app (11 Nov 2026), built like Connect Google (google-connect.mjs). Microsoft has no
// remote MCP an ordinary install can use (Work IQ MCP needs a work tenant, an admin and Microsoft 365 Copilot), so
// aqeelOS signs in to Microsoft Graph itself:
// - Once per install an admin registers one app in Microsoft Entra (portal.azure.com › App registrations: any
//   organisation and personal accounts, Web return address <PUBLIC_URL>/microsoft-oauth/callback, a client secret)
//   and pastes its Application (client) ID and the secret's Value. Kept in HERMES_HOME/microsoft_client.json (0600).
// - "Connect Microsoft" opens Microsoft's sign-in (PKCE, offline_access) and the callback writes the sign-in for that
//   agent: microsoft_token[_<name>].json in the agent's engine home, with what it may use (Mail, Calendar, Files).
// - Check renews the sign-in once (Microsoft hands a new refresh token each time, which is saved); Remove deletes the file.
// The agents' Outlook, Calendar and OneDrive tools that read these files are a follow-up (docs/microsoft-setup.md).
import {readFile,writeFile,mkdir,rename,unlink,readdir,chmod} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';

export const SERVICES={
 mail:{label:'Outlook mail',scopes:['Mail.ReadWrite','Mail.Send']},
 calendar:{label:'Calendar',scopes:['Calendars.ReadWrite']},
 files:{label:'OneDrive files',scopes:['Files.ReadWrite.All']}};
const ID_SCOPES=['openid','profile','email','offline_access','User.Read'];
const LOGIN='https://login.microsoftonline.com/';
const TTL=20*60e3;
const GUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTokenFile=f=>/^microsoft_token(?:_[\w.-]+)?\.json$/.test(f);
export const fileFor=name=>'microsoft_token'+(name?'_'+name:'')+'.json';
export const cleanName=s=>String(s||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
export const authUrl=t=>LOGIN+encodeURIComponent(t||'common')+'/oauth2/v2.0/authorize';
export const tokenUrl=t=>LOGIN+encodeURIComponent(t||'common')+'/oauth2/v2.0/token';
const short=s=>String(s).replace(/^https:\/\/graph\.microsoft\.com\//i,'');
export function servicesOf(scopes=[]){const s=new Set(scopes.map(x=>short(x).toLowerCase()));return Object.entries(SERVICES).filter(([,v])=>v.scopes.some(x=>s.has(x.toLowerCase()))).map(([k])=>k)}
export function scopesFor(services){const l=(services?.length?services:Object.keys(SERVICES)).filter(k=>SERVICES[k]);if(!l.length)throw Error('Pick at least one thing it may use.');return [...new Set([...ID_SCOPES,...l.flatMap(k=>SERVICES[k].scopes)])]}
// who may sign in: common (work, school and personal), organizations, consumers, or one organisation (its ID or domain)
export function cleanTenant(t){const s=String(t||'').trim().toLowerCase();if(!s)return 'common';
 if(['common','organizations','consumers'].includes(s)||GUID.test(s)||/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s))return s;
 throw Error('That is not a Directory (tenant) ID. Leave it empty unless only one organisation may sign in.')}
// what people paste from the app's Overview and Certificates & secrets pages
export function parseClient(b={}){const id=String(b.client_id||'').trim(),secret=String(b.client_secret||'').trim();
 if(!id)throw Error('Paste the Application (client) ID first.');
 if(!GUID.test(id))throw Error('That does not look like an Application (client) ID. It looks like 8-4-4-4-12 letters and digits, on the app’s Overview page.');
 if(!secret)throw Error('Paste the client secret’s Value too.');
 if(GUID.test(secret))throw Error('That is the Secret ID. Copy the Value column instead (it shows only right after you make the secret; if it is hidden, make a new one).');
 if(secret.length<16||/\s/.test(secret))throw Error('That does not look like a client secret’s Value. Copy the whole Value column from Certificates & secrets.');
 return {client_id:id.toLowerCase(),client_secret:secret,tenant:cleanTenant(b.tenant)}}
const b64u=b=>Buffer.from(b).toString('base64url');
// the account inside Microsoft's id_token (straight from Microsoft over TLS, so it is read, not verified again)
export function emailOf(idToken){try{const j=JSON.parse(Buffer.from(String(idToken).split('.')[1],'base64url').toString('utf8'));return String(j.email||j.preferred_username||j.upn||'').toLowerCase()}catch{return ''}}
export function codeFrom(input){const s=String(input||'').trim();let q;try{q=new URL(s).searchParams}catch{q=new URLSearchParams(s.replace(/^[^?]*\?/,''))}
 return {code:q.get('code')||'',state:q.get('state')||'',error:q.get('error')||'',why:q.get('error_description')||''}}
// Microsoft's AADSTS codes in plain words (the ones people actually hit while setting up)
export function plainError(code,desc=''){const d=String(desc||''),m=/AADSTS(\d+)/.exec(d)?.[1]||'';
 if(m==='50011')return 'Microsoft does not know this return address. Add it under the app’s Authentication › Web › Redirect URIs (step 3), then try again.';
 if(m==='7000215'||m==='7000222')return 'The client secret is wrong or has expired. Make a new one under Certificates & secrets and paste its Value here (Change).';
 if(m==='700016')return 'Microsoft cannot find this app for that account. Check that the app allows accounts in any organisation and personal accounts (step 2).';
 if(m==='50020'||m==='500200')return 'This app does not allow that kind of account. Set Supported account types to any organisation and personal accounts.';
 if(m==='65001'||m==='90094'||code==='consent_required')return 'Your organisation needs an admin to approve aqeelOS first. Ask your Microsoft 365 admin to grant consent for the app.';
 if(code==='access_denied')return 'You pressed Cancel on Microsoft, so nothing was connected.';
 if(code==='invalid_grant')return 'The sign-in code was already used or is too old. Press Connect again.';
 if(code==='invalid_client')return 'Microsoft refused the app’s ID or secret. Check them under Change.';
 return 'Microsoft refused the sign-in ('+(d.split(/\r?\n/)[0].slice(0,200)||code||'no reason given')+').'}

export function createMicrosoftConnect({HERMES_HOME,DATA,PUBLIC_URL,homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),fetchImpl=fetch,now=()=>Date.now(),log=()=>{}}){
 const CLIENT=path.join(HERMES_HOME,'microsoft_client.json'),PEND=path.join(DATA,'microsoft-connect.json');
 const redirectUri=()=>String(typeof PUBLIC_URL==='function'?PUBLIC_URL():PUBLIC_URL).replace(/\/$/,'')+'/microsoft-oauth/callback';
 const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};
 const put=async(f,v)=>{await mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(v,null,2),{mode:0o600});await chmod(t,0o600).catch(()=>{});await rename(t,f)};
 let pend=null;const load=async()=>{pend??=(await readJson(PEND))||{};const t=now();for(const [k,v] of Object.entries(pend))if(t-(v.at||0)>TTL)delete pend[k];return pend};
 const saveP=()=>put(PEND,pend);
 async function client(){const j=await readJson(CLIENT);if(!j)return null;try{return parseClient(j)}catch{return null}}
 const tokenPost=(tenant,params)=>fetchImpl(tokenUrl(tenant),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params).toString(),signal:AbortSignal.timeout(20000)});
 async function info(){const c=await client(),REDIRECT=redirectUri();
  return {client:c?{id:c.client_id.slice(0,8)+'…',tenant:c.tenant}:null,redirect:REDIRECT,https:/^https:\/\//i.test(REDIRECT)||/^http:\/\/localhost[:/]/i.test(REDIRECT),services:Object.fromEntries(Object.entries(SERVICES).map(([k,v])=>[k,v.label])),permissions:[...new Set([...ID_SCOPES.filter(s=>s!=='openid'),...Object.values(SERVICES).flatMap(v=>v.scopes)])]}}
 async function saveClient(body){const c=parseClient(body);await put(CLIENT,{...c,saved_at:new Date(now()).toISOString()});log('microsoft: app client saved ('+c.client_id.slice(0,8)+'…, '+c.tenant+')');return info()}
 async function removeClient(){await unlink(CLIENT).catch(()=>{});log('microsoft: app client removed');return info()}
 async function accounts(agent){const home=homeOf(agent),out=[];
  for(const f of (await readdir(home).catch(()=>[])).filter(isTokenFile).sort()){const d=await readJson(path.join(home,f));if(!d)continue;
   const name=/^microsoft_token(?:_([\w.-]+))?\.json$/.exec(f)[1]||'';out.push({agent,name,file:f,email:String(d.account||'').toLowerCase(),services:servicesOf(d.scopes||[]),renews:!!d.refresh_token})}
  return out}
 async function start({agent='default',name='',services,reconnect=false}){const c=await client();if(!c)throw Error('Add the Microsoft app first (step 1).');
  name=cleanName(name);const have=await accounts(agent);let hint='';
  if(reconnect){const x=have.find(a=>a.name===name);if(!x)throw Error('That Microsoft account is not on this agent any more. Reload the page.');hint=x.email;if(!services?.length)services=x.services}
  else if(have.some(a=>a.name===name)&&(name||have.length))throw Error(name?'This agent already has a Microsoft account called '+name+'. Pick another name, or use Reconnect on it.':'This agent already has a main Microsoft account. Give this one a short name, like work.');
  const scopes=scopesFor(services),state=b64u(randomBytes(18)),verifier=b64u(randomBytes(40)),challenge=b64u(createHash('sha256').update(verifier).digest()),redirect=redirectUri();
  await load();pend[state]={agent,name,scopes,verifier,redirect,reconnect,hint,at:now()};await saveP();
  const q=new URLSearchParams({client_id:c.client_id,response_type:'code',redirect_uri:redirect,response_mode:'query',scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account',...(hint?{login_hint:hint}:{})});
  return {url:authUrl(c.tenant)+'?'+q,state}}
 const has=async state=>!!(await load())[state]?.verifier;
 async function finish(input){const {code,state,error,why}=codeFrom(input);await load();const p=pend[state];
  if(!p||!p.verifier)throw Error('This sign-in link has expired or was already used. Press Connect again.');
  const done=r=>{pend[state]={...p,verifier:null,result:r,at:now()};return saveP().then(()=>r)};
  const fail=async m=>{await done({ok:false,error:m});throw Error(m)};
  if(error)return fail(plainError(error,why));
  if(!code)return fail('That address has no sign-in code in it. Press Connect again.');
  const c=await client();if(!c)return fail('The Microsoft app was removed meanwhile.');
  const r=await tokenPost(c.tenant,{client_id:c.client_id,client_secret:c.client_secret,code,redirect_uri:p.redirect,grant_type:'authorization_code',code_verifier:p.verifier,scope:p.scopes.join(' ')});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token)return fail(plainError(j.error,j.error_description));
  if(!j.refresh_token)return fail('Microsoft gave no lasting sign-in. Press Connect again and allow everything it asks for.');
  const email=emailOf(j.id_token),have=await accounts(p.agent);
  if(p.reconnect&&p.hint&&email&&email!==p.hint)return fail('You signed in as '+email+', but this account is '+p.hint+'. Press Reconnect and pick '+p.hint+' on Microsoft.');
  const same=!p.reconnect&&email&&have.find(a=>a.email===email);const name=same?same.name:p.name;
  const granted=String(j.scope||p.scopes.join(' ')).split(' ').filter(Boolean).map(short);
  const tok={type:'microsoft_oauth',account:email,tenant:c.tenant,client_id:c.client_id,client_secret:c.client_secret,refresh_token:j.refresh_token,access_token:j.access_token,
   token_uri:tokenUrl(c.tenant),scopes:granted,expiry:new Date(now()+(Number(j.expires_in)||3600)*1000).toISOString(),aqeelos_connected:now()};
  const home=homeOf(p.agent);await mkdir(home,{recursive:true});await put(path.join(home,fileFor(name)),tok);
  log('microsoft: '+(email||'an account')+' connected to '+p.agent+' as '+fileFor(name)+(p.reconnect?' (reconnect)':''));
  return done({ok:true,agent:p.agent,name,file:fileFor(name),email,services:servicesOf(granted),renewed:!!same})}
 async function result(state){const p=(await load())[state];if(!p)return {ok:false,error:'This sign-in expired. Press Connect again.'};return p.result||{waiting:true}}
 // a sign-in still works: Microsoft gives a new access token, and a new refresh token that replaces the old one
 async function check(agent,name){const f=path.join(homeOf(agent),fileFor(cleanName(name)));const d=await readJson(f);if(!d)throw Error('That Microsoft account is gone. Reload the page.');
  if(!d.refresh_token)return {ok:false,why:'It has no lasting sign-in. Press Reconnect.'};
  const c=await client(),cid=d.client_id||c?.client_id,sec=d.client_secret||c?.client_secret;
  const r=await tokenPost(d.tenant||c?.tenant,{client_id:cid||'',client_secret:sec||'',refresh_token:d.refresh_token,grant_type:'refresh_token',scope:(d.scopes||[]).join(' ')}).catch(e=>({ok:false,json:async()=>({error:e.message})}));
  const j=await r.json().catch(()=>({}));
  if(j.access_token){await put(f,{...d,access_token:j.access_token,refresh_token:j.refresh_token||d.refresh_token,expiry:new Date(now()+(Number(j.expires_in)||3600)*1000).toISOString()});return {ok:true}}
  return {ok:false,why:j.error==='invalid_grant'?'Microsoft ended this sign-in (password changed, access removed, or unused for 90 days). Press Reconnect.':plainError(j.error,j.error_description)}}
 async function remove(agent,name){name=cleanName(name);const f=path.join(homeOf(agent),fileFor(name));const d=await readJson(f);if(!d)return {ok:true};await unlink(f);log('microsoft: '+(d.account||fileFor(name))+' removed from '+agent);return {ok:true,email:d.account||''}}
 return {info,saveClient,removeClient,accounts,start,has,finish,result,check,remove,redirectUri}}
