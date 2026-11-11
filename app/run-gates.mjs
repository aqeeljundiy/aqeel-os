// Run gates (11 Nov 2026). Owner's reason: on the Elkiya server one agent (Continue Threads) paid 30-60k tokens of setup
// for each of 432 runs a day, and most of them ended "nothing to do" or "the AI service is rate-limited". A run that
// cannot do anything should cost nothing, for every schedule, existing and future, on every agent.
//
// How: the engine runs a job's `script` (a file in <home>/scripts/) before it starts the AI, and skips the AI when the
// script's last line is {"wakeAgent": false} (cron/scheduler.py, wake gate). aqeelOS gives every schedule that starts
// the AI such a script, named aqeelos-gate-<job id>.sh. It asks this app (route /run-gate/<agent>/<job>/<sig>), and the
// answer is skip or go:
//  a) the AI service asked everyone to wait. The engine's proxy writes "holding outbound sends until <time>" into the
//     agent's log and into the job's last failure; the engine itself parks a job in quota_hold_until. Until then
//     every run would fail anyway, so none starts.
//  b) a posting schedule (marked in DATA/run-gates.json rules, or one that already runs the posting gate) while the
//     agent's posting limits (posting-limits.mjs: gap, an hour, a day, pause file) say it cannot post now.
//  c) a check of the job's own: if <home>/scripts/aqeelos-check-<job id>.sh exists, the gate script runs it (as the
//     agent's own user) and skips when its last line is {"anythingToDo": false}. Nobody has written one yet: no check
//     is invented here, because none can be grounded in data aqeelOS can see (the DM and reply lists live in the
//     agent's own browser). A check that fails or says nothing never stops a run.
// A schedule that already has a script of its own (the posting gate) keeps it: our script runs first and then runs
// that one, so its output reaches the AI as before. Schedules whose script is the whole job (no_agent) and Python
// scripts (which need the job's own interpreter) are left alone. If aqeelOS does not answer, the run goes ahead.
//
// Applied the way billion-context.mjs applies its plugin: install() on a 10-minute interval, nothing changes when
// nothing has to, jobs.json is copied to jobs.json.bak-<date>-gates before the first change of a day, the file
// <HERMES_HOME>/.aqeelos-run-gates-off takes everything back out. How many runs each gate skipped is kept in
// DATA/run-gates.json for a Health view, as {"jobs": {"<agent>/<job id>": {skips, runs, by}}}: skips = runs that never
// reached the AI, runs = runs that did (what app/efficiency-view.mjs reads).
//
// Rate: a job that sends N messages an hour gains nothing from running more often than once an hour. aqeelOS does not
// change a schedule silently: it records a proposal (proposals in DATA/run-gates.json, shown by view()). A proposal
// the owner approved is applied once; a later hand change of that schedule is left alone.
import {readFile,writeFile,mkdir,rename,stat,readdir,copyFile,chmod,open} from 'node:fs/promises';
import path from 'node:path';
import {decide as postDecide,clean as postClean} from './posting-limits.mjs';

export const GATE_PREFIX='aqeelos-gate-',CHECK_PREFIX='aqeelos-check-',POSTING_GATE='aqeelos-posting-gate.sh';
const MARK='# aqeelos-run-gate original=';
const MAX_HOLD_MS=6*3600e3;     // a hold further away than this is not believed (a clock gone wrong must not stop a schedule for days)
const LOG_TAIL=512*1024;
const SKIP_EXT=/\.(sh|bash)$/i;
// the owner's approvals (11 Nov 2026): Continue Threads' outbound DM runner sends at most 3 an hour, so it runs hourly
export const APPROVED=[{agent:'continue-threads',name:/outbound DM/i,expr:'7 * * * *',by:'owner',at:'2026-11-11',
 why:'it may send 3 DMs an hour, so running every 15 minutes only repeats the same setup'}];
const SPREAD_MINUTE=7;          // away from :00, :05, :10 ... where the other runners of that agent start

const jobsOf=d=>Array.isArray(d)?d:d?.jobs||[];
const isoOr=(s)=>{const t=Date.parse(s);return Number.isFinite(t)?t:null};

// the latest "holding outbound sends until <ISO time>" in some text (the engine's proxy writes it when the AI service
// answers 429). The latest TIME wins, not the last line: a retry may carry an earlier time.
export function holdIn(text){let best=null;for(const m of String(text||'').matchAll(/holding outbound sends until (\d{4}-\d\d-\d\dT[\d:.]+Z)/g)){const t=isoOr(m[1]);if(t!=null&&(best==null||t>best))best=t}return best}

// until when is this job held back by the AI service: the engine's own park marker, the proxy's hold on the job's last
// failure, and the proxy's hold in the agent's log (a run that never got as far as being recorded)
export function backoffUntil({job,logText='',now=Date.now()}){const c=[];
 const q=isoOr(job?.quota_hold_until);if(q!=null)c.push({t:q,src:'the engine parked this schedule because the AI service stays closed'});
 const f=holdIn((job?.last_failure?.detail||'')+' '+(job?.last_error||''));if(f!=null)c.push({t:f,src:'the AI service asked for a pause'});
 const l=holdIn(logText);if(l!=null)c.push({t:l,src:'the AI service asked for a pause'});
 const live=c.filter(x=>x.t>now&&x.t-now<=MAX_HOLD_MS).sort((a,b)=>b.t-a.t)[0];return live||null}

// how often a schedule fires per hour; null when it cannot be told from the schedule alone
export function runsPerHour(s){if(!s)return null;
 if(s.kind==='interval'&&s.minutes>0)return 60/s.minutes;
 if(s.kind!=='cron'||typeof s.expr!=='string')return null;const f=s.expr.trim().split(/\s+/);if(f.length!==5||f.slice(1).some(x=>x!=='*'))return null;
 const set=new Set();for(const part of f[0].split(',')){const m=/^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);if(!m)return null;
  const step=m[4]?+m[4]:1,lo=m[1]?0:+m[2],hi=m[1]?59:m[3]!=null?+m[3]:m[4]?59:+m[2];if(!(step>0)||lo>hi||hi>59)return null;for(let v=lo;v<=hi;v+=step)set.add(v)}
 return set.size}

// "3 DMs/h" in a job's name is how the owner wrote its limit: that is the only record of it
export function sendLimit(job){const m=/(\d+)\s*(DMs?|messages?|comments?|posts?)\s*\/\s*h/i.exec(job?.name||'');return m?{perHour:+m[1],what:m[2].toLowerCase()}:null}
// a job that only sends direct messages out (not one that answers, or comments)
export const isOutboundDm=job=>/\bDMs?\b/i.test(job?.name||'')&&/outbound/i.test(job?.name||'')&&!/comment|answer|repl/i.test(job?.name||'')&&!!sendLimit(job);

export function proposalFor(job){if(!isOutboundDm(job))return null;const n=runsPerHour(job.schedule);if(n==null||n<=1)return null;const lim=sendLimit(job);
 const was=job.schedule.display||job.schedule.expr||('every '+job.schedule.minutes+' min');
 return {to:SPREAD_MINUTE+' * * * *',toText:'hourly (at minute '+SPREAD_MINUTE+')',from:was,
  why:'It sends at most '+lim.perHour+' an hour and now starts '+Math.round(n)+' times an hour. Once an hour is enough.'}}

// next run for "minute M of every hour", in the zone the job's next_run_at is written in
export function nextHourly(minute,after,offsetMin){const L=after+offsetMin*60e3;let t=Math.floor(L/3600e3)*3600e3+minute*60e3;if(t<=L)t+=3600e3;
 const u=t-offsetMin*60e3,o=Math.abs(offsetMin),p=n=>String(n).padStart(2,'0');
 return new Date(t).toISOString().slice(0,19)+'.000000'+(offsetMin<0?'-':'+')+p(Math.floor(o/60))+':'+p(o%60)+(u?'':'')}
const offsetOf=s=>{const m=/([+-])(\d\d):(\d\d)$/.exec(String(s||''));return m?(m[1]==='-'?-1:1)*(+m[2]*60+ +m[3]):0};

export function gateBody({port,agent,jobId,sig,original}){const U='http://127.0.0.1:'+port+'/run-gate/'+agent+'/'+jobId+'/'+sig;
 return ['#!/bin/bash',
  '# Written by aqeelOS (run gates). Asks aqeelOS whether this run can do anything; if not, the AI does not start',
  '# and costs nothing. If aqeelOS does not answer, the run goes ahead.',
  original?MARK+original:'# aqeelos-run-gate original=',
  'U="'+U+'"','D="$(cd "$(dirname "$0")" && pwd)"',
  'out=$(curl -sf -m 15 "$U" 2>/dev/null) || out=""',
  'last=$(printf \'%s\\n\' "$out" | awk \'NF\' | tail -n 1)',
  'if printf \'%s\' "$last" | grep -q \'"wakeAgent": *false\'; then printf \'%s\\n\' "$out"; exit 0; fi',
  'C="$D/'+CHECK_PREFIX+jobId+'.sh"',
  'if [ -f "$C" ]; then',
  '  cout=$(timeout 30 bash "$C" 2>/dev/null); crc=$?',
  '  clast=$(printf \'%s\\n\' "$cout" | awk \'NF\' | tail -n 1)',
  '  if [ "$crc" = 0 ] && printf \'%s\' "$clast" | grep -q \'"anythingToDo": *false\'; then',
  '    curl -sf -m 15 "$U?nothing=1" 2>/dev/null || printf \'aqeelOS run check: nothing to do this time.\\n{"wakeAgent": false}\\n\'',
  '    exit 0',
  '  fi',
  'fi',
  ...(original?['exec bash "$D/'+original+'"']
   :['[ -n "$out" ] || out=$(printf \'aqeelOS run check: clear to run.\\n{"wakeAgent": true}\')','printf \'%s\\n\' "$out"']),''].join('\n')}

export function createRunGates({HERMES_HOME,DATA,WORK,PORT,sig,live=true,lock=async(f,fn)=>fn(),skipAgent=async()=>false,now=()=>Date.now(),log=m=>console.log(m),dayOf=t=>new Date(t).toISOString().slice(0,10).replace(/-/g,'')}){
 const FILE=path.join(DATA,'run-gates.json'),OFF=path.join(HERMES_HOME,'.aqeelos-run-gates-off');
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.jobs||={};db.proposals||={};db.rules||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 async function homes(){const out=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
  if(d.isDirectory()&&!d.name.startsWith('.')&&/^[a-z0-9][a-z0-9_-]{0,80}$/.test(d.name))out.push(d.name);return out}
 const readJobs=async a=>{try{return JSON.parse(await readFile(path.join(home(a),'cron','jobs.json'),'utf8'))}catch{return null}};
 const originalOf=async(a,script)=>{if(!script||!script.startsWith(GATE_PREFIX))return script||'';
  const t=await readFile(path.join(home(a),'scripts',script),'utf8').catch(()=>'');const m=/^# aqeelos-run-gate original=(.*)$/m.exec(t);return m?m[1].trim():''};
 const key=(a,id)=>a+'/'+id;
 const tail=async f=>{try{const h=await open(f,'r');try{const {size}=await h.stat();const n=Math.min(size,LOG_TAIL),b=Buffer.alloc(n);await h.read(b,0,n,size-n);return b.toString('utf8')}finally{await h.close()}}catch{return ''}};
 const jobRow=(a,j)=>(db.jobs[key(a,j.id)]||={name:'',runs:0,skips:0,by:{},since:now()});
 const reasonShort={backoff:'the AI service asked for a pause',limits:'posting limits',nothing:'nothing to do'};

 // the gate's answer for one run of one job. Never throws: whatever goes wrong, the run goes ahead.
 async function check(a,jobId,{nothing=false}={}){await load();const t=now();let row,job=null;
  try{job=jobsOf(await readJobs(a)).find(x=>x.id===jobId)||null}catch{}
  row=job?jobRow(a,job):(db.jobs[key(a,jobId)]||={name:'',runs:0,skips:0,by:{},since:t});if(job)row.name=job.name||row.name;
  const skip=async(why,text)=>{row.by[why]=(row.by[why]||0)+1;row.skips++;row.lastSkipAt=t;row.lastSkipWhy=why;row.lastSkipText=text;await save().catch(()=>{});
   return text+'\n{"wakeAgent": false}'};
  try{
   if(nothing)return await skip('nothing','aqeelOS run check: this schedule\'s own check found nothing to do, so no run started.');
   const hold=job?backoffUntil({job,logText:await tail(path.join(home(a),'logs','agent.log')),now:t}):null;
   if(hold){const mins=Math.max(1,Math.ceil((hold.t-t)/60e3));
    return await skip('backoff','aqeelOS run check: no run started, '+hold.src+'. It is over in about '+mins+' min; the schedule tries again at its next time.')}
   const orig=job?await originalOf(a,job.script):'';
   const rules=db.rules[key(a,jobId)]||{};
   if(rules.posting===true||orig===POSTING_GATE){const pd=await postingDecision(a,t);
    if(pd&&!pd.allow)return await skip('limits','aqeelOS run check: no run started, the posting limits do not allow a post now. '+pd.reason)}
  }catch(e){log('run gate '+a+'/'+jobId+': '+e.message)}
  row.runs++;row.lastRunAt=t;await save().catch(()=>{});
  return 'aqeelOS run check: clear to run.\n{"wakeAgent": true}'}

 async function postingDecision(a,t){let d;try{d=JSON.parse(await readFile(path.join(DATA,'posting-limits.json'),'utf8'))}catch{return null}
  const raw=d?.agents?.[a];if(!raw?.on)return null;const r=postClean(raw);let entries=[];try{entries=JSON.parse(await readFile(path.join(DATA,'posting-log',a+'.json'),'utf8'))}catch{}
  const stopped=!!(r.stopFile&&WORK&&await stat(path.join(WORK,a,r.stopFile)).then(()=>true,()=>false));return postDecide(r,entries,{now:t,stopped})}

 // gate script for one job, written only when its text changed
 async function writeScript(a,id,body){const f=path.join(home(a),'scripts',GATE_PREFIX+id+'.sh');await mkdir(path.dirname(f),{recursive:true});
  if((await readFile(f,'utf8').catch(()=>null))!==body){await writeFile(f,body,{mode:0o700});await chmod(f,0o700);return true}return false}

 async function offAll(){const changed=[];for(const a of await homes()){const file=path.join(home(a),'cron','jobs.json');
  try{await lock(path.join(home(a),'cron','.jobs.lock'),async()=>{const d=await readJobs(a);if(!d)return;let did=false;
   for(const j of jobsOf(d)){if(typeof j.script==='string'&&j.script.startsWith(GATE_PREFIX)){const o=await originalOf(a,j.script);j.script=o||null;did=true}}
   if(did){await backup(a,file);await writeJson(file,d);changed.push(a)}})}catch(e){log('run gates: off for '+a+': '+e.message)}}
  if(changed.length)log('run gates: switched off for '+changed.join(', '));return changed}
 async function backup(a,file){const b=file+'.bak-'+dayOf(now())+'-gates';if(!await stat(b).then(()=>true,()=>false))await copyFile(file,b)}
 async function writeJson(file,d){const keep=await stat(file).then(s=>s.mode&0o777,()=>0o600);await writeFile(file+'.tmp',JSON.stringify(d,null,2)+'\n',{mode:keep});await rename(file+'.tmp',file)}

 // every home: a gate for each schedule that starts the AI, proposals for the rate, approved ones applied once.
 // Returns the agents whose jobs.json changed.
 async function install(){await load();if(await stat(OFF).then(()=>true,()=>false))return offAll();
  const changed=[];let dirty=false;
  for(const a of await homes()){if(await skipAgent(a).catch(()=>false))continue;const file=path.join(home(a),'cron','jobs.json');
   try{
    const peek=await readJobs(a);if(!peek)continue;
    // work out what has to change first; take the engine's lock and write only when something does
    const need=jobsOf(peek).some(j=>j&&j.id&&!j.no_agent&&j.enabled!==false&&j.state!=='completed');if(!need)continue;
    await lock(path.join(home(a),'cron','.jobs.lock'),async()=>{const d=await readJobs(a);if(!d)return;let did=false;
     for(const j of jobsOf(d)){if(!j||!j.id||j.no_agent||j.enabled===false||j.state==='completed')continue;
      if((db.rules[key(a,j.id)]||{}).off===true)continue;
      const row=jobRow(a,j);row.name=j.name||'';
      // the rate proposal; applied once when the owner approved it
      const pr=proposalFor(j),pk=key(a,j.id);
      if(pr&&!db.proposals[pk]){db.proposals[pk]={...pr,at:now(),status:'proposed',agent:a,job:j.id,name:j.name};dirty=true}
      const ap=db.proposals[pk];
      if(ap&&ap.status==='proposed'){const ok=APPROVED.find(x=>x.agent===a&&x.name.test(j.name||''));
       if(ok){const off=offsetOf(j.next_run_at);j.schedule={...j.schedule,kind:'cron',expr:ok.expr,display:ok.expr};delete j.schedule.minutes;j.schedule_display=ok.expr;
        if(j.state!=='paused')j.next_run_at=nextHourly(SPREAD_MINUTE,now(),off);
        Object.assign(ap,{status:'applied',appliedAt:now(),approvedBy:ok.by,approvedAt:ok.at,approvedWhy:ok.why});dirty=true;did=true;log('run gates: '+a+' "'+j.name+'" now '+ok.expr+' (was '+ap.from+', approved by the owner)')}}
      // the gate script
      const cur=typeof j.script==='string'?j.script.trim():'';
      if(cur&&!cur.startsWith(GATE_PREFIX)&&!SKIP_EXT.test(cur)){row.unchained=cur;continue}   // a Python script keeps its own interpreter: left alone
      const original=cur.startsWith(GATE_PREFIX)?await originalOf(a,cur):cur;
      if(!live)continue;
      const body=gateBody({port:PORT,agent:a,jobId:j.id,sig:sig(a),original});
      if(await writeScript(a,j.id,body))did=true;
      if(j.script!==GATE_PREFIX+j.id+'.sh'){j.script=GATE_PREFIX+j.id+'.sh';did=true}
      if(row.original!==(original||null)){row.original=original||null;dirty=true}}
     if(did){await backup(a,file);await writeJson(file,d);changed.push(a)}})}
   catch(e){log('run gates: '+a+': '+e.message)}}
  if(dirty||changed.length)await save().catch(()=>{});
  if(changed.length)log('run gates: set up for '+changed.join(', '));return changed}

 // for the Health view: per schedule, how many runs the gate stopped
 async function view(){await load();const rows=Object.entries(db.jobs).map(([k,v])=>{const [agent,id]=[k.slice(0,k.indexOf('/')),k.slice(k.indexOf('/')+1)];const skipped=v.skips||0;
  return {agent,job:id,name:v.name,original:v.original||null,unchained:v.unchained||null,runs:v.runs||0,skipped,skippedBy:Object.fromEntries(Object.entries(v.by||{}).map(([w,n])=>[reasonShort[w]||w,n])),
   savedShare:skipped+(v.runs||0)?Math.round(skipped/(skipped+(v.runs||0))*100):0,lastSkipAt:v.lastSkipAt||null,lastSkip:v.lastSkipText||null,since:v.since}});
  return {on:!await stat(OFF).then(()=>true,()=>false),jobs:rows.sort((a,b)=>b.skipped-a.skipped),proposals:Object.values(db.proposals)}}
 return {check,install,view,offAll,gateName:id=>GATE_PREFIX+id+'.sh'}}
