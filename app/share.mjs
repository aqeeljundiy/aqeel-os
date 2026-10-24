// Sharing abilities between agents. In the engine every agent keeps its own skills, MCP tools, plugins and
// schedules, so "share" means: copy it to the agents you pick (settings included), and "used by" means:
// which agents have one with that name. Renaming an MCP tool is copy-under-new-name, then remove the old.
import {allowed,restricted,allowedNames} from './skills-policy.mjs';
import {execFile} from 'node:child_process';
import {cp,readdir,stat,access,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {hermes as hq} from './agentops.mjs';

const HERMES=process.env.HERMES_BIN||path.join(homedir(),'.local','bin','hermes');
const NAME=/^[\w.@-]{1,80}$/;

export function createShare({DASH,TOKEN,HERMES_HOME,listAgents}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const run=(args,timeout=60000)=>args[0]==='-p'?hq(args[1],args.slice(2),{timeout:Math.max(timeout,120000)}):new Promise(res=>execFile(HERMES,args,{timeout,maxBuffer:4e6},(e,out,err)=>res({ok:!e,out:String(out||''),err:String(err||e?.message||'')})));
 const api=(p,o={})=>fetch(DASH+'/api'+p,{signal:AbortSignal.timeout(o.timeout||60000),...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json'}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
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
   else if(kind==='skill'){const src=await findSkillDir(from,name);if(!src)throw new Error('skill folder not found');const rel=path.relative(path.join(homeOf(from),'skills'),src);
    if(!allowed(rel,t))throw new Error('this skill is only for '+(allowedNames(rel).filter(a=>a!=='default').join(', ')||'the main agent'));await cp(src,path.join(homeOf(t),'skills',rel),{recursive:true,force:true})}
   else if(kind==='plugin'){const own=path.join(homeOf(from),'plugins',name);if(await stat(own).then(s=>s.isDirectory(),()=>false))await cp(own,path.join(homeOf(t),'plugins',name),{recursive:true,force:true});
    const r=await run(['-p',t,'plugins','enable',name]);if(!r.ok)throw new Error((r.err||r.out).trim().split('\n').pop())}
   else if(kind==='schedule'){const jobs=await api('/cron/jobs'+q(from));const j=(Array.isArray(jobs)?jobs:jobs.jobs||[]).find(x=>x.id===name);if(!j)throw new Error('schedule not found');
    await api('/cron/jobs'+q(t),{method:'POST',body:JSON.stringify({name:j.name,prompt:j.prompt||j.prompt_preview||'',schedule:j.schedule?.expr||j.schedule_display||j.schedule,deliver:/^bot-chat/.test(j.deliver||'')?'bot-chat:'+t:(j.deliver||'local')})})}
   else throw new Error('Unknown kind');done.push(t)}catch(e){failed.push({agent:t,error:e.message})}}
  return {done,failed}}

 async function renameMcp(agent,from,to){if(!NAME.test(from)||!NAME.test(to))throw new Error('Use letters, numbers, dots or dashes.');
  if(from===to)return {ok:true};const have=((await api('/mcp/servers'+q(agent))).servers||[]).map(x=>x.name);if(have.includes(to))throw new Error(to+' already exists. Pick another name.');
  const block=await mcpBlock(agent,from);await setMcp(agent,to,block);
  // its sign-in files are named after the tool, so they move to the new name too
  const td=path.join(homeOf(agent),'mcp-tokens');for(const s of ['.json','.meta.json','.client.json'])await rename(path.join(td,from+s),path.join(td,to+s)).catch(()=>{});
  const r=await run(['-p',agent,'config','unset','mcp_servers.'+from]);if(!r.ok)throw new Error('Copied, but the old name could not be removed.');return {ok:true}}
 /* a second copy on the same agent under another name (e.g. two AdsPower logins, or a skill to change separately) */
 async function duplicate(kind,agent,name,to){if(!NAME.test(name)||!NAME.test(to)||name===to)throw new Error('Use letters, numbers, dots or dashes, and a new name.');
  if(kind==='mcp'){const have=((await api('/mcp/servers'+q(agent))).servers||[]).map(x=>x.name);if(have.includes(to))throw new Error(to+' already exists.');await setMcp(agent,to,await mcpBlock(agent,name));return {ok:true,name:to}}
  if(kind==='skill'){const src=await findSkillDir(agent,name);if(!src)throw new Error('Skill folder not found.');const dst=path.join(path.dirname(src),to);
   if(restricted(path.relative(path.join(homeOf(agent),'skills'),src)))throw new Error('This skill is only for certain agents, so it cannot be copied under a new name.');
   if(await stat(dst).then(()=>true,()=>false))throw new Error(to+' already exists.');await cp(src,dst,{recursive:true});
   const md=path.join(dst,'SKILL.md');let t=await readFile(md,'utf8');t=t.replace(/^(---[\s\S]*?\nname:\s*)(.+)$/m,(m,a)=>a+to);await writeFile(md,t);return {ok:true,name:to}}
  throw new Error('Only MCP tools and skills can be duplicated. A plugin runs once per agent.')}
 // sign-ins return to the public site (set per tool, so the engine's own public-URL setting and its login gate stay off)
 async function prepareSignin(agent,name,redirect,client){if(!NAME.test(name))throw new Error('Bad name');const b=await mcpBlock(agent,name);if(!b?.url)throw new Error('Only tools with an address sign in this way.');
  // the public return address wins; a local callback port (what 'hermes mcp login' uses) cannot reach the person's browser
  const o={...(b.oauth||{}),redirect_uri:redirect};delete o.redirect_port;if(client?.id)o.client_id=client.id;if(client?.secret)o.client_secret=client.secret;
  const own=!!o.client_id;   // the person's own app: its settings must list our Redirect URL
  if(b.auth==='oauth'&&JSON.stringify(b.oauth||{})===JSON.stringify(o))return {ok:true,changed:false,own,url:b.url};b.auth='oauth';b.oauth=o;await setMcp(agent,name,b);return {ok:true,changed:true,own,url:b.url}}
 async function setOauthClient(agent,name,id,secret,redirect){if(!id)throw new Error('Paste the Client ID.');return prepareSignin(agent,name,redirect,{id,secret})}
 return {usedBy,share,renameMcp,python,duplicate,setOauthClient,prepareSignin};
}
