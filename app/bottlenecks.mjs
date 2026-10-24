// Bottlenecks: everything that is stuck until a person acts, each with a way to fix it. Two sources:
//   - what aqeelOS notices itself: a sign-in that is due, an AI account signed out, a schedule that failed, an invite that expired, the server
//     having been off;
//   - what an agent reports with its report_bottleneck tool when it cannot go on: access it is missing, a sign-in,
//     a permission, something only the person can give.
// Reports of the same thing merge; items leave when fixed (system ones disappear by themselves, reports are marked
// fixed); "Not now" hides an item for a day (for everyone when an admin says it, else just for that person).
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export function createBottlenecks({DATA,dash,listAgents,names}){
 const FILE=path.join(DATA,'bottlenecks.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.reports||=[];db.snooze||={};db.fixed||={};db.events||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,120);
 // an agent reports what blocks it (merged with an open report about the same missing thing)
 async function report(agent,{what,missing,fix,from}){await load();const m=String(missing||'').trim().slice(0,400);if(!m)throw Error('Say what is missing.');
  const key=agent+'|'+norm(m);let r=db.reports.find(x=>x.key===key&&!x.fixed);
  if(r){r.count=(r.count||1)+1;r.updated=Date.now();if(what)r.what=String(what).slice(0,400);if(fix)r.fix=String(fix).slice(0,400);if(from)r.from=from}
  else{r={id:'r'+randomBytes(6).toString('hex'),key,agent,what:String(what||'').slice(0,400),missing:m,fix:String(fix||'').slice(0,400),created:Date.now(),updated:Date.now(),count:1,from:from||null};db.reports.unshift(r);db.reports=db.reports.slice(0,200)}
  await save();return r}
 // something aqeelOS itself noticed once (the server was off): shown until dismissed
 async function event(kind,text,detail){await load();db.events.unshift({id:'e'+randomBytes(6).toString('hex'),kind,text,detail,created:Date.now()});db.events=db.events.slice(0,20);await save()}
 let sched={at:0,items:[]};
 async function failedSchedules(){if(Date.now()-sched.at<120000)return sched.items;const out=[];
  for(const a of await listAgents().catch(()=>[])){let l;try{l=await dash('/cron/jobs?profile='+encodeURIComponent(a))}catch{continue}
   for(const j of (Array.isArray(l)?l:l?.jobs||[]))if(j.enabled!==false&&j.last_status&&!/^(ok|success|completed?)$/i.test(j.last_status))out.push({agent:a,id:j.id,name:j.name||j.prompt?.slice(0,60)||'A schedule',status:j.last_status,error:String(j.last_error||'').slice(0,300),at:j.last_run_at})}
  sched={at:Date.now(),items:out};return out}
 // the list for one person: system items (admins) and reports from the agents they may use
 async function list({admin,mayUse,signins,invites,uid,accounts}){await load();const now=Date.now();const hid=k=>(db.snooze[k]||0)>now||uid&&(db.snooze[uid+'#'+k]||0)>now||db.fixed[k];const out=[];
  if(admin){for(const s of signins||[]){const k='signin|'+s.agent+'|'+s.name;if(!hid(k))out.push({id:k,kind:'signin',agent:s.agent,agentName:s.agentName,title:(s.account?.workspace?(s.app||s.label||s.name)+' ('+s.account.workspace+')':(s.label||s.name))+' needs signing in',text:s.agentName+' can’t '+(s.does||'use it')+' until then.',purpose:s.origin?.purpose||'',from:s.origin?.from||null,signin:s})}
   for(const j of await failedSchedules()){const k='sched|'+j.agent+'|'+j.id+'|'+j.at;if(!hid(k))out.push({id:k,kind:'schedule',agent:j.agent,agentName:names(j.agent),title:'A schedule failed: '+j.name,text:(j.error||j.status).slice(0,200),job:j})}
   for(const i of invites||[]){const k='invite|'+i.code;if(!hid(k))out.push({id:k,kind:'invite',title:'The invite for '+(i.name||'someone')+' expired',text:'They can’t join with the old link.',invite:i})}
   // an AI account that signed out (accounts.mjs keeps one per account until it works again; the time keeps a
   // "Not now" to that one time, so a later sign-out shows again)
   for(const a of accounts||[]){const k='account|'+a.key+'|'+a.since;if(!hid(k))out.push({id:k,kind:'account',title:a.name+' is signed out',text:'Agents that use it can’t answer with it until it is reconnected.',account:a,at:a.since})}
   for(const e of db.events){const k='event|'+e.id;if(!hid(k))out.push({id:k,kind:e.kind,title:e.text,text:e.detail||''})}}
  for(const r of db.reports){if(r.fixed||!mayUse(r.agent)||hid('report|'+r.id))continue;out.push({id:'report|'+r.id,kind:'report',missing:r.missing,agent:r.agent,agentName:names(r.agent),title:names(r.agent)+' is blocked: '+r.missing,text:r.fix?'Would fix it: '+r.fix:'',purpose:r.what?r.what.replace(/^to /i,''):'',from:r.from||null,count:r.count,at:r.updated})}
  return out}
 async function done(id){await load();if(id.startsWith('report|')){const r=db.reports.find(x=>'report|'+x.id===id);if(r){r.fixed=Date.now()}}else db.fixed[id]=Date.now();await save()}
 // uid: a member's "Not now" hides it only for them; snoozes that ran out are dropped so the map stays small
 async function later(id,uid){await load();const now=Date.now();for(const [k,t] of Object.entries(db.snooze))if(t<now)delete db.snooze[k];db.snooze[uid?uid+'#'+id:id]=now+24*3600e3;await save()}
 // the open report behind a "report|<id>", so the caller can check who may act on it
 async function find(id){await load();return db.reports.find(x=>'report|'+x.id===id&&!x.fixed)||null}
 return {report,event,list,done,later,find}}
