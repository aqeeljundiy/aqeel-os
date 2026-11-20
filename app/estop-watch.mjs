// The engine's emergency stop, never silent again (21 Nov 2026). On 20 Nov one /pause in Telegram stopped every agent on Elkiya,
// customer lines included, for an hour, and nothing told anyone. The engine keeps the stop as <HERMES_HOME>/ESTOP; this is read on
// the gateway watch (every minute, no timer of its own):
//   - while it is on: one Needs-you item (kind 'estop') with Lift it, and once it has lasted `after`, one Telegram message to the
//     owner per stop;
//   - once it is off (lifted here, by /pause off, or by `hermes resume`): the item goes by itself.
// Lift it runs the engine's own `hermes resume` (POST /ui/engine/resume, admins only).
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';

export function estopText(state,now=Date.now(),tz=undefined){const at=Date.parse(state?.engaged_at||'')||now,mins=Math.max(0,Math.round((now-at)/60e3));
 const t=new Date(at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',...(tz?{timeZone:tz}:{})});
 return {title:'Every agent on this server is paused',text:'The engine’s emergency stop is on since '+t+(mins?' ('+mins+' min)':'')+(state?.reason?', reason: '+state.reason:'')+
  '. No agent takes new work: customer chats, Telegram, schedules. Lift it here, or send /pause off to any agent. It was started with /pause or hermes pause.',mins}}

export function createEstopWatch({HERMES_HOME,bottlenecks,send=async()=>{},tz=()=>undefined,after=2*60e3,now=()=>Date.now(),bin=path.join(homedir(),'.local','bin','hermes'),log=m=>console.log(m)}){
 const F=path.join(HERMES_HOME,'ESTOP');let told='',shown=false;
 const read=async()=>{try{const t=await readFile(F,'utf8');try{return JSON.parse(t)||{}}catch{return {}}}catch{return null}};   // a file that does not parse still counts as on (the engine says so)
 async function tick(){const s=await read();
  if(!s){if(shown){shown=false;told='';await bottlenecks.resolve('estop').catch(()=>{});log('estop: lifted')}return null}
  const x=estopText(s,now(),tz());if(!shown){shown=true;log('estop: on since '+(s.engaged_at||'?'))}
  await bottlenecks.event('estop',x.title,x.text,{topic:'estop'}).catch(()=>{});
  const key=String(s.engaged_at||'on');if(told!==key&&now()-(Date.parse(s.engaged_at||'')||now())>=after){told=key;
   await send('⏸️ '+x.title+'. '+x.text).catch(e=>log('estop: telegram '+e.message))}
  return s}
 const resume=()=>new Promise(res=>execFile(bin,['resume'],{timeout:60e3},(e,out,err)=>res({ok:!e,out:String(out||err||'')})));
 // the route (server.mjs keeps one line): POST /ui/engine/resume
 async function route(req,res,p,{admin,send:reply}){if(p!=='/ui/engine/resume')return false;if(req.method!=='POST')return reply(res,405,{error:'POST only'}),true;
  if(!admin)return reply(res,403,{error:'Only admins lift the pause.'}),true;const r=await resume();if(!r.ok&&await read())return reply(res,409,{error:'The engine did not lift the pause: '+r.out.slice(0,200)}),true;
  log('estop: lifted from the app');await tick();return reply(res,200,{ok:true}),true}
 return {tick,route}}
