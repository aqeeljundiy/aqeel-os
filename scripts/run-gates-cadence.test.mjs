// The 30-minute rule of app/run-gates.mjs: a schedule that starts the AI more often than every 30 minutes needs a no-model check or an
// event rule; without either it starts at most once per 30 minutes. Run: node --test scripts/run-gates-cadence.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cadenceOf,suggestCheck,savedStarts,checkBody,createRunGates,CHECK_PREFIX,MIN_CADENCE} from '../app/run-gates.mjs';

const T=Date.parse('2026-11-12T10:00:00Z'),MIN=60e3;
const sched=expr=>({kind:'cron',expr,display:expr});
const job=(id,name,o={})=>({id,name,prompt:'x',script:null,no_agent:false,enabled:true,state:'scheduled',schedule:sched('*/10 * * * *'),next_run_at:'2026-11-12T17:10:00.000000+07:00',...o});
async function make(jobsByAgent,{rule,names}={}){const root=await mkdtemp(path.join(tmpdir(),'cad-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data');let now=T;
 for(const [a,jobs] of Object.entries(jobsByAgent)){const h=a==='default'?H:path.join(H,'profiles',a);await mkdir(path.join(h,'cron'),{recursive:true});await mkdir(path.join(h,'scripts'),{recursive:true});
  await writeFile(path.join(h,'cron','jobs.json'),JSON.stringify({jobs},null,2))}
 const G=createRunGates({HERMES_HOME:H,DATA,WORK:path.join(root,'w'),PORT:4400,sig:a=>'s-'+a,now:()=>now,log:()=>{},rule,names});
 return {G,H,DATA,at:m=>{now=T+m*MIN},home:a=>path.join(H,'profiles',a)}}
const last=t=>t.trim().split('\n').pop();
const go=t=>last(t)==='{"wakeAgent": true}';

test('cadence: minute lists, intervals, and crons limited to some hours or days',()=>{
 assert.equal(cadenceOf({kind:'interval',minutes:5}),5);assert.equal(cadenceOf(sched('*/10 * * * *')),10);assert.equal(cadenceOf(sched('5,35 * * * *')),30);
 assert.equal(cadenceOf(sched('*/10 9-17 * * 1-5')),10,'active hours only, but every 10 minutes while active');
 assert.equal(cadenceOf(sched('*/30 9-19 * * 1-5')),30);assert.equal(cadenceOf(sched('0 9 * * 1')),60);assert.equal(cadenceOf({kind:'once'}),null);assert.equal(MIN_CADENCE,30)});

test('the standard check is proposed from the prompt\'s own words: reading work, or the posting limits for a job that sends',()=>{
 const answer='You are Continue Threads Manager. JOB: answer waiting DMs and replies under our comments (every 10 min, under 8 minutes).';
 assert.deepEqual(suggestCheck('Threads DM + reply answering runner '+answer),{checks:'--dms --comments',what:'unread DMs and unanswered comments'});
 assert.equal(suggestCheck('check the inbox').checks,'--dms');assert.equal(suggestCheck('Reply to every new comment on our posts').checks,'--comments');
 const send='Threads comment + DM runner (5 comments/h, 3 DMs/h) JOB: post comments (and comment-first DM pairings) until this hour has 5 comments, max 5/h, 8+ min apart, 70/day.';
 assert.equal(suggestCheck(send).checks,'--posting','its comments are ones it sends, not ones to answer');
 assert.equal(suggestCheck('Continue Sales Recap tick. In the terminal run exactly: python3 run.py If it prints nothing answer [SILENT]'),null);assert.equal(suggestCheck(''),null)});

test('the check script is the one events-wire writes: node run-check.mjs with the flags',()=>{
 const b=checkBody({runCheck:'/app/scripts/run-check.mjs',agent:'a',home:'/h/a',data:'/d',checks:'--dms --comments'});
 assert.match(b,/^#!\/bin\/bash/);assert.ok(b.endsWith('exec node "/app/scripts/run-check.mjs" --agent a --home "/h/a" --data "/d" --dms --comments\n'))});

test('a start without a check is let through once, then skipped until 28 minutes have passed, and the skips are counted by the hour',async()=>{
 const {G,at,DATA}=await make({a:[job('j1','Sales recap')]});
 assert.ok(go(await G.check('a','j1')),'the first start goes');
 for(const m of [10,20]){at(m);const r=await G.check('a','j1');assert.equal(last(r),'{"wakeAgent": false}');assert.match(r,/every 10 min.*once every 30 minutes/)}
 at(29.9);assert.ok(go(await G.check('a','j1')),'the third firing after a start (29:58) is the next start');
 const st=JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8')),row=st.jobs['a/j1'];assert.equal(row.by.cadence,2);assert.equal(row.runs,2);
 assert.equal((await G.view()).jobs[0].skippedBy['nothing-to-do skip (no check)'],2);
 const s=savedStarts(st,T+30*MIN);assert.equal(s.h24,2);assert.equal(s.d7,2);assert.deepEqual(s.jobs.map(j=>[j.agent,j.job,j.d7]),[['a','j1',2]]);
 assert.equal(savedStarts(st,T+25*3600e3).h24,0,'older than a day: only in the week');assert.equal(savedStarts(st,T+25*3600e3).d7,2);assert.equal(savedStarts(st,T+9*864e5).d7,0)});

test('the rule does not apply: a check of its own, an event rule, a slow schedule, a schedule that is the whole job, a kept one, the rule switched off',async()=>{
 const {G,at,home,DATA}=await make({a:[job('chk','has check'),job('evt','has event'),job('slow','slow',{schedule:sched('*/30 * * * *')}),job('nm','no model',{no_agent:true}),job('keep','kept'),job('plain','plain')]});
 await writeFile(path.join(home('a'),'scripts',CHECK_PREFIX+'chk.sh'),'#!/bin/bash\n');
 await mkdir(DATA,{recursive:true});await writeFile(path.join(DATA,'event-runs.json'),JSON.stringify({rules:{a:[{event:['message.received'],job:'evt'}]}}));
 await G.decide('a','keep','keep');
 for(const id of ['chk','evt','slow','keep'])assert.ok(go(await G.check('a',id)),id);at(10);
 for(const id of ['chk','evt','slow','keep'])assert.ok(go(await G.check('a',id)),id+' again, 10 minutes later');
 assert.ok(go(await G.check('a','plain')));at(11);assert.equal(last(await G.check('a','plain')),'{"wakeAgent": false}','the plain one is held');
 const off=await make({a:[job('p','plain')]},{rule:()=>false});assert.ok(go(await off.G.check('a','p')));off.at(5);assert.ok(go(await off.G.check('a','p')),'switched off for the install');assert.deepEqual(await off.G.needs(),[])});

test('one Health item per agent lists its schedules, with the proposed check where one fits',async()=>{
 const {G}=await make({'continue-threads':[job('dm','Threads DM + reply answering runner',{prompt:'answer waiting DMs and replies under our comments'}),job('rc','Sales recap (every 5 min)',{schedule:{kind:'interval',minutes:5,display:'every 5m'},prompt:'run recap.py'}),job('ok','Hourly',{schedule:sched('0 * * * *')})],
  other:[job('o','Inbox sweep',{prompt:'look at the inbox'})]},{names:a=>a==='other'?'Other':'Continue Threads'});
 const items=await G.needs();assert.equal(items.length,2);const it=items.find(x=>x.agent==='continue-threads');
 assert.equal(it.id,'cadence|continue-threads');assert.equal(it.kind,'cadence');assert.equal(it.agentName,'Continue Threads');assert.match(it.title,/2 schedules start the AI every few minutes with no check/);
 assert.deepEqual(it.jobs.map(j=>[j.job,j.every,j.suggest?.checks||null]),[['dm',10,'--dms --comments'],['rc',5,null]]);assert.match(it.text,/at most once every 30 minutes/);
 assert.equal((await G.needs(false)).length,0,'admins only')});

test('"Add a check" writes the standard check and lifts the slowdown; "Keep" is stored and the item never comes back',async()=>{
 const {G,at,home,DATA}=await make({a:[job('dm','DM runner',{prompt:'answer waiting DMs'}),job('rc','Sales recap',{prompt:'run recap.py'})]});
 await G.check('a','dm');const r=await G.decide('a','dm','check');assert.equal(r.checks,'--dms');
 const f=path.join(home('a'),'scripts',CHECK_PREFIX+'dm.sh');assert.ok((await readFile(f,'utf8')).endsWith(' --dms\n'));if(process.platform!=='win32')assert.equal((await stat(f)).mode&0o100,0o100);
 at(10);assert.ok(go(await G.check('a','dm')),'with a check of its own it is no longer held');
 await assert.rejects(()=>G.decide('a','rc','check'),/No standard check fits/);assert.equal((await G.needs())[0].jobs.length,1);
 assert.equal((await G.decide('a','rc','keep')).kept,true);assert.deepEqual(await G.needs(),[]);
 const st=JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8'));assert.equal(st.rules['a/rc'].keep.min,10);
 await assert.rejects(()=>G.decide('a','gone','keep'),/gone/);await assert.rejects(()=>G.decide('a','rc','x'),/Unknown choice/)});
