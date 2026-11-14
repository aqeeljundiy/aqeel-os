// Tests for app/restart-later.mjs and that agents and aqeelOS's own changes never restart the engine at once.
// Run: node --test scripts/restart-later.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createRestartLater,inQuiet,hourIn} from '../app/restart-later.mjs';
import {src} from './lib/source.mjs';
test('quiet hours are 01:00-05:00 in the install time zone',()=>{
 const at=(iso)=>new Date(iso);
 assert.equal(hourIn(at('2026-11-07T19:23:00Z'),'Asia/Jakarta'),2);       // 02:23 WIB
 assert.equal(inQuiet(at('2026-11-07T19:23:00Z'),'Asia/Jakarta'),true);
 assert.equal(inQuiet(at('2026-11-07T12:00:00Z'),'Asia/Jakarta'),false);  // 19:00 WIB
 assert.equal(inQuiet(at('2026-11-07T22:00:00Z'),'Asia/Jakarta'),false);  // 05:00 WIB, the window has ended
 assert.equal(inQuiet(at('2026-11-07T18:00:00Z'),'Asia/Jakarta'),true)}); // 01:00 WIB
test('waiting restarts are collected and done once in the quiet hours; an immediate restart covers them',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'rl-'));let t=new Date('2026-11-07T12:00:00Z');const done=[];
 const l=createRestartLater({DATA,restart:async w=>done.push(w),tz:()=>'Asia/Jakarta',now:()=>t,log:()=>{}});
 await l.add('agent defaults');await l.add('Higgsfield shared (asked by Donna AI)');await l.add('agent defaults');
 assert.deepEqual((await l.pending()).whys,['agent defaults','Higgsfield shared (asked by Donna AI)']);
 assert.equal(await l.tick(),false);assert.equal(done.length,0,'nothing outside the quiet hours');
 t=new Date('2026-11-07T19:00:00Z');assert.equal(await l.tick(),true);assert.equal(done.length,1);assert.match(done[0],/quiet-hours restart: agent defaults; Higgsfield/);
 assert.equal(await l.tick(),false,'once');
 await l.add('x');await l.covered();assert.deepEqual((await l.pending()).whys,[]);
 assert.ok(JSON.parse(await readFile(path.join(DATA,'restart-later.json'),'utf8')))});
test('server: agents, defaults, plugin, tool lists, n8n and app sharing wait; nothing restarts at once for them',async()=>{
 const s=src('app/server.mjs');
 for(const w of ["restartGateway('agent defaults')","restartGateway('new agent defaults')","restartGateway('aqeelos-live plugin for '","restartGateway('new or changed aqeelOS tools for '","restartGateway(why+' (asked by '","restartGateway(base+' changed its own '","restartGateway('connected app '+name+' shared')"])
  assert.ok(!s.includes(w),'still restarts at once: '+w);
 assert.ok(s.includes("restartLater(why+' (asked by '"));assert.ok(s.includes('later.covered()'));
 assert.ok(s.includes("for(const a of to)await optins.setApp(a,name,true)"),'sharing switches the app on for those agents');
 assert.ok(s.includes('keepNewApp(a,n)'),'a new sign-in app stays only where wanted')});

// 14 Nov 2026: a one-time test-cleanup schedule was lost to the window restart (the engine drops a one-time job more than two
// minutes late, and the restart holds new runs for up to ten): the window restart waits while one is due within 15 minutes
test('a one-time schedule due within 15 minutes holds the window restart; recurring ones, paused or far-off ones do not',async()=>{
 const {oneShotDueSoon,isOneShot}=await import('../app/restart-later.mjs');const at=Date.parse('2026-11-14T17:05:00Z'),iso=m=>new Date(at+m*60e3).toISOString();
 assert.ok(isOneShot({schedule:{kind:'once'}})&&isOneShot({schedule:{expr:'2026-11-14T17:10'}})&&isOneShot({schedule:'once at 2026-11-14 17:10'})&&isOneShot({repeat:{times:1}}));
 assert.ok(!isOneShot({schedule:{kind:'cron',expr:'0 8 * * *'}}));
 assert.equal(oneShotDueSoon([{id:'a',schedule:{kind:'once'},next_run_at:iso(10)}],at)?.id,'a');
 assert.equal(oneShotDueSoon([{id:'b',schedule:{kind:'cron',expr:'*/5 * * * *'},next_run_at:iso(3)},{id:'c',schedule:{kind:'once'},next_run_at:iso(40)},{id:'d',schedule:{kind:'once'},state:'paused',next_run_at:iso(2)}],at),null);
 const dir=await (await import('node:fs/promises')).mkdtemp(path.join((await import('node:os')).tmpdir(),'rl-'));const restarts=[];let due={id:'x',name:'Clean test data',next_run_at:iso(5)};
 const L=createRestartLater({DATA:dir,restart:async w=>restarts.push(w),dueSoon:async()=>due,inWindow:()=>true,log:()=>{}});
 await L.add('settings');assert.equal(await L.tick(),false);assert.equal(restarts.length,0,'held while the one-time job is due');
 due=null;assert.equal(await L.tick(),true);assert.equal(restarts.length,1,'restarted once it ran')});
