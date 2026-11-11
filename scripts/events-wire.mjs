#!/usr/bin/env node
// Wires one schedule to events and a no-model check (11 Nov 2026, extended 12 Nov). Nothing is changed unless --apply is given; without it
// the script prints what it would do. Three steps:
//   1. <home>/scripts/aqeelos-check-<job>.sh: calls scripts/run-check.mjs with the checks (run-gates.mjs runs it first);
//   2. DATA/event-runs.json: the rule "event <names> starts job <id>" (app/event-runs.mjs);
//   3. the clock schedule becomes the slow fallback (default hourly), through the engine's own update call.
// Usage: node scripts/events-wire.mjs --agent continue-threads --job 7ab01824ed01 --events comment.created,message.received
//          --checks "--dms" [--platforms threads] [--expr "23 * * * *"] [--min-gap 120] [--data DIR] [--home DIR] [--apply]
// 12 Nov additions:
//   --check-only          only step 1: the schedule keeps its clock and its prompt, a no-model check in front of the model decides each run
//   --after <job id>      the rule is "when schedule <job id> finishes well, start this one" (a chain), event schedule.finished; combine with
//                         --keep-schedule to leave the clock as it is (the clock then only retries, and the check says whether anything is due)
//   --keep-schedule       step 3 is skipped
//   --undo                removes the check script and the rules of this job (the clock: put it back with --expr "<old cron line>" and no other flag... see the doc)
//   --checks accepts double quotes around one flag's value: --checks '--cmd "node /x/check.mjs --stage 2" --cmd-once'
// Engine: HERMES_DASH (default http://127.0.0.1:9119) and HERMES_DASHBOARD_SESSION_TOKEN, as aqeelOS itself uses.
import {readFile,writeFile,mkdir,rename,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2),opt=(n,d)=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:d},has=n=>args.includes('--'+n),apply=has('apply'),undo=has('undo');
const agent=opt('agent'),job=opt('job');
if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agent||'')||!/^[\w-]{1,64}$/.test(job||'')){console.error('--agent and --job are needed');process.exit(2)}
const home=opt('home',agent==='default'?path.join(homedir(),'.hermes'):path.join(homedir(),'.hermes','profiles',agent));
const DATA=opt('data',process.env.AQEELOS_DATA||'');if(!DATA){console.error('--data (aqeelOS data folder) is needed');process.exit(2)}
const after=opt('after'),checkOnly=has('check-only'),keepSchedule=has('keep-schedule')||checkOnly;
if(after&&!/^[\w-]{1,64}$/.test(after)){console.error('--after is a job id');process.exit(2)}
const events=(after?'schedule.finished':opt('events','comment.created')).split(',').map(s=>s.trim()).filter(Boolean),platforms=(opt('platforms','')||'').split(',').map(s=>s.trim()).filter(Boolean);
const checks=opt('checks','--dms'),expr=opt('expr','23 * * * *'),gap=+opt('min-gap',after?0:120);
const here=path.dirname(fileURLToPath(import.meta.url)),runCheck=path.join(here,'run-check.mjs');
if(/[^\w\s.=:\/"-]/.test(checks)||(checks.match(/"/g)||[]).length%2){console.error('--checks holds run-check.mjs flags only (letters, digits, . = : / - and balanced double quotes)');process.exit(2)}

export const checkScript=({runCheck,agent,home,data,checks,job})=>['#!/bin/bash','# Written by aqeelOS (events-wire.mjs). The run gate runs this before the AI; the last line says whether there is anything to do.',
 'exec node '+JSON.stringify(runCheck)+' --agent '+agent+' --home '+JSON.stringify(home)+' --data '+JSON.stringify(data)+(job?' --job '+job:'')+' '+checks,''].join('\n');

const say=m=>console.log((apply||undo?'':'[dry run] ')+m);
const script=path.join(home,'scripts','aqeelos-check-'+job+'.sh'),file=path.join(DATA,'event-runs.json');
const readDb=async()=>{let db={};try{db=JSON.parse(await readFile(file,'utf8'))}catch{}db.rules||={};return db};
const writeDb=async db=>{await mkdir(DATA,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(db,null,1));await rename(file+'.tmp',file)};

if(undo){const db=await readDb();const rules=(db.rules[agent]||[]).filter(r=>r.job!==job);
 say('undo 1. remove '+script);say('undo 2. in '+file+' the rules of '+agent+' lose those of job '+job+' (left: '+rules.length+')');
 say('the clock of the schedule is not touched here: put the old cron line back through the schedule screen or the engine update call');
 if(apply){await rm(script,{force:true});if(rules.length)db.rules[agent]=rules;else delete db.rules[agent];await writeDb(db);console.log('undone')}
 process.exit(0)}

const body=checkScript({runCheck,agent,home,data:DATA,checks,job});
say('1. write '+script+':\n'+body);
let db=await readDb(),rules=null;
if(!checkOnly){rules=(db.rules[agent]||[]).filter(r=>r.job!==job);rules.push({event:events,job,...(platforms.length?{platforms}:{}),...(after?{after,ok:true}:{}),minGapSec:gap});db.rules[agent]=rules;
 say('2. in '+file+' the rules of '+agent+' become '+JSON.stringify(rules))}
const dash=(process.env.HERMES_DASH||'http://127.0.0.1:9119').replace(/\/$/,''),tok=process.env.HERMES_DASHBOARD_SESSION_TOKEN||'';
if(!keepSchedule)say('3. PUT '+dash+'/api/cron/jobs/'+job+'?profile='+agent+' {"updates":{"schedule":"'+expr+'"}}  (the fallback poll)');
if(apply){
 await mkdir(path.dirname(script),{recursive:true});await writeFile(script,body,{mode:0o700});await chmod(script,0o700);
 if(!checkOnly)await writeDb(db);
 if(keepSchedule){console.log('done');process.exit(0)}
 if(!tok){console.error('no HERMES_DASHBOARD_SESSION_TOKEN: steps 1 and 2 done, the schedule is unchanged');process.exit(3)}
 const r=await fetch(dash+'/api/cron/jobs/'+job+'?profile='+encodeURIComponent(agent),{method:'PUT',headers:{'x-hermes-session-token':tok,'content-type':'application/json'},body:JSON.stringify({updates:{schedule:expr}})});
 if(!r.ok){console.error('the engine answered '+r.status);process.exit(4)}console.log('done')}
