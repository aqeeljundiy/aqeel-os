// Extra channel connections for one agent ("WhatsApp 2", "Telegram 3"…). The engine allows one connection
// per app per agent, so each extra one gets a hidden linked copy of the agent: <agent>--<app>-<n>.
// The copy points at the agent's own personality, memory, skills, plugins and folders (symlinks), and its
// settings (model, tools, MCP servers…) are kept equal to the agent's, except its own channel settings.
// To the person it is the same agent on another number. Chats stay with the copy that received them.
import {readFile,writeFile,rename,rm,lstat,symlink,mkdir,stat,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

export const isLink=n=>typeof n==='string'&&n.includes('--');
export const baseOf=n=>isLink(n)?n.split('--')[0]:n;

export function createLinks({DATA,DASH,TOKEN,HERMES_HOME,python,setupAgent}){
 const FILE=path.join(DATA,'channel-links.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.links||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json'}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const SHARED=['SOUL.md','memories','skills','plugins','home','workspace'];

 // the copy's settings = the agent's settings, keeping only the copy's own channels
 const SYNC=`import sys,os
from ruamel.yaml import YAML
y=YAML();y.preserve_quotes=True
main=y.load(open(sys.argv[1])) or {}
try: link=y.load(open(sys.argv[2])) or {}
except FileNotFoundError: link={}
main.pop('platforms',None)
if 'platforms' in link: main['platforms']=link['platforms']
ms=main.get('mcp_servers')
if ms and 'aqeelos-notify' in ms: del ms['aqeelos-notify']
with open(sys.argv[2]+'.tmp','w') as f: y.dump(main,f)
os.chmod(sys.argv[2]+'.tmp',0o600);os.replace(sys.argv[2]+'.tmp',sys.argv[2])`;
 async function syncOne(name,agent){const py=await python();if(!py)throw new Error('The engine is not installed on the box.');
  await new Promise((res,rej)=>execFile(py,['-c',SYNC,path.join(homeOf(agent),'config.yaml'),path.join(homeOf(name),'config.yaml')],{timeout:30000},(e,o,er)=>e?rej(new Error(String(er||e.message).trim().split('\n').pop())):res()))}
 async function share(name,agent){for(const f of SHARED){const src=path.join(homeOf(agent),f),dst=path.join(homeOf(name),f);
   if(!await stat(src).catch(()=>null)){if(f==='SOUL.md')continue;await mkdir(src,{recursive:true})}
   const cur=await lstat(dst).catch(()=>null);if(cur?.isSymbolicLink())continue;if(cur)await rm(dst,{recursive:true,force:true});await symlink(src,dst)}}

 async function list(agent){await load();return Object.entries(db.links).filter(([,v])=>!agent||v.agent===agent).map(([name,v])=>({name,...v}))}
 async function create(agent,platform){
  if(isLink(agent))throw new Error('Pick the main agent.');if(!/^[a-z0-9_]{2,30}$/.test(platform))throw new Error('Unknown channel.');
  await stat(homeOf(agent)).catch(()=>{throw new Error('Unknown agent.')});await load();
  const taken=new Set((await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[])));let n=2;while(taken.has(`${agent}--${platform}-${n}`))n++;
  const name=`${agent}--${platform}-${n}`;if(name.length>64)throw new Error('That agent name is too long for an extra connection.');
  await api('/profiles',{method:'POST',body:JSON.stringify({name,clone_from_default:false,no_skills:true})});
  try{await share(name,agent);await syncOne(name,agent);await setupAgent?.(name)}catch(e){await remove(name).catch(()=>{});throw e}
  db.links[name]={agent,platform,n,label:null,created:Date.now()};await save();return {name,agent,platform,n}}
 async function remove(name){if(!isLink(name))throw new Error('Not an extra connection.');await load();const v=db.links[name];
  if(v)await api('/messaging/platforms/'+v.platform+'?profile='+encodeURIComponent(name),{method:'PUT',body:JSON.stringify({enabled:false,env:{}})}).catch(()=>{});
  // unhook the shared folders first, so removing the copy can never touch the agent's own files
  for(const f of SHARED){const d=path.join(homeOf(name),f);if((await lstat(d).catch(()=>null))?.isSymbolicLink())await rm(d,{force:true})}
  await api('/profiles/'+encodeURIComponent(name),{method:'DELETE'}).catch(e=>{if(!/not|no profile/i.test(e.message))throw e});
  delete db.links[name];await save()}
 async function rename_(name,label){await load();if(!db.links[name])throw new Error('Unknown connection.');db.links[name].label=String(label||'').trim().slice(0,40)||null;await save();return db.links[name]}

 // keep every copy's settings equal to its agent's (checked every minute; only rewritten after a change)
 const seen=new Map();
 async function syncAll(){await load();for(const [name,v] of Object.entries(db.links)){try{
   const m=(await stat(path.join(homeOf(v.agent),'config.yaml'))).mtimeMs;if(seen.get(name)===m)continue;
   await share(name,v.agent);await syncOne(name,v.agent);seen.set(name,m)}catch(e){console.warn('link sync',name,e.message)}}}
 setInterval(()=>syncAll().catch(()=>{}),60000).unref();setTimeout(()=>syncAll().catch(()=>{}),8000).unref();
 return {list,create,remove,rename:rename_,syncAll,isLink,baseOf};
}
