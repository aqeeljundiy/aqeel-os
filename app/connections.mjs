// Abilities › Connections (1 Nov 2026): one list for everything an agent can use, one row per connection, so the
// owner sees in one place: 1. what is connected (an app, a login as you, a skill, a plugin, a key), 2. which agent owns
// it, 3. which agents may use it, 4. how much each may do. It replaced Connected apps, Connected accounts and the All
// agents duplicate of them ("why are there so many ways to view this?").
//   - names are the service and who it is ("Google · a@b.com", "Slack · Pixel & Profits", "AdsPower · Donna"), never
//     an agent's own label (connected-accounts.mjs displayName);
//   - who owns and who may use: access.mjs (owner and share/unshare copy the setup and the sign-in), skills are each
//     agent's own copy (on or off per agent, skills-policy.mjs decides who may have one at all);
//   - how much: apps and logins have Read, Read & draft or Full per agent. Google: gapi.py refuses the rest for that
//     agent (aqeelos-accounts.json, per agent). Apps: the tools the level leaves out go in the agent's
//     mcp_servers.<name>.tools.exclude (the engine registers only the rest), applied the way Pause does it (removed
//     through the dashboard, written back); skills and plugins are On or Off.
// The parts that only decide are exported and tested in scripts/connections.test.mjs.
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {providerOf,toolNeed,serviceName,displayName,PROVIDERS,CAN} from './connected-accounts.mjs';
import {allowed as skillOk,allowedNames} from './skills-policy.mjs';

/* ---------- the parts that only decide (tested) ---------- */
export const LEVELS={read:['read'],draft:['read','draft'],full:['read','draft','send']};
export const LEVEL_NAME={read:'Read',draft:'Read & draft',full:'Full',on:'On',off:'Off'};
export const canOf=l=>[...(LEVELS[l]||LEVELS.full)];
export const levelOf=can=>{const c=Array.isArray(can)?can:CAN;return c.includes('send')?'full':c.includes('draft')?'draft':'read'};
export const toolLevel=(prov,tool)=>({read:'read',draft:'draft',send:'full'})[toolNeed(prov,tool)];
// how many of an app's tools each level lets an agent use: {read, draft, full, total}
export function toolCounts(tools,prov){const n={read:0,draft:0,full:0,total:0};for(const t of tools||[]){const l=toolLevel(prov,t);n.total++;n.full++;if(l!=='full')n.draft++;if(l==='read')n.read++}return n}
export const baseOf=a=>String(a).split('--')[0];
const has=(l,id)=>l.some(u=>u.id===id);

// an app's name: the service it is, then the server's own name when that says more ("Slack · slack-bot")
export function appName(id,url){const p=PROVIDERS.find(x=>x.re.test(id))||PROVIDERS.find(x=>x.re.test(url||''));const svc=p?p.name:serviceName(id),slug=String(id).toLowerCase();
 const norm=x=>String(x).toLowerCase().replace(/[-_\s]+/g,' ');return norm(svc)===norm(id)||slug===p?.id?svc:svc+' · '+id}

const STATE={connected:'connected','signed-out':'signin',paused:'paused',pausing:'paused',resuming:'paused',failed:'paused',off:'off',applying:'connected',checking:'connected'};
const ADS={running:'connected','signed-out':'signin',off:'off',starting:'connected'};
// aqeelOS's own tools on every agent: the code bridge, and the AdsPower tool (its rows are "AdsPower · <agent>")
const INTERNAL=/^(aqeelos-notify|aqeelos-code|adspower)$/i;
const TYPE_ORDER={account:0,app:1,plugin:2,key:3,skill:4};

// every connection as one row. in: {agents:[{id,name}], acc:{mcp,google,plugin,key} (access.mjs lists, null when not
// loaded), accounts (connected-accounts.mjs list items), skills:{agent:[{name,category,description,enabled}]},
// ads (agent-adspower.mjs items), levels ({'mcp|name':{agent:level}}), code ({devices,live} or null), busy (Set of keys),
// names (agent → name)}
export function buildRows(i){const names=i.names||(a=>a),out=[],acc=i.acc||{};const av=a=>({id:a,name:names(a)});
 const accounts=i.accounts||[],taken=new Set();
 // logins as you (connected-accounts.mjs): their owner and users from Access, what each may do from their canBy
 for(const x of accounts){const it=x.kind==='mcp-oauth'?acc.mcp?.items?.find(y=>y.id===x.mcp):x.kind==='google'?acc.google?.items?.find(y=>y.id===x.identity):null;
  if(it)taken.add(it.kind+'|'+it.id);const users=[];
  for(const u of [...(it?.users||[]),...(x.agents||[])]){const b=baseOf(u.id);if(has(users,b))continue;users.push({id:b,name:u.name||names(b),level:levelOf(x.canBy?.[b]||x.can),signed:u.signed!==false})}
  const owner=it?.owner||x.owner||users[0]?.id||null;const st=STATE[x.state]||'connected';
  out.push({key:'ca:'+x.id,type:'account',kind:x.kind==='mcp-oauth'?'mcp':x.kind,id:x.kind==='mcp-oauth'?x.mcp:x.kind==='google'?x.identity:x.id,caId:x.id,name:x.name||displayName(x),service:x.app||'',logo:x.logo||'',
   what:x.kind==='google'?'Your Google account: Gmail, Drive, Sheets, Docs, Calendar':x.kind==='mcp-oauth'?'Signed in as you: what agents do goes out under your name':x.kind==='telegram-user'?'Your personal Telegram account':'A login as you',
   owner,users,status:st,why:x.why||'',busy:['pausing','resuming','applying'].includes(x.state)||i.busy?.has('ca:'+x.id),lastUsed:x.lastUsed||null,recent:(x.recent||[]).slice(0,10),
   note:[x.ownerLabel?'You call it '+x.ownerLabel:'',x.agentLabel?'Registered as “'+x.agentLabel+'”':'',x.note||''].filter(Boolean).join(' · '),registered:x.registered!==false,mayPause:!!x.mayPause,paused:st==='paused',
   levels:x.kind==='google'||x.kind==='mcp-oauth'?'level':'none',enforce:x.kind==='google'?'gapi':x.kind==='mcp-oauth'?'tools':'note',ownerFixed:!it,where:x.where||''})}
 // apps (every other MCP server) and Google accounts aqeelOS has not checked as a login yet
 for(const it of acc.mcp?.items||[]){if(taken.has('mcp|'+it.id)||INTERNAL.test(it.id))continue;const lv=i.levels?.['mcp|'+it.id]||{};
  const st=it.off?'off':it.users.some(u=>!u.signed)||it.ownerSigned===false?'signin':'connected';const host=(/https?:\/\/([^/\s:]+)/.exec(it.detail||'')||[])[1]||'';
  out.push({key:'mcp:'+it.id,type:'app',kind:'mcp',id:it.id,name:appName(it.id,it.detail),service:appName(it.id,it.detail).split(' · ')[0],logo:host?host.split('.').slice(-2).join('.'):'',what:it.own?it.ownNote:host?'An app at '+host:'A tool that runs on the AI box',
   owner:it.own?null:it.owner,ownerName:it.own?it.ownerName:'',users:it.users.map(u=>({id:u.id,name:u.name,level:lv[u.id]||'full',signed:u.signed,off:u.off})),status:st,busy:i.busy?.has('mcp:'+it.id),oauth:!!it.oauth,own:!!it.own,mixed:!!it.mixed,
   levels:it.own?'none':'level',enforce:'tools',ownerFixed:!!it.own,lastUsed:null,recent:[]})}
 for(const it of acc.google?.items||[]){if(taken.has('google|'+it.id))continue;
  out.push({key:'google:'+it.id,type:'account',kind:'google',id:it.id,name:'Google · '+it.id,service:'Google',logo:'google.com',what:'Your Google account: Gmail, Drive, Sheets, Docs, Calendar',owner:it.owner,
   users:it.users.map(u=>({id:u.id,name:u.name,level:'full',signed:u.signed})),status:it.users.some(u=>!u.signed)?'signin':'connected',levels:'none',enforce:'gapi',lastUsed:null,recent:[],registered:true})}
 // each agent's own AdsPower (it signs in on that agent's screen)
 for(const x of i.ads||[]){if(!ADS[x.state])continue;out.push({key:'ads:'+x.agent,type:'account',kind:'ads',id:x.agent,name:'AdsPower · '+names(x.agent),service:'AdsPower',logo:'adspower.com',
  what:'AdsPower on '+names(x.agent)+'’s screen, with its own login',owner:x.agent,users:[{id:x.agent,name:names(x.agent),level:'on',signed:x.state!=='signed-out'}],status:ADS[x.state],busy:x.state==='starting',ads:x.state,port:x.port||null,levels:'none',ownerFixed:true,lastUsed:null,recent:[]})}
 // plugins and keys: Access, on for the agents that have them
 for(const it of acc.plugin?.items||[])out.push({key:'plugin:'+it.id,type:'plugin',kind:'plugin',id:it.id,name:it.label,service:'Plugin',what:'An extension of the engine itself',owner:it.owner,
  users:it.users.map(u=>({id:u.id,name:u.name,level:'on'})),status:'on',levels:'onoff',lastUsed:null,recent:[]});
 for(const it of acc.key?.items||[])out.push({key:'key:'+it.id,type:'key',kind:'key',id:it.id,name:it.label,service:'Key',what:it.bot?'A chat bot: it answers as one agent only':'A key or token, kept hidden on the AI box',owner:it.owner,bot:!!it.bot,
  users:it.users.map(u=>({id:u.id,name:u.name,level:'on'})),status:'on',levels:'none',ownerFixed:!!it.bot,lastUsed:null,recent:[]});
 // skills: every agent keeps its own copy; on or off per agent. The main agent's copy is where new agents get theirs.
 const sk=new Map();for(const [a,l] of Object.entries(i.skills||{}))for(const s of l||[]){if(!s?.name)continue;const r=sk.get(s.name)||{name:s.name,category:s.category||'',description:s.description||'',users:[]};r.users.push({id:a,name:names(a),level:s.enabled===false?'off':'on'});sk.set(s.name,r)}
 for(const r of sk.values()){const only=allowedNames(r.category?r.category+'/'+r.name:r.name);const owner=has(r.users,'default')?'default':r.users[0].id;
  out.push({key:'skill:'+r.name,type:'skill',kind:'skill',id:r.name,name:r.name,service:'Skill',what:r.description||'Know-how an agent picks up for a task',category:r.category,owner,users:r.users,status:r.users.some(u=>u.level==='on')?'on':'off',
   levels:'onoff',ownerFixed:true,only:only.length?only.filter(a=>a!=='default'):null,lastUsed:null,recent:[]})}
 // Code on people's computers: each person signs in to their own GitHub there
 if(i.code)out.push({key:'code:computers',type:'app',kind:'code',id:'computers',name:'Code · people’s computers',service:'Code',what:'Apps connected inside Code on people’s computers',owner:null,ownerName:'Each person',users:[],
  status:i.code.live?.connected?'connected':'off',levels:'none',ownerFixed:true,code:i.code,lastUsed:null,recent:[]});
 // the same name twice: the server's own name tells two Notion sign-ins to one workspace apart, the owner two
 // agents' own bots (TELEGRAM_BOT_TOKEN)
 const seen=new Map();for(const r of out)seen.set(r.name,(seen.get(r.name)||0)+1);for(const r of out)if(seen.get(r.name)>1)r.name+=r.kind==='mcp'?' ('+r.id+')':r.owner?' · '+names(r.owner):'';
 for(const r of out){r.ownerName||=r.owner?names(r.owner):'';r.canUse=r.users.filter(u=>u.level!=='off').map(u=>u.id)}
 // what needs you first (a login nobody registered, a sign-in to make), then logins, apps, plugins, keys, skills
 const rank=r=>(r.registered===false?0:4)+(r.status==='signin'?0:2)+(r.status==='off'?1:0);
 return out.sort((a,b)=>(rank(a)>>1)-(rank(b)>>1)||TYPE_ORDER[a.type]-TYPE_ORDER[b.type]||(rank(a)&1)-(rank(b)&1)||a.name.localeCompare(b.name))}

// may this person change it. p: {admin, level:a=>'chat'|'edit'|'owner'|null, canOn:(cap,a)=>bool}; what: level | add |
// remove | owner. Admins may do everything. An agent's owner manages its skills and apps (users.mjs OWNER_CAPS); adding
// an app copies its owner's sign-in, so it needs the owner agent too. Logins as you, plugins, keys, AdsPower and Code:
// admins only, as before.
export function mayChange(p,row,what,agent){if(p?.admin)return true;if(!p||!row)return false;const lv=a=>p.level?.(a)||null,own=a=>lv(a)==='owner',edit=a=>['edit','owner'].includes(lv(a));
 if(row.kind==='skill')return what!=='owner'&&!!agent&&edit(agent)&&!!p.canOn?.('skills',agent);
 if(row.type==='app'&&row.kind==='mcp'&&!row.own){if(what==='owner')return !!agent&&own(agent)&&own(row.owner);if(!agent||!edit(agent)||!p.canOn?.('mcp',agent))return false;return what==='add'?own(row.owner):true}
 return false}

/* ---------- the store: each app's level per agent, and its own tools setting from before ---------- */
export function createConnections({DATA,access,accounts,listAgents,listCopies=async()=>[],names=a=>a,engine,sharing,ads=null,code=null}){
 const FILE=path.join(DATA,'connections.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.levels||={};db.orig||={}}return db};
 let saving=Promise.resolve();const save=()=>saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)}).catch(e=>console.warn('connections: saving',e.message));
 // shown at once, refreshed behind (1 Nov 2026: gathering every app, login, skill and key took ~10 s, the page waited):
 // the last list per viewer is answered straight away and a newer one is gathered in the background; the owner's list is
 // kept on disk too, so it is instant after a restart. ?fresh=1 (Check now, a change) still waits for a new one
 const busy=new Set(),CACHE=path.join(DATA,'connections-cache.json');const caches=new Map(),pending=new Map();let gen=0;const drop=()=>{gen++;caches.clear();rm(CACHE,{force:true}).catch(()=>{})};   // a change: no stale list from memory or disk
 const regather=(k,only)=>{if(pending.has(k))return pending.get(k);const g0=gen;const p=gather(only).then(g=>{const c={at:Date.now(),g};if(g0===gen){caches.set(k,c);if(k==='*')writeFile(CACHE,JSON.stringify(c)).catch(()=>{})}return c}).finally(()=>pending.delete(k));pending.set(k,p);return p};
 async function cached(k,only,fresh){let c=caches.get(k);if(!c&&k==='*'&&!fresh){try{c=JSON.parse(await readFile(CACHE,'utf8'));caches.set(k,c)}catch{}}
  if(fresh||!c)return regather(k,only);if(Date.now()-c.at>20000)regather(k,only).catch(()=>{});return c}
 const skillsOf=async a=>{const r=await engine('GET','/api/skills?profile='+encodeURIComponent(a)).catch(()=>null);const l=Array.isArray(r?.j)?r.j:r?.j?.skills;return Array.isArray(l)?l:null};
 // everything, for an admin; a member gets the agents they may use only, and no logins as you, keys, AdsPower or Code
 async function gather(only){const agents=await listAgents();const seen=a=>!only||only.has(a);const acc={};
  await Promise.all(['mcp','google','plugin',...(only?[]:['key'])].map(async k=>{try{acc[k]=await access.list(k,only)}catch{acc[k]=null}}));
  const sk={};await Promise.all(agents.filter(seen).map(async a=>{const l=await skillsOf(a);if(l)sk[a]=l}));
  let ca=[];if(!only){try{ca=(await accounts.list()).items}catch{}}
  const ad=only||!ads?[]:await ads().catch(()=>[]);const cd=only||!code?null:await code().catch(()=>null);
  return {agents:agents.filter(seen).map(a=>({id:a,name:names(a)})),acc,accounts:ca,skills:sk,ads:ad,code:cd,partial:Object.entries(acc).filter(([,v])=>!v).map(([k])=>k)}}
 async function list(perm={admin:true},{fresh=false}={}){await load();const only=perm.admin?null:new Set((await listAgents()).filter(a=>perm.level?.(a)));const k=only?[...only].sort().join(','):'*';
  if(fresh){drop();access.fresh?.()}const cache=await cached(k,only,fresh);const g=cache.g;
  const rows=buildRows({...g,levels:db.levels,busy,names}).map(r=>({...r,may:{level:mayChange(perm,r,'level',r.owner)||r.users.some(u=>mayChange(perm,r,'level',u.id)),owner:mayChange(perm,r,'owner',perm.admin?r.owner:null)||g.agents.some(a=>mayChange(perm,r,'owner',a.id)),add:g.agents.some(a=>!has(r.users,a.id)&&mayChange(perm,r,'add',a.id))}}));
  return {rows,agents:g.agents,canEdit:!!perm.admin,partial:g.partial,at:cache.at}}
 async function find(key,perm){const l=await list({admin:true});const r=l.rows.find(x=>x.key===key);if(!r)throw Object.assign(new Error('That connection is gone. Reload the page.'),{status:404});return {r,agents:l.agents}}
 const check=(perm,r,what,agent)=>{if(!mayChange(perm,r,what,agent))throw Object.assign(new Error(what==='owner'?'Only an admin or the owner of both agents can move this.':'You can’t change who uses '+r.name+'. Ask an admin.'),{status:403})};
 const job=(key,fn)=>{busy.add(key);drop();return Promise.resolve().then(fn).catch(e=>console.warn('connections:',key,e.message)).finally(()=>{busy.delete(key);drop()})};
 // one app's level on an agent and its extra numbers (default--whatsapp-2 has its own settings)
 async function applyApp(r,agent){const name=r.id,lv=db.levels['mcp|'+name]?.[agent]||'full';const orig=db.orig['mcp|'+name]||={};const prov=providerOf(name).id;const out=[];const known=await toolsAny(r);
  for(const a of [agent,...(await listCopies()).filter(c=>baseOf(c)===agent&&c!==agent)]){const x=await accounts.applyTools(a,name,canOf(lv),prov,orig,null,known);out.push([a,x]);if(!x.ok)console.warn('connections: level on',a,name,x.why)}
  if(!Object.keys(orig).length)delete db.orig['mcp|'+name];await save();return out}

 // an app's tools as the owner's copy lists them, else any other agent's (the engine lists them once it connects)
 const toolsAny=async r=>{for(const a of [r.owner,...r.users.map(u=>u.id)].filter(Boolean)){const t=await accounts.toolsOf(a,r.id).catch(()=>[]);if(t.length)return t}return []};
 async function setLevel(key,agent,level,perm){const {r}=await find(key);check(perm,r,'level',agent);const u=r.users.find(x=>x.id===agent);if(!u)throw Object.assign(new Error(names(agent)+' doesn’t have '+r.name+'.'),{status:409});
  if(r.levels==='onoff'){if(!['on','off'].includes(level))throw new Error('On or Off');
   if(r.kind==='skill'){if(level==='on'&&!skillOk(r.category?r.category+'/'+r.id:r.id,agent))throw new Error(r.name+' is kept for '+(r.only||[]).map(names).join(', ')+' only.');
    const x=await engine('PUT','/api/skills/toggle?profile='+encodeURIComponent(agent),{name:r.id,enabled:level==='on'});if(!x.ok)throw new Error(x.j?.detail||'The engine did not switch it');drop();return {ok:true,level}}
   if(r.kind==='plugin'){if(level==='off')await access.revoke('plugin',r.id,agent);drop();return {ok:true,level}}}
  if(r.levels!=='level'||!LEVELS[level])throw new Error('Read, Read & draft or Full');
  if(r.type==='account'){const x=await accounts.setAgentCan(r.caId,agent,canOf(level));drop();return {ok:true,level,background:!!x.background}}
  (db.levels['mcp|'+r.id]||={})[agent]=level;if(level==='full')delete db.levels['mcp|'+r.id][agent];if(!Object.keys(db.levels['mcp|'+r.id]).length)delete db.levels['mcp|'+r.id];await save();
  job(key,()=>applyApp(r,agent));return {ok:true,level,background:true}}

 // another agent gets it: Access copies the setup and the sign-in; a login as you starts at Read (it acts as you), an
 // app at Full (as before), a skill is copied from the agent that has it on
 async function add(key,agent,perm){const {r,agents}=await find(key);if(!agents.some(a=>a.id===agent))throw new Error('Unknown agent');check(perm,r,'add',agent);if(has(r.users,agent))return {ok:true,already:true};
  if(r.kind==='skill'){const from=r.users.find(u=>u.level==='on')?.id||r.owner;const x=await sharing.share('skill',r.id,from,[agent]);if(x.failed?.length)throw new Error(x.failed[0].error);await engine('PUT','/api/skills/toggle?profile='+encodeURIComponent(agent),{name:r.id,enabled:true});drop();return {ok:true,level:'on'}}
  if(r.kind==='ads'||r.kind==='code'||r.kind==='telegram-user'||r.kind==='other')throw new Error(r.name+' belongs to one agent only.');
  if(r.bot)throw new Error('A chat bot answers as one agent only. Give the other agent its own bot instead.');
  // the owner stays the owner: Access otherwise names the first agent signed in, which a new agent can be
  if(r.owner&&!r.own&&r.kind!=='skill')await access.setOwner(r.kind,r.id,r.owner).catch(()=>{});
  await access.grant(r.kind,r.id,agent);drop();
  if(r.type==='account'&&r.caId){await accounts.scan().catch(()=>{});await accounts.setAgentCan(r.caId,agent,canOf('read')).catch(e=>console.warn('connections: read on',agent,e.message));return {ok:true,level:'read'}}
  return {ok:true,level:r.levels==='onoff'?'on':'full'}}
 async function remove(key,agent,perm){const {r}=await find(key);check(perm,r,'remove',agent);if(!has(r.users,agent))return {ok:true,already:true};
  if(r.kind==='skill'){const x=await engine('PUT','/api/skills/toggle?profile='+encodeURIComponent(agent),{name:r.id,enabled:false});if(!x.ok)throw new Error(x.j?.detail||'The engine did not switch it');drop();return {ok:true,level:'off'}}
  if(!['mcp','google','plugin','key'].includes(r.kind))throw new Error(r.name+' can only be disconnected.');
  if(agent===r.owner)throw Object.assign(new Error(names(agent)+' owns '+r.name+'. Make another agent the owner first.'),{status:409});
  await access.revoke(r.kind,r.id,agent);if(db.levels['mcp|'+r.id]){delete db.levels['mcp|'+r.id][agent];await save()}
  if(r.caId)await accounts.setAgentCan(r.caId,agent,null).catch(()=>{});drop();return {ok:true}}
 async function setOwner(key,agent,perm){const {r,agents}=await find(key);if(!agents.some(a=>a.id===agent))throw new Error('Unknown agent');check(perm,r,'owner',agent);if(r.ownerFixed)throw new Error(r.kind==='skill'?'Each agent keeps its own copy of a skill, so it has no single owner.':r.name+' stays with '+(r.ownerName||'its agent')+'.');
  if(r.owner===agent)return {ok:true,already:true};if(!has(r.users,agent))await add(key,agent,perm);await access.setOwner(r.kind,r.id,agent);drop();return {ok:true}}
 // an app off every agent: the others first (Access takes their copy and sign-in), then the owner's
 async function disconnect(key,perm){const {r}=await find(key);if(!perm.admin)throw Object.assign(new Error('Only admins can disconnect an app.'),{status:403});if(r.type!=='app'||r.kind!=='mcp'||r.own)throw new Error('Disconnect this one from its own place.');
  for(const u of r.users)if(u.id!==r.owner)await access.revoke('mcp',r.id,u.id);const x=await engine('DELETE','/api/mcp/servers/'+encodeURIComponent(r.id)+'?profile='+encodeURIComponent(r.owner));if(!x.ok&&x.status!==404)throw new Error('The engine would not remove it ('+x.status+')');
  await access.forget?.('mcp',r.id).catch(()=>{});delete db.levels['mcp|'+r.id];delete db.orig['mcp|'+r.id];await save();drop();return {ok:true}}
 // one row in full: for an app, how many of its tools each level leaves (from the owner's tool list)
 async function detail(key,perm){const l=await list(perm);const r=l.rows.find(x=>x.key===key);if(!r)throw Object.assign(new Error('That connection is gone. Reload the page.'),{status:404});let tools=null;
  if(r.kind==='mcp'&&r.levels==='level'){const t=await toolsAny(r);if(t.length)tools=toolCounts(t,providerOf(r.id).id)}
  let recent=r.recent;if(r.caId&&perm.admin){try{recent=(await accounts.actions(r.caId)).items}catch{}}return {...r,tools,recent}}
 return {list,detail,setLevel,add,remove,setOwner,disconnect,_db:load}}
