#!/usr/bin/env node
// Switches one agent's polling schedule to "run on payment" (12 Nov 2026). Nothing is changed unless --apply is given; without it
// the script prints what it would do. Three steps (app/event-hooks.mjs):
//   1. DATA/event-hooks.json: the hook "on payment.paid / order.posted run <command> in the agent's folder, deliver to <the schedule's chat>";
//   2. <home>/scripts/aqeelos-hook-<job>.sh: the slow fallback, a script that asks aqeelOS (signed, this box only) for the same run;
//   3. the model schedule becomes that script-only schedule (no_agent, no tokens), hourly by default, through the engine's own update call.
// The old schedule is written to DATA/event-hooks-wired/<agent>-<job>.json first; --undo puts it back and removes the hook.
// Usage: node scripts/hooks-wire.mjs --agent continue-support --job 8181388f19ee --run "python3 -I sales-recap/run.py" --feed sales-recap/feed
//          [--on payment.paid,order.posted] [--id sales-recap] [--deliver telegram:<chat>:<topic>] [--expr "17 * * * *"] [--min-gap 60]
//          [--keep "-> OK|ERROR"] [--prefix "Recap: "] [--dedupe] [--user ag-x --cwd /dir] [--data DIR] [--home DIR] [--port 4400] [--apply | --undo]
// Engine: HERMES_DASH (default http://127.0.0.1:9119) and HERMES_DASHBOARD_SESSION_TOKEN (node --env-file=$HOME/.hermes/.env ...), as aqeelOS itself uses.
import {readFile,writeFile,mkdir,rename,chmod} from 'node:fs/promises';
import {sigOf,relayKeys} from '../app/relay-keys.mjs';
import path from 'node:path';
import {homedir} from 'node:os';
import {cleanHook,remoteCommand,fallbackScript} from '../app/event-hooks.mjs';

const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d},has=n=>args.includes('--'+n),apply=has('apply'),undo=has('undo');
const agent=opt('agent'),job=opt('job'),die=(m,c=2)=>{console.error(m);process.exit(c)};
if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agent||'')||!/^[\w-]{1,64}$/.test(job||''))die('--agent and --job are needed');
const HH=path.join(homedir(),'.hermes'),home=opt('home',agent==='default'?HH:path.join(HH,'profiles',agent)),DATA=opt('data',process.env.AQEELOS_DATA||process.env.UI_DATA_DIR||path.join(homedir(),'apps','hermes-ui-data'));
const dash=(process.env.HERMES_DASH||'http://127.0.0.1:9119').replace(/\/$/,''),tok=process.env.HERMES_DASHBOARD_SESSION_TOKEN||'',port=opt('port',process.env.UI_PORT||'4400');
const say=m=>console.log((apply||undo?'':'[dry run] ')+m);
const api=async(p,o={})=>{const r=await fetch(dash+'/api'+p,{...o,headers:{'x-hermes-session-token':tok,'content-type':'application/json'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('the engine answered '+r.status);return r.json()};
const q='?profile='+encodeURIComponent(agent),file=path.join(DATA,'event-hooks.json'),keep=path.join(DATA,'event-hooks-wired',agent+'-'+job+'.json');
const readJson=async(f,d)=>{try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}};
const putJob=updates=>api('/cron/jobs/'+job+q,{method:'PUT',body:JSON.stringify({updates})});
const id=opt('id','sales-recap'),script='aqeelos-hook-'+job+'.sh';

if(undo){const was=await readJson(keep,null);if(!was)die('nothing recorded for '+agent+'/'+job+' ('+keep+')');
 say('undo: '+agent+'/'+job+' goes back to '+JSON.stringify(was.job)+' and the hook '+was.hook+' is removed');
 const db=await readJson(file,{});const hooks=db.hooks||db;const rest=(hooks[agent]||[]).filter(h=>h.id!==was.hook);if(rest.length)hooks[agent]=rest;else delete hooks[agent];
 await mkdir(DATA,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(db.hooks?{...db,hooks}:hooks,null,1));await rename(file+'.tmp',file);
 await putJob(was.job);console.log('undone');process.exit(0)}

const run=opt('run');if(!run)die('--run (the command inside the agent\'s folder) is needed');
let old=null;try{const l=await api('/cron/jobs'+q);old=(Array.isArray(l)?l:l.jobs||[]).find(j=>j.id===job)||null}catch(e){say('could not read the schedule ('+e.message+')')}
if(!old&&apply)die('the schedule '+job+' of '+agent+' was not found in the engine',3);
const originTarget=o=>o?.platform&&o.chat_id?o.platform+':'+o.chat_id+(o.thread_id?':'+o.thread_id:''):'';
const deliver=opt('deliver',old?(old.deliver&&old.deliver!=='origin'?old.deliver:originTarget(old.origin)):'');
const hook=cleanHook({id,on:opt('on','payment.paid,order.posted').split(',').map(s=>s.trim()).filter(Boolean),run,deliver:deliver||undefined,feed:opt('feed'),minGapSec:+opt('min-gap',60),keep:opt('keep'),prefix:opt('prefix',''),dedupe:has('dedupe')});
if(!hook)die('the hook is not valid: --run is plain words inside the folder, --deliver is telegram:<chat>[:<topic>], --feed a folder inside it');
if(!hook.deliver)die('no delivery target: the schedule has none; pass --deliver telegram:<chat>[:<topic>]');
remoteCommand(hook.run);   // throws when the command is not allowed
const expr=opt('expr','17 * * * *');
let secret=process.env.UI_SECRET||'';if(!secret)secret=(await readFile(path.join(DATA,'ui-secret'),'utf8').catch(()=>'')).trim();if(apply&&secret.length<32)die('no UI secret (UI_SECRET or '+path.join(DATA,'ui-secret')+')',3);
const sig=sigOf(relayKeys(DATA,secret||'x').cur,'relay:',agent);   // the relay key when there is one (rotate-secrets.mjs), else the cookie key
const body=fallbackScript({agent,id:hook.id,port,sig});
say('1. in '+file+' the hook of '+agent+': '+JSON.stringify(hook));
say('2. write '+path.join(home,'scripts',script)+':\n'+body.replace(sig,'<signature>'));
say('3. PUT '+dash+'/api/cron/jobs/'+job+q+' {"updates":{"no_agent":true,"script":"'+script+'","schedule":"'+expr+'"}}   (was: '+(old?JSON.stringify({no_agent:!!old.no_agent,script:old.script||null,schedule:old.schedule_display||old.schedule}):'unknown')+')');
if(apply){
 await mkdir(path.join(DATA,'event-hooks-wired'),{recursive:true});
 if(!await readJson(keep,null))await writeFile(keep,JSON.stringify({hook:hook.id,job:{no_agent:!!old.no_agent,script:old.script||null,schedule:old.schedule_display||old.schedule}},null,1));   // the first state is the one to go back to
 const db=await readJson(file,{}),hooks=db.hooks||db;hooks[agent]=[...(hooks[agent]||[]).filter(h=>h.id!==hook.id),{id:hook.id,on:hook.on,run:hook.run,deliver:hook.deliver,...(hook.feed?{feed:hook.feed}:{}),minGapSec:hook.gap,...(hook.keep?{keep:hook.keep}:{}),...(hook.prefix?{prefix:hook.prefix}:{}),...(hook.dedupe?{dedupe:true}:{})}];
 await writeFile(file+'.tmp',JSON.stringify(db.hooks?{...db,hooks}:hooks,null,1),{mode:0o600});await rename(file+'.tmp',file);
 await mkdir(path.join(home,'scripts'),{recursive:true});const sp=path.join(home,'scripts',script);await writeFile(sp,body,{mode:0o700});await chmod(sp,0o700);
 if(!tok)die('no HERMES_DASHBOARD_SESSION_TOKEN: steps 1 and 2 done, the schedule is unchanged',3);
 await putJob({no_agent:true,script,schedule:expr});console.log('done')}
