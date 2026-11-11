// "A schedule finished" as an event (12 Nov 2026). The Elkiya Close stages were chained in ChatGPT (stage 2 runs when stage 1 finishes) and became
// daily guarded retries here. The engine records, per schedule, when it last ran and how it ended (cron/jobs.json: last_run_at, last_status), so
// this watcher turns a change of last_run_at into onEvent(agent,{type:'schedule.finished',data:{job,status}}). It looks only at the schedules an
// event rule names in "after" (event-runs.mjs watchedJobs), and only when the agent's jobs file changed (a stat first), so it costs next to nothing.
// The first look at a schedule is a baseline: it fires nothing. State is in memory: after an app restart the first look is a baseline again, so a
// schedule that finished while the app was down is picked up by the slow fallback of the schedule it would have started, not by this event.
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';

const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const jobsFile=(HERMES_HOME,agent)=>agent==='default'?path.join(HERMES_HOME,'cron','jobs.json'):path.join(HERMES_HOME,'profiles',agent,'cron','jobs.json');

export function createScheduleFinish({HERMES_HOME,watched=async()=>({}),onEvent=()=>{},log=m=>console.log(m)}){
 const seen=new Map(),mtimes=new Map();
 async function tick(){const w=await watched(),fired=[];
  for(const [agent,ids] of Object.entries(w)){if(!AGENT.test(agent)||!ids.length)continue;const f=jobsFile(HERMES_HOME,agent);
   const m=await stat(f).then(s=>s.mtimeMs).catch(()=>null);if(m==null||(mtimes.get(agent)===m&&ids.every(id=>seen.has(agent+'/'+id))))continue;mtimes.set(agent,m);
   let jobs;try{const d=JSON.parse(await readFile(f,'utf8'));jobs=Array.isArray(d)?d:d.jobs||[]}catch{continue}
   for(const id of ids){const j=jobs.find(x=>x.id===id);if(!j)continue;const k=agent+'/'+id,at=j.last_run_at||null;
    if(!seen.has(k)){seen.set(k,at);continue}
    if(at&&seen.get(k)!==at){seen.set(k,at);const ev={type:'schedule.finished',data:{job:id,status:j.last_status==='ok'?'ok':'failed'}};fired.push([agent,ev]);
     Promise.resolve().then(()=>onEvent(agent,ev)).catch(e=>log('schedule finish: '+agent+' '+id+': '+e.message))}}}
  return fired}
 return {tick}}
