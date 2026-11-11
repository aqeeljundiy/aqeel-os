// Memory watchdog (OPS-17, 11 Nov 2026). The AI box is a container with its own memory limit (Elkiya: 28 GB of the
// host's 47 GB, no swap); free/meminfo show the host and say "15 GB available" while the container is at 98% of its
// limit, page cache squeezed out and two processes killed so far. So this reads the container's own numbers: what it
// holds (memory.current) minus the cache it can drop at once (inactive_file), against memory.max.
// Every 2 minutes, when less than 15% of the limit is free, one step per pass (each waits for the last to take effect):
//  1. idle agents' screens go to sleep (they wake on use) and idle agents that never sleep (their own AdsPower) keep
//     only their newest tabs;
//  2. the biggest idle agent Chrome or AdsPower is started again (at most one every 15 minutes);
//  3. the engine is restarted gracefully (it waits for idle, as every engine restart does) when it holds 3 GB or more,
//     at most once in 6 hours; then back to 2.
// Idle: no engine session of the agent running (a reply, a schedule, a webhook), not in ~/.aqeelos-agent-busy, and no
// use of its screen (wake proxy .active, .screen/activity) for 10 minutes. Screens and browsers belong to the agents'
// own Linux users, so steps 1 and 2 are requests to the root script (scripts/agent-users.sh, $REQ.mem), which checks
// the agent is still idle before it acts. The owner hears once per low-memory spell, with what was done.
// It also keeps what each app holds (an hourly mean, 2 days) for System › Health: a line per app, and a warning for one
// that grew by 1 GB and a third in a day.
import {readFile,writeFile,rename,mkdir,stat,appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

export const LOW=0.15,OK=0.25,IDLE_MIN=10,PASS_GAP=100e3,RECYCLE_GAP=15*60e3,ENGINE_GAP=6*3600e3,ENGINE_BIG=3*2**30,RECYCLE_MIN=2**30;
const GB=2**30,gb=b=>(b/1e9).toFixed(1)+' GB';   // shown like the app shows sizes (1 GB = 10^9 bytes)

// the container's numbers: {used,limit,free} (free as a share of the limit), or null when there is no limit
export function containerMem(current,max,statText){const cur=Number(current),lim=Number(max);if(!(cur>0)||!(lim>0)||!Number.isFinite(lim))return null;
 const inact=Number((/^inactive_file (\d+)/m.exec(String(statText||''))||[])[1]||0),used=Math.max(0,cur-inact);
 return {used,limit:lim,free:Math.max(0,(lim-used)/lim)}}

// which app a process belongs to, from "user rss args"
export function appOf(user,args){const a=String(args||''),ag=/^ag-(.+)$/.exec(user||'')?.[1];
 if(/adspower_global|SunBrowser|rpa\.min\.js/.test(a))return ag?'AdsPower · '+ag:'AdsPower (shared)';
 if(/\/chrome(\s|$)|chrome-linux64|chrome-headless-shell|chrome_crashpad/.test(a))return ag?'Chrome · '+ag:'Engine browsers';
 if(/python3? -I -c import os, re, sys/.test(a))return / gateway\s*$/.test(a)?'Engine':/ dashboard( |$)/.test(a)?'Engine dashboard':'Engine (other)';
 if(/\/bin\/claude -p |\bcodex\b|gemini\.js/.test(a))return 'Model programs';
 if(/next-server|next dev|next start|vite|webpack/.test(a))return 'Web apps and dev servers';
 if(/hermes-ui\/app\/server\.mjs|aq-stage\/app\/server\.mjs/.test(a))return 'aqeelOS app';
 if(/billion-context/.test(a))return 'Billion-context';
 if(/^postgres/.test(a))return 'Postgres';
 if(/Xvnc|Xvfb|xfce|xfwm|xfdesktop|fluxbox|x11vnc|websockify/.test(a))return ag?'Desktop · '+ag:'Desktop';
 return ag?'Other · '+ag:'Other'}
// "user rss args" lines → Map app → bytes
export function appsFrom(psText){const m=new Map();for(const l of String(psText||'').split('\n')){const x=/^\s*(\S+)\s+(\d+)\s+(.*)$/.exec(l);if(!x)continue;
 const k=appOf(x[1],x[3]);m.set(k,(m.get(k)||0)+Number(x[2])*1024)}return m}

// hourly points per app [{t,b}] → growth over the last day: {from,to} when it grew 1 GB or more and by a third or more
export function grew(points,now){const p=(points||[]).filter(x=>x.t>now-26*3600e3);if(p.length<2)return null;const first=p[0],last=p.at(-1);
 if(last.t-first.t<6*3600e3)return null;const from=Math.min(...p.slice(0,Math.max(1,Math.ceil(p.length/4))).map(x=>x.b));
 return last.b-from>=GB&&last.b>=from*4/3?{from,to:last.b,hours:Math.round((last.t-first.t)/3600e3)}:null}

// One pass. input: {free,used,limit,agents:[{name,busy,idleMin,asleep,canSleep,chrome,ads}],engine:{bytes,restarting},apps:[[name,bytes]]}
// st: what is kept between passes. Returns {st,actions,alert}; actions: {kind:'sleep'|'tabs'|'recycle'|'engine',agent,what,bytes}
export function plan(input,st={},now=Date.now()){st={...st};const free=Number(input?.free);const out=a=>({st,actions:a,alert:null});
 if(!Number.isFinite(free))return out([]);
 if(free>=OK){st.spell=null;return out([])}
 if(free>=LOW)return out([]);
 const sp=st.spell=st.spell?{...st.spell,done:[...st.spell.done]}:{since:now,step:0,last:0,done:[],told:false};
 if(now-sp.last<PASS_GAP)return out([]);
 const idle=(input.agents||[]).filter(a=>!a.busy&&a.idleMin>=IDLE_MIN);let actions=[];
 for(let tries=0;tries<3&&!actions.length;tries++){
  if(sp.step===0){sp.step=1;
   actions=[...idle.filter(a=>a.canSleep&&!a.asleep).map(a=>({kind:'sleep',agent:a.name,bytes:(a.chrome||0)})),
    ...idle.filter(a=>!a.canSleep&&!a.asleep).map(a=>({kind:'tabs',agent:a.name}))]}
  else if(sp.step===1){sp.step=2;
   // one started again in the last hour is not again (if it grew back that fast, a restart is not the answer)
   const recent=Object.fromEntries(Object.entries(st.recycled||{}).filter(([,t])=>now-t<3600e3));
   if(now-(st.lastRecycle||0)>=RECYCLE_GAP){const c=idle.filter(a=>!a.asleep&&!recent[a.name]).map(a=>{const ads=a.ads||0,ch=a.chrome||0;return {agent:a.name,what:ads>ch?'adspower':'chrome',bytes:Math.max(ads,ch)}})
     .filter(x=>x.bytes>=RECYCLE_MIN).sort((x,y)=>y.bytes-x.bytes)[0];
    if(c){actions=[{kind:'recycle',...c}];st.lastRecycle=now;recent[c.agent]=now}}
   st.recycled=recent}
  else{sp.step=1;
   const e=input.engine||{};if(e.bytes>=ENGINE_BIG&&!e.restarting&&now-(st.lastEngine||0)>=ENGINE_GAP){actions=[{kind:'engine',bytes:e.bytes}];st.lastEngine=now}
   break}}
 sp.last=now;sp.done.push(...actions.map(say));
 let alert=null;
 if(!sp.told&&(actions.length||sp.step===1)){sp.told=true;
  const top=(input.apps||[]).slice().sort((a,b)=>b[1]-a[1]).slice(0,4).map(([n,b])=>n+' '+gb(b)).join(', ');
  alert='Memory on the AI box is low: '+Math.round((1-free)*100)+'% of its '+gb(input.limit)+' limit in use ('+gb(Math.max(0,input.limit-input.used))+' free, no swap).\n'+
   (sp.done.length?'What I did: '+sp.done.join('; ')+'.':'Nothing was idle, so nothing was stopped; agents at work are never touched.')+(top?'\nBiggest now: '+top+'.':'')}
 return {st,actions,alert}}
export const say=a=>a.kind==='sleep'?a.agent+'’s screen put to sleep (wakes on use)':a.kind==='tabs'?a.agent+'’s extra tabs closed':
 a.kind==='recycle'?a.agent+'’s '+(a.what==='adspower'?'AdsPower':'Chrome')+' started again ('+gb(a.bytes)+')':a.kind==='engine'?'the engine restarted when idle ('+gb(a.bytes)+')':a.kind;

// the runner. sessions(agent) → {active,lastActive ms} from the engine; busy() → agent names mid-reply in aqeelOS;
// keepOn(agent) → its own AdsPower runs (never sleeps); closeTabs(agent) → tabs closed; restartEngine(why); tell(text)
export function createMemWatch({DATA,HOME,HERMES_HOME,sessions=async()=>null,busy=()=>[],keepOn=()=>false,closeTabs=async()=>0,restartEngine=async()=>{},restarting=()=>false,tell=async()=>{},
 log=m=>console.log(m),now=()=>Date.now(),CG='/sys/fs/cgroup/',WAKE='/var/lib/aqeelos/wake',readPs=null}){
 const FILE=path.join(DATA,'memwatch.json'),REQ=path.join(HOME,'.aqeelos-agent-users.mem');let st=null;
 const load=async()=>{if(!st){try{st=JSON.parse(await readFile(FILE,'utf8'))}catch{st={}}st.apps||={}}return st};
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(st));await rename(t,FILE)};
 const ps=readPs||(()=>new Promise(res=>execFile('ps',['-ewwo','user:32=,rss=,args='],{maxBuffer:16e6},(e,o)=>res(e?'':String(o)))));
 const mtime=async f=>(await stat(f).catch(()=>null))?.mtimeMs||0;
 async function mem(){const r=f=>readFile(CG+f,'utf8').catch(()=>'');const [c,m,s]=await Promise.all([r('memory.current'),r('memory.max'),r('memory.stat')]);
  const x=containerMem(c.trim(),m.trim()==='max'?NaN:m.trim(),s);if(x)return x;
  // no container limit: the machine's own numbers
  const mi=await readFile('/proc/meminfo','utf8').catch(()=>'');const kb=k=>Number((new RegExp('^'+k+':\\s+(\\d+)','m').exec(mi)||[])[1]||0)*1024;
  const lim=kb('MemTotal');return lim?{used:lim-kb('MemAvailable'),limit:lim,free:kb('MemAvailable')/lim}:null}
 async function agentsNow(text){const names=(await readFile(path.join(HOME,'.aqeelos-agent-users'),'utf8').catch(()=>'')).split('\n').map(s=>s.trim()).filter(s=>/^[a-z0-9][a-z0-9_-]{0,28}$/.test(s));
  const limits=Object.fromEntries((await readFile(path.join(HOME,'.aqeelos-agent-limits'),'utf8').catch(()=>'')).split('\n').map(l=>l.trim().split(/\s+/)).filter(x=>x.length>=3).map(x=>[x[0],Number(x[2])||0]));
  const by=new Map();for(const l of String(text).split('\n')){const x=/^\s*ag-(\S+)\s+(\d+)\s+(.*)$/.exec(l);if(!x)continue;const o=by.get(x[1])||{chrome:0,ads:0};const k=appOf('ag-'+x[1],x[3]);
   if(k.startsWith('AdsPower'))o.ads+=Number(x[2])*1024;else if(k.startsWith('Chrome'))o.chrome+=Number(x[2])*1024;by.set(x[1],o)}
  const busyNow=new Set(busy()),t=now();
  return Promise.all(names.map(async n=>{const s=await sessions(n).catch(()=>null),ws=path.join(HOME,'workspaces',n);
   const last=Math.max(s?.lastActive||0,await mtime(path.join(WAKE,n+'.active')),await mtime(path.join(ws,'.screen','activity')));
   const own=by.get(('ag-'+n).slice(3,32))||{chrome:0,ads:0};
   // unknown engine state counts as busy: nothing is stopped on a guess
   return {name:n,busy:!s||!!s.active||busyNow.has(n),idleMin:last?Math.floor((t-last)/60e3):9999,asleep:!!await mtime(path.join(ws,'.screen','asleep')),
    canSleep:(limits[n]||0)>0&&!keepOn(n),chrome:own.chrome,ads:own.ads}}))}
 function sample(apps){const t=now(),hour=t-(t%3600e3);for(const [k,b] of apps){const p=(st.apps[k]||=[]);const last=p.at(-1);
   if(last?.t===hour){last.n=(last.n||1)+1;last.b=Math.round(last.b+(b-last.b)/last.n)}else p.push({t:hour,b,n:1});if(p.length>48)p.splice(0,p.length-48)}
  for(const k of Object.keys(st.apps))if(!apps.has(k)&&!(st.apps[k].at(-1)?.t>t-48*3600e3))delete st.apps[k]}
 async function act(a){if(a.kind==='sleep'||a.kind==='recycle'){await appendFile(REQ,a.agent+' '+(a.kind==='sleep'?'sleep':a.what)+'\n');return}
  if(a.kind==='tabs'){await closeTabs(a.agent).catch(e=>log('memory watch: tabs '+a.agent+': '+e.message));return}
  if(a.kind==='engine')await restartEngine('memory low ('+gb(a.bytes)+' engine)')}
 let running=false;
 async function tick(){if(running)return null;running=true;try{await load();const m=await mem();if(!m)return null;const text=await ps();const apps=appsFrom(text);sample(apps);
   st.now={t:now(),used:m.used,limit:m.limit,free:m.free};let r={actions:[],alert:null};
   if(m.free<OK||st.spell){const engine=[...apps].find(([k])=>k==='Engine')?.[1]||0;
    r=plan({...m,agents:m.free<LOW?await agentsNow(text):[],engine:{bytes:engine,restarting:restarting()},apps:[...apps]},st,now());st={...r.st,apps:st.apps,now:st.now};
    for(const a of r.actions){await act(a).catch(e=>log('memory watch: '+a.kind+' '+(a.agent||'')+': '+e.message));log('memory watch: '+say(a))}
    if(r.alert){st.lastAlert={t:now(),text:r.alert};await tell(r.alert).catch(e=>log('memory watch: owner not told: '+e.message))}}
   await save();return r}finally{running=false}}
 // System › Health: the container's numbers, each app now, and the ones that grew in the last day
 async function view(){await load();const t=now(),apps=Object.entries(st.apps).map(([name,p])=>({name,bytes:p.at(-1)?.b||0,grew:grew(p,t)})).filter(a=>a.bytes>=50e6).sort((a,b)=>b.bytes-a.bytes);
  const n=st.now&&t-st.now.t<10*60e3?st.now:null;
  return {used:n?.used??null,limit:n?.limit??null,free:n?.free??null,level:n==null?null:n.free<LOW?'low':n.free<OK?'tight':'ok',apps:apps.slice(0,12),growing:apps.filter(a=>a.grew).map(a=>({name:a.name,...a.grew})),last:st.lastAlert||null}}
 return {tick,view,plan}}
