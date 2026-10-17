// Channels across agents. In Hermes every channel connection (a Telegram bot, a WhatsApp login…) belongs
// to one agent, and one connection can only be read by one agent at a time. aqeelOS shows them for the
// whole team and can hand a working connection to another agent (its settings, WhatsApp login and
// approved people move along), so nobody sets the same channel up twice.
import {readFile,writeFile,rename,cp,rm,access,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {editEnv} from './agentops.mjs';

export function createChannels({DASH,TOKEN,HERMES_HOME,listAgents,cached,restart,paused}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{signal:AbortSignal.timeout(o.timeout||60000),...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json',...(o.headers||{})}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const platforms=async a=>{const r=await api('/messaging/platforms?profile='+encodeURIComponent(a));return r.platforms||r};
 const exists=f=>access(f).then(()=>true,()=>false);
 const NOT_CHANNELS=new Set(['api_server','webhook']);   // shared by every agent already

 async function list(){const out=[];const all=await listAgents();const off=paused?await paused():{};const got=await Promise.all(all.map(a=>(cached?cached(a).then(r=>r.platforms||r):platforms(a)).catch(()=>null)));
  for(const [i,a] of all.entries()){const ps=got[i];if(!ps)continue;for(const p of ps)// only connections that exist: a switched-on but never-linked WhatsApp (a started set-up) is not one
   if(!NOT_CHANNELS.has(p.id)&&(p.configured||p.state==='connected'||off[a+'|'+p.id]))out.push({agent:a,id:p.id,name:p.name,paused:!!off[a+'|'+p.id],state:off[a+'|'+p.id]?'paused':p.state,enabled:!!p.enabled,error:p.error_message||null,error_code:p.error_code||null,account:p.account||null,needs_link:!!p.needs_link})}
  return out}

 // move one channel's connection from agent `from` to agent `to`
 async function move(platform,from,to){
  if(!/^[a-z0-9_]{1,40}$/.test(platform)||NOT_CHANNELS.has(platform))throw new Error('That channel cannot be moved.');
  const agents=await listAgents();if(!agents.includes(from)||!agents.includes(to)||from===to)throw new Error('Pick two different agents.');
  const p=(await platforms(from)).find(x=>x.id===platform);if(!p)throw new Error('Unknown channel.');
  const keys=new Set((p.env_vars||[]).map(v=>v.key));
  const target=(await platforms(to)).find(x=>x.id===platform);if(target?.configured)throw new Error(`${pretty(to)} already has its own ${p.name}. Remove it there first.`);
  // the engine can't tell a linked WhatsApp on other agents; its saved login is the real sign
  if(await exists(path.join(homeOf(to),'platforms',platform,'session','creds.json')))throw new Error(`${pretty(to)} already has its own ${p.name} login. Remove it there first.`);
  // stop the connector still using this login, so the login is never used twice at once
  {const {execFile}=await import('node:child_process');const dir=path.join(homeOf(from),'platforms',platform,'session');
   const out=await new Promise(r=>execFile('ps',['-eo','pid=,args='],(e,o)=>r(String(o||''))));
   for(const line of out.split('\n')){const m=/^\s*(\d+)\s+(.*)$/.exec(line);if(m&&m[2].includes('bridge.js')&&m[2].includes('--session '+dir))try{process.kill(Number(m[1]))}catch{}}}
  // settings: the channel's lines leave one .env and join the other
  const fromEnv=path.join(homeOf(from),'.env'),toEnv=path.join(homeOf(to),'.env');
  // both files are edited under the engine's own .env lock
  const isKey=l=>keys.has(l.split('=')[0].trim());const moving=(await readFile(fromEnv,'utf8').catch(()=>'')).split('\n').filter(isKey);
  if(moving.length){await editEnv(toEnv,cur=>{const d=cur.split('\n').filter(l=>!isKey(l));while(d.length&&d[d.length-1]==='')d.pop();return [...d,...moving,''].join('\n')});
   await editEnv(fromEnv,cur=>cur.split('\n').filter(l=>!isKey(l)).join('\n'))}
  // state (e.g. the WhatsApp login) moves too
  const fromDir=path.join(homeOf(from),'platforms',platform),toDir=path.join(homeOf(to),'platforms',platform);
  if(await exists(fromDir)){await mkdir(path.dirname(toDir),{recursive:true});await rm(toDir,{recursive:true,force:true});await cp(fromDir,toDir,{recursive:true});await rm(fromDir,{recursive:true,force:true})}
  // people already approved on this channel stay approved
  const pf=path.join(homeOf(from),'platforms','pairing'),pt=path.join(homeOf(to),'platforms','pairing');
  for(const f of await readdir(pf).catch(()=>[]))if(f.startsWith(platform)){await mkdir(pt,{recursive:true});await cp(path.join(pf,f),path.join(pt,f)).catch(()=>{})}
  await api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(from),{method:'PUT',body:JSON.stringify({enabled:false,env:{}})}).catch(()=>{});
  await api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(to),{method:'PUT',body:JSON.stringify({enabled:true,env:{}})}).catch(()=>{});
  // the proper restart (waits for replies in progress, keeps the engine in its managed session)
  if(restart)restart('moved '+platform+' from '+from+' to '+to).catch(()=>{});else await api('/gateway/restart?profile=default',{method:'POST',body:'{}'}).catch(()=>{});
  return {ok:true,moved:moving.length}}
 const pretty=a=>a==='default'?'The main agent':a;
 return {list,move};
}
