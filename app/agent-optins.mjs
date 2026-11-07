// Abilities an agent gets only when switched on (7 Nov 2026, owner): AdsPower (browser profiles: about 96 processes and
// 6 GB on the box when every agent had it) and Composio (it asked every agent for a sign-in). Off by default: new agents
// and a clean install have neither. Edit agent › Abilities switches them; when off, the agent has no AdsPower copy,
// screen or tool and no Composio entry, so nothing asks for a sign-in.
// The first start with this file keeps each one only for agents that really used it: tool calls that ran (role "tool"
// in the engine's state.db, the last 14 days), never mentions in logs.
import {readFile,writeFile,rename,mkdir,copyFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

export const KINDS={adspower:'Browser profiles (AdsPower)',composio:'Composio apps'};
export const COMPOSIO=/connect\.composio\.dev|rube\.app|composio/i;
export const baseOf=a=>String(a).split('--')[0];
// the MCP names one agent's tools of a kind run under: AdsPower's own name, and whatever name its Composio entry has
export function toolNames(config){const out={adspower:['AdsPower'],composio:[]};for(const [n,e] of Object.entries(config?.mcp_servers||{}))if(e&&COMPOSIO.test(String(e.url||'')))out.composio.push(n);
 if(!out.composio.length)out.composio.push('composio');return out}
// counts per agent: {agent:{adspower:{n,last},composio:{n,last}}}, copies (default--whatsapp-2) counted for their agent
export function decide(counts,agents){const on={adspower:{},composio:{}};
 for(const a of agents){const b=baseOf(a);for(const k of Object.keys(on)){const c=counts?.[a]?.[k];if(c&&c.n>0)on[k][b]=true}}
 return on}

// python: the engine's own (it has sqlite3); reads each state.db read-only
const PY=`import sqlite3,json,sys,time
q=json.loads(sys.argv[1]);cut=time.time()-q["days"]*86400;out={}
for a,spec in q["agents"].items():
  r={}
  try:
    c=sqlite3.connect("file:"+spec["db"]+"?mode=ro",uri=True)
    for k,names in spec["names"].items():
      n=0;last=0
      for nm in names:
        row=c.execute("select count(*),max(timestamp) from messages where role='tool' and timestamp>? and (tool_name like ? or tool_name like ?)",(cut,"mcp__"+nm+"__%","mcp_"+nm+"_%")).fetchone()
        n+=row[0] or 0;last=max(last,row[1] or 0)
      r[k]={"n":n,"last":last}
  except Exception as e:r={"error":str(e)}
  out[a]=r
print(json.dumps(out))`;

export function createOptins({DATA,HERMES_HOME,listAgents,readConfig,python,live=false,note=async()=>{},log=m=>console.log(m),run=null,now=()=>Date.now()}){
 const FILE=path.join(DATA,'agent-optins.json');let db=null;
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const load=async()=>db||=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>null);
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)};
 const exec=run||((cmd,args)=>new Promise(res=>execFile(cmd,args,{timeout:120000,maxBuffer:8e6},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||e?.message||'')}))));

 // on for this agent? Copies follow their agent. Before the first-start count has run, everything stays as it was (on),
 // so nothing is stopped before the count decides; after it, an agent not listed is off.
 async function on(kind,a){await load();if(!db?.migration)return true;return !!db?.[kind]?.[baseOf(a)]}
 async function set(kind,a,v){if(!KINDS[kind])throw Error('Unknown ability');await load();db||={v:1};db[kind]||={};if(v)db[kind][baseOf(a)]=true;else delete db[kind][baseOf(a)];await save();log('abilities: '+KINDS[kind]+' '+(v?'on':'off')+' for '+baseOf(a))}
 async function state(a){await load();return Object.fromEntries(Object.keys(KINDS).map(k=>[k,{on:!!db?.[k]?.[baseOf(a)],label:KINDS[k],used:db?.migration?.counts?.[baseOf(a)]?.[k]||null}]))}

 async function usage(days=14){const agents=await listAgents();const spec={};
  for(const a of agents){const c=await readConfig(a).catch(()=>null)||{};const db_=path.join(home(a),'state.db');if(!await stat(db_).catch(()=>null))continue;spec[a]={db:db_,names:toolNames(c)}}
  const py=await python();if(!py)throw Error('the engine’s Python was not found');
  const r=await exec(py,['-c',PY,JSON.stringify({days,agents:spec})]);if(!r.ok)throw Error('counting tool calls failed: '+r.err.slice(0,200));
  const raw=JSON.parse(r.out.trim().split('\n').pop()||'{}'),out={};
  // copies count for their agent
  for(const [a,v] of Object.entries(raw)){const b=baseOf(a);out[b]||={};for(const k of Object.keys(KINDS)){const x=v?.[k];if(!x)continue;const cur=out[b][k]||{n:0,last:0};out[b][k]={n:cur.n+x.n,last:Math.max(cur.last,x.last)}}}
  return {agents,counts:out}}

 // once: before this, every agent had both. Backups first (the AdsPower ports file and each agent's config.yaml that
 // will lose its Composio entry), then the switches from real use; the result goes to the log and the Activity feed.
 async function migrate({force=false}={}){await load();if(db?.migration&&!force)return null;if(!live&&!force)return null;
  const {agents,counts}=await usage(14);const dec=decide(counts,agents);const stamp=new Date(now()).toISOString().slice(0,19).replace(/[-:T]/g,'');
  const bak=[];const cp=async f=>{if(await stat(f).catch(()=>null)){await copyFile(f,f+'.bak-optins-'+stamp);bak.push(f+'.bak-optins-'+stamp)}};
  await cp(path.join(DATA,'agent-adspower.json'));for(const a of agents){const c=await readConfig(a).catch(()=>null)||{};if(!dec.composio[baseOf(a)]&&toolNames(c).composio.some(n=>c.mcp_servers?.[n]))await cp(path.join(home(a),'config.yaml'))}
  db={v:1,adspower:dec.adspower,composio:dec.composio,migration:{at:now(),days:14,counts,backups:bak}};await save();
  const bases=[...new Set(agents.map(baseOf))],kept=k=>bases.filter(b=>dec[k][b]),fmt=l=>l.length?l.join(', '):'nobody';
  const text='AdsPower kept for '+fmt(kept('adspower'))+'; Composio kept for '+fmt(kept('composio'))+'. Everyone else has them off (no tool call in 14 days). Switch them on per agent in Edit agent › Abilities.';
  log('abilities: first start: '+text+' Backups: '+bak.length);await note('AdsPower and Composio are now per agent',text).catch(()=>{});
  return {decision:dec,counts,backups:bak,text}}

 return {on,set,state,usage,migrate,load}}
