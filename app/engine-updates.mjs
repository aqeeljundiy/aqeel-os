// Engine updates at night, checked after (25 Oct 2026). Off / Ask me first / Adaptive, set on System › Health.
//   - Adaptive: in the quietest two hours of the night (worked out each week from the last 4 weeks of messages to every
//     agent), when nobody is chatting and no schedule is running or due, the engine is updated to the newest stable
//     release once it has been out for 3 days. The engine's own update does the work (hermes update, through its
//     dashboard, the same as the Update button); aqeelOS puts its changes back on after it, as before.
//   - Ask me first: aqeelOS says when a release is ready; "Update tonight" runs it in the quiet hours the same way.
//   - After every update (the button too) the engine is checked: it is back, every channel that was connected is again,
//     every profile_routes entry still reaches its agent (the engine's own matcher, under the main home and the
//     agent's home: the 24 Oct problem), no new profile_mismatch or error spike in agent.log, and aqeelOS answers.
//   - Every tool server that runs as a program still starts (the 24 Oct problem: an update removed the Python two of
//     them were built on): the automations guard (automation-guard.mjs) checks each one and the Python it starts,
//     rebuilds a broken environment and reconnects the server first; only what it cannot fix counts as a failed check.
//     When a check fails, the engine goes back to the version it had (the update's receipt says which), the same way
//     the engine's docs describe: stop, check out that version, prepare its dependencies, start.
//   - The owner gets one message the next morning; every attempt is listed next to the setting.
// The decisions are in engine-update-rules.mjs (tested on their own); this file gathers facts and acts.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,readdir,stat,open,readlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import * as R from './engine-update-rules.mjs';

// runs under the engine's own Python and code: for each route, every form of its chat ID this home knows, and which
// agent the engine's matcher sends each one to. argv: checkout, site-packages, extra IDs per route (JSON), config.yaml
export const ROUTES_PY=`import json,os,sys
sys.path[:0]=[sys.argv[1],sys.argv[2]]
extra=json.loads(sys.argv[3] or '{}')
from ruamel.yaml import YAML
cfg=YAML(typ='safe').load(open(sys.argv[4])) or {}
from gateway.profile_routing import parse_profile_routes,match_profile_route
from gateway.whatsapp_identity import expand_whatsapp_aliases
raw=(cfg.get('gateway') or {}).get('profile_routes') or cfg.get('profile_routes') or []
routes=parse_profile_routes(raw)
out=[]
for r in routes:
    if not r.enabled:
        continue
    ids=[r.chat_id] if r.chat_id else [None]
    if r.chat_id and r.platform in ('whatsapp','whatsapp_cloud'):
        ids+=sorted(expand_whatsapp_aliases(r.chat_id))
    ids+=[i for i in extra.get(r.name,[]) if i!='None' and i not in ids]
    got={}
    for i in dict.fromkeys(ids):
        m=match_profile_route(routes,r.platform,guild_id=r.guild_id,chat_id=i,thread_id=r.thread_id,parent_chat_id=None,adapter_profile=r.bot_profile,user_id=r.user_id)
        got[str(i)]=m.profile if m else None
    out.append({'name':r.name,'platform':r.platform,'profile':r.profile,'ids':[str(i) for i in dict.fromkeys(ids)],'got':got})
print(json.dumps({'routes':out}))`;
// people's messages per hour (UTC hour numbers) since argv[1], and the newest one, over every agent's state.db (read only)
const USAGE_PY=`import sqlite3,sys,json
since=float(sys.argv[1]);b={};last=0
for f in sys.argv[2:]:
    try:
        c=sqlite3.connect('file:'+f+'?mode=ro',uri=True)
        for h,n in c.execute("select cast(timestamp/3600 as integer),count(*) from messages where role='user' and timestamp>? group by 1",(since,)):
            b[h]=b.get(h,0)+n
        m=c.execute("select max(timestamp) from messages where role='user'").fetchone()[0]
        if m and m>last:
            last=m
        c.close()
    except Exception:
        pass
print(json.dumps({'buckets':[[h,n] for h,n in b.items()],'last':last}))`;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=(cmd,args,{timeout=120000,env,cwd}={})=>new Promise(res=>execFile(cmd,args,{timeout,maxBuffer:16e6,env:env||process.env,cwd:cwd||homedir()},(e,o,er)=>res({ok:!e,code:e?(typeof e.code==='number'?e.code:-1):0,out:String(o||''),err:String(er||'')})));
const lastLine=s=>String(s||'').trim().split('\n').filter(Boolean).pop()?.slice(0,200)||'';

export function createEngineUpdates({guard=null,DATA,HERMES_HOME,PORT,LIVE,dash,busy,readConfig,python,patches,restartGateway,stopGateway,resetForUpdate,tellOwner}){
 const REPO=path.join(HERMES_HOME,'hermes-agent'),HERMES=process.env.HERMES_BIN||path.join(homedir(),'.local','bin','hermes');
 const git=(...a)=>run('git',['-C',REPO,...a]);
 const FILE=path.join(DATA,'engine-updates.json');let db=null,active=null;
 const load=async()=>{if(!db){db=await readStore(FILE);if(!R.MODES.includes(db.mode))db.mode='ask';db.log||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1))};
 const zone=async()=>(await readConfig('default').catch(()=>null))?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const head=async()=>{const h=(await git('rev-parse','HEAD')).out.trim();return /^[0-9a-f]{40}$/.test(h)?h:''};

 /* ---------- facts ---------- */
 async function dbFiles(){const out=[path.join(HERMES_HOME,'state.db')];for(const d of await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[]))out.push(path.join(HERMES_HOME,'profiles',d,'state.db'));
  const ok=[];for(const f of out)if(await stat(f).catch(()=>null))ok.push(f);return ok}
 async function usage(since){const py=await python();if(!py)return null;const r=await run(py,['-c',USAGE_PY,String(since/1000),...await dbFiles()],{timeout:60000});try{return JSON.parse(r.out)}catch{return null}}
 // the window is worked out again once a week
 async function windowNow(){await load();const tz=await zone();if(db.win&&Date.now()-db.win.at<7*864e5&&db.win.tz===tz)return db.win;
  const u=await usage(Date.now()-28*864e5);if(!u)return db.win||{...R.quietWindow([],tz),at:0,tz};
  db.win={...R.quietWindow(u.buckets,tz),at:Date.now(),tz};await save();return db.win}
 const lastUserAt=async()=>{const u=await usage(Date.now());return u?.last?u.last*1000:0};
 // every agent's schedules, read from the engine's own files
 async function jobs(){const files=[path.join(HERMES_HOME,'cron','jobs.json')];for(const d of await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[]))files.push(path.join(HERMES_HOME,'profiles',d,'cron','jobs.json'));
  const out=[];for(const f of files){try{const j=JSON.parse(await readFile(f,'utf8'));out.push(...(Array.isArray(j)?j:j.jobs||[]))}catch{}}return out}
 const gwState=async()=>{try{return JSON.parse(await readFile(path.join(HERMES_HOME,'gateway_state.json'),'utf8'))}catch{return {}}};
 const alive=pid=>{try{return !!pid&&process.kill(pid,0)}catch{return false}};
 const connected=st=>Object.entries(st.platforms||{}).filter(([,v])=>v?.state==='connected').map(([k])=>k).sort();
 async function tags(){await git('fetch','--tags','--quiet','origin');   // the newest tags from GitHub (only tags; the checkout itself is not touched)
  const r=await git('for-each-ref','refs/tags','--format=%(refname:short)%09%(creatordate:unix)%09%(objectname)%09%(*objectname)');
  return r.out.split('\n').map(l=>l.split('\t')).filter(x=>R.STABLE.test(x[0]||'')).map(([name,t,o,d])=>({name,at:(+t||0)*1000,sha:d||o}))}
 let tCache={at:0,manual:null,v:null};
 async function target({manual=false}={}){if(tCache.v&&tCache.manual===manual&&Date.now()-tCache.at<30*60e3)return tCache.v;
  let engine=null;try{engine=await dash('/hermes/update/check')}catch{}
  const list=await tags(),h=await head(),want='v'+String(engine?.source_version||'').replace(/^v/,'');
  const forward=list.some(t=>t.name===want)?(await git('merge-base','--is-ancestor',h,want)).ok:undefined;
  const v=R.pickTarget({engine,tags:list,head:h,forward,now:Date.now(),manual});tCache={at:Date.now(),manual,v};return v}
 // the gateway's own Python and dependencies (from its running process), so the check runs exactly the code it runs
 async function runtime(){const pid=+(await gwState()).pid||0;let py='',sp='';
  if(alive(pid)){py=await readlink('/proc/'+pid+'/exe').catch(()=>'');sp=(/(\/\S*?\/installs\/\S*?\/site-packages)\//.exec(await readFile('/proc/'+pid+'/maps','utf8').catch(()=>''))||[])[1]||''}
  if(!py){const t=path.join(HERMES_HOME,'tools');const d=(await readdir(t).catch(()=>[])).filter(x=>/^python-/.test(x)).sort().pop();if(d)py=path.join(t,d,'bin','python3')}
  if(!sp){const found=[];const base=path.join(HERMES_HOME,'installs');
   for(const i of await readdir(base).catch(()=>[]))for(const e of await readdir(path.join(base,i,'environments')).catch(()=>[])){const lib=path.join(base,i,'environments',e,'venv','lib');
    for(const v of await readdir(lib).catch(()=>[])){const p=path.join(lib,v,'site-packages');const s=await stat(path.join(p,'ruamel')).catch(()=>null);if(s)found.push([s.mtimeMs,p])}}
   sp=found.sort((a,b)=>b[0]-a[0])[0]?.[1]||''}
  return {py,sp}}
 /* Each route under the main home and under the home of every agent a route names. First every home says which forms of
    the chat ID it knows; then every home is asked about all of them (a form only one home knows was the 24 Oct case). */
 async function routeCheck(){const {py,sp}=await runtime();if(!py||!sp)return {error:'the engine’s Python was not found'};
  const cfgF=path.join(HERMES_HOME,'config.yaml'),c=await readConfig('default').catch(()=>null),raw=c?.gateway?.profile_routes||c?.profile_routes||[];
  const homes=[['main',HERMES_HOME]];for(const r of Array.isArray(raw)?raw:[])for(const p of [r?.profile,r?.bot_profile]){const h=path.join(HERMES_HOME,'profiles',String(p||''));if(p&&p!=='default'&&!homes.some(x=>x[0]===p)&&await stat(h).catch(()=>null))homes.push([p,h])}
  const once=async(home,extra)=>{const r=await run(py,['-I','-c',ROUTES_PY,REPO,sp,JSON.stringify(extra),cfgF],{timeout:60000,env:{...process.env,HERMES_HOME:home}});
   if(!r.ok)throw new Error(lastLine(r.err)||lastLine(r.out)||'failed');return JSON.parse(lastLine(r.out))};
  try{const all={};for(const [,home] of homes)for(const x of (await once(home,{})).routes)for(const id of x.ids)(all[x.name]||=new Set()).add(id);
   const extra=Object.fromEntries(Object.entries(all).map(([k,v])=>[k,[...v]]));const runs=[];
   for(const [label,home] of homes)runs.push({label,home,routes:(await once(home,extra)).routes});return {runs}}
  catch(e){return {error:String(e.message||e).slice(0,200)}}}
 async function tail(f,bytes){const h=await open(f,'r').catch(()=>null);if(!h)return '';try{const {size}=await h.stat();const n=Math.min(size,bytes),b=Buffer.alloc(n);await h.read(b,0,n,size-n);return b.toString('utf8')}finally{await h.close()}}
 const logText=async()=>(await tail(path.join(HERMES_HOME,'logs','agent.log.1'),4e6))+'\n'+(await tail(path.join(HERMES_HOME,'logs','agent.log'),10e6));
 const healthOk=async()=>{try{const r=await fetch('http://127.0.0.1:'+PORT+'/healthz',{signal:AbortSignal.timeout(10000)});return r.ok&&(await r.json()).ok===true}catch{return false}};
 // what is true just before an update: the self-check compares against it
 async function snapshot(){const now=Date.now(),st=await gwState();
  return {at:now,sha:await head(),version:st.code_version||null,channels:connected(st),routes:await routeCheck(),log:R.countLog(await logText(),now-60*60e3,now),tools:guard?await guard.snapshot().catch(e=>({error:e.message})):null}}
 // the engine back, then every channel that was connected (up to 10 min), and at least 5 min of the new engine's log
 async function selfCheck(pre,since){let st={};
  for(let i=0;i<40;i++){st=await gwState();if(st.gateway_state==='running'&&alive(+st.pid)&&pre.channels.every(c=>st.platforms?.[c]?.state==='connected'))break;await sleep(15000)}
  const wait=since+5*60e3-Date.now();if(wait>0)await sleep(wait);st=await gwState();
  const after={gatewayUp:st.gateway_state==='running'&&alive(+st.pid),channels:Object.fromEntries(Object.entries(st.platforms||{}).map(([k,v])=>[k,v?.state])),routes:await routeCheck(),log:R.countLog(await logText(),since,Date.now()),healthOk:await healthOk()};
  const v=R.verdict(pre,after);if(!guard)return v;
  // tool servers: broken ones are fixed first (a Python environment built again, the server reconnected); what is still
  // wrong and was fine before the update fails the check
  step('checking tool servers');const g=await guard.fullCheck({repair:true,since,before:pre.tools,why:'after the engine update'}).catch(e=>({problems:['the tool server check could not run: '+e.message],fixed:[]}));
  if(g.fixed?.length)v.fixed=g.fixed;if(g.problems?.length){v.ok=false;v.problems=[...v.problems,...g.problems]}return v}
 // the engine's record of its newest update run (started after `since`)
 async function receipt(since){const dir=path.join(HERMES_HOME,'logs','update_receipts');const f=(await readdir(dir).catch(()=>[])).filter(x=>/^update_.*\.json$/.test(x)).sort().pop();if(!f)return null;
  try{const r=JSON.parse(await readFile(path.join(dir,f),'utf8'));return Date.parse(r.started_at||'')>=since-120e3?r:null}catch{return null}}
 // the update runs in the engine's dashboard: wait for it to finish (it can take 30 min; the dashboard may be away a while)
 async function waitAction(){let last={};await sleep(20000);
  for(let i=0;i<360;i++){try{last=await dash('/actions/hermes-update/status?lines=20');if(last&&last.running===false)return last}catch{}await sleep(15000)}return {...last,timedOut:true}}
 // the earlier version knows the chat history the gateway runtime writes (the engine refuses to go below that line)
 async function knowsRuntime(sha){if(!sha)return undefined;const r=await git('grep','-q','-F','CREATE TABLE IF NOT EXISTS session_admissions',sha,'--','hermes_state*.py');return r.ok?true:r.code===1?false:undefined}

 /* ---------- actions ---------- */
 const step=s=>{if(active)active.step=s};
 // one line in the list; a night's result is told the next morning, a press of the button only adds a Bottlenecks item when it went wrong
 async function record(e){await load();const x={at:Date.now(),...e};x.tell??=x.trigger!=='by hand';db.log.unshift(x);db.log=db.log.slice(0,40);delete db.running;await save();console.log('engine update:',x.kind,x.to||'',x.reason||'',(x.problems||[]).join('; '));
  if(x.trigger==='by hand'&&x.kind!=='updated')tellOwner(R.ownerText(x,await zone()),{bell:true,kind:x.kind}).catch(()=>{});return x}
 // back to `to`: stop the engine, check out that version, let the engine prepare its dependencies, put aqeelOS's changes on, start
 async function rollback(to){step('going back to the earlier version');await stopGateway();
  await git('checkout','--','.');const c=await git('checkout','-q','--detach',to);if(!c.ok)throw new Error('could not check out '+to.slice(0,8)+': '+lastLine(c.err));
  const pm=await run(HERMES,['pm','install'],{timeout:45*60e3});if(!pm.ok)console.warn('engine rollback: pm install',lastLine(pm.err||pm.out));
  await patches();const at=Date.now();await restartGateway('engine rolled back to '+to.slice(0,8),{wait:false});return at}
 // after the engine's update finished (from tonight's run, the button, or a run aqeelOS restarted during)
 async function afterUpdate(pre,{trigger,to},st){const rc=await receipt(pre.at),h=await head();const toV=rc?.post_update?.version||to||null;
  step('putting aqeelOS changes back');
  if(!h||h===pre.sha){await patches();const why=st?.timedOut?'it did not finish within 90 min':rc?.outcome&&rc.outcome!=='success'?'the engine reported '+rc.outcome+(lastLine((st?.lines||[]).join('\n'))?' ('+lastLine((st?.lines||[]).join('\n'))+')':''):st?.exit_code?'it stopped with code '+st.exit_code+(st.lines?.length?' ('+lastLine(st.lines.join('\n'))+')':''):'the engine did not change';
   return record({kind:'failed',trigger,from:pre.version,to:toV,reason:why})}
  const n=await patches();let since=Date.parse(rc?.finished_at||'')||Date.now();if(n){since=Date.now();await restartGateway('engine updated: aqeelOS wording applied again',{wait:false})}
  step('checking the engine');const check=await selfCheck(pre,since);
  if(check.ok)return record({kind:'updated',trigger,from:pre.version,to:toV,...(check.fixed?{fixed:check.fixed}:{})});
  const plan=R.rollbackPlan({check,receipt:rc,head:h,knowsRuntime:await knowsRuntime(rc?.pre_update?.sha)});
  if(!plan.rollback)return record({kind:'check-failed',trigger,from:pre.version,to:toV,problems:check.problems,reason:plan.reason});
  try{const at=await rollback(plan.to);step('checking the engine again');const again=await selfCheck(pre,at);return record({kind:'rolled-back',trigger,from:plan.version,to:toV,problems:check.problems,after:again.problems})}
  catch(e){return record({kind:'check-failed',trigger,from:pre.version,to:toV,problems:check.problems,reason:'going back failed: '+e.message})}}
 async function runUpdate(trigger,t){if(active)return;active={step:'checking first',trigger,to:t?.tag,at:Date.now()};try{
   const pre=await snapshot();await load();db.running={pre,trigger,to:t?.tag||null,at:pre.at};await save();
   step('updating');await resetForUpdate();let r;try{r=await dash('/hermes/update',{method:'POST',body:'{}'})}catch(e){r={ok:false,message:e.message}}
   if(r?.ok===false){await patches();return record({kind:'failed',trigger,from:pre.version,to:t?.tag,reason:r.message||r.error||'the engine refused'})}
   await afterUpdate(pre,{trigger,to:t?.tag},await waitAction())}
  catch(e){console.warn('engine update',e.message);await record({kind:'failed',trigger,to:t?.tag,reason:e.message})}finally{active=null;tCache.v=null}}

 // the Update button: what is true now is kept first (server.mjs calls this before passing the press on), then followed
 async function beforeManual(){if(active)return false;active={step:'updating',trigger:'by hand',at:Date.now()};try{const pre=await snapshot();await load();db.running={pre,trigger:'by hand',at:pre.at};await save();
   setTimeout(()=>{waitAction().then(st=>afterUpdate(pre,{trigger:'by hand'},st)).catch(e=>record({kind:'failed',trigger:'by hand',reason:e.message})).finally(()=>{active=null;tCache.v=null})},1000);return true}
  catch(e){active=null;throw e}}

 /* ---------- every 5 minutes ---------- */
 async function morning(now,tz){const due=db.log.filter(e=>e.tell&&!e.told);if(!due.length||!R.isDaytime(now,tz))return;
  for(const e of due)e.told=Date.now();await save();await tellOwner(R.ownerText(due[0],tz),{kind:due[0].kind}).catch(e=>console.warn('engine update: telling the owner',e.message))}
 async function tick(){if(active)return;await load();const now=Date.now(),tz=await zone();await morning(now,tz);
  if(db.mode==='off'&&!db.tonight)return;const manual=!!db.tonight;
  // Ask me first: say once per release that one is ready
  if(db.mode==='ask'&&!manual){if(now-(db.askedAt||0)<6*3600e3)return;db.askedAt=now;const t=await target();
   if(t.ok&&db.offered!==t.tag){db.offered=t.tag;await tellOwner('Engine '+t.tag+' is ready to install',{bell:true,detail:'Open System › Health and press Update, then Update tonight. It runs in the quiet hours and is checked after.'}).catch(()=>{})}
   await save();return}
  // db.night: tonight's date, whether it is settled, and the last reason it could not start yet
  const win=await windowNow(),key=R.nightOf(now,win,tz),n=db.night||{};
  if(!R.mayStart(now,win,tz)){
   // the quiet hours ended without a start: the last reason goes in the list (and to the owner when a release was ready)
   if(n.key&&!n.done&&n.why){const w=n.why;n.done=true;await record({kind:'skipped',trigger:w.manual?'tonight':'night',to:w.to,reason:w.reason,tell:!!(w.ready||w.manual)})}
   return}
  if(n.key===key&&n.done)return;
  const t=await target({manual});
  if(t.none){db.night={key,done:true};if(manual)db.tonight=false;await save();return}   // nothing to do tonight
  const c=R.conditions({now,win,tz,target:t,busy:busy(),lastUserAt:await lastUserAt(),jobs:await jobs()});
  if(c.ok){db.night={key,done:true};db.tonight=false;await save();return runUpdate(manual?'tonight':'night',t)}
  db.night={key,why:{reason:c.reason,to:t.tag||null,ready:!!t.ok,manual}};await save()}
 if(LIVE){setInterval(()=>tick().catch(e=>console.warn('engine updates',e.message)),5*60e3).unref();
  // aqeelOS restarted while an update ran: follow it to the end (or note that it was cut off)
  setTimeout(async()=>{await load();const r=db.running;if(!r||active)return;if(Date.now()-r.at>3*3600e3)return record({kind:'failed',trigger:r.trigger,to:r.to,reason:'aqeelOS restarted during the update'});
   active={step:'updating',trigger:r.trigger,to:r.to,at:r.at};try{await afterUpdate(r.pre,r,await waitAction())}catch(e){await record({kind:'failed',trigger:r.trigger,to:r.to,reason:e.message})}finally{active=null}},30000).unref()}

 async function status(){await load();const win=await windowNow().catch(()=>db.win||null);
  return {mode:db.mode,tonight:!!db.tonight,window:win&&{label:win.label,start:win.start,end:win.end,at:win.at||null},running:active?{step:active.step,trigger:active.trigger,to:active.to||null,at:active.at}:null,waiting:db.night?.why?.reason||null,log:db.log.slice(0,12)}}
 async function setMode(m){if(!R.MODES.includes(m))throw new Error('Unknown setting');await load();db.mode=m;await save();return status()}
 async function setTonight(on){await load();db.tonight=!!on;if(on){tCache.v=null;if(!db.night?.done)delete db.night}await save();return status()}
 return {status,setMode,setTonight,beforeManual,busy:()=>!!active,tick,routeCheck,snapshot}}
