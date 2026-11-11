// Event-started runs (11 Nov 2026). Owner's reason: an agent that polls every 10 minutes for DMs and replies spends a run's
// setup on most of them for nothing. With an event (Tebar's webhook: a new comment, a new DM) the matching schedule is
// started at once, and the clock schedule can fall back to once an hour, only so that nothing is missed when a webhook
// does not arrive. The run is started the way "run now" does it (the engine's POST /api/cron/jobs/<id>/trigger), so the
// run gate and the job's own check (run-gates.mjs, run-checks.mjs) still come first and stop a run with nothing to do.
// Rules live in DATA/event-runs.json: {"rules":{"<agent>":[{"event":"comment.created","job":"<job id>","platforms":["threads"],"minGapSec":120}]}}
// Chains (12 Nov 2026): the event "schedule.finished" (app/schedule-finish.mjs) carries data.job and data.status; a rule with "after":"<job id>" matches only
// that job's finish (and "ok":true only when it ended well): {"event":"schedule.finished","after":"<stage 1 job>","ok":true,"job":"<stage 2 job>"}.
// "event" may be one name or a list; "platforms" is optional (the event's own platform field). Several events inside
// minGapSec become one run: the first starts at once, the rest one run when the gap is over.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';

const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/,JOB=/^[\w-]{1,64}$/;
export const DEFAULT_GAP=120;

// the rules an event matches
export function matching(rules,agent,ev){const type=String(ev?.type||''),p=String(ev?.data?.platform||'').toLowerCase();
 return (rules?.[agent]||[]).filter(r=>r&&JOB.test(String(r.job||''))&&[].concat(r.event||[]).includes(type)&&(!r.platforms?.length||r.platforms.map(x=>String(x).toLowerCase()).includes(p))&&(!r.after||String(ev?.data?.job||'')===String(r.after))&&(!r.ok||ev?.data?.status==='ok'))}
// the jobs whose finish starts something: {agent:[job ids]}
export const watchedJobs=rules=>Object.fromEntries(Object.entries(rules||{}).map(([a,l])=>[a,[...new Set((l||[]).filter(r=>r?.after&&JOB.test(String(r.after))).map(r=>String(r.after)))]]).filter(([,l])=>l.length));

export function createEventRuns({DATA,trigger,now=()=>Date.now(),log=m=>console.log(m),setTimer=(fn,ms)=>setTimeout(fn,ms)}){
 const FILE=path.join(DATA,'event-runs.json');let db=null;const last=new Map(),pending=new Map();
 const load=async()=>{try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.rules||={};db.runs||={};return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const go=async(agent,r,type)=>{const k=agent+'/'+r.job;last.set(k,now());pending.delete(k);
  try{await trigger(agent,r.job);const row=(db.runs[k]||={n:0});row.n++;row.at=now();row.by=type;await save().catch(()=>{});log('event run: '+agent+' job '+r.job+' started by '+type)}
  catch(e){log('event run: '+agent+' job '+r.job+' not started: '+e.message)}};
 // an event arrived: start every matching schedule (or queue one trailing start inside the gap). Returns the job ids touched.
 async function fire(agent,ev){if(!AGENT.test(String(agent||'')))return [];await load();const out=[];
  for(const r of matching(db.rules,agent,ev)){const k=agent+'/'+r.job,gap=(Number.isFinite(+r.minGapSec)?+r.minGapSec:DEFAULT_GAP)*1000,wait=(last.get(k)||0)+gap-now();out.push(r.job);
   if(wait<=0)await go(agent,r,ev.type);
   else if(!pending.has(k))pending.set(k,setTimer(()=>go(agent,r,ev.type),wait));}
  return out}
 // the rules, for a settings view
 async function view(){await load();return {rules:db.rules,runs:db.runs}}
 async function watched(){await load();return watchedJobs(db.rules)}
 async function setRules(agent,list){if(!AGENT.test(String(agent||'')))throw Error('Unknown agent');if(!Array.isArray(list))throw Error('Rules are a list');await load();
  db.rules[agent]=list.map(r=>({event:[].concat(r.event||[]).map(String),job:String(r.job||''),...(r.platforms?.length?{platforms:r.platforms.map(String)}:{}),...(r.after&&JOB.test(String(r.after))?{after:String(r.after)}:{}),...(r.ok?{ok:true}:{}),...(r.minGapSec!=null?{minGapSec:Math.max(0,+r.minGapSec||0)}:{})})).filter(r=>r.event.length&&JOB.test(r.job));
  if(!db.rules[agent].length)delete db.rules[agent];await save();return db.rules[agent]||[]}
 return {fire,view,setRules,watched}}
