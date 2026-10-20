// Access: for every connection (a connected app, a Google account, a plugin, a key) which agent owns it and which
// other agents may use it. The owner is where it was signed in or added; sharing copies the setup and the sign-in
// to another agent (no new sign-in), taking it away removes it there. The owner itself can't be taken away:
// move ownership first. Changes to apps, plugins and keys apply when the agents restart (once nobody is mid-reply).
import {readFile,writeFile,readdir,stat,mkdir,copyFile,unlink,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {constants as fsc} from 'node:fs';
import path from 'node:path';

// keys that are the engine's own wiring, or a chat bot's identity (one bot answers as one agent only)
const KEY_SKIP=/^(HERMES_|API_SERVER_|GATEWAY_|TERMINAL_)|_(ALLOWED_USERS|HOME_CHANNEL|ALLOWED_CHANNELS)$/;
const KEY_BOT=/^(SLACK_BOT_TOKEN|SLACK_APP_TOKEN|TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|WHATSAPP_.*|SIGNAL_.*|TEAMS_.*)$/;
const KEY_SECRET=/(KEY|TOKEN|SECRET|PASSWORD|PASS)$/;
const h8=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,8);
const readJson=async f=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return null}};

// own: connections where every agent has its own account instead of a shared sign-in (n8n): turning one on makes
// that agent's own account, and there is no owner agent to pick (the label says who owns the service itself)
export function createAccess({HERMES_HOME,DATA,listAgents,readConfig,setKey,hermes,editEnv,names,writeJson,restart,dash,own={}}){
 // each agent's settings, kept for 30 s: reading them starts a small program per agent (1-2 s each), and the box
 // that offers "use another agent's" has just read them, so the click goes straight to saving
 const cfgCache=new Map();const readConfigRaw=readConfig;readConfig=async a=>{const c=cfgCache.get(a);if(c&&Date.now()-c.at<30000)return c.v;const v=await readConfigRaw(a);cfgCache.set(a,{v,at:Date.now()});return v};
 const hermesRaw=hermes;hermes=async(a,...r)=>{cfgCache.delete(a);try{return await hermesRaw(a,...r)}finally{cfgCache.delete(a)}};
 const setKeyRaw=setKey;setKey=async(a,...r)=>{cfgCache.delete(a);try{return await setKeyRaw(a,...r)}finally{cfgCache.delete(a)}};
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const REG=path.join(DATA,'access.json');let reg=null;
 const loadReg=async()=>reg||(reg=(await readJson(REG))||{owners:{}});
 const saveReg=()=>writeJson(REG,reg);
 const order=list=>[...list].sort((x,y)=>(x==='default'?-1:y==='default'?1:x.localeCompare(y)));

 // a Google sign-in file that doesn't say whose it is: ask Google once (Drive "about"), then note it in the file
 const emails=new Map();
 async function emailOf(f,j){const k=h8(j.refresh_token||f);if(emails.has(k))return emails.get(k);let email='';
  try{const t=await fetch(j.token_uri||'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:j.client_id,client_secret:j.client_secret,refresh_token:j.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)}).then(r=>r.json());
   if(t.access_token){const u=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',{headers:{authorization:'Bearer '+t.access_token},signal:AbortSignal.timeout(15000)}).then(r=>r.json());email=u.user?.emailAddress||''}
   if(email){const cur=await readJson(f);if(cur&&!cur.account){cur.account=email;await writeFile(f,JSON.stringify(cur),{mode:0o600})}}}catch{}
  emails.set(k,email);return email}
 // what one agent has, per kind: id → {label, detail, signed (for sign-in apps), fp (same sign-in or value)}
 async function holdings(a){const out={mcp:{},google:{},plugin:{},key:{}};const c=await readConfig(a).catch(()=>null)||{};
  for(const [n,v] of Object.entries(c.mcp_servers||{})){if(n==='aqeelos-notify'||!v||typeof v!=='object')continue;
   const tok=await readJson(path.join(home(a),'mcp-tokens',n+'.json'));const oauth=v.auth==='oauth';
   out.mcp[n]={label:n,detail:v.url||v.command||'',oauth,signed:!oauth||!!tok,fp:tok?h8(tok.refresh_token||tok.access_token||''):'',off:v.enabled===false}}
  for(const f of await readdir(home(a)).catch(()=>[])){const m=/^google_token(?:_([\w.-]+))?\.json$/.exec(f);if(!m)continue;const j=await readJson(path.join(home(a),f));if(!j)continue;
   if(!j.account)j.account=await emailOf(path.join(home(a),f),j);if(!j.account)continue;
   out.google[j.account]={label:j.account,detail:'Gmail, Drive, Sheets, Docs, Calendar',file:f,signed:!!j.refresh_token,fp:h8(j.account)}}
  for(const n of c.plugins?.enabled||[])out.plugin[n]={label:n,detail:'',signed:true,fp:n};
  const env=await readFile(path.join(home(a),'.env'),'utf8').catch(()=>'');
  for(const l of env.split('\n')){const m=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);if(!m||KEY_SKIP.test(m[1])||!KEY_SECRET.test(m[1]))continue;const v=m[2].trim().replace(/^["']|["']$/g,'');if(!v)continue;
   out.key[m[1]+'@'+h8(v)]={label:m[1],detail:KEY_BOT.test(m[1])?'A chat bot: it answers as one agent only':'',bot:KEY_BOT.test(m[1]),signed:true,fp:h8(v),name:m[1],value:v}}
  return out}

 // every connection of a kind across the agents, with its owner and the agents that use it
 // only: the agents this person may use (null = all). Owners are worked out over every agent either way.
 async function list(kind,only=null){await loadReg();const agents=order(await listAgents());const seen=a=>!only||only.has(a);const per={};for(const a of agents)per[a]=(await holdings(a))[kind];
  const ids=new Set();for(const a of agents)for(const id of Object.keys(per[a]))ids.add(id);const items=[];
  for(const id of ids){const users=agents.filter(a=>per[a][id]);const signed=users.filter(a=>per[a][id].signed);
   let owner=reg.owners[kind+'|'+id];if(!users.includes(owner))owner=signed[0]||users[0];
   if(!users.some(seen))continue;const x=per[owner][id];const o=kind==='mcp'&&own[id];items.push({kind,id,label:x.label,detail:x.detail,bot:!!x.bot,owner,ownerName:o?o.owner:names(owner),own:!!o,ownNote:o?.note||'',
    users:users.filter(seen).map(a=>({id:a,name:names(a),signed:per[a][id].signed})),ownerSigned:per[owner][id].signed})}
  return {agents:agents.filter(seen).map(a=>({id:a,name:names(a)})),items:items.sort((p,q)=>p.label.localeCompare(q.label))}}

 async function find(kind,id){const l=await list(kind);const it=l.items.find(x=>x.id===id);if(!it)throw new Error('That connection is gone. Reload the page.');return it}

 async function grant(kind,id,to){const it=await find(kind,id);const from=it.owner;if(to===from)return {changed:false};
  if(kind==='mcp'&&own[id]){await own[id].grant(to);return {changed:true}}
  const src=(await holdings(from))[kind][id];
  if(kind==='mcp'){const c=await readConfig(from);const entry=c?.mcp_servers?.[id];if(!entry)throw new Error('The owner no longer has it.');
   const r=await setKey(to,'mcp_servers.'+id,entry);if(!r.ok)throw new Error(r.err||'Could not save');
   const td=path.join(home(from),'mcp-tokens'),dd=path.join(home(to),'mcp-tokens');await mkdir(dd,{recursive:true,mode:0o700});
   for(const f of await readdir(td).catch(()=>[]))if(f===id+'.json'||f===id+'.meta.json'||f===id+'.client.json')await copyFile(path.join(td,f),path.join(dd,f));
   restart('access: '+id+' shared with '+names(to));return {changed:true}}
  if(kind==='google'){const mine=Object.values((await holdings(to)).google).find(x=>x.label===id);if(mine)return {changed:false};
   // a free name from the whole address (two accounts can share the part before @), never over another account's file
   let f=src.file;const base='google_token_'+id.replace(/[^\w-]/g,'_').toLowerCase();for(let n=1;await stat(path.join(home(to),f)).catch(()=>null);n++)f=base+(n>1?'_'+n:'')+'.json';
   await copyFile(path.join(home(from),src.file),path.join(home(to),f),fsc.COPYFILE_EXCL);
   if(!await stat(path.join(home(to),'google_client_secret.json')).catch(()=>null))await copyFile(path.join(home(from),'google_client_secret.json'),path.join(home(to),'google_client_secret.json')).catch(()=>{});
   return {changed:true}}
  if(kind==='plugin'){const d=path.join(home(to),'plugins',id);const s0=path.join(home(from),'plugins',id);if(!await stat(d).catch(()=>null)&&await stat(s0).catch(()=>null))await cp(s0,d,{recursive:true});
   const r=await hermes(to,['plugins','enable',id],{timeout:150000});if(!r.ok)throw new Error(r.out?.slice(-200)||'Could not turn it on');restart('access: plugin '+id+' on '+names(to));return {changed:true}}
  if(kind==='key'){if(src.bot)throw new Error('A chat bot answers as one agent only. Give the other agent its own bot instead.');
   // the other agent may have its own key under the same name: never replace it silently
   {const theirs=Object.values((await holdings(to)).key).find(x=>x.name===src.name);if(theirs&&theirs.value!==src.value)throw new Error(names(to)+' already has its own '+src.name+'. Remove it there first if you want to replace it.')}
   await editEnv(path.join(home(to),'.env'),cur=>{const lines=cur.split('\n').filter(l=>!l.startsWith(src.name+'='));lines.push(src.name+'='+src.value);return lines.join('\n').replace(/^\n+/,'')});
   restart('access: '+src.name+' shared with '+names(to));return {changed:true}}
  throw new Error('Unknown kind')}

 async function revoke(kind,id,from){const it=await find(kind,id);if(from===it.owner&&!it.own)throw new Error(names(from)+' owns it. Make another agent the owner first.');
  const mine=(await holdings(from))[kind][id];if(!mine)return {changed:false};
  if(kind==='mcp'){await dash('DELETE','/api/mcp/servers/'+encodeURIComponent(id)+'?profile='+encodeURIComponent(from));
   for(const f of [id+'.json',id+'.meta.json',id+'.client.json'])await unlink(path.join(home(from),'mcp-tokens',f)).catch(()=>{});
   restart('access: '+id+' taken from '+names(from));return {changed:true}}
  if(kind==='google'){await unlink(path.join(home(from),mine.file));return {changed:true}}
  if(kind==='plugin'){const r=await hermes(from,['plugins','disable',id],{timeout:150000});if(!r.ok)throw new Error(r.out?.slice(-200)||'Could not turn it off');restart('access: plugin '+id+' off on '+names(from));return {changed:true}}
  if(kind==='key'){await editEnv(path.join(home(from),'.env'),cur=>cur.split('\n').filter(l=>!l.startsWith(mine.name+'=')).join('\n'));restart('access: '+mine.name+' taken from '+names(from));return {changed:true}}
  throw new Error('Unknown kind')}

 async function setOwner(kind,id,agent){const it=await find(kind,id);if(it.own)throw new Error(it.label+' has no owner agent: '+it.ownNote);if(!it.users.some(u=>u.id===agent))throw new Error(names(agent)+' doesn’t have it yet. Turn it on first.');
  await loadReg();reg.owners[kind+'|'+id]=agent;await saveReg();return {ok:true}}

 return {list,grant,revoke,setOwner}}
