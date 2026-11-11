// Tests for app/event-runs.mjs and the Tebar hook into it. Run: node --test scripts/event-runs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {matching,createEventRuns} from '../app/event-runs.mjs';
import {createTebar} from '../app/tebar.mjs';

const rules={'ct':[{event:['comment.created'],job:'j1',platforms:['threads'],minGapSec:60},{event:'message.received',job:'j2'}]};
const ev=(type,platform)=>({type,data:{platform}});

test('an event matches by name and platform',()=>{
 assert.deepEqual(matching(rules,'ct',ev('comment.created','Threads')).map(r=>r.job),['j1']);
 assert.deepEqual(matching(rules,'ct',ev('comment.created','instagram')),[],'another platform');
 assert.deepEqual(matching(rules,'ct',ev('message.received')).map(r=>r.job),['j2'],'no platform filter');
 assert.deepEqual(matching(rules,'other',ev('comment.created','threads')),[],'another agent');
 assert.deepEqual(matching({ct:[{event:'x',job:'../bad'}]},'ct',ev('x')),[],'a job id that is not an id')});

async function setup(r=rules){const DATA=await mkdtemp(path.join(tmpdir(),'aq-evr-'));await writeFile(path.join(DATA,'event-runs.json'),JSON.stringify({rules:r}));
 const calls=[],timers=[];let t=1e6;const E=createEventRuns({DATA,trigger:async(a,id)=>calls.push(a+'/'+id),now:()=>t,log:()=>{},setTimer:(fn,ms)=>timers.push({fn,ms})});
 return {E,calls,timers,tick:ms=>{t+=ms}}}

test('an event starts the job at once; events inside the gap become one later run',async()=>{const {E,calls,timers,tick}=await setup();
 assert.deepEqual(await E.fire('ct',ev('comment.created','threads')),['j1']);assert.deepEqual(calls,['ct/j1']);
 await E.fire('ct',ev('comment.created','threads'));await E.fire('ct',ev('comment.created','threads'));
 assert.equal(calls.length,1,'not again inside the gap');assert.equal(timers.length,1,'one trailing start');assert.equal(timers[0].ms,60000);
 tick(60000);await timers[0].fn();assert.equal(calls.length,2);
 assert.equal((await E.view()).runs['ct/j1'].n,2)});

test('an event nobody listens for starts nothing; a failing trigger does not throw',async()=>{const s=await setup();
 assert.deepEqual(await s.E.fire('ct',ev('post.failed')),[]);assert.equal(s.calls.length,0);
 const DATA=await mkdtemp(path.join(tmpdir(),'aq-evr-'));await writeFile(path.join(DATA,'event-runs.json'),JSON.stringify({rules}));
 const E=createEventRuns({DATA,trigger:async()=>{throw Error('engine down')},log:()=>{}});await E.fire('ct',ev('message.received'))});

test('setRules keeps good rules only',async()=>{const {E}=await setup({});
 const l=await E.setRules('ct',[{event:'comment.created',job:'abc123',minGapSec:30},{event:[],job:'x'},{event:'a',job:'bad id'}]);
 assert.deepEqual(l,[{event:['comment.created'],job:'abc123',minGapSec:30}]);await assert.rejects(()=>E.setRules('../x',[]))});

test('Tebar: a comment event reaches onEvent and a failure there does not break the notice',async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'aq-evr-'));const got=[],notes=[];
 const tb=createTebar({DATA,log:()=>{},notice:async(a,title)=>notes.push(title),onEvent:async(a,e)=>{got.push(a+':'+e.type);throw Error('x')}});
 await tb.handle('ct',{type:'comment.created',data:{platform:'threads',text:'hi'}});
 assert.deepEqual(got,['ct:comment.created']);assert.equal(notes.length,1)});
