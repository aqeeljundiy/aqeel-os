// Usage per person and per agent, added up from Hermes' chats (each chat knows its agent, model and tokens;
// aqeelOS knows who started it). Used by System › Usage and by per-person daily limits.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {readRecords,summarize} from './route-order.mjs';
export function createUsage(DASH,TOKEN,DATA,opt={}){
 const cache=new Map(),flying=new Map();   // agent → {t,full,since,list}; agent → the read in progress
 const at=(s,active)=>active?Math.max(s.last_active||0,s.started_at||0):(s.started_at||0);
 const TTL=60000,FULL=600000,PAGE_MS=15000,CAP=5000;
 // one page of an agent's chats; a slow or failing engine throws (a long history used to hang the whole Usage page)
 const page=async(agent,off)=>{const r=await fetch(`${DASH}/api/sessions?limit=100&offset=${off}&profile=${encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':TOKEN},signal:AbortSignal.timeout(PAGE_MS)});
  if(!r.ok)throw new Error('the engine answered '+r.status);return (await r.json())?.sessions||[]};
 // newest first, back only to `stop`: a cached list is topped up with what changed since it was read (usually one page),
 // and read in full again every 10 minutes so deleted chats drop out
 async function read(agent,since){const hit=cache.get(agent),warm=hit&&hit.since<=since&&Date.now()-hit.full<FULL,stop=warm?Math.min(since,hit.t/1000-120):since;
  const got=[];let off=0;for(;off<CAP;off+=100){const pg=await page(agent,off);got.push(...pg);if(pg.length<100||pg.some(s=>at(s,true)<stop))break}
  let list=got;if(warm){const m=new Map(hit.list.map(s=>[s.id,s]));for(const s of got)m.set(s.id,s);list=[...m.values()]}
  const e={t:Date.now(),full:warm?hit.full:Date.now(),since:warm?hit.since:since,list};cache.set(agent,e);return e}
 async function chats(agent,since,active=false){const pick=e=>e.list.filter(s=>at(s,active)>=since);
  const hit=cache.get(agent);if(hit&&Date.now()-hit.t<TTL&&hit.since<=since)return pick(hit);
  // a read already under way for this agent serves everyone asking meanwhile (Usage, the people table and limits at once)
  const f=flying.get(agent);if(f){const e=await f.p;if(f.since<=since)return pick(e)}
  const p=read(agent,since).finally(()=>{if(flying.get(agent)?.p===p)flying.delete(agent)});flying.set(agent,{since,p});return pick(await p)}
 // a few agents at a time: the engine answers every agent from one process
 const each=async(list,fn,n=3)=>{const out=new Array(list.length);let i=0;await Promise.all(Array.from({length:Math.min(n,list.length)},async()=>{while(i<list.length){const k=i++;out[k]=await fn(list[k])}}));return out};
 // the engine's own usage report for one agent (System › Usage, Schedules' cost line): a few at a time, with a time limit
 // and one retry; when the engine fails, the last good answer (up to 30 min old) is served instead.
 // Shown at once (1 Nov 2026: Usage took ~9 s on the box): the last answer is given straight away and, once it is older than
 // a minute, read again behind the scenes for the next visit (stale-while-revalidate). Only an answer older than 6 hours,
 // or none yet, waits; fresh=true always waits for a new one.
 const REP_TTL=opt.ttl??60000,REP_STALE=opt.stale??6*3600e3;
 const rep=new Map();let running=0;const waiting=[];
 const slot=()=>running<3?(running++,Promise.resolve()):new Promise(r=>waiting.push(r)),free=()=>{const n=waiting.shift();n?n():running--};
 async function report(kind,agent,days,{fresh=false}={}){const k=kind+'|'+agent+'|'+days,hit=rep.get(k),age=hit?.d?Date.now()-hit.t:Infinity;
  if(!fresh&&age<REP_STALE){if(age>=REP_TTL&&!hit.p)reread(k,kind,agent,days,hit).catch(()=>{});return hit.d}
  if(hit?.p)return hit.p;return reread(k,kind,agent,days,hit)}
 function reread(k,kind,agent,days,hit){
  const p=(async()=>{await slot();try{for(let i=0;;i++){try{const r=await fetch(`${DASH}/api/analytics/${kind}?days=${days}&profile=${encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':TOKEN},signal:AbortSignal.timeout(45000)});
     if(!r.ok){const t=await r.text().catch(()=>'');throw Object.assign(new Error((()=>{try{const j=JSON.parse(t);return j.detail?.message||j.detail||j.error}catch{}})()||'the engine answered '+r.status),{status:r.status})}
     const d=await r.json();if(d&&typeof d==='object')d.read_at=Math.round(Date.now()/1000);rep.set(k,{t:Date.now(),d});return d}
    catch(e){if(i<1&&e.name!=='TimeoutError'&&!(e.status>=400&&e.status<500))continue;if(hit?.d&&Date.now()-hit.t<1800000){console.warn('usage report',agent,e.message,'(serving the last one)');rep.set(k,{...hit,p:null});return {...hit.d,stale_at:Math.round(hit.t/1000)}}
     rep.set(k,{...(hit||{t:0}),p:null});console.warn('usage report',agent,e.message);throw e}}}finally{free()}})();
  rep.set(k,{...(hit||{t:0}),p});return p}
 const add=(o,s)=>{o.chats++;o.messages+=s.message_count||0;o.input+=s.input_tokens||0;o.output+=s.output_tokens||0;o.cache+=(s.cache_read_tokens||0)+(s.cache_write_tokens||0);o.cost+=Number(s.estimated_cost_usd||s.actual_cost_usd||0)};
 const blank=()=>({chats:0,messages:0,input:0,output:0,cache:0,cost:0});
 // ownerOf(sessionId) → person id
 // agents that could not be read are named in `failed`, the rest still add up
 async function breakdown(agents,days,ownerOf){const since=Date.now()/1000-days*86400;const byPerson={},byAgent={},byModel={},failed=[];
  const per=await each(agents,a=>chats(a,since).catch(e=>{console.warn('usage',a,e.message);failed.push(a);return []}));
  agents.forEach((a,i)=>{for(const s of per[i]){const p=ownerOf(s.id,s);add(byPerson[p]||=blank(),s);add(byAgent[a]||=blank(),s);add(byModel[s.model||'unknown']||=blank(),s)}});
  // where a run asked for one model's vendor and ran on another (route-order.mjs): per agent and kind, with the reasons
  const routes=summarize(await readRecords(DATA,{days}).catch(()=>[]),{days,agents});
  return {days,byPerson,byAgent,byModel,routes,...(failed.length?{failed}:{})}}
 // today's use counts only what a chat added today: each chat's totals at the first sight of the day are kept
 // (DATA/usage-day.json, reset at midnight) and subtracted. A chat started today starts from 0. Use before the first
 // sight of an older chat today is not counted (seen on every message a member sends, so the gap is small).
 const DAYF=DATA?path.join(DATA,'usage-day.json'):null;let day=null,first=null,saving=Promise.resolve();
 const dayKey=d=>d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
 async function base(k){if(!day){first||=DAYF?readFile(DAYF,'utf8').then(JSON.parse).catch(()=>null):Promise.resolve(null);day=day||await first}if(!day||day.day!==k||typeof day.base!=='object')day={day:k,base:{}};return day.base}
 const keep=()=>{if(!DAYF)return;const snap=JSON.stringify(day);saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});const tmp=DAYF+'.'+process.pid+'.tmp';await writeFile(tmp,snap);await rename(tmp,DAYF)}).catch(e=>console.warn('usage day',e.message))};
 // tokens a person used since midnight (server time), across all agents
 async function today(agents,uid,ownerOf){const d=new Date();d.setHours(0,0,0,0);const since=d.getTime()/1000;const b=await base(dayKey(d));let t=0,m=0,added=false;
  // an agent that can't be read counts nothing this time (a limit never blocks a message because the engine is slow)
  const per=await each(agents,a=>chats(a,since,true).catch(()=>[]));
  agents.forEach((a,ai)=>{for(const s of per[ai]){const tok=(s.input_tokens||0)+(s.output_tokens||0),msg=s.message_count||0,k=a+'|'+s.id;
   if(!b[k]){b[k]=(s.started_at||0)>=since?{t:0,m:0}:{t:tok,m:msg};added=true}
   if(ownerOf(s.id)===uid){t+=Math.max(0,tok-b[k].t);m+=Math.ceil(Math.max(0,msg-b[k].m)/2)}}});
  if(added)keep();return {tokens:t,messages:m}}
 return {breakdown,today,report,forget:()=>{cache.clear();rep.clear()}};
}
