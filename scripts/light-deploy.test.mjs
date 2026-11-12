// The light deploy (12 Nov 2026): browser checks out of the default deploy, into the night's maintenance run (app/browser-checks.mjs,
// maintenance.mjs browserChecksDue) or FULL_CHECK=1; the live test's agent check does not start a model while the provider is on hold.
// Run: node --test scripts/light-deploy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {windowOpened,browserChecksDue,DEFAULT_WINDOW} from '../app/maintenance.mjs';
import {createBrowserChecks,failuresIn,TOPIC} from '../app/browser-checks.mjs';
import {readHold,createLimitState} from '../app/provider-limits.mjs';
import {holdSkip,summary} from './live-test.mjs';

const at=iso=>new Date(iso);
// the default window is 00:00 to 01:00 Jakarta = 17:00 to 18:00 UTC

test('the window that contains a moment opened at its start, whatever zone the server is in',()=>{
 assert.equal(windowOpened(at('2026-11-11T17:42:31Z')).toISOString(),'2026-11-11T17:00:00.000Z');
 const w={from:'23:30',to:'00:30',tz:'UTC'};assert.equal(windowOpened(at('2026-11-12T00:10:00Z'),w).toISOString(),'2026-11-11T23:30:00.000Z','a window may pass midnight')});

test('the night browser checks start AFTER the window (00:00-01:00 Jakarta = 17:00-18:00 UTC), once a night, never twice for a version that passed',()=>{
 const base={w:DEFAULT_WINDOW,sha:'abc'};const d=(iso,o={})=>browserChecksDue({...base,now:at(iso),...o});
 const last=(iso,ok,sha='abc')=>({at:at(iso).getTime(),ok,sha});
 assert.equal(d('2026-11-11T12:00:00Z').due,false,'19:00 Jakarta: too long after the window');
 assert.match(d('2026-11-11T17:30:00Z').why,/window is open/,'inside the window the update goes first; the checks never start there (an update restart cut them off)');
 assert.match(d('2026-11-11T17:59:00Z').why,/window is open/);
 assert.match(d('2026-11-11T18:02:00Z').why,/just finished/,'01:02: the update has just finished');
 assert.equal(d('2026-11-11T18:05:00Z').due,true,'01:05: due');
 assert.equal(d('2026-11-12T01:00:00Z').due,true,'08:00 Jakarta: still inside the catch-up time (box was busy or restarting)');
 assert.match(d('2026-11-12T02:30:00Z').why,/too long after/,'09:30 Jakarta: waits for tonight');
 assert.match(d('2026-11-11T18:30:00Z',{updating:true}).why,/update is running/);assert.match(d('2026-11-11T18:30:00Z',{running:true}).why,/already running/);
 assert.match(d('2026-11-11T19:00:00Z',{last:last('2026-11-11T18:31:00Z',false)}).why,/already ran after this window/,'once a night, a failed run too');
 assert.equal(d('2026-11-11T18:30:00Z',{last:last('2026-11-10T18:31:00Z',false)}).due,true,'a failed run is tried again the next night');
 assert.equal(d('2026-11-11T18:30:00Z',{last:last('2026-11-11T16:00:00Z',false)}).due,true,'a run from before the window does not count for this night');
 assert.match(d('2026-11-11T18:30:00Z',{last:last('2026-11-10T18:31:00Z',true)}).why,/already passed/);
 assert.equal(d('2026-11-11T18:30:00Z',{last:last('2026-11-10T18:31:00Z',true,'old')}).due,true,'a new version is checked');
 assert.equal(d('2026-11-11T18:30:00Z',{last:last('2026-11-01T18:31:00Z',true)}).due,true,'and the same one again after a week');
 // the afternoon the feature shipped (12 Nov 17:12 Jakarta): nothing runs until the first window has passed
 assert.equal(d('2026-11-12T10:12:00Z').due,false);assert.equal(d('2026-11-12T18:10:00Z').due,true,'first night: 01:10 Jakarta on 13 Nov');
 // an install own window, passing midnight, in another zone
 const own={from:'23:30',to:'00:30',tz:'UTC'};assert.equal(browserChecksDue({now:at('2026-11-12T00:10:00Z'),w:own}).due,false,'inside');assert.equal(browserChecksDue({now:at('2026-11-12T00:40:00Z'),w:own}).due,true);
 assert.equal(browserChecksDue({now:at('2026-11-12T00:40:00Z'),w:own,last:{at:at('2026-11-11T23:20:00Z').getTime(),ok:false,sha:'x'}}).due,true,'a run from before this window opened');
 assert.equal(browserChecksDue({now:at('2026-11-12T00:40:00Z'),w:own,last:{at:at('2026-11-12T00:36:00Z').getTime(),ok:false,sha:'x'}}).due,false,'one from after it closed')});

async function boxFixture({sha='abc',auto=null,settings={}}={}){const root=await mkdtemp(path.join(tmpdir(),'bc-')),APP=path.join(root,'app'),DATA=path.join(root,'data');
 await mkdir(path.join(APP,'scripts'),{recursive:true});await mkdir(DATA,{recursive:true});await writeFile(path.join(APP,'scripts','box-check.sh'),'#!/bin/bash\n');await writeFile(path.join(APP,'.deployed.tgz'),'x');
 if(auto)await writeFile(path.join(DATA,'auto-update.json'),JSON.stringify(auto));
 const events=[],resolved=[],calls=[];let t=at('2026-11-11T18:30:00Z').getTime();
 const mk=(out,code=0,timedOut=false)=>createBrowserChecks({DATA,APP,HOME:root,settings:()=>settings,now:()=>t,log:()=>{},live:async()=>({box:true,sha}),
  bottlenecks:{event:async(...a)=>{events.push(a)},resolve:async x=>{resolved.push(x)}},exec:async(f,a,o)=>{calls.push({f,a,o});t+=60e3;return {code,out,timedOut}}});
 return {mk,events,resolved,calls,DATA,APP,tick:m=>{t+=m*60e3}}}

test('a night run that passes records itself and takes the Health item away',async()=>{
 const fx=await boxFixture();const bc=fx.mk('· 1/5 pages\n✓ browser checks passed\n');const r=await bc.tick();assert.equal(r.due,true);
 assert.equal(fx.calls.length,1);assert.deepEqual(fx.calls[0].a,[path.join(fx.APP,'scripts','box-check.sh')]);
 assert.equal(fx.calls[0].o.env.BROWSER_ONLY,'1');assert.match(fx.calls[0].o.env.TGZ,/hui-nightly-/);assert.equal(fx.calls[0].o.env.FULL_CHECK,undefined);
 const last=await bc.last();assert.equal(last.ok,true);assert.equal(last.sha,'abc');assert.deepEqual(fx.resolved,[TOPIC]);assert.equal(fx.events.length,0);
 assert.equal((await bc.tick()).due,false,'not again in the same window')});

test('a failed night run is one Health item and changes nothing else',async()=>{
 const fx=await boxFixture();const out='· 1/5 pages\n✗ a page did not load: {"errors":["/system/health"]}\n';const bc=fx.mk(out,1);await bc.tick();
 const last=await bc.last();assert.equal(last.ok,false);assert.deepEqual(last.failed,['a page did not load: {"errors":["/system/health"]}']);
 assert.equal(fx.events.length,1);assert.equal(fx.events[0][0],'update');assert.match(fx.events[0][1],/page checks found a problem/);assert.match(fx.events[0][2],/a page did not load/);assert.equal(fx.events[0][3].topic,TOPIC);assert.deepEqual(fx.resolved,[]);
 const d=JSON.parse(await readFile(path.join(fx.DATA,'browser-checks.json'),'utf8'));assert.equal(d.history.length,1);
 assert.deepEqual(failuresIn('a\n✗ one\n✗ two\n✓ ok'),['one','two'])});

test('a run stopped at its limit counts as a failure with a plain reason; nothing runs when an update is running, the box has no deployed copy, or it is switched off',async()=>{
 const fx=await boxFixture();const bc=fx.mk('',1,true);await bc.tick();assert.match((await bc.last()).failed[0],/did not finish within 80 minutes/);
 assert.equal((await (await boxFixture({auto:{running:{at:at('2026-11-11T18:10:00Z').getTime()}}})).mk('').due()).why,'an update is running');
 assert.equal((await (await boxFixture({settings:{nightlyBrowserChecks:false}})).mk('').due()).why,'switched off');
 const f2=await boxFixture();const off=createBrowserChecks({DATA:f2.DATA,APP:f2.APP,now:()=>at('2026-11-11T18:30:00Z').getTime(),live:async()=>({box:false,sha:''}),exec:async()=>{throw Error('must not run')}});
 assert.match((await off.tick()).why,/not a box/)});

test('box-check.sh: the browser checks are not part of the default deploy; FULL_CHECK=1 and BROWSER_ONLY=1 run them; the engine update check stays',()=>{
 const s=readFileSync(new URL('./box-check.sh',import.meta.url),'utf8');
 assert.match(s,/FULL=\$\{FULL_CHECK:-0\}; BO=\$\{BROWSER_ONLY:-0\}; HEAVY=0/);
 const heavy=s.indexOf('if [ "$HEAVY" = 1 ]; then\necho "· 1/5 pages"'),end=s.indexOf('fi   # HEAVY');
 assert.ok(heavy>0&&end>heavy);const inside=s.slice(heavy,end);
 for(const x of ['pages-check.mjs','sweep.js','controls-check.mjs','mybrowser-check.mjs'])assert.ok(inside.includes(x),x+' only runs in the heavy part');
 for(const x of ['pages-check.mjs','sweep.js','controls-check.mjs','mybrowser-check.mjs'])assert.equal(s.slice(0,heavy).includes(x)||s.slice(end).includes(x),false,x+' nowhere else');
 // the test copy is only started when heavy; the light part parses files and checks globals
 assert.ok(s.indexOf('if [ "$HEAVY" != 1 ]; then')>0&&s.indexOf('check-globals.mjs')<s.indexOf('else\n',s.indexOf('if [ "$HEAVY" != 1 ]; then')));
 assert.ok(s.indexOf('UI_PORT=4402')>s.indexOf('else\n',s.indexOf('if [ "$HEAVY" != 1 ]; then')),'the test copy (port 4402) starts only in the heavy branch');
 assert.match(s,/\[ "\$BO" = 1 \] \|\| \{ nice -n 10 bash scripts\/engine-sim\.sh/,'the engine update check runs at every deploy, not in the night run');
 // the auto-undo after a failed live test is box-live.sh and was not touched
 const live=readFileSync(new URL('./box-live.sh',import.meta.url),'utf8');assert.match(live,/aq_undo "the live test failed"/);
 const deploy=readFileSync(new URL('./box-deploy.sh',import.meta.url),'utf8');assert.match(deploy,/FULL_CHECK=\$\{FULL_CHECK:-0\} MB=\$MB TGZ=\$TGZ bash "\$W\/scripts\/box-check\.sh"/);assert.match(deploy,/timing: go live took/)});

test('the live test\'s agent check does not ask a model while the provider is on hold; an old or missing hold changes nothing',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'hold-')),now=Date.now();assert.equal(readHold(DATA,now),null,'no file');
 const st=createLimitState({DATA,now:()=>now});st.set(now+30*60e3,'You\'ve hit your session limit','limit');await new Promise(r=>setTimeout(r,60));
 const h=readHold(DATA,now);assert.ok(h&&h.until>now);const s=holdSkip(h,now);
 assert.equal(s.skipped,true);assert.equal(s.inconclusive,true);assert.equal(s.resetAt,h.until);assert.match(s.why,/on hold.*session limit.*test agent was not asked/);
 assert.equal(readHold(DATA,now+31*60e3),null,'over');assert.equal(holdSkip(null),null);assert.equal(holdSkip({until:now-1},now),null);
 assert.deepEqual(summary([{name:'agent',...s}]),{ok:true,failed:[]},'a skipped, inconclusive check never undoes a deploy')});
