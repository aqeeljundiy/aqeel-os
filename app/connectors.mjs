// Connectors for every agent (workstream C, 6 Nov 2026): every app that signs in through a sign-in page (Slack, Notion,
// Composio, any future one an agent adds) is available to every agent, without anyone's login. The catalog is not a
// hand-written list: it is every sign-in-page app any agent has, by address. Each agent missing one gets a plain copy of
// the setup (address, scopes, safety excludes), never the sign-in files and never someone's own app keys (client id or
// secret). The agent then signs in its own with connect_mcp_tool, or the owner shares theirs on the Access page
// (sharing levels), which copies the sign-in on purpose. An app an agent switched off, or has under another name, is
// left alone. Nothing here knows any agent, app or path: the caller passes them.
import path from 'node:path';

const LOCAL=/^https?:\/\/(127\.|localhost|\[::1\])/i;
export const hostOf=u=>{try{return new URL(String(u)).host.toLowerCase()}catch{return ''}};
// a header or token sign-in is someone's own key: not a connector to hand out (n8n has its own per-agent users)
const keyed=e=>!!(e.bearer||e.bearer_token||e.token||(e.auth&&e.auth!=='oauth')||Object.keys(e.headers||{}).some(k=>/auth|token|key|bearer/i.test(k)));
// a sign-in-page app: an address, oauth (or Composio's connector, which signs in the same way), no key of its own
export const isConnector=e=>!!(e&&typeof e==='object'&&e.url&&!LOCAL.test(e.url)&&!keyed(e)&&(e.auth==='oauth'||/connect\.composio\.dev|rube\.app/.test(e.url)));

// the setup without anyone's login: no client id/secret (someone's own app), no token, the return address set per agent later
export function vanilla(e){const out={url:e.url,auth:'oauth'};const o={};
 for(const k of ['scope','timeout'])if(e.oauth?.[k]!=null)o[k]=e.oauth[k];
 // aqeelOS's own app for a service, named by a setting (${VAR}) rather than written in, is not anyone's login: kept,
 // and it only works for an agent that has that setting itself (else the sign-in asks for an app of its own)
 for(const k of ['client_id','client_secret'])if(/^\$\{[^}]+\}$/.test(String(e.oauth?.[k]||'')))o[k]=e.oauth[k];out.oauth=o;
 if(e.tools&&typeof e.tools==='object'){const t={};for(const k of ['include','exclude'])if(Array.isArray(e.tools[k]))t[k]=[...e.tools[k]];if(Object.keys(t).length)out.tools=t}
 if(e.timeout!=null)out.timeout=e.timeout;out.enabled=true;return out}

// configs: {agent: config}. One entry per address: the plainest name wins (slack over slack-pixel), the safest setup
// (the most excludes) is kept so a shared default never allows more than the strictest agent set up.
export function catalog(configs){const by=new Map();
 for(const c of Object.values(configs||{}))for(const [name,e] of Object.entries(c?.mcp_servers||{})){if(!isConnector(e))continue;const h=hostOf(e.url);if(!h)continue;
  const cur=by.get(h),v=vanilla(e);const ex=x=>(x.tools?.exclude||[]).length;
  if(!cur){by.set(h,{name,entry:v});continue}
  const better=name.length<cur.name.length||(name.length===cur.name.length&&name<cur.name);
  const entry=ex(v)>ex(cur.entry)?v:cur.entry;by.set(h,{name:better?name:cur.name,entry})}
 return [...by.values()].sort((a,b)=>a.name.localeCompare(b.name))}

// what one agent is missing: an app it has under any name (switched off too) counts as had
export function missing(cat,config){const mine=Object.entries(config?.mcp_servers||{});const hosts=new Set(mine.map(([,e])=>hostOf(e?.url)).filter(Boolean));const names=new Set(mine.map(([n])=>n));
 return cat.filter(x=>!hosts.has(hostOf(x.entry.url))&&!names.has(x.name))}

// apps an agent has that are not signed in yet (no token file): shown to the agent as "available, not connected"
export function notConnected(config,hasToken){return Object.entries(config?.mcp_servers||{}).filter(([n,e])=>isConnector(e)&&e.enabled!==false&&!hasToken(n)).map(([n,e])=>({name:n,url:e.url}))}

// deps: listAgents, readConfig, setKey(agent,key,value), redirect(name)->public return address, noteApp(agent,name,rec),
// eligible(agent)->bool (real agents with the sign-in tool; test copies stay as they are), log
// hasEnv(agent,VAR): whether the agent's own settings file has that name (a ${VAR} app key is kept only then)
export function forAgent(entry,has){const o={...entry.oauth};for(const k of ['client_id','client_secret']){const m=/^\$\{(?:env:)?([^}]+)\}$/.exec(String(o[k]||''));if(m&&!has(m[1].trim()))delete o[k]}
 if(!o.client_id)delete o.client_secret;return {...entry,oauth:o}}
// allow(agent,entry): whether this agent may get this app at all (Composio only for agents switched on for it, agent-optins.mjs)
export function createConnectors({listAgents,readConfig,setKey,redirect,allow=async()=>true,hasEnv=async()=>false,noteApp=async()=>{},origin=async()=>null,eligible=async()=>true,log=()=>{}}){
 async function plan(){const agents=await listAgents();const cfg={};for(const a of agents)cfg[a]=await readConfig(a).catch(()=>null)||{};
  const cat=catalog(cfg);const out=[];
  for(const a of agents){if(!await eligible(a,cfg[a]))continue;for(const x of missing(cat,cfg[a])){if(!await allow(a,x.entry))continue;const envs=new Set();for(const k of ['client_id','client_secret']){const m=/^\$\{(?:env:)?([^}]+)\}$/.exec(String(x.entry.oauth?.[k]||''));if(m&&await hasEnv(a,m[1].trim()))envs.add(m[1].trim())}
   const e=forAgent(x.entry,v=>envs.has(v));out.push({agent:a,name:x.name,entry:{...e,oauth:{...e.oauth,redirect_uri:redirect(x.name)}}})}}
  return {catalog:cat,add:out}}
 // adds what is missing; each agent signs in its own later. Marked "set up by aqeelOS" so it never nags for a sign-in.
 async function ensureAll({dry=false}={}){const p=await plan();const done=[];
  for(const x of p.add){if(dry){done.push(x);continue}
   const r=await setKey(x.agent,'mcp_servers.'+x.name,x.entry);if(!r?.ok){log('connectors',x.agent,x.name,'could not add:',r?.err||'');continue}
   await noteApp(x.agent,x.name,{by:'setup'}).catch(()=>{});done.push(x);log('connectors',x.agent,'can now connect',x.name,'(not signed in)')}
  // a plain copy with no note of where it came from (a note lost to a restart) counts as set up too: it never nags
  if(!dry){const hosts=new Set(p.catalog.map(c=>hostOf(c.entry.url)));for(const a of await listAgents()){const c=await readConfig(a).catch(()=>null)||{};
   for(const [n,e] of Object.entries(c.mcp_servers||{}))if(isConnector(e)&&hosts.has(hostOf(e.url))&&!e.oauth?.client_id&&!await origin(a,n,e.url))await noteApp(a,n,{by:'setup'}).catch(()=>{})}}
  return {catalog:p.catalog.map(c=>c.name),added:done.map(x=>x.agent+':'+x.name),changed:!dry&&done.length>0}}
 return {plan,ensureAll}}

// the lines an agent reads at the start of every chat (from its real settings and token files)
export function contextLines(list){if(!list.length)return [];
 return ['','## Apps you can connect','',
  'These apps are set up for you but not signed in yet: '+list.map(x=>x.name).join(', ')+'. You have no one else’s login for them. When a job needs one, either call connect_mcp_tool with its name (and why) and send the person the steps it gives, so you sign in your own; or ask the owner to share theirs with you (Abilities › Access). Never copy another agent’s sign-in files.']}

export const tokenPath=(home,name)=>path.join(home,'mcp-tokens',name+'.json');
