// Sharing abilities between agents. In the engine every agent keeps its own skills, MCP tools, plugins and
// schedules, so "share" means: copy it to the agents you pick (settings included), and "used by" means:
// which agents have one with that name. Renaming an MCP tool is copy-under-new-name, then remove the old.
import {execFile} from 'node:child_process';
import {cp,readdir,stat,access} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';

const HERMES=process.env.HERMES_BIN||path.join(homedir(),'.local','bin','hermes');
const NAME=/^[\w.@-]{1,80}$/;

export function createShare({DASH,TOKEN,HERMES_HOME,listAgents}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const run=(args,timeout=60000)=>new Promise(res=>execFile(HERMES,args,{timeout,maxBuffer:4e6},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
 const api=(p,o={})=>fetch(DASH+'/api'+p,{...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json'}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const q=a=>'?profile='+encodeURIComponent(a);
 // the engine's Python reads YAML; used to lift one MCP block out of an agent's config as JSON
 let py=null;async function python(){if(py)return py;const base=path.join(HERMES_HOME,'installs');
  // several old environments can sit side by side; take the newest one that can read YAML
  const found=[];for(const i of await readdir(base).catch(()=>[]))for(const e of await readdir(path.join(base,i,'environments')).catch(()=>[])){const p=path.join(base,i,'environments',e,'venv','bin','python');const s=await stat(p).catch(()=>null);if(s)found.push([s.mtimeMs,p])}
  for(const [,p] of found.sort((a,b)=>b[0]-a[0])){const ok=await new Promise(r=>execFile(p,['-c','import ruamel.yaml'],{timeout:10000},e=>r(!e)));if(ok){py=p;return py}}return null}
 async function mcpBlock(agent,name){const p=await python();if(!p)throw new Error('The engine is not installed as expected.');
  return new Promise((res,rej)=>execFile(p,['-c','import sys,json;from ruamel.yaml import YAML;c=YAML(typ="safe").load(open(sys.argv[1]))or{};print(json.dumps((c.get("mcp_servers")or{}).get(sys.argv[2]),default=str))',path.join(homeOf(agent),'config.yaml'),name],{timeout:20000},(e,out)=>{if(e)return rej(e);const v=JSON.parse(String(out||'null'));v?res(v):rej(new Error('That tool is not on '+agent+'.'))}))}
 const setMcp=async(agent,name,block)=>{const r=await run(['-p',agent,'config','set','mcp_servers.'+name,JSON.stringify(block)]);if(!r.ok)throw new Error((r.err||r.out).trim().split('\n').pop())};

 /* which agents have each item */
 async function usedBy(kind){const out={};for(const a of await listAgents()){let names=[];
  try{if(kind==='skill')names=((await api('/skills'+q(a))).skills||(await api('/skills'+q(a)))||[]).filter(s=>s.enabled!==false).map(s=>s.name);
   else if(kind==='mcp')names=((await api('/mcp/servers'+q(a))).servers||[]).map(s=>s.name);
   else if(kind==='plugin')names=((await api('/dashboard/plugins/hub'+q(a))).plugins||[]).filter(p=>p.runtime_status==='enabled').map(p=>p.name)}catch{}
  for(const n of names)(out[n]||=[]).push(a)}return out}

 async function findSkillDir(agent,name){const root=path.join(homeOf(agent),'skills');
  const walk=async(d,depth)=>{for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[])){if(!e.isDirectory()||e.name.startsWith('.'))continue;const p=path.join(d,e.name);
   if(e.name===name&&await access(path.join(p,'SKILL.md')).then(()=>1,()=>0))return p;if(depth<3){const f=await walk(p,depth+1);if(f)return f}}return null};
  return walk(root,0)}

 /* copy one item from agent `from` to each agent in `to` */
 async function share(kind,name,from,to){if(!NAME.test(name))throw new Error('Bad name');const agents=await listAgents();const done=[],failed=[];
  for(const t of to){if(!agents.includes(t)||t===from)continue;try{
   if(kind==='mcp')await setMcp(t,name,await mcpBlock(from,name));
   else if(kind==='skill'){const src=await findSkillDir(from,name);if(!src)throw new Error('skill folder not found');const rel=path.relative(path.join(homeOf(from),'skills'),src);await cp(src,path.join(homeOf(t),'skills',rel),{recursive:true,force:true})}
   else if(kind==='plugin'){const own=path.join(homeOf(from),'plugins',name);if(await stat(own).then(s=>s.isDirectory(),()=>false))await cp(own,path.join(homeOf(t),'plugins',name),{recursive:true,force:true});
    const r=await run(['-p',t,'plugins','enable',name]);if(!r.ok)throw new Error((r.err||r.out).trim().split('\n').pop())}
   else if(kind==='schedule'){const jobs=await api('/cron/jobs'+q(from));const j=(Array.isArray(jobs)?jobs:jobs.jobs||[]).find(x=>x.id===name);if(!j)throw new Error('schedule not found');
    await api('/cron/jobs'+q(t),{method:'POST',body:JSON.stringify({name:j.name,prompt:j.prompt||j.prompt_preview||'',schedule:j.schedule?.expr||j.schedule_display||j.schedule,deliver:/^bot-chat/.test(j.deliver||'')?'bot-chat:'+t:(j.deliver||'local')})})}
   else throw new Error('Unknown kind');done.push(t)}catch(e){failed.push({agent:t,error:e.message})}}
  return {done,failed}}

 async function renameMcp(agent,from,to){if(!NAME.test(from)||!NAME.test(to))throw new Error('Use letters, numbers, dots or dashes.');
  const block=await mcpBlock(agent,from);await setMcp(agent,to,block);const r=await run(['-p',agent,'config','unset','mcp_servers.'+from]);if(!r.ok)throw new Error('Copied, but the old name could not be removed.');return {ok:true}}
 return {usedBy,share,renameMcp};
}
