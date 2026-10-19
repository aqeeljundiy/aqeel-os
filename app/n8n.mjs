// n8n for every agent. One n8n (n8n.elkiya.com); each agent gets its own n8n user, made with the owner's login the
// first time it is needed, so it has its own workflows. The agent's n8n tool connects as that user (its own MCP key),
// and Automations › n8n opens the agent's n8n without signing in: aqeelOS hands out a one-minute ticket, a small
// page that aqeelOS serves on n8n's own address (n8n.elkiya.com/aqeelos-login) signs in as the agent's user with
// the browser's own n8n id, and n8n opens signed in. Passwords stay in aqeelOS's data; nobody types them.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';

export function createN8n({BASE='https://n8n.elkiya.com',DATA,setKey,restart,names}){
 const FILE=path.join(DATA,'n8n.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.base||=BASE;db.users||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE,JSON.stringify(db,null,1),{mode:0o600})};
 const SERVER_BID='aqeelos-'+randomUUID();     // the browser id aqeelOS itself uses when it talks to n8n
 // one REST call; cookie and browser id go along, a new sign-in cookie comes back
 async function rest(p,{method='GET',body,cookie='',bid=SERVER_BID}={}){await load();
  const r=await fetch(db.base+p,{method,headers:{'content-type':'application/json','browser-id':bid,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(20000)});
  const set=r.headers.getSetCookie?.()||[];const text=await r.text();let j=null;try{j=JSON.parse(text)}catch{}
  if(!r.ok)throw new Error((j?.message||('n8n answered '+r.status)).replace(/Do you have caps lock on\?/,'').trim());return {data:j?.data??j,set}}
 const cookieOf=set=>set.map(c=>c.split(';')[0]).filter(c=>/^n8n-auth=/.test(c)).join('; ');
 // n8n allows only a few sign-ins a minute, so aqeelOS keeps its own sessions (30 minutes) instead of signing in per step.
 // A browser's sign-in (its own browser id) is never cached: that cookie goes to the person.
 const sessions=new Map();
 async function login(email,password,bid=SERVER_BID){const k=email,s=sessions.get(k);if(bid===SERVER_BID&&s&&Date.now()-s.at<30*60e3)return s.v;
  const r=await rest('/rest/login',{method:'POST',body:{emailOrLdapLoginId:email,password},bid});const c=cookieOf(r.set);if(!c)throw new Error('n8n did not sign in.');
  const v={cookie:c,set:r.set,user:r.data};if(bid===SERVER_BID)sessions.set(k,{v,at:Date.now()});return v}
 // aqeelOS owns n8n: on a fresh n8n (no owner yet) it makes the owner account itself, so nobody types an n8n login
 let setupTried=0;
 async function autoSetup(){if(Date.now()-setupTried<60000)return false;setupTried=Date.now();
  let s;try{s=(await rest('/rest/settings')).data}catch{return false}if(!s?.userManagement?.showSetupOnFirstLoad)return false;
  const email='aqeelos@agents.'+new URL(db.base).hostname.split('.').slice(-2).join('.'),password='Aq'+randomBytes(18).toString('base64url')+'9';
  await rest('/rest/owner/setup',{method:'POST',body:{email,firstName:'aqeelOS',lastName:'Owner',password}});
  db.ownerEmail=email;db.ownerPassword=password;db.ownedByAqeelos=true;await save();console.log('n8n: aqeelOS set itself up as the owner ('+email+')');return true}
 const ready=async()=>{await load();return !!(db.ownerEmail&&db.ownerPassword)||await autoSetup().catch(()=>false)};
 async function setOwner(email,password){await load();await login(email,password);db.ownerEmail=email;db.ownerPassword=password;await save();return true}
 async function owner(){if(!await ready())throw new Error('Connect aqeelOS to n8n first: Automations › n8n asks for the n8n owner login once.');return login(db.ownerEmail,db.ownerPassword)}

 // the agent's own n8n user (made once), and its tool connected as that user
 async function ensure(agent){await load();let u=db.users[agent];
  // agents reach n8n through its MCP access, which a fresh n8n starts with switched off
  if(!db.mcpOn){const o=await owner();await rest('/rest/mcp/settings',{method:'PATCH',body:{mcpAccessEnabled:true},cookie:o.cookie});db.mcpOn=true;await save()}
  if(!u){const o=await owner();const email=('agent-'+agent).replace(/[^a-z0-9-]/gi,'').toLowerCase()+'@agents.elkiya.com',password='Aq'+randomBytes(18).toString('base64url')+'9';
   // invite, then accept the invitation with its token (the link n8n returns: /signup?token=…). An invitation sent
   // earlier and never accepted is picked up from the user list instead of inviting again.
   const inv=await rest('/rest/invitations',{method:'POST',body:[{email,role:'global:member'}],cookie:o.cookie});const it=(Array.isArray(inv.data)?inv.data:[])[0];
   let link=String(it?.user?.inviteAcceptUrl||''),id=it?.user?.id;
   if(!link){const list=(await rest('/rest/users',{cookie:o.cookie})).data;const all=Array.isArray(list)?list:list?.items||[];const x=all.find(y=>String(y.email).toLowerCase()===email);
    if(x&&!x.isPending)throw new Error('An n8n user '+email+' already exists and aqeelOS doesn’t know its password. Remove it in n8n (Open as owner › Settings › Users), then try again.');
    link=String(x?.inviteAcceptUrl||'');id=x?.id}
   const token=new URL(link||'/',db.base).searchParams.get('token');if(!token)throw new Error(it?.error||'n8n did not make the user.');
   await rest('/rest/invitations/accept',{method:'POST',body:{token,firstName:names(agent),lastName:'(aqeelOS)',password}});
   u=db.users[agent]={email,password,id,made:Date.now()};await save()}
  if(!u.mcp){const s=await login(u.email,u.password);let k=null;try{k=(await rest('/rest/mcp/api-key',{cookie:s.cookie})).data}catch{}
   if(!k?.apiKey)k=(await rest('/rest/mcp/api-key/rotate',{method:'POST',cookie:s.cookie})).data;
   if(!k?.apiKey)throw new Error('n8n did not give an MCP key.');u.mcp=true;await save();
   const r=await setKey(agent,'mcp_servers.n8n',{url:db.base+'/mcp-server/http',headers:{Authorization:'Bearer '+k.apiKey},enabled:true});if(!r.ok)throw new Error(r.err||'Could not connect the agent’s n8n tool');
   restart('n8n connected for '+names(agent))}
  return {email:u.email}}

 // opening n8n without signing in: a one-minute ticket, then the login page on n8n's own address uses it
 const tickets=new Map();
 function ticket(agent){const t=randomBytes(24).toString('base64url');tickets.set(t,{agent,at:Date.now()});setTimeout(()=>tickets.delete(t),60000).unref?.();return t}
 const page=()=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Opening n8n</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#555;background:#f6f6f8}p{animation:f 1.2s ease-in-out infinite}@keyframes f{50%{opacity:.4}}</style><p id="m">Opening n8n…</p>
<script>(async()=>{const K='n8n-browserId';let b=localStorage.getItem(K);if(!b){b=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());localStorage.setItem(K,b)}
const t=new URLSearchParams(location.search).get('t')||'';const go=new URLSearchParams(location.search).get('to')||'/home/workflows';
try{const r=await fetch('/aqeelos-login/go',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({t,b})});const j=await r.json();if(!r.ok)throw new Error(j.error||'n8n could not open');location.replace(go.startsWith('/')?go:'/home/workflows')}
catch(e){document.getElementById('m').textContent=e.message+'. Close this and open n8n again from aqeelOS.'}})()</script>`;
 async function go(t,bid){const k=tickets.get(String(t||''));if(!k||Date.now()-k.at>60000)throw new Error('This link has expired');tickets.delete(t);
  // an admin opening n8n as its owner (to see every agent's workflows), or an agent's own n8n
  const u=k.agent==='__owner'?{email:db.ownerEmail,password:db.ownerPassword}:(await ensure(k.agent),db.users[k.agent]);const s=await login(u.email,u.password,String(bid||'').slice(0,100));
  // n8n's own cookie, for n8n's own address (this page is served there)
  return s.set.filter(c=>/^n8n-auth=/.test(c)).map(c=>c.replace(/;\s*domain=[^;]*/i,''))}
 const status=async agent=>{await load();return {ready:await ready(),base:db.base,user:db.users[agent]?{email:db.users[agent].email}:null,users:Object.fromEntries(Object.entries(db.users).map(([a,u])=>[a,u.email]))}};
 return {ready,setOwner,ensure,ticket,page,go,status}}
