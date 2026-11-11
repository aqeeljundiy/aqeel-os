#!/usr/bin/env node
// Turns one model schedule into a script-only schedule (no model, no tokens), and back (12 Nov 2026). For schedules whose whole job is a fixed text
// or a command whose output is the message (the 4AM wake-up, the invoice reminder, the Master To Do sync once its script exists).
// Nothing is changed unless --apply is given; without it the script prints what it would do.
//   1. --from FILE (optional): copies that local file to <home>/scripts/<script> (mode 700), so the engine can run it;
//   2. the engine's own update call: PUT /api/cron/jobs/<job>?profile=<agent> {"updates":{"no_agent":true,"script":"<script>"[,"deliver":..][,"schedule":..]}}
// The schedule as it was (no_agent, script, deliver, schedule, prompt) is written to DATA/job-wired/<agent>-<job>.json first; --undo puts it back
// (the new script file is left in place). The delivery target of a script-only schedule is its "deliver": the script's output goes there, nothing
// printed = nothing sent.
// Usage: node scripts/job-script-wire.mjs --agent default --job c0a6ba56f9c3 --script wakeup-nudge.py --from scripts/box-checks/wakeup-nudge.py
//          [--deliver whatsapp:<id>] [--expr "0,2,4,6,8 4 * * *"] [--data DIR] [--home DIR] [--apply | --undo]
// Engine: HERMES_DASH (default http://127.0.0.1:9119) and HERMES_DASHBOARD_SESSION_TOKEN (node --env-file=$HOME/.hermes/.env ...), as aqeelOS uses.
import {readFile,writeFile,mkdir,rename,chmod,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';

const KEEP=['no_agent','script','deliver','schedule','prompt','enabled'];
// the fields to remember and the update to send
export function planUpdate(old,{script,deliver,expr}){const was=Object.fromEntries(KEEP.filter(k=>k in (old||{})).map(k=>[k,k==='schedule'?(old.schedule_display||old.schedule?.expr||old.schedule):old[k]]));
 const updates={no_agent:true,script,...(deliver?{deliver}:{}),...(expr?{schedule:expr}:{})};return {was,updates}}
export function undoUpdate(was){const u={...was};if(u.script===undefined||u.script===null)u.script='';return u}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d},has=n=>args.includes('--'+n),apply=has('apply'),undo=has('undo');
 const agent=opt('agent'),job=opt('job'),script=opt('script'),die=(m,c=2)=>{console.error(m);process.exit(c)};
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agent||'')||!/^[\w-]{1,64}$/.test(job||''))die('--agent and --job are needed');
 const HH=path.join(homedir(),'.hermes'),home=opt('home',agent==='default'?HH:path.join(HH,'profiles',agent)),DATA=opt('data',process.env.AQEELOS_DATA||process.env.UI_DATA_DIR||path.join(homedir(),'apps','hermes-ui-data'));
 const dash=(process.env.HERMES_DASH||'http://127.0.0.1:9119').replace(/\/$/,''),tok=process.env.HERMES_DASHBOARD_SESSION_TOKEN||'';
 const api=async(p,o={})=>{const r=await fetch(dash+'/api'+p,{...o,headers:{'x-hermes-session-token':tok,'content-type':'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('the engine answered '+r.status);return r.json()};
 const q='?profile='+encodeURIComponent(agent),keep=path.join(DATA,'job-wired',agent+'-'+job+'.json'),say=m=>console.log((apply||undo?'':'[dry run] ')+m);
 const put=updates=>api('/cron/jobs/'+job+q,{method:'PUT',body:JSON.stringify({updates})});
 if(undo){let was;try{was=JSON.parse(await readFile(keep,'utf8'))}catch{die('nothing recorded for '+agent+'/'+job+' ('+keep+')')}
  say('undo: '+agent+'/'+job+' goes back to '+JSON.stringify({...was,prompt:was.prompt?'<'+was.prompt.length+' characters>':was.prompt}));await put(undoUpdate(was));console.log("undone");process.exit(0)}
 if(!/^[\w.-]{1,80}$/.test(script||''))die('--script is a file name for <home>/scripts');
 let old=null;try{const l=await api('/cron/jobs'+q);old=(Array.isArray(l)?l:l.jobs||[]).find(j=>j.id===job)||null}catch(e){say('could not read the schedule ('+e.message+')')}
 if(!old&&apply)die('the schedule '+job+' of '+agent+' was not found in the engine',3);
 const {was,updates}=planUpdate(old,{script,deliver:opt('deliver'),expr:opt('expr')});
 if(opt('from'))say('1. copy '+opt('from')+' to '+path.join(home,'scripts',script)+' (mode 700)');
 say('2. PUT '+dash+'/api/cron/jobs/'+job+q+' '+JSON.stringify({updates})+'   (was: '+JSON.stringify({...was,prompt:was.prompt?'<'+was.prompt.length+' characters>':was.prompt})+')');
 if(apply){if(!tok)die('no HERMES_DASHBOARD_SESSION_TOKEN',3);
  await mkdir(path.dirname(keep),{recursive:true});try{await readFile(keep)}catch{await writeFile(keep,JSON.stringify(was,null,1),{mode:0o600})}   // the first state is the one to go back to
  if(opt('from')){const t=path.join(home,'scripts',script);await mkdir(path.dirname(t),{recursive:true});await copyFile(opt('from'),t);await chmod(t,0o700)}
  await put(updates);console.log('done')}}
