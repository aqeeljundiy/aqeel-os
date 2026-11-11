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
