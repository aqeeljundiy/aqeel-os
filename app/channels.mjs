// Channels across agents. In Hermes every channel connection (a Telegram bot, a WhatsApp login…) belongs
// to one agent, and one connection can only be read by one agent at a time. aqeelOS shows them for the
// whole team and can hand a working connection to another agent (its settings, WhatsApp login and
// approved people move along), so nobody sets the same channel up twice.
import {readFile,writeFile,rename,cp,rm,access,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';

export function createChannels({DASH,TOKEN,HERMES_HOME,listAgents,cached}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json',...(o.headers||{})}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const platforms=async a=>{const r=await api('/messaging/platforms?profile='+encodeURIComponent(a));return r.platforms||r};
 const exists=f=>access(f).then(()=>true,()=>false);
 const NOT_CHANNELS=new Set(['api_server','webhook']);   // shared by every agent already

 async function list(){const out=[];const all=await listAgents();const got=await Promise.all(all.map(a=>(cached?cached(a).then(r=>r.platforms||r):platforms(a)).catch(()=>null)));
  for(const [i,a] of all.entries()){const ps=got[i];if(!ps)continue;for(const p of ps)if(!NOT_CHANNELS.has(p.id)&&(p.configured||p.enabled))out.push({agent:a,id:p.id,name:p.name,state:p.state,enabled:!!p.enabled,error:p.error_message||null})}
  return out}

 // move one channel's connection from agent `from` to agent `to`
 async function move(platform,from,to){
  if(!/^[a-z0-9_]{1,40}$/.test(platform)||NOT_CHANNELS.has(platform))throw new Error('That channel cannot be moved.');
  const agents=await listAgents();if(!agents.includes(from)||!agents.includes(to)||from===to)throw new Error('Pick two different agents.');
  const p=(await platforms(from)).find(x=>x.id===platform);if(!p)throw new Error('Unknown channel.');
  const keys=new Set((p.env_vars||[]).map(v=>v.key));
  const target=(await platforms(to)).find(x=>x.id===platform);if(target?.configured)throw new Error(`${pretty(to)} already has its own ${p.name}. Remove it there first.`);
  // settings: the channel's lines leave one .env and join the other
  const fromEnv=path.join(homeOf(from),'.env'),toEnv=path.join(homeOf(to),'.env');
  const src=(await readFile(fromEnv,'utf8').catch(()=>'')).split('\n');const moving=src.filter(l=>keys.has(l.split('=')[0].trim()));
  let dst=(await readFile(toEnv,'utf8').catch(()=>'')).split('\n').filter(l=>!keys.has(l.split('=')[0].trim()));
  if(moving.length){while(dst.length&&dst[dst.length-1]==='')dst.pop();dst.push(...moving,'');await writeFile(toEnv+'.tmp',dst.join('\n'),{mode:0o600});await rename(toEnv+'.tmp',toEnv);
   const rest=src.filter(l=>!keys.has(l.split('=')[0].trim()));await writeFile(fromEnv+'.tmp',rest.join('\n'),{mode:0o600});await rename(fromEnv+'.tmp',fromEnv)}
  // state (e.g. the WhatsApp login) moves too
  const fromDir=path.join(homeOf(from),'platforms',platform),toDir=path.join(homeOf(to),'platforms',platform);
  if(await exists(fromDir)){await mkdir(path.dirname(toDir),{recursive:true});await rm(toDir,{recursive:true,force:true});await cp(fromDir,toDir,{recursive:true});await rm(fromDir,{recursive:true,force:true})}
  // people already approved on this channel stay approved
  const pf=path.join(homeOf(from),'platforms','pairing'),pt=path.join(homeOf(to),'platforms','pairing');
  for(const f of await readdir(pf).catch(()=>[]))if(f.startsWith(platform)){await mkdir(pt,{recursive:true});await cp(path.join(pf,f),path.join(pt,f)).catch(()=>{})}
  await api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(from),{method:'PUT',body:JSON.stringify({enabled:false,env:{}})}).catch(()=>{});
  await api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(to),{method:'PUT',body:JSON.stringify({enabled:true,env:{}})}).catch(()=>{});
  await api('/gateway/restart?profile=default',{method:'POST',body:'{}'}).catch(()=>{});
  return {ok:true,moved:moving.length}}
 const pretty=a=>a==='default'?'The main agent':a;
 return {list,move};
}
