// Engine restarts that can wait (7 Nov 2026, owner): a restart drops every channel for 2 to 4 minutes, so one that an
// agent asks for (apply_changes, its own settings) or that aqeelOS wants for itself (agent defaults, the aqeelos-live
// plugin, new tool lists, n8n) waits for the quiet hours, 01:00 to 05:00 in the install's time zone. They are
// collected and done as one restart. App and tool-server changes need none: the engine re-reads config.yaml by itself
// ("MCP servers reconciled with config"). Restarts the owner asks for (Restart agents, channels, a restore) and
// repairs (no engine running, wrong home) stay immediate. Any immediate restart also covers what was waiting.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export const QUIET={from:1,to:5};
// the hour (0-23) at `date` in time zone `tz`; an unknown zone falls back to the system's
export function hourIn(date,tz){try{return Number(new Intl.DateTimeFormat('en-GB',{timeZone:tz||undefined,hour:'2-digit',hourCycle:'h23'}).format(date))%24}catch{return date.getHours()}}
export const inQuiet=(date,tz)=>{const h=hourIn(date,tz);return h>=QUIET.from&&h<QUIET.to};

export function createRestartLater({DATA,restart,tz=()=>'',now=()=>new Date(),log=m=>console.log(m)}){
 const FILE=path.join(DATA,'restart-later.json');let st=null;
 const load=async()=>st||=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>({whys:[],since:0}));
 const save=async()=>{await mkdir(DATA,{recursive:true});const t=FILE+'.'+process.pid+'.tmp';await writeFile(t,JSON.stringify(st));await rename(t,FILE)};
 // queue a reason; the same reason once
 async function add(why){await load();const w=String(why||'settings changed').slice(0,160);if(!st.whys.includes(w)){st.whys.push(w);st.whys=st.whys.slice(-20)}
  if(!st.since)st.since=now().getTime();await save();log('engine restart waits for the quiet hours ('+QUIET.from+':00-'+QUIET.to+':00): '+w);return {queued:true,whys:[...st.whys]}}
 // an immediate restart happened: everything waiting is covered by it
 async function covered(){await load();if(!st.whys.length)return;st={whys:[],since:0};await save()}
 // every few minutes: in the quiet hours, one restart for everything waiting
 async function tick(){await load();if(!st.whys.length||!inQuiet(now(),tz()))return false;const whys=st.whys;st={whys:[],since:0};await save();
  await restart('quiet-hours restart: '+whys.join('; ').slice(0,300));return true}
 const pending=async()=>{await load();return {whys:[...st.whys],since:st.since}};
 return {add,covered,tick,pending}}
