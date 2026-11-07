// Tests for the engine update decisions (app/engine-update-rules.mjs). Run: node --test scripts/engine-updates.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {quietWindow,minutesIn,mayStart,nightOf,frequent,blockingJobs,stableTags,pickTarget,conditions,countLog,logProblems,routeProblems,verdict,rollbackPlan,ownerText,isDaytime} from '../app/engine-update-rules.mjs';

const TZ='Asia/Jakarta';   // UTC+7, no summer time
const at=(s)=>Date.parse(s+'+07:00');   // a Jakarta wall-clock time
const hourIdx=s=>Math.floor(at(s)/3600e3);
const SHA=c=>c.repeat(40);

test('window: the quietest two hours, counted in the box time zone',()=>{
 const b=[];for(let d=1;d<=7;d++)for(let h=0;h<24;h++){const n=h>=1&&h<3?3:h===3?20:100;b.push([hourIdx(`2026-10-${String(10+d).padStart(2,'0')}T${String(h).padStart(2,'0')}:00:00`),n])}
 const w=quietWindow(b,TZ);assert.equal(w.start,1);assert.equal(w.end,3);assert.equal(w.label,'01:00-03:00')});
test('window: may cross midnight',()=>{const b=[];for(let h=0;h<24;h++)b.push([hourIdx(`2026-10-20T${String(h).padStart(2,'0')}:00:00`),h===23||h===0?1:50]);
 const w=quietWindow(b,TZ);assert.equal(w.label,'23:00-01:00');
 assert.equal(minutesIn(at('2026-10-21T00:30:00'),w,TZ),90);assert.equal(nightOf(at('2026-10-21T00:30:00'),w,TZ),'2026-10-20')});
test('window: no history gives 01:00-03:00',()=>{assert.equal(quietWindow([],TZ).label,'01:00-03:00')});
test('window: starts only in the first 90 minutes',()=>{const w=quietWindow([],TZ);
 assert.ok(mayStart(at('2026-10-26T01:00:00'),w,TZ));assert.ok(mayStart(at('2026-10-26T02:29:00'),w,TZ));
 assert.ok(!mayStart(at('2026-10-26T02:31:00'),w,TZ));assert.ok(!mayStart(at('2026-10-26T00:59:00'),w,TZ));assert.ok(!mayStart(at('2026-10-26T03:00:00'),w,TZ))});
test('morning message time',()=>{assert.ok(!isDaytime(at('2026-10-26T02:00:00'),TZ));assert.ok(isDaytime(at('2026-10-26T07:05:00'),TZ));assert.ok(!isDaytime(at('2026-10-26T22:00:00'),TZ))});

test('schedules: more often than every hour may be skipped',()=>{
 assert.ok(frequent({schedule:{kind:'cron',expr:'*/2 * * * *'}}));assert.ok(frequent({schedule:{kind:'cron',expr:'*/30 9-19 * * 1-5'}}));
 assert.ok(frequent({schedule:{kind:'interval',minutes:15}}));assert.ok(frequent({schedule:{kind:'cron',expr:'0,30 * * * *'}}));
 assert.ok(!frequent({schedule:{kind:'cron',expr:'0 3 * * 1'}}));assert.ok(!frequent({schedule:{kind:'cron',expr:'50 6-23 * * *'}}));
 assert.ok(!frequent({schedule:{kind:'interval',minutes:60}}));assert.ok(!frequent({schedule:{kind:'once',run_at:'x'}}))});
test('schedules: due within 45 min or running blocks, frequent and paused ones do not',()=>{const now=at('2026-10-26T02:20:00');
 const jobs=[{name:'Dora Monday report',schedule:{kind:'cron',expr:'0 3 * * 1'},next_run_at:'2026-10-26T03:00:00+07:00',state:'scheduled'},
  {name:'Faris away',schedule:{kind:'cron',expr:'*/2 * * * *'},next_run_at:'2026-10-26T02:22:00+07:00',state:'scheduled'},
  {name:'Off one',enabled:false,schedule:{kind:'cron',expr:'0 3 * * *'},next_run_at:'2026-10-26T02:30:00+07:00'}];
 const b=blockingJobs(jobs,now,{tz:TZ});assert.equal(b.length,1);assert.match(b[0].why,/Dora Monday report is due at 03:00/);
 assert.equal(blockingJobs(jobs,at('2026-10-26T01:00:00'),{tz:TZ}).length,0);
 assert.match(blockingJobs([{name:'Long job',schedule:{kind:'cron',expr:'0 0 * * *'},state:'running'}],now,{tz:TZ})[0].why,/is running/)});

const tags=[{name:'v0.22.5',at:at('2026-10-23T12:28:00'),sha:SHA('b')},{name:'v0.22.6',at:at('2026-10-24T10:00:00'),sha:SHA('c')},{name:'rc.1-v0.22.6',at:at('2026-10-24T09:00:00'),sha:SHA('d')},
 {name:'v0.22.6+canary.20261024T065630Z',at:at('2026-10-24T13:00:00'),sha:SHA('e')},{name:'abandoned-rc.2-v0.22.5',at:at('2026-10-23T09:00:00'),sha:SHA('f')},{name:'v2026.9.24',at:at('2026-09-24T17:00:00'),sha:SHA('1')}];
test('tags: stable vX.Y.Z only, newest first',()=>{assert.deepEqual(stableTags(tags).map(t=>t.name),['v0.22.6','v0.22.5','v2026.9.24'])});
test('target: 3 days old, stable, forward, not already on it',()=>{const engine={update_available:true,behind:12,source_version:'0.22.6'},base={engine,tags,head:SHA('b'),forward:true};
 const young=pickTarget({...base,now:at('2026-10-26T01:30:00')});assert.equal(young.ok,false);assert.ok(young.young);assert.match(young.reason,/v0.22.6 came out 1 day ago/);
 assert.equal(pickTarget({...base,now:at('2026-10-26T01:30:00'),manual:true}).ok,true);
 const ok=pickTarget({...base,now:at('2026-10-27T11:00:00')});assert.equal(ok.ok,true);assert.equal(ok.tag,'v0.22.6');assert.equal(ok.sha,SHA('c'));
 assert.ok(pickTarget({...base,head:SHA('c'),now:at('2026-10-30T01:00:00')}).none);
 assert.equal(pickTarget({...base,forward:false,now:at('2026-10-30T01:00:00')}).ok,false);
 assert.match(pickTarget({...base,engine:{...engine,source_version:'0.22.7+canary.1'},now:at('2026-10-30T01:00:00')}).reason,/not a stable release/);
 assert.match(pickTarget({...base,engine:{...engine,rollback_to:'0.22.4'},now:at('2026-10-30T01:00:00')}).reason,/move back/);
 assert.ok(pickTarget({...base,engine:{update_available:false,behind:0},now:at('2026-10-30T01:00:00')}).none);
 assert.equal(pickTarget({...base,engine:{behind:null},now:at('2026-10-30T01:00:00')}).ok,false);
 assert.match(pickTarget({...base,engine:{...engine,source_version:'0.22.9'},now:at('2026-10-30T01:00:00')}).reason,/not in the engine checkout/)});

test('conditions: all must hold, first failing one is the reason',()=>{const win=quietWindow([],TZ),now=at('2026-10-27T01:40:00'),target={ok:true,tag:'v0.22.6'};
 const base={now,win,tz:TZ,target,busy:0,lastUserAt:now-60*60e3,jobs:[]};
 assert.equal(conditions(base).ok,true);
 assert.ok(conditions({...base,now:at('2026-10-27T13:00:00')}).wait);
 assert.match(conditions({...base,target:{ok:false,reason:'v0.22.6 came out 1 day ago'}}).reason,/1 day ago/);
 assert.match(conditions({...base,busy:2}).reason,/busy \(2 jobs/);
 assert.match(conditions({...base,lastUserAt:now-5*60e3}).reason,/message 5 min before/);
 assert.match(conditions({...base,jobs:[{name:'Night job',schedule:{kind:'cron',expr:'0 2 * * *'},next_run_at:'2026-10-27T02:00:00+07:00'}]}).reason,/Night job is due at 02:00/)});

const L=(t,lvl,msg)=>t+',123 '+lvl+' [x] '+msg;
test('log: new profile_mismatch or an error spike fails',()=>{const t0=Date.parse('2026-10-24T22:00:00Z');
 const text=[L('2026-10-24 22:10:00','ERROR','one old error'),L('2026-10-24 23:40:00','ERROR','gateway.run: RuntimeStoreError profile_mismatch'),L('2026-10-24 23:41:00','WARNING','profile_mismatch again'),L('2026-10-24 23:42:00','INFO','fine')].join('\n');
 const before=countLog(text,t0,t0+3600e3),after=countLog(text,t0+100*60e3,t0+110*60e3);
 assert.deepEqual([before.errors,before.mismatch],[1,0]);assert.deepEqual([after.errors,after.mismatch],[1,2]);
 assert.match(logProblems(before,after)[0],/2 chats were refused with profile_mismatch/);
 assert.deepEqual(logProblems(before,countLog(text,t0+102*60e3,t0+110*60e3)),[]);
 const many=Array.from({length:8},(_,i)=>L('2026-10-25 00:0'+i+':00','ERROR','boom')).join('\n');
 assert.match(logProblems({errors:2,mismatch:0,minutes:60},countLog(many,Date.parse('2026-10-25T00:00:00Z'),Date.parse('2026-10-25T00:10:00Z')))[0],/8 errors/)});

// the 24 Oct problem: under the profile's home the LID form no longer reached sela
const run=(label,got)=>({home:'/h/'+label,label,routes:[{name:'sela-whatsapp',platform:'whatsapp',profile:'sela',got}]});
test('routes: only a form that reached its agent before and does not now is a problem',()=>{
 const before=[run('main',{'111@lid':'sela','628222':'sela'}),run('sela',{'111@lid':'sela','628222':null})];
 assert.deepEqual(routeProblems(before,before),[]);
 const after=[run('main',{'111@lid':'sela','628222':'sela'}),run('sela',{'111@lid':null,'628222':null})];
 const p=routeProblems(before,after);assert.equal(p.length,1);assert.match(p[0],/sela-whatsapp no longer reaches sela for .*LID.*checked as sela/);
 assert.match(routeProblems(before,[{home:'/h/main',label:'main',routes:[]}])[0],/no longer read/)});

test('verdict: gateway, every channel, routes, log and health',()=>{const before={channels:['whatsapp','telegram','cove-social:telegram'],routes:{runs:[run('main',{'111@lid':'sela'})]},log:{errors:0,mismatch:0,minutes:60}};
 const good={gatewayUp:true,channels:{whatsapp:'connected',telegram:'connected','cove-social:telegram':'connected'},routes:{runs:[run('main',{'111@lid':'sela'})]},log:{errors:0,mismatch:0,minutes:8},healthOk:true};
 assert.deepEqual(verdict(before,good),{ok:true,problems:[]});
 const bad=verdict(before,{...good,channels:{...good.channels,whatsapp:'retrying'},healthOk:false});assert.equal(bad.ok,false);
 assert.deepEqual(bad.problems,['whatsapp did not reconnect (retrying)','aqeelOS did not answer its health check']);
 assert.match(verdict(before,{...good,gatewayUp:false}).problems[0],/did not come back/);
 assert.match(verdict(before,{...good,routes:{error:'no python'}}).problems[0],/route check could not run/);
 assert.equal(verdict({...before,routes:{error:'x'}},{...good,routes:{error:'x'}}).ok,true)});

test('rollback: only with a record of the earlier version that can still run',()=>{const receipt={pre_update:{sha:SHA('a'),version:'0.22.2'},post_update:{sha:SHA('b')}},check={ok:false,problems:['x']};
 assert.deepEqual(rollbackPlan({check:{ok:true},receipt,head:SHA('b')}),{rollback:false});
 assert.deepEqual(rollbackPlan({check,receipt,head:SHA('b'),knowsRuntime:true}),{rollback:true,to:SHA('a'),version:'0.22.2'});
 assert.equal(rollbackPlan({check,receipt:{},head:SHA('b')}).rollback,false);
 assert.match(rollbackPlan({check,receipt,head:SHA('a')}).reason,/did not cause/);
 assert.match(rollbackPlan({check,receipt,head:SHA('b'),knowsRuntime:false}).reason,/restore by hand/)});

test('owner message',()=>{const t=at('2026-10-27T01:40:00');
 assert.equal(ownerText({kind:'updated',at:t,to:'0.22.6'},TZ),'Updated the engine to v0.22.6 at 01:40, all checks passed.');
 assert.equal(ownerText({kind:'skipped',at:t,to:'v0.22.6',reason:'someone sent a message 5 min before'},TZ),'Skipped the engine update to v0.22.6: someone sent a message 5 min before.');
 assert.match(ownerText({kind:'rolled-back',at:t,from:'0.22.5',problems:['whatsapp did not reconnect'],after:[]},TZ),/^Rolled back: whatsapp did not reconnect\. The engine is on v0\.22\.5 again, and the checks pass\.$/)});
