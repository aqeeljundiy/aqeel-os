// Personal add-ons (11 Nov 2026, owner: "like giving them a subscription: connect all the tools, MCP connections,
// whatever they want, even outside the aqeelOS repo"). Every signed-in person may add apps (MCP links), skills and
// plugins to the agents they own, whatever their role; agents shared with them still need edit rights and the role's
// right, as before. What runs code on the box (a command server, a plugin from any GitHub repo) stays the separate
// "Terminal, files and code" permission. Admins see who added what, and keep a block list of apps and hosts.
// Also the check that an address really is an MCP tool before it is saved (on P&P a Google Sheet link was saved as an
// app with no tools and a broken sign-in): probeMcp asks it the MCP way and refuses ordinary web pages.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

/* ---------- is this address an MCP tool? ---------- */
// links people paste that are never MCP tools, each with what to do instead
const NOT_MCP=[
 [/^(docs|sheets|drive|slides|forms|mail|calendar|meet|photos)\.google\.com$/i,'That is a link to Google (a file, Gmail or Calendar), not an app. Connect a Google account instead: Connections › Add › A Google account. The agent then opens this file or inbox with its Google tools; keep the link in its notes.'],
 [/^([\w-]+\.)?slack\.com$/i,'That is a Slack page, not an app address. Connect Slack instead: Connections › Add › Slack (a guided setup), then press Connect Slack.',h=>!/^mcp\.slack\.com$/i.test(h)],
 [/(^|\.)(sharepoint\.com|onedrive\.live\.com|office\.com|outlook\.(com|live\.com|office\.com)|teams\.microsoft\.com|1drv\.ms)$/i,'That is a Microsoft 365 link (a file, Outlook or Teams), not an app. Connect Microsoft instead: Connections › Add › Microsoft 365.'],
 [/^(www\.)?github\.com$/i,'That is a GitHub page, not an app address. If it is a plugin, install it under Abilities › Plugins › Browse › Install from GitHub; if it is a skill, add it under Abilities › Skills. GitHub\'s own app is in the catalog (Connections › Add › An app from the catalog).'],
 [/^(www\.)?(youtube\.com|youtu\.be|notion\.so|airtable\.com|figma\.com|canva\.com|trello\.com|dropbox\.com)$/i,'That is a link to a page in the app, not the app\'s MCP address. Add the app from the catalog (Connections › Add › An app from the catalog), or ask the service for its MCP address (it often ends in /mcp).']];
export function notMcpReason(url){let u;try{u=new URL(String(url))}catch{return 'Type the address, starting with https://'}
 if(!/^https?:$/.test(u.protocol))return 'Type the address, starting with https://';
 for(const [re,why,keep] of NOT_MCP)if(re.test(u.hostname)&&(!keep||keep(u.hostname)))return why;
 return null}
const NOT_ANSWERING='That address did not answer like an MCP tool (it looks like an ordinary web page). Ask the service for its MCP address (it often ends in /mcp or /sse), add the app from the catalog (Connections › Add › An app from the catalog), or connect it with its own API key.';
// reads at most `max` characters of a body, stopping early once `enough` says so (an SSE stream may stay open)
async function readSome(r,max=65536,enough=()=>false){if(!r.body?.getReader)return (await r.text().catch(()=>'')).slice(0,max);const rd=r.body.getReader(),dec=new TextDecoder();let s='';
 try{while(s.length<max){const {value,done}=await rd.read();if(done)break;s+=dec.decode(value,{stream:true});if(enough(s))break}}catch{}finally{rd.cancel().catch(()=>{})}return s}
const isRpc=t=>/"jsonrpc"\s*:\s*"2\.0"/.test(t);
/* Asks `url` the MCP way: a JSON-RPC initialize (Streamable HTTP), the sign-in answer an MCP server gives (401 with a
   Bearer WWW-Authenticate, or an oauth-protected-resource document), or an old-style SSE endpoint.
   Returns {ok:true, auth:'oauth'|'none'} or {ok:false, why}. */
export async function probeMcp(url,{fetch:f=globalThis.fetch,timeout=10000}={}){
 const why=notMcpReason(url);if(why)return {ok:false,why};
 const sig=()=>AbortSignal.timeout(timeout);
 const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'aqeelos-check',version:'1'}}};
 let r;try{r=await f(url,{method:'POST',headers:{accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify(init),signal:sig()})}
 catch(e){return {ok:false,why:'Could not reach that address ('+String(e?.cause?.code||e?.name||e?.message||'no answer')+'). Check it is typed right and open to the internet.'}}
 const wa=r.headers.get('www-authenticate')||'';
 if((r.status===401||r.status===403)&&/bearer|resource_metadata/i.test(wa)){readSome(r,1).catch(()=>{});return {ok:true,auth:'oauth'}}
 const ct=r.headers.get('content-type')||'';
 if(/json|event-stream/i.test(ct)){const t=await readSome(r,65536,isRpc);if(isRpc(t))return {ok:true,auth:'none'}}else readSome(r,1).catch(()=>{});
 // a server that wants a sign-in may say so only in its protected-resource document (RFC 9728)
 const u=new URL(url);for(const wk of [u.origin+'/.well-known/oauth-protected-resource'+(u.pathname==='/'?'':u.pathname),u.origin+'/.well-known/oauth-protected-resource']){
  try{const x=await f(wk,{headers:{accept:'application/json'},signal:sig()});if(x.ok&&/json/i.test(x.headers.get('content-type')||'')){const j=await x.json().catch(()=>null);if(j&&(Array.isArray(j.authorization_servers)||j.resource))return {ok:true,auth:'oauth'}}else readSome(x,1).catch(()=>{})}catch{}}
 // the old SSE transport: a GET that opens an event stream (its first event names the endpoint)
 if(r.status===404||r.status===405||r.status===400||/event-stream/i.test(ct)){try{const x=await f(url,{headers:{accept:'text/event-stream'},signal:sig()});
  if(/event-stream/i.test(x.headers.get('content-type')||'')){readSome(x,1).catch(()=>{});return {ok:true,auth:'none'}}
  if((x.status===401||x.status===403)&&/bearer|resource_metadata/i.test(x.headers.get('www-authenticate')||'')){readSome(x,1).catch(()=>{});return {ok:true,auth:'oauth'}}readSome(x,1).catch(()=>{})}catch{}}
 return {ok:false,why:NOT_ANSWERING}}

/* ---------- who may add an add-on to an agent ---------- */
// A pure decision, so it can be tested: null (allowed) or the sentence to show.
//  admin:   the person is an admin or the owner (everything, as before)
//  level:   their level on the agent: 'owner' | 'edit' | 'chat' | null
//  caps:    their role's rights (users.mjs CAPS)
//  kind:    'mcp' | 'skill' | 'plugin'
//  runsCode: a command-started tool server, or a plugin from any GitHub repo (not the reviewed catalog)
export const RUNS_CODE_MSG='Tools that run a command or code on the AI box need the "Terminal, files and code" permission. Use the app\'s web address (its MCP link) or the catalog instead, or ask an admin.';
export function addonDecision({admin=false,level=null,caps=[],kind='mcp',runsCode=false}={}){
 if(admin)return null;
 if(runsCode&&!caps.includes('unsafe'))return RUNS_CODE_MSG;
 if(level==='owner')return null;   // an agent you own is yours to extend, whatever your role
 if(level==='edit'){const cap=kind==='skill'?'skills':kind==='mcp'?'mcp':null;
  if(cap&&caps.includes(cap))return null;
  return kind==='plugin'?'Plugins on a shared agent are turned on by its owner or an admin.':'Your role does not include adding '+(kind==='skill'?'skills':'apps')+' to agents shared with you. Add it to your own agent instead, or ask the agent\'s owner.'}
 return level==='chat'?'You can chat with this agent but not change it. Add it to your own agent instead.':'That agent is not shared with you.'}

/* ---------- the record of what people added, and the block list ---------- */
const clean=s=>String(s??'').trim();
// the host of an address, or '' (a name like "notion" is not an address)
const hostOf=v=>{try{return new URL(/^https?:\/\//i.test(v)?v:'https://'+v).hostname.toLowerCase()}catch{return ''}};
// does a block entry (a host like example.com, or an app/skill/plugin name) cover this add-on?
export function blockMatch(entry,{name='',url=''}={}){const e=clean(entry).toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(!e)return false;
 if(clean(name).toLowerCase()===e)return true;
 const h=url?hostOf(url):'';if(h&&e.includes('.'))return h===e||h.endsWith('.'+e);
 return false}
export function createAddons({DATA}){const F=path.join(DATA,'addons.json');let db=null;
 async function load(){if(db)return db;db=await readStore(F);db.added??=[];db.blocked??=[];return db}
 async function save(){await mkdir(DATA,{recursive:true});await writeStore(F,JSON.stringify(db,null,1))}
 // one line per kind+agent+name; adding it again moves it to the top with the latest details
 async function note({kind,agent,name,url='',by={},via='app'}){await load();name=clean(name).slice(0,120);if(!name)return;const key=kind+'|'+(agent||'')+'|'+name;
  db.added=db.added.filter(x=>x.key!==key);db.added.unshift({key,kind,agent:agent||null,name,url:clean(url).slice(0,300).replace(/([?&][^=]*(key|token|secret|sig)[^=]*=)[^&]+/gi,'$1(hidden)'),by:{id:by.id||null,name:by.name||null},via,at:Date.now()});
  db.added=db.added.slice(0,2000);await save()}
 async function list(){await load();return {added:db.added,blocked:db.blocked}}
 // the block entry that covers this add-on, or null
 async function blockedBy(x){await load();return db.blocked.find(b=>blockMatch(b.value,x))||null}
 async function refusal(x){const b=await blockedBy(x);return b?'An admin has blocked '+b.value+' on this aqeelOS'+(b.note?' ('+b.note+')':'')+', so it can\'t be added. Ask an admin if you need it.':null}
 async function block(value,{note='',by={}}={}){value=clean(value).toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(!/^[a-z0-9][a-z0-9._@-]{0,120}$/.test(value))throw new Error('Type an app name (like notion) or a host (like example.com).');
  await load();db.blocked=db.blocked.filter(b=>b.value!==value);db.blocked.push({value,note:clean(note).slice(0,200),by:{id:by.id||null,name:by.name||null},at:Date.now()});await save();return db.blocked}
 async function unblock(value){await load();value=clean(value).toLowerCase();db.blocked=db.blocked.filter(b=>b.value!==value);await save();return db.blocked}
 return {note,list,blockedBy,refusal,block,unblock}}
