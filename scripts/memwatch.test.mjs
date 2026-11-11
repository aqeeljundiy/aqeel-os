// The memory watchdog's decisions (app/memwatch.mjs, OPS-17)
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {containerMem,appOf,appsFrom,grew,plan,say,createMemWatch,LOW,OK,PASS_GAP,RECYCLE_GAP,ENGINE_GAP} from '../app/memwatch.mjs';

const GB=2**30,T=1_800_000_000_000;
const agent=(name,o={})=>({name,busy:false,idleMin:60,asleep:false,canSleep:true,chrome:0.3*GB,ads:0,...o});
const box=(free,o={})=>({free,used:(1-free)*28*GB,limit:28*GB,engine:{bytes:2*GB},agents:[],apps:[['Engine',2*GB]],...o});

test('the container: what it holds minus the cache it can drop, against its own limit',()=>{
 const m=containerMem('29662187520','30064771072','anon 1\ninactive_file 3957489664\nactive_file 5\n');
 assert.equal(m.used,29662187520-3957489664);assert.equal(m.limit,30064771072);assert.ok(Math.abs(m.free-0.145)<0.01);
 assert.equal(containerMem('100',NaN,''),null);assert.equal(containerMem('','100',''),null)});

test('processes are grouped by app and agent',()=>{
 assert.equal(appOf('ag-continue-threads','/home/claude/workspaces/.aqeelos-adspower/adspower_global /x/rpa.min.js'),'AdsPower · continue-threads');
 assert.equal(appOf('ag-sesa','/opt/aqeelos/chrome/chrome --type=renderer'),'Chrome · sesa');
 assert.equal(appOf('claude','/h/python3 -I -c import os, re, sys import x  -p default gateway'),'Engine');
 assert.equal(appOf('claude','/h/python3 -I -c import os, re, sys import x  -p default dashboard --no-open'),'Engine dashboard');
 assert.equal(appOf('claude','next-server (v16.3.3)'),'Web apps and dev servers');
 assert.equal(appOf('claude','/home/claude/.local/bin/claude -p --model x'),'Model programs');
 assert.equal(appOf('claude','/home/claude/.hermes/tools/chromium-1208/chrome-linux64/chrome --headless=new'),'Engine browsers');
 const m=appsFrom('ag-sesa 1024 /opt/aqeelos/chrome/chrome\nag-sesa 1024 /opt/aqeelos/chrome/chrome --type=gpu\nclaude 2048 next-server (v16)\njunk\n');
 assert.equal(m.get('Chrome · sesa'),2048*1024);assert.equal(m.get('Web apps and dev servers'),2048*1024)});

test('growth: 1 GB and a third more within a day, over at least 6 hours',()=>{const h=3600e3,now=T;
 const p=(vals)=>vals.map((b,i)=>({t:now-(vals.length-1-i)*h,b}));
 assert.deepEqual(grew(p([3,3,3,3,3,4.5,5,5.5,6].map(x=>x*GB)),now).to,6*GB);
 assert.equal(grew(p([3,3.2,3.3,3.4,3.5,3.6,3.7].map(x=>x*GB)),now),null);       // +0.7 GB: not enough
 assert.equal(grew(p([8,8,8,8,8,8,9.2].map(x=>x*GB)),now),null);                 // +1.2 GB but only 15%
 assert.equal(grew(p([1,3].map(x=>x*GB)),now),null)});                           // one hour apart: too short

test('plenty free: nothing, and a low spell ends once a quarter is free again',()=>{
 assert.deepEqual(plan(box(0.4),{},T).actions,[]);
 let r=plan(box(0.2),{},T);assert.deepEqual(r.actions,[]);assert.equal(r.st.spell,undefined);
 r=plan(box(0.1,{agents:[agent('a')]}),{},T);assert.ok(r.st.spell);
 r=plan(box(0.2),r.st,T+PASS_GAP);assert.ok(r.st.spell,'still a spell between 15% and 25%');
 r=plan(box(OK),r.st,T+2*PASS_GAP);assert.equal(r.st.spell,null)});

test('step 1: idle screens sleep, idle agents with their own AdsPower keep only their newest tabs; busy ones are left alone',()=>{
 const agents=[agent('idle'),agent('ads',{canSleep:false}),agent('busy',{busy:true}),agent('fresh',{idleMin:3}),agent('asleep',{asleep:true})];
 const r=plan(box(0.1,{agents}),{},T);
 assert.deepEqual(r.actions.map(a=>a.kind+':'+a.agent),['sleep:idle','tabs:ads']);
 assert.match(r.alert,/Memory on the AI box is low: 90% of its 30\.1 GB limit/);assert.ok(r.alert.includes('What I did: idle’s screen put to sleep (wakes on use); ads’s extra tabs closed.'));
 // the next pass waits for the step to take effect
 assert.deepEqual(plan(box(0.1,{agents}),r.st,T+30e3).actions,[])});

test('step 2: the biggest idle Chrome or AdsPower starts again, at most one every 15 minutes; then the engine; told once',()=>{
 const agents=[agent('t',{canSleep:false,chrome:1.5*GB,ads:5.7*GB}),agent('s',{canSleep:false,chrome:2.4*GB}),agent('w',{busy:true,chrome:9*GB})];
 let r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),{},T);assert.deepEqual(r.actions.map(a=>a.kind),['tabs','tabs']);assert.ok(r.alert);
 r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),r.st,T+PASS_GAP);
 assert.deepEqual(r.actions,[{kind:'recycle',agent:'t',what:'adspower',bytes:5.7*GB}]);assert.equal(r.alert,null,'the owner hears once per spell');
 assert.equal(say(r.actions[0]),'t’s AdsPower started again (6.1 GB)');
 r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),r.st,T+2*PASS_GAP);assert.deepEqual(r.actions,[{kind:'engine',bytes:3.4*GB}]);
 // 15 minutes not yet passed since the last restart: nothing is restarted, the engine not again within 6 hours
 r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),r.st,T+3*PASS_GAP);assert.deepEqual(r.actions,[]);
 r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),r.st,T+RECYCLE_GAP+PASS_GAP);assert.deepEqual(r.actions.map(a=>a.agent+':'+a.what),['s:chrome']);
 r=plan(box(0.1,{agents,engine:{bytes:3.4*GB}}),r.st,T+RECYCLE_GAP+2*PASS_GAP);assert.deepEqual(r.actions,[],'engine waits 6 hours');
 assert.ok(ENGINE_GAP>RECYCLE_GAP)});

test('nothing idle: nothing is stopped and the owner hears that once',()=>{
 const agents=[agent('a',{busy:true,chrome:3*GB}),agent('b',{idleMin:2,chrome:3*GB})];
 const r=plan(box(0.05,{agents,engine:{bytes:1*GB},apps:[['Engine',1*GB],['Web apps and dev servers',3.4*GB]]}),{},T);
 assert.deepEqual(r.actions,[]);assert.match(r.alert,/Nothing was idle, so nothing was stopped/);assert.match(r.alert,/Biggest now: Web apps and dev servers 3\.7 GB, Engine 1\.1 GB/);
 assert.equal(plan(box(0.05,{agents}),r.st,T+PASS_GAP).alert,null)});

test('small browsers are not restarted, and an engine already restarting is left alone',()=>{
 const agents=[agent('a',{canSleep:false,chrome:0.5*GB})];
 let r=plan(box(0.1,{agents,engine:{bytes:4*GB,restarting:true}}),{},T);r=plan(box(0.1,{agents,engine:{bytes:4*GB,restarting:true}}),r.st,T+PASS_GAP);
 assert.deepEqual(r.actions,[]);assert.ok(LOW<OK)});

test('the runner asks the root script, closes tabs itself, tells the owner once and keeps app history',async()=>{
 const d=mkdtempSync(path.join(tmpdir(),'aq-mw-')),home=path.join(d,'home'),data=path.join(d,'data'),cg=path.join(d,'cg')+'/',wake=path.join(d,'wake');
 for(const x of [home,data,cg,wake,path.join(home,'workspaces','idle','.screen'),path.join(home,'workspaces','ads','.screen')])mkdirSync(x,{recursive:true});
 writeFileSync(cg+'memory.current',String(27*GB));writeFileSync(cg+'memory.max',String(28*GB));writeFileSync(cg+'memory.stat','inactive_file '+(1*GB)+'\n');
 writeFileSync(path.join(home,'.aqeelos-agent-users'),'idle\nads\nwork\n');writeFileSync(path.join(home,'.aqeelos-agent-limits'),'idle 4096 30\nads 8192 0\nwork 4096 30\n');
 let now=T;const told=[],tabs=[],restarts=[];
 const sessions=async a=>a==='work'?{active:true,lastActive:now}:{active:false,lastActive:now-3600e3};
 const ps='ag-idle 2000000 /opt/aqeelos/chrome/chrome\nag-ads 6000000 /x/adspower_global /x/rpa.min.js\nag-ads 300000 /opt/aqeelos/chrome/chrome\nclaude 3600000 /p/python3 -I -c import os, re, sys x -p default gateway\n';
 const w=createMemWatch({DATA:data,HOME:home,CG:cg,WAKE:wake,sessions,keepOn:a=>a==='ads',closeTabs:async a=>{tabs.push(a);return 3},restartEngine:async why=>restarts.push(why),
  tell:async t=>told.push(t),now:()=>now,readPs:async()=>ps,log:()=>{}});
 await w.tick();
 assert.equal(readFileSync(path.join(home,'.aqeelos-agent-users.mem'),'utf8'),'idle sleep\n');assert.deepEqual(tabs,['ads']);assert.equal(told.length,1);
 now+=PASS_GAP;await w.tick();
 assert.equal(readFileSync(path.join(home,'.aqeelos-agent-users.mem'),'utf8'),'idle sleep\nads adspower\n');
 now+=PASS_GAP;await w.tick();assert.equal(restarts.length,1);assert.equal(told.length,1);
 const v=await w.view();assert.equal(v.level,'low');assert.equal(v.apps[0].name,'AdsPower · ads');assert.ok(existsSync(path.join(data,'memwatch.json')));
 // enough free again: the spell ends and nothing more is asked
 writeFileSync(cg+'memory.current',String(10*GB));now+=PASS_GAP;const r=await w.tick();assert.deepEqual(r.actions,[]);assert.equal((await w.view()).level,'ok')});
