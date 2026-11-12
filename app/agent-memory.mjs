// Memory per agent (HEALTH-6, 11 Nov 2026): what each agent's programs use in RAM, and a warning when one keeps growing.
// Each agent's tools, screens and browsers run as its own Linux user (ag-<agent>, agent-defaults.mjs), so summing what
// each user's processes hold gives a number per agent. The app's own user is the main agent and the engine together.
// A sample every 10 minutes; one point an hour (the mean of its samples) kept 7 days in DATA/agent-memory.json.
// A warning when the daily mean rose for 3 days in a row and grew by at least half a GB to 1 GB or more.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {userInfo} from 'node:os';
import path from 'node:path';

const HOUR=3600e3,DAY=24*HOUR,KEEP=7*24;
// "rss user" lines (ps -eo rss=,user=) → Map user → bytes
export function perUser(text){const m=new Map();for(const l of String(text||'').split('\n')){const x=/^\s*(\d+)\s+(\S+)/.exec(l);if(x)m.set(x[2],(m.get(x[2])||0)+Number(x[1])*1024)}return m}
// the agent a Linux user belongs to: ag-<agent> (cut at 32 characters), or the app's own user for the main agent
export function agentOfUser(user,agents,self){if(user===self)return 'default';if(!user.startsWith('ag-'))return null;return agents.find(a=>('ag-'+a).slice(0,32)===user)||null}
// daily means, oldest first, from hourly points [{t,b}], the newest day ending at the last point
export function dailyMeans(points){if(!points?.length)return [];const end=points.at(-1).t,out=[];
 for(let d=6;d>=0;d--){const from=end-(d+1)*DAY,to=end-d*DAY;const p=points.filter(x=>x.t>from&&x.t<=to);if(p.length)out.push(p.reduce((a,x)=>a+x.b,0)/p.length)}return out}
// growing: the last daily means each rose by 4% or more, 3 days in a row at least, by 0.5 GB or more, to 1 GB or more
export function growth(points){const m=dailyMeans(points);if(m.length<3)return null;let k=m.length-1;while(k>0&&m[k]>m[k-1]*1.04)k--;
 const days=m.length-1-k;if(days<2)return null;const from=m[k],to=m.at(-1);if(to<1e9||to-from<0.5e9)return null;
 return {from:Math.round(from),to:Math.round(to),days:days+1,perDay:Math.round((to-from)/days)}}

export function createAgentMemory({DATA,listAgents=async()=>[],boxMemory=async()=>null,ps=null,now=()=>Date.now(),self=userInfo().username,log=m=>console.log(m)}){
 const FILE=path.join(DATA,'agent-memory.json');let db=null,samples=new Map(),timer=null;
 const load=async()=>{if(!db){db=await readStore(FILE);db.agents||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db))};
 const readPs=ps||(()=>new Promise(res=>execFile('ps',['-eo','rss=,user='],{maxBuffer:8e6},(e,o)=>res(e?'':String(o)))));
 // what each agent holds right now (bytes)
 async function current(){const [txt,agents]=await Promise.all([readPs(),listAgents().catch(()=>[])]);const out={};
  for(const [u,b] of perUser(txt)){const a=agentOfUser(u,agents,self);if(a)out[a]=(out[a]||0)+b}return out}
 async function sample(){await load();const cur=await current(),t=now(),hour=t-(t%HOUR);
  for(const [a,b] of Object.entries(cur)){const s=samples.get(a);if(s&&s.hour===hour){s.sum+=b;s.n++}else samples.set(a,{hour,sum:b,n:1})}
  // each agent's point for this hour, updated as samples come in
  for(const [a,s] of samples){if(s.hour!==hour){samples.delete(a);continue}const p=(db.agents[a]||=[]);const v={t:hour,b:Math.round(s.sum/s.n)};
   if(p.at(-1)?.t===hour)p[p.length-1]=v;else p.push(v);if(p.length>KEEP)p.splice(0,p.length-KEEP)}
  for(const a of Object.keys(db.agents))if(!(db.agents[a].at(-1)?.t>t-KEEP*HOUR))delete db.agents[a];
  db.now={t,cur};await save();return cur}
 function start(every=10*60e3){if(timer)return;const go=()=>sample().catch(e=>log('agent memory: '+e.message));setTimeout(go,30e3).unref?.();timer=setInterval(go,every);timer.unref?.()}
 // per agent: now, the daily means for the spark line, and the warning when it keeps growing
 async function view(){await load();const cur=db.now?.t>now()-30*60e3?db.now.cur:await sample().catch(()=>({}));const box=await boxMemory().catch(()=>null);
  const ids=[...new Set([...Object.keys(cur||{}),...Object.keys(db.agents)])];
  return {limit:box?.memory?.limit||null,used:box?.memory?.used||null,agents:Object.fromEntries(ids.map(a=>{const p=db.agents[a]||[];const g=growth(p);
   return [a,{now:cur?.[a]??p.at(-1)?.b??0,days:dailyMeans(p).map(Math.round),growing:g}]}))}}
 return {sample,start,view,current}}
