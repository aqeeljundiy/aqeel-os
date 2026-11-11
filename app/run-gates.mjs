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
// The 30-minute rule (12 Nov 2026, owner-approved; both servers were CPU-bound with schedules waking a model every 5-10
// minutes for nothing): a schedule that starts the AI more often than every 30 minutes must have a no-model check that says
// whether there is anything to do: its own aqeelos-check-<job>.sh, or an event rule (event-runs.mjs). Without either, the gate
// lets it start at most once per 30 minutes and skips the other firings (counted as "nothing-to-do skip (no check)", with
// hourly buckets for the Efficiency view). The person's schedule is never rewritten for this. ONE Health item per agent lists
// them: "Add a check" where a standard check fits (suggestCheck reads the prompt's words: --dms, --comments, --posting) and
// "Keep every N min", which is stored and never asked again. install.json "cadenceRule": false turns the rule off.
// A manual "Run now" goes through the same gate, so it is skipped too when the last start was under 28 minutes ago.
//
// Rate: a job that sends N messages an hour gains nothing from running more often than once an hour. aqeelOS does not
// change a schedule silently: it records a proposal (proposals in DATA/run-gates.json, shown by view()). A proposal
// the owner approved is applied once; a later hand change of that schedule is left alone.
import {readFile,writeFile,mkdir,rename,stat,readdir,copyFile,chmod,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {decide as postDecide,clean as postClean} from './posting-limits.mjs';
import {cadenceMin} from './rule-conflicts.mjs';

export const GATE_PREFIX='aqeelos-gate-',CHECK_PREFIX='aqeelos-check-',POSTING_GATE='aqeelos-posting-gate.sh';
const MARK='# aqeelos-run-gate original=';
const MAX_HOLD_MS=6*3600e3;     // a hold further away than this is not believed (a clock gone wrong must not stop a schedule for days)
const LOG_TAIL=512*1024;
const SKIP_EXT=/\.(sh|bash)$/i;
// the owner's approvals (11 Nov 2026): Continue Threads' outbound DM runner sends at most 3 an hour, so it runs hourly
export const APPROVED=[{agent:'continue-threads',name:/outbound DM/i,expr:'7 * * * *',by:'owner',at:'2026-11-11',
 why:'it may send 3 DMs an hour, so running every 15 minutes only repeats the same setup'}];
const SPREAD_MINUTE=7;          // away from :00, :05, :10 ... where the other runners of that agent start
export const MIN_CADENCE=30,SLOT_MS=28*60e3;   // 28, not 30: a 10-minute schedule's third firing after a start lands at 29:58
const HOUR=3600e3,KEEP_HOURS=8*24;
const RUN_CHECK=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','scripts','run-check.mjs');

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

// minutes between two starts of a schedule. rule-conflicts' cadenceMin only reads a cron whose other fields are "*"; "*/10 9-17 * * 1-5"
// fires every 10 minutes while it is active, so the hour, day and weekday fields are widened for this question
export function cadenceOf(s){const c=cadenceMin(s);if(c!=null)return c;
 if(s?.kind==='cron'&&typeof s.expr==='string'){const f=s.expr.trim().split(/\s+/);if(f.length===5)return cadenceMin({kind:'cron',expr:f[0]+' * * * *'})}
 return null}

// which standard no-model check (run-checks.mjs flags for scripts/run-check.mjs) fits a schedule, from its prompt's own words.
// null when none does (a sales recap, a report): such a schedule can only be kept as it is or slowed down.
export function suggestCheck(text){const t=String(text||'');
 // a schedule whose job is to SEND (post comments, max 5/h, 3 DMs/h) has the posting limits as its check: its "comments" are not ones to answer
 if(/\bposting limits?\b|\bpost(?:s|ing)?\s+(?:new\s+)?(?:comments?|threads?|posts?)\b|\bmax\s*\d+\s*\/\s*h\b|\b\d+\s*(?:comments?|posts?|threads?|DMs?)\s*(?:\/|per|a|an)\s*(?:h\b|hour|day)/i.test(t))return {checks:'--posting',what:'the posting limits'};
 const dm=/\b(DMs?|direct messages?|inbox|unread (?:chats?|messages?|DMs?))\b/i.test(t),cm=/\bcomments?\b|\breplies\b/i.test(t);
 if(dm||cm)return {checks:[dm?'--dms':'',cm?'--comments':''].filter(Boolean).join(' '),what:[dm?'unread DMs':'',cm?'unanswered comments':''].filter(Boolean).join(' and ')};
 return null}

// the check script: the same file scripts/events-wire.mjs writes (the gate runs it first; its last line says whether there is anything to do)
export const checkBody=({runCheck=RUN_CHECK,agent,home,data,checks})=>['#!/bin/bash','# Written by aqeelOS (run gates, "Add a check"). The run gate runs this before the AI; the last line says whether there is anything to do.',
 'exec node '+JSON.stringify(runCheck)+' --agent '+agent+' --home '+JSON.stringify(home)+' --data '+JSON.stringify(data)+' '+checks,''].join('\n');

// skipped starts by hour bucket (row.hours {<hours since 1970>: n}) -> {h24,d7}
export function savedStarts(gates,now=Date.now()){const h=Math.floor(now/HOUR),out={h24:0,d7:0,jobs:[]};
 for(const [k,v] of Object.entries(gates?.jobs||{})){let a=0,b=0;for(const [hh,n] of Object.entries(v.hours||{})){const age=h-(+hh);if(age<0||!(n>0))continue;if(age<24)a+=n;if(age<7*24)b+=n}
  if(b){const i=k.indexOf('/');out.jobs.push({agent:k.slice(0,i),job:k.slice(i+1),name:v.name||'',h24:a,d7:b})}out.h24+=a;out.d7+=b}
 out.jobs.sort((x,y)=>y.d7-x.d7);return out}

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

export function createRunGates({strict=async()=>({}),HERMES_HOME,DATA,WORK,PORT,sig,live=true,lock=async(f,fn)=>fn(),skipAgent=async()=>false,names=a=>a,rule:ruleFn=()=>true,runCheck=RUN_CHECK,now=()=>Date.now(),log=m=>console.log(m),dayOf=t=>new Date(t).toISOString().slice(0,10).replace(/-/g,'')}){
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
 const reasonShort={backoff:'the AI service asked for a pause',limits:'posting limits',nothing:'nothing to do',cadence:'nothing-to-do skip (no check)'};

 // the 30-minute rule: the schedule's cadence when it applies to this job (starts the AI more often than every 30 minutes, has no
 // check script, no event rule, was not kept by the person, the rule is on), else null
 const rule=async()=>{try{return (await Promise.resolve(ruleFn()))!==false}catch{return true}};
 const exists=f=>stat(f).then(()=>true,()=>false);
 let evCache={at:0,v:{}};
 const eventRules=async()=>{if(now()-evCache.at>60e3){let v={};try{v=JSON.parse(await readFile(path.join(DATA,'event-runs.json'),'utf8')).rules||{}}catch{}evCache={at:now(),v}}return evCache.v};
 const hasEvent=async(a,id)=>((await eventRules())[a]||[]).some(r=>r&&r.job===id);
 const hasCheck=(a,id)=>exists(path.join(home(a),'scripts',CHECK_PREFIX+id+'.sh'));
 async function unchecked(a,job){if(!job||job.no_agent||job.enabled===false||job.state==='completed'||!await rule())return null;
  const c=cadenceOf(job.schedule);if(c==null||c>=MIN_CADENCE)return null;const r=db.rules[key(a,job.id)]||{};if(r.keep||r.off)return null;
  if(await hasCheck(a,job.id)||await hasEvent(a,job.id))return null;return c}

 // the gate's answer for one run of one job. Never throws: whatever goes wrong, the run goes ahead.
 async function check(a,jobId,{nothing=false}={}){await load();const t=now();let row,job=null;
  try{job=jobsOf(await readJobs(a)).find(x=>x.id===jobId)||null}catch{}
  row=job?jobRow(a,job):(db.jobs[key(a,jobId)]||={name:'',runs:0,skips:0,by:{},since:t});if(job)row.name=job.name||row.name;
  const skip=async(why,text)=>{row.by[why]=(row.by[why]||0)+1;row.skips++;row.lastSkipAt=t;row.lastSkipWhy=why;row.lastSkipText=text;
   if(why==='cadence'){const h=Math.floor(t/HOUR),b=row.hours||={};b[h]=(b[h]||0)+1;for(const k of Object.keys(b))if(h-k>KEEP_HOURS)delete b[k]}await save().catch(()=>{});
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
   // the 30-minute rule: no check of its own and no event rule, so at most one start per 30 minutes
   const cad=await unchecked(a,job);
   if(cad!=null&&row.lastRunAt&&t-row.lastRunAt<SLOT_MS)return await skip('cadence','aqeelOS run check: no run started. This schedule starts every '+cad+' min and has no check that says whether there is anything to do, so it starts at most once every '+MIN_CADENCE+' minutes ('+Math.round((t-row.lastRunAt)/60e3)+' min since the last start).')
  }catch(e){log('run gate '+a+'/'+jobId+': '+e.message)}
  row.runs++;row.lastRunAt=t;await save().catch(()=>{});
  return 'aqeelOS run check: clear to run.\n{"wakeAgent": true}'}

 async function postingDecision(a,t){let d;try{d=JSON.parse(await readFile(path.join(DATA,'posting-limits.json'),'utf8'))}catch{return null}
  const raw=d?.agents?.[a];if(!raw?.on)return null;const r=postClean(raw);
  // a conflict nobody answered yet (rule-conflicts.mjs): the strictest side counts, never more than any side allows
  const st=await strict(a).catch(()=>({}));if(st.gapMin!=null)r.gapMin=Math.max(r.gapMin,st.gapMin);for(const k of ['perDay','perHour'])if(st[k]!=null)r[k]=Math.min(r[k],st[k]);let entries=[];try{entries=JSON.parse(await readFile(path.join(DATA,'posting-log',a+'.json'),'utf8'))}catch{}
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
  return {on:!await stat(OFF).then(()=>true,()=>false),jobs:rows.sort((a,b)=>b.skipped-a.skipped),proposals:Object.values(db.proposals),cadenceRule:await rule(),saved:savedStarts(db,now())}}
 // The Health item (one per agent): its schedules that start the AI more often than every 30 minutes with nothing to check first
 async function pending(a){await load();const out=[];if(!await rule())return out;
  for(const j of jobsOf(await readJobs(a))){const c=await unchecked(a,j);if(c==null)continue;
   out.push({job:j.id,name:j.name||j.id,every:c,display:j.schedule?.display||j.schedule?.expr||('every '+j.schedule?.minutes+' min'),suggest:suggestCheck((j.name||'')+' '+(j.prompt||''))})}
  return out}
 async function needs(admin=true){if(!admin||!await rule())return [];const out=[];
  for(const a of await homes()){if(await skipAgent(a).catch(()=>false))continue;const jobs=await pending(a);if(!jobs.length)continue;const n=jobs.length;
   out.push({id:'cadence|'+a,kind:'cadence',agent:a,agentName:names(a),title:names(a)+': '+(n===1?'a schedule starts':n+' schedules start')+' the AI every few minutes with no check',
    text:(n===1?'It has':'They have')+' no check that says whether there is anything to do, so '+(n===1?'it starts':'they start')+' at most once every '+MIN_CADENCE+' minutes for now: '+jobs.map(j=>'“'+j.name+'” (every '+j.every+' min'+(j.suggest?', '+j.suggest.what+' can be checked':', no standard check fits')+')').join('; ')+'. Add a check, or keep the schedule as it is and accept the cost.',
    jobs,created:db.jobs[key(a,jobs[0].job)]?.since||now()})}
  return out}
 // "check": write the standard check the prompt's words suggest; "keep": accept the cost, stored, never asked again
 async function decide(a,jobId,choice){await load();const j=jobsOf(await readJobs(a)).find(x=>x.id===jobId);if(!j)throw Error('That schedule is gone.');const k=key(a,jobId),r=db.rules[k]||={};
  if(choice==='keep'){r.keep={at:now(),min:cadenceOf(j.schedule)};await save();return {ok:true,kept:true}}
  if(choice!=='check')throw Error('Unknown choice');const s=suggestCheck((j.name||'')+' '+(j.prompt||''));if(!s)throw Error('No standard check fits this schedule. Keep it as it is, or ask the agent for a check of its own.');
  if(!/^[\w-]{1,64}$/.test(jobId)||!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(a))throw Error('Unknown schedule');
  const f=path.join(home(a),'scripts',CHECK_PREFIX+jobId+'.sh');await mkdir(path.dirname(f),{recursive:true});await writeFile(f,checkBody({runCheck,agent:a,home:home(a),data:DATA,checks:s.checks}),{mode:0o700});await chmod(f,0o700);
  r.check={at:now(),checks:s.checks};await save();return {ok:true,checks:s.checks,what:s.what}}
 return {check,install,view,offAll,needs,pending,decide,gateName:id=>GATE_PREFIX+id+'.sh'}}
