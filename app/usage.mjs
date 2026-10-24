// Usage per person and per agent, added up from Hermes' chats (each chat knows its agent, model and tokens;
// aqeelOS knows who started it). Used by System › Usage and by per-person daily limits.
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
export function createUsage(DASH,TOKEN,DATA){
 const cache=new Map();   // agent → {t, list}
 const at=(s,active)=>active?Math.max(s.last_active||0,s.started_at||0):(s.started_at||0);
 async function chats(agent,since,active=false){
  const hit=cache.get(agent);if(hit&&Date.now()-hit.t<60000&&hit.since<=since)return hit.list.filter(s=>at(s,active)>=since);
  const list=[];for(let off=0;off<5000;off+=100){
   const r=await fetch(`${DASH}/api/sessions?limit=100&offset=${off}&profile=${encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':TOKEN}}).then(r=>r.json()).catch(()=>null);
   const page=r?.sessions||[];list.push(...page);if(page.length<100||page.some(s=>at(s,true)<since))break}
  cache.set(agent,{t:Date.now(),since,list});return list.filter(s=>at(s,active)>=since)}
 const add=(o,s)=>{o.chats++;o.messages+=s.message_count||0;o.input+=s.input_tokens||0;o.output+=s.output_tokens||0;o.cache+=(s.cache_read_tokens||0)+(s.cache_write_tokens||0);o.cost+=Number(s.estimated_cost_usd||s.actual_cost_usd||0)};
 const blank=()=>({chats:0,messages:0,input:0,output:0,cache:0,cost:0});
 // ownerOf(sessionId) → person id
 async function breakdown(agents,days,ownerOf){const since=Date.now()/1000-days*86400;const byPerson={},byAgent={},byModel={};
  for(const a of agents)for(const s of await chats(a,since)){const p=ownerOf(s.id);add(byPerson[p]||=blank(),s);add(byAgent[a]||=blank(),s);add(byModel[s.model||'unknown']||=blank(),s)}
  return {days,byPerson,byAgent,byModel}}
 // today's use counts only what a chat added today: each chat's totals at the first sight of the day are kept
 // (DATA/usage-day.json, reset at midnight) and subtracted. A chat started today starts from 0. Use before the first
 // sight of an older chat today is not counted (seen on every message a member sends, so the gap is small).
 const DAYF=DATA?path.join(DATA,'usage-day.json'):null;let day=null,first=null,saving=Promise.resolve();
 const dayKey=d=>d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
 async function base(k){if(!day){first||=DAYF?readFile(DAYF,'utf8').then(JSON.parse).catch(()=>null):Promise.resolve(null);day=day||await first}if(!day||day.day!==k||typeof day.base!=='object')day={day:k,base:{}};return day.base}
 const keep=()=>{if(!DAYF)return;const snap=JSON.stringify(day);saving=saving.then(async()=>{await mkdir(DATA,{recursive:true});const tmp=DAYF+'.'+process.pid+'.tmp';await writeFile(tmp,snap);await rename(tmp,DAYF)}).catch(e=>console.warn('usage day',e.message))};
 // tokens a person used since midnight (server time), across all agents
 async function today(agents,uid,ownerOf){const d=new Date();d.setHours(0,0,0,0);const since=d.getTime()/1000;const b=await base(dayKey(d));let t=0,m=0,added=false;
  for(const a of agents)for(const s of await chats(a,since,true)){const tok=(s.input_tokens||0)+(s.output_tokens||0),msg=s.message_count||0,k=a+'|'+s.id;
   if(!b[k]){b[k]=(s.started_at||0)>=since?{t:0,m:0}:{t:tok,m:msg};added=true}
   if(ownerOf(s.id)===uid){t+=Math.max(0,tok-b[k].t);m+=Math.ceil(Math.max(0,msg-b[k].m)/2)}}
  if(added)keep();return {tokens:t,messages:m}}
 return {breakdown,today,forget:()=>cache.clear()};
}
