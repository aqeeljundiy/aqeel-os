// The maintenance window (app/maintenance.mjs): when updates and waiting restarts may happen, per install.
// Run: node --test scripts/maintenance.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WINDOW,windowOf,inWindow,cleanWindow,windowText,resumeMaxMs} from '../app/maintenance.mjs';
import {createRestartLater} from '../app/restart-later.mjs';
import {busyTotal,holdTotal} from '../app/busy.mjs';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const at=iso=>new Date(iso);
test('the default window is 00:00 to 01:00 Jakarta time, whatever zone the server is in',()=>{
 assert.deepEqual(windowOf({}),DEFAULT_WINDOW);assert.deepEqual(windowOf({timezone:'Europe/Amsterdam'}),{from:'00:00',to:'01:00',tz:'Asia/Jakarta'});
 assert.equal(inWindow(at('2026-11-11T17:00:00Z')),true);    // 00:00 in Jakarta
 assert.equal(inWindow(at('2026-11-11T17:59:59Z')),true);    // 00:59
 assert.equal(inWindow(at('2026-11-11T18:00:00Z')),false);   // 01:00: the end is not part of it
 assert.equal(inWindow(at('2026-11-11T16:59:00Z')),false);   // 23:59
 assert.equal(inWindow(at('2026-11-11T05:30:00Z')),false)});  // midday
test('an install sets its own window and zone',()=>{const w=windowOf({maintenance:{from:'03:30',to:'04:15',tz:'Europe/Amsterdam'}});
 assert.deepEqual(w,{from:'03:30',to:'04:15',tz:'Europe/Amsterdam'});
 assert.equal(inWindow(at('2026-11-12T02:30:00Z'),w),true);assert.equal(inWindow(at('2026-11-12T03:14:00Z'),w),true);assert.equal(inWindow(at('2026-11-12T03:15:00Z'),w),false);
 assert.equal(inWindow(at('2026-11-11T17:30:00Z'),w),false);   // Jakarta's midnight is not this install's window
 // only part of it set: the rest stays the default
 assert.deepEqual(windowOf({maintenance:{tz:'UTC'}}),{from:'00:00',to:'01:00',tz:'UTC'});
 assert.equal(windowText(w),'03:30 to 04:15 (Amsterdam time)')});
test('a window may pass midnight',()=>{const w=cleanWindow({from:'23:30',to:'0:30',tz:'UTC'});assert.equal(w.to,'00:30');
 assert.equal(inWindow(at('2026-11-11T23:45:00Z'),w),true);assert.equal(inWindow(at('2026-11-12T00:29:00Z'),w),true);assert.equal(inWindow(at('2026-11-12T00:30:00Z'),w),false);assert.equal(inWindow(at('2026-11-11T23:29:00Z'),w),false)});
test('a broken setting never stops updates: the default is used; a person’s entry is refused with a reason',()=>{
 for(const m of [{from:'25:00'},{tz:'Not/AZone'},{from:'01:00',to:'01:00'},{from:'01:00',to:'01:10'},'x'])assert.deepEqual(windowOf({maintenance:m}),DEFAULT_WINDOW);
 assert.throws(()=>cleanWindow({from:'1',to:'02:00',tz:'UTC'}),/hours and minutes/);assert.throws(()=>cleanWindow({from:'01:00',to:'01:10',tz:'UTC'}),/30 minutes/);assert.throws(()=>cleanWindow({from:'01:00',to:'02:00',tz:'Mars/Base'}),/time zone/)});
test('how long interrupted work is continued: 2 hours unless the install says otherwise',()=>{
 assert.equal(resumeMaxMs({}),7200e3);assert.equal(resumeMaxMs({resumeMaxHours:6}),6*3600e3);assert.equal(resumeMaxMs({resumeMaxHours:0}),7200e3);assert.equal(resumeMaxMs({resumeMaxHours:'x'}),7200e3)});
test('restarts that can wait happen in the window, and do not wait for an idle box',async()=>{const DATA=mkdtempSync(path.join(tmpdir(),'aq-mw-'));let now=at('2026-11-11T10:00:00Z');const done=[];
 const l=createRestartLater({DATA,restart:async why=>{done.push(why)},now:()=>now,log:()=>{},inWindow:d=>inWindow(d,windowOf({}))});
 await l.add('agent defaults');assert.equal(await l.tick(),false);
 now=at('2026-11-11T18:30:00Z');assert.equal(await l.tick(),false);   // 01:30 in Jakarta: the old quiet hours, not the window
 now=at('2026-11-11T17:05:00Z');assert.equal(await l.tick(),true);assert.equal(done.length,1);assert.equal(await l.tick(),false)});
test('a deploy waits only for what cannot be continued afterwards',()=>{
 assert.equal(holdTotal({live:4}),0);assert.equal(busyTotal({live:4}),4);
 assert.equal(holdTotal({live:4,setups:1,restore:true,gwRestarting:true,engineUpdate:true,ops:1,relay:1}),6)});

/* ---------- a restart in the window: gentle for a bounded time, then --interrupt (12 Nov 2026) ---------- */
import {restartGraceMs,windowRestartStep,restartWaitPolls,RESTART_POLL_MS} from '../app/maintenance.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
test('the gentle time of a window restart: 10 minutes unless the install says otherwise, 0 means none, never more than an hour',()=>{
 assert.equal(restartGraceMs({}),600e3);assert.equal(restartGraceMs({restartGraceMinutes:3}),180e3);assert.equal(restartGraceMs({restartGraceMinutes:0}),0);
 assert.equal(restartGraceMs({restartGraceMinutes:90}),600e3);assert.equal(restartGraceMs({restartGraceMinutes:'x'}),600e3);assert.equal(restartGraceMs({restartGraceMinutes:-1}),600e3);
 assert.equal(restartWaitPolls(600e3),120);assert.equal(restartWaitPolls(0),0);assert.equal(restartWaitPolls(7000),2);assert.equal(RESTART_POLL_MS,5000)});
test('idle: restart at once; busy: wait until the gentle time is over, then restart with --interrupt',()=>{const grace=600e3;
 assert.deepEqual(windowRestartStep({busy:false,waited:0,grace}),{go:true,interrupt:false});
 assert.deepEqual(windowRestartStep({busy:true,waited:60e3,grace}),{go:false});
 assert.deepEqual(windowRestartStep({busy:true,waited:grace,grace}),{go:true,interrupt:true});
 assert.deepEqual(windowRestartStep({busy:true,waited:0,grace:0}),{go:true,interrupt:true},'0 minutes: no waiting')});
test('server: the window restart waits gently (agents, background tasks) for the install’s time and then stops the engine with --yes (= --interrupt)',()=>{
 const s=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8'),g=readFileSync(new URL('../app/gateway-stop.mjs',import.meta.url),'utf8');
 assert.ok(s.includes("restart:why=>restartGateway(why,{wait:true,waitMax:restartWaitPolls(restartGraceMs(installSettings()))})"),'the window restart is the gentle one with the install’s bound');
 assert.ok(s.includes("resume.openOf('deleg')>0"),'a running background task is waited for');
 assert.ok(g.includes("'hermes -p default gateway stop'+(yes?' --yes':'')"),'the stop that follows interrupts');
 assert.ok(!/restart:why=>restartGateway\(why,\{wait:false\}\)/.test(s),'no more immediate restart in the window')});
test('the nightly entry of services.sh asks the app through the request file, with no loop of its own around the old script',()=>{
 const sh=readFileSync(new URL('./services.sh',import.meta.url),'utf8');
 assert.ok(sh.includes('restart-request.json')&&sh.includes('nightly engine restart'));assert.ok(!/\$HOME\/nightly-engine-restart\.sh;/.test(sh),'the old script is not run')});
test('a request file left by a script is queued like any other reason, once, and done in the window',async()=>{const DATA=mkdtempSync(path.join(tmpdir(),'aq-rq-'));let now=at('2026-11-11T10:00:00Z');const done=[];
 const l=createRestartLater({DATA,restart:async why=>{done.push(why)},now:()=>now,log:()=>{},inWindow:d=>inWindow(d,windowOf({}))});
 writeFileSync(path.join(DATA,'restart-request.json'),'{"why":"nightly engine restart"}');
 assert.equal(await l.tick(),false);assert.deepEqual((await l.pending()).whys,['nightly engine restart']);assert.throws(()=>readFileSync(path.join(DATA,'restart-request.json')),'the file is taken');
 now=at('2026-11-11T17:05:00Z');assert.equal(await l.tick(),true);assert.match(done[0],/quiet-hours restart: nightly engine restart/);assert.equal(await l.tick(),false);
 writeFileSync(path.join(DATA,'restart-request.json'),'not json');assert.equal(await l.take(),true);assert.deepEqual((await l.pending()).whys,['not json'])});
