// Engine restarts that can wait (7 Nov 2026, owner): a restart drops every channel for 2 to 4 minutes, so one that an
// agent asks for (apply_changes, its own settings) or that aqeelOS wants for itself (agent defaults, the aqeelos-live
// plugin, new tool lists, n8n) waits for the quiet hours, 01:00 to 05:00 in the install's time zone. They are
// collected and done as one restart. A script on the box asks for one by dropping <data>/restart-request.json {"why"} (the nightly
// entry of scripts/services.sh does: the same path as everything else, no loop of its own). App and tool-server changes need none: the engine re-reads config.yaml by itself
// ("MCP servers reconciled with config"). Restarts the owner asks for (Restart agents, channels, a restore) and
// repairs (no engine running, wrong home) stay immediate. Any immediate restart also covers what was waiting.
import {writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import path from 'node:path';

export const QUIET={from:1,to:5};
// the hour (0-23) at `date` in time zone `tz`; an unknown zone falls back to the system's
export function hourIn(date,tz){try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:tz||undefined,hour:'2-digit',hourCycle:'h23'}).format(date))%24}catch{return date.getHours()}}
export const inQuiet=(date,tz)=>{const h=hourIn(date,tz);return h>=QUIET.from&&h<QUIET.to};

// a one-time schedule due soon (14 Nov 2026: a test-cleanup schedule was lost to the window restart). The engine deletes a one-time
// job that is more than two minutes late, and before a restart aqeelOS holds new scheduled runs for up to ten minutes, so a one-time
// job due in that stretch never ran. The window restart now waits while one is due within `minutes` (or just past due, still to run).
export const isOneShot=j=>{const e=String(j?.schedule?.expr??j?.schedule??'').trim();return j?.schedule?.kind==='once'||/^(once\b|\d{4}-\d\d-\d\d)/i.test(e)||j?.repeat?.times===1};
export function oneShotDueSoon(jobs,at,minutes=15){const t=+at;return (jobs||[]).find(j=>isOneShot(j)&&j.enabled!==false&&j.state!=='paused'&&j.state!=='completed'&&(()=>{const n=Date.parse(j.next_run_at||'');return Number.isFinite(n)&&n>=t-5*60e3&&n<=t+minutes*60e3})())||null}

// the engine's schedules, asked from its dashboard API, for the check above (server.mjs wires it to the window restart)
export const cronDueSoon=(origin,token,fetchFn=fetch)=>async()=>{const r=await fetchFn(origin+'/api/cron/jobs?profile=all',{signal:AbortSignal.timeout(20000),headers:{'x-hermes-session-token':token}});if(!r.ok)return null;const j=await r.json().catch(()=>null);return oneShotDueSoon(Array.isArray(j)?j:j?.jobs||[],Date.now())};

// Since 12 Nov 2026 these restarts go in the maintenance window (maintenance.mjs) and no longer wait for an idle box: what the
// restart cuts off is continued afterwards (resume.mjs). A restart in the window waits gently for what is running (restartGraceMs,
// 10 minutes unless the install says otherwise), then restarts with --interrupt (stopGatewayCmd passes --yes).
// inWindow/label: the install's maintenance window (maintenance.mjs) instead of the fixed hours above (12 Nov 2026)
export function createRestartLater({DATA,restart,dueSoon=async()=>null,tz=()=>'',now=()=>new Date(),log=m=>console.log(m),inWindow=d=>inQuiet(d,tz()),label=()=>'the quiet hours ('+QUIET.from+':00-'+QUIET.to+':00)'}){
 const FILE=path.join(DATA,'restart-later.json'),REQ=path.join(DATA,'restart-request.json');let st=null;
 const load=async()=>st||=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>({whys:[],since:0}));
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(st))};
 // queue a reason; the same reason once
 async function add(why){await load();const w=String(why||'settings changed').slice(0,160);if(!st.whys.includes(w)){st.whys.push(w);st.whys=st.whys.slice(-20)}
  if(!st.since)st.since=now().getTime();await save();log('engine restart waits for '+label()+': '+w);return {queued:true,whys:[...st.whys]}}
 // an immediate restart happened: everything waiting is covered by it
 async function covered(){await load();if(!st.whys.length)return;st={whys:[],since:0};await save()}
 // a script's request file (scripts/services.sh): queued like any other reason, then deleted
 async function take(){let t='';try{t=await readFile(REQ,'utf8')}catch{return false}await unlink(REQ).catch(()=>{});let w='';try{w=JSON.parse(t).why}catch{w=t.trim()}await add(String(w||'requested by a script').replace(/\s+/g,' ').slice(0,160));return true}
 // every few minutes: in the quiet hours, one restart for everything waiting
 async function tick(){await take();await load();if(!st.whys.length||!inWindow(now()))return false;
  // a one-time schedule due within 15 minutes runs first; the restart is tried again at the next tick (every 5 minutes)
  const due=await dueSoon().catch(()=>null);if(due){if(st.heldFor!==due.id){st.heldFor=due.id;await save();log('window restart waits: the one-time schedule "'+String(due.name||due.id).slice(0,60)+'" is due at '+String(due.next_run_at||'').slice(11,16)+' UTC')}return false}
  const whys=st.whys;st={whys:[],since:0};await save();
  await restart('quiet-hours restart: '+whys.join('; ').slice(0,300));return true}
 const pending=async()=>{await load();return {whys:[...st.whys],since:st.since}};
 return {add,covered,tick,take,pending}}
