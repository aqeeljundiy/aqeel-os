// Channels across agents. In Hermes every channel connection (a Telegram bot, a WhatsApp login…) belongs
// to one agent, and one connection can only be read by one agent at a time. aqeelOS shows them for the
// whole team and can hand a working connection to another agent (its settings, WhatsApp login and
// approved people move along), so nobody sets the same channel up twice.
import {readFile,writeFile,rename,cp,rm,access,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {editEnv} from './agentops.mjs';

export function createChannels({DASH,TOKEN,HERMES_HOME,listAgents,cached,restart,paused,pendingOf,stop,moved,notify}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{signal:AbortSignal.timeout(o.timeout||60000),...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json',...(o.headers||{})}}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));return j});
 const platforms=async a=>{const r=await api('/messaging/platforms?profile='+encodeURIComponent(a));return r.platforms||r};
 const exists=f=>access(f).then(()=>true,()=>false);
 const NOT_CHANNELS=new Set(['api_server','webhook']);   // shared by every agent already

 // an agent whose list the engine did not give (it is down or slow) is named in failed, so the page never says "nothing connected"
 async function list(){const out=[],failed=[];const all=await listAgents();const off=paused?await paused():{};const got=await Promise.all(all.map(a=>(cached?cached(a).then(r=>r.platforms||r):platforms(a)).catch(()=>null)));
  for(const [i,a] of all.entries()){const ps=got[i];if(!Array.isArray(ps)){failed.push(a);continue}for(const p of ps)// only connections that exist: a switched-on but never-linked WhatsApp (a started set-up) is not one
   if(!NOT_CHANNELS.has(p.id)&&(p.configured||p.state==='connected'||off[a+'|'+p.id]))out.push({agent:a,id:p.id,name:p.name,paused:!!off[a+'|'+p.id],state:off[a+'|'+p.id]?'paused':p.state,enabled:!!p.enabled,error:p.error_message||null,error_code:p.error_code||null,account:p.account||null,identity_error:p.identity_error||null,needs_link:!!p.needs_link,updated_at:p.updated_at||null,moving:busy.get(a+'|'+p.id)?.from===a?{to:busy.get(a+'|'+p.id).to,stage:busy.get(a+'|'+p.id).stage}:null})}
  // settings changed after a WhatsApp connection started: it only reads them at start, so it needs a reconnect
  await Promise.all(out.map(async r=>{r.pending=!!(pendingOf&&r.id==='whatsapp'&&!r.paused&&r.state==='connected'&&await pendingOf(r.agent,r.id).catch(()=>false))}));
  return {channels:out,failed}}

 /* move one channel's connection from agent `from` to agent `to`. One move per channel at a time (from|platform and
    to|platform are held until it is done). Off the main agent the engine has to restart first, which can take minutes
    (replies in progress finish first): then the answer comes at once ({pending:'restart'}), the move finishes behind the
    scenes in the same safe order, the list shows it as moving, and a failure is reported through notify. */
 const busy=new Map();
 async function move(platform,from,to){
  if(!/^[a-z0-9_]{1,40}$/.test(platform)||NOT_CHANNELS.has(platform))throw new Error('That channel cannot be moved.');
  const agents=await listAgents();if(!agents.includes(from)||!agents.includes(to)||from===to)throw new Error('Pick two different agents.');
  const locks=[from+'|'+platform,to+'|'+platform];if(locks.some(k=>busy.has(k)))throw new Error('This channel is being moved already. Wait until that move finishes.');
  const job={from,to,platform,stage:'checking',t:Date.now()};for(const k of locks)busy.set(k,job);job.release=()=>{for(const k of locks)if(busy.get(k)===job)busy.delete(k)};
  let later=false;try{return await moveNow(platform,from,to,job,()=>{later=true})}finally{if(!later)job.release()}}   // a move finishing later lets go itself
 async function moveNow(platform,from,to,job,goLater){
  const p=(await platforms(from)).find(x=>x.id===platform);if(!p)throw new Error('Unknown channel.');
  const keys=new Set((p.env_vars||[]).map(v=>v.key));
  const target=(await platforms(to)).find(x=>x.id===platform);if(target?.configured)throw new Error(`${pretty(to)} already has its own ${p.name}. Remove it there first.`);
  // the engine can't tell a linked WhatsApp on other agents; its saved login is the real sign
  if(await exists(path.join(homeOf(to),'platforms',platform,'session','creds.json')))throw new Error(`${pretty(to)} already has its own ${p.name} login. Remove it there first.`);
  const put=(a,on)=>api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(a),{method:'PUT',body:JSON.stringify({enabled:on,env:{}})});
  // `from` is switched off first and must say so: otherwise the engine could start its connector again on the login being
  // copied, or both agents would read the same bot. The main agent's channels only stop with an engine restart, so that runs
  // (and finishes) before anything is copied
  let off;try{off=await put(from,false)}catch(e){throw new Error(`${pretty(from)} could not switch its ${p.name} off, so nothing moved: ${e.message}`)}
  if(from==='default'&&!off?.hot_served&&restart){job.stage='restart';goLater();
   (async()=>{try{await restart('switching '+platform+' off on the main agent to move it to '+to);job.stage='moving';await finish(platform,from,to,p,keys,true,job)}
    catch(e){if(job.stage==='restart')await put(from,true).catch(()=>{});   // the restart itself failed: nothing was copied, `from` answers again
     job.stage='failed';console.warn('channel move',platform,from,'→',to,'failed:',e.message);
     // the notice says what really happened: copied (the login and settings are on `to` now) or not (`from` is on again)
     if(job.copied)notify?.(pretty(from)+'’s '+p.name+' moved to '+pretty(to)+', but the move did not finish',e.message+' The login and settings are on '+pretty(to)+' now. Open Channels and switch '+p.name+' on there if it is off.');
     else{await put(from,true).catch(()=>{});notify?.(pretty(from)+' could not hand its '+p.name+' to '+pretty(to),e.message+' Nothing moved; '+pretty(from)+' answers it again. Try the move again from Channels.')}}
    finally{job.release()}})();
   return {ok:true,pending:'restart'}}
  return finish(platform,from,to,p,keys,false)}
 async function finish(platform,from,to,p,keys,restarted,job={}){
  const put=(a,on)=>api('/messaging/platforms/'+platform+'?profile='+encodeURIComponent(a),{method:'PUT',body:JSON.stringify({enabled:on,env:{}})});
  // then the connector still using this login stops (asked, then made to), so the login is never used twice at once
  if(stop&&platform==='whatsapp')await stop(from).catch(()=>{});
  else{const {execFile}=await import('node:child_process');const dir=path.join(homeOf(from),'platforms',platform,'session');
   const out=await new Promise(r=>execFile('ps',['-eo','pid=,args='],(e,o)=>r(String(o||''))));const pids=[];
   for(const line of out.split('\n')){const m=/^\s*(\d+)\s+(.*)$/.exec(line);if(m&&m[2].includes('bridge.js')&&m[2].includes('--session '+dir))pids.push(Number(m[1]))}
   for(const pid of pids)try{process.kill(pid,'SIGTERM')}catch{}if(pids.length){await new Promise(r=>setTimeout(r,1500));for(const pid of pids)try{process.kill(pid,'SIGKILL')}catch{}}}
  // settings: the channel's lines leave one .env and join the other
  const fromEnv=path.join(homeOf(from),'.env'),toEnv=path.join(homeOf(to),'.env');
  // both files are edited under the engine's own .env lock
  const isKey=l=>keys.has(l.split('=')[0].trim());const moving=(await readFile(fromEnv,'utf8').catch(()=>'')).split('\n').filter(isKey);
  // state (e.g. the WhatsApp login) moves too. It is copied first and the old copy removed only once both .env files
  // are done; if any step fails, the new agent's copy and lines are taken back so the login stays whole on the old one
  const fromDir=path.join(homeOf(from),'platforms',platform),toDir=path.join(homeOf(to),'platforms',platform),hasDir=await exists(fromDir);
  let had=[],toDone=false;
  try{if(hasDir){await mkdir(path.dirname(toDir),{recursive:true});await rm(toDir,{recursive:true,force:true});await cp(fromDir,toDir,{recursive:true})}
   if(moving.length){await editEnv(toEnv,cur=>{const all=cur.split('\n');had=all.filter(isKey);const d=all.filter(l=>!isKey(l));while(d.length&&d[d.length-1]==='')d.pop();return [...d,...moving,''].join('\n')});toDone=true;
    await editEnv(fromEnv,cur=>cur.split('\n').filter(l=>!isKey(l)).join('\n'))}}
  catch(e){if(toDone)await editEnv(toEnv,cur=>{const d=cur.split('\n').filter(l=>!isKey(l));while(d.length&&d[d.length-1]==='')d.pop();return [...d,...had,''].join('\n')}).catch(()=>{});
   if(hasDir)await rm(toDir,{recursive:true,force:true}).catch(()=>{});
   // nothing moved: `from` answers again
   await put(from,true).then(r=>{if(from==='default'&&!r?.hot_served&&restart)restart('move of '+platform+' failed, the main agent answers it again').catch(()=>{})},()=>{});throw e}
  job.copied=true;   // from here on the login and settings are `to`'s: a later failure must not say nothing moved
  if(hasDir)await rm(fromDir,{recursive:true,force:true}).catch(e=>console.warn('channel move: the old copy of',platform,'on',from,'was not removed:',e.message));   // `from` is off, so a leftover is never read
  // people already approved on this channel stay approved
  const pf=path.join(homeOf(from),'platforms','pairing'),pt=path.join(homeOf(to),'platforms','pairing');
  for(const f of await readdir(pf).catch(()=>[]))if(f.startsWith(platform)){await mkdir(pt,{recursive:true});await cp(path.join(pf,f),path.join(pt,f)).catch(()=>{})}
  // `from` is really off by now, so `to` may start reading it. on:false tells the page the move worked but the channel still has to be switched on
  let onR=null;const on=await put(to,true).then(r=>{onR=r;return true},()=>false);
  // the proper restart (waits for replies in progress, keeps the engine in its managed session), unless it ran already and `to` took it live
  if(!(restarted&&onR?.hot_served&&to!=='default')){if(restart)restart('moved '+platform+' from '+from+' to '+to).catch(()=>{});else await api('/gateway/restart?profile=default',{method:'POST',body:'{}'}).catch(()=>{})}
  await Promise.resolve(moved?.(platform,from,to)).catch(e=>console.warn('after moving',platform,e.message));return {ok:true,moved:moving.length,on}}
 const pretty=a=>a==='default'?'The main agent':a;
 return {list,move};
}
