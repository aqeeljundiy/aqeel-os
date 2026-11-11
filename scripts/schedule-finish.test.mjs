// Tests for "a schedule finished" events and chained schedules (app/schedule-finish.mjs, app/event-runs.mjs). Run: node --test scripts/schedule-finish.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createScheduleFinish,jobsFile} from '../app/schedule-finish.mjs';
import {createEventRuns,matching,watchedJobs} from '../app/event-runs.mjs';

const S1='0076621ae618',S2='d37f72f40913',S3='84282191bd14';
const RULES={default:[{event:'schedule.finished',after:S1,ok:true,job:S2},{event:'schedule.finished',after:S2,ok:true,job:S3,minGapSec:0}]};
const fin=(job,status='ok')=>({type:'schedule.finished',data:{job,status}});

test('a rule with "after" matches only that schedule finish, and "ok" only a good end',()=>{
 assert.deepEqual(matching(RULES,'default',fin(S1)).map(r=>r.job),[S2]);
 assert.deepEqual(matching(RULES,'default',fin(S2)).map(r=>r.job),[S3]);
 assert.deepEqual(matching(RULES,'default',fin(S1,'failed')),[]);assert.deepEqual(matching(RULES,'default',fin('other')),[]);
 assert.deepEqual(matching(RULES,'default',{type:'comment.created'}),[]);
 assert.deepEqual(watchedJobs(RULES),{default:[S1,S2]});assert.deepEqual(watchedJobs({a:[{event:'x',job:'j'}]}),{})});

async function rig(){const H=await mkdtemp(path.join(tmpdir(),'sf-'));await mkdir(path.join(H,'cron'),{recursive:true});await mkdir(path.join(H,'profiles','ct','cron'),{recursive:true});
 let n=0;const write=async(agent,jobs)=>{const f=jobsFile(H,agent);await writeFile(f,JSON.stringify({jobs}));n++;const d=new Date(Date.now()+n*5000);await utimes(f,d,d)};
 const events=[];const W={default:[S1,S2],ct:['aaa']};
 const F=createScheduleFinish({HERMES_HOME:H,watched:async()=>W,onEvent:(a,e)=>events.push([a,e.data.job,e.data.status]),log:()=>{}});return {H,write,events,F}}

test('the first look is a baseline; a new last_run_at is one event with the ending; nothing else fires',async()=>{const {write,events,F}=await rig();
 await write('default',[{id:S1,last_run_at:'2026-11-01T03:10:00+07:00',last_status:'ok'},{id:S2,last_run_at:null},{id:'zzz',last_run_at:'x'}]);
 assert.deepEqual(await F.tick(),[]);assert.deepEqual(events,[]);
 assert.deepEqual(await F.tick(),[],'unchanged file');
 await write('default',[{id:S1,last_run_at:'2026-11-02T03:10:00+07:00',last_status:'ok'},{id:S2,last_run_at:null},{id:'zzz',last_run_at:'y'}]);
 await F.tick();await new Promise(r=>setTimeout(r,10));assert.deepEqual(events,[['default',S1,'ok']]);
 await write('default',[{id:S1,last_run_at:'2026-11-02T03:10:00+07:00',last_status:'ok'},{id:S2,last_run_at:'2026-11-02T05:03:00+07:00',last_status:'error'},{id:'zzz',last_run_at:'z'}]);
 await F.tick();await new Promise(r=>setTimeout(r,10));assert.deepEqual(events.at(-1),['default',S2,'failed']);assert.equal(events.length,2,'an unwatched schedule fires nothing')});

test('the chain: stage 1 finishing starts stage 2 through the event rules, once; a failed end starts nothing',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'sf2-'));await writeFile(path.join(D,'event-runs.json'),JSON.stringify({rules:RULES}));const started=[];
 const R=createEventRuns({DATA:D,trigger:async(a,id)=>{started.push([a,id])},log:()=>{}});
 assert.deepEqual(await R.fire('default',fin(S1)),[S2]);assert.deepEqual(started,[['default',S2]]);
 assert.deepEqual(await R.fire('default',fin(S1,'failed')),[]);assert.equal(started.length,1);
 assert.deepEqual(await R.watched(),{default:[S1,S2]});
 await R.setRules('default',[{event:'schedule.finished',after:S1,ok:true,job:S2}]);assert.deepEqual((await R.view()).rules.default,[{event:['schedule.finished'],job:S2,after:S1,ok:true}])});
