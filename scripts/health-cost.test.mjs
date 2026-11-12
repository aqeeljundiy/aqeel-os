// node --test scripts/health-cost.test.mjs — System › Health's "Cost this week" never holds the page up (12 Nov 2026): adding it up took 15 to
// 29 s on a busy box and the page waited for it on every visit. The last answer is given at once and added up again behind it.
import test from 'node:test';import assert from 'node:assert/strict';
import {createHealthRoutes} from '../app/health-routes.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture({slow=60,warmMs=1e9}={}){let n=0,cost=1;
 const usage={breakdown:async(agents,days,who)=>{n++;await sleep(slow);return {byAgent:{'default':{cost},'default--helper':{cost:1}},byPerson:{[who('s1',{source:'cron'})]:{cost}}}}};
 const users={isAdmin:u=>!!u.admin,sessionOwner:()=>null,people:()=>[]};
 const handle=createHealthRoutes({usage,users,issues:{policy:async()=>({})},listAllProfiles:async()=>['default'],agentName:a=>'Agent '+a,send:(res,code,body)=>{res.code=code;res.body=body},warmMs});
 const ask=async(admin=true)=>{const res={};const t=Date.now();const done=await handle({method:'GET'},res,'/ui/health/cost',new URL('http://x/ui/health/cost'),{admin});return {...res,done,ms:Date.now()-t}};
 return {ask,calls:()=>n,setCost:c=>cost=c}}
test('cost this week: the first ask adds it up, later asks answer at once from the last answer, admins only',async()=>{
 const f=fixture();
 const a=await f.ask();assert.equal(a.code,200);assert.equal(a.done,true);assert.deepEqual(a.body.byAgent,[{id:'default',cost:2,name:'Agent default'}],'a helper agent counts for its agent');
 assert.deepEqual(a.body.byPerson,[{id:'_cron',cost:1,name:'Schedules',auto:true}]);assert.equal(f.calls(),1);
 f.setCost(5);const b=await f.ask();assert.ok(b.ms<40,'answered from the last answer, took '+b.ms+' ms');assert.equal(b.body.byAgent[0].cost,2);assert.equal(f.calls(),1,'younger than a minute: not added up again');
 assert.equal((await f.ask(false)).code,403);assert.equal(f.calls(),1)});
test('cost this week: once the answer is a minute old it is still given at once and added up again behind it',async t=>{
 t.mock.timers.enable({apis:['Date']});const f=fixture({slow:0});
 await f.ask();t.mock.timers.tick(61000);f.setCost(5);
 const b=await f.ask();assert.equal(b.body.byAgent[0].cost,2,'the last answer, at once');await sleep(40);assert.equal(f.calls(),2,'and read again behind it');
 assert.equal((await f.ask()).body.byAgent[0].cost,6,'the next ask has the new one')});
test('cost this week is added up once shortly after the app starts, so the first visit to Health does not wait for it',async()=>{
 const f=fixture({slow:0,warmMs:5});await sleep(60);assert.equal(f.calls(),1);const a=await f.ask();assert.equal(f.calls(),1);assert.equal(a.body.days,7)});

// the same for every number a page shows from the agents' chats (System › Usage reads them too): usage.mjs
test('usage shown on a page: a list over a minute old is given at once and read again behind it; a limit still waits for the new one',async t=>{
 const {createUsage}=await import('../app/usage.mjs');let reads=0,cost=1,now=1e12;t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async u=>{reads++;await sleep(30);return new Response(JSON.stringify({sessions:[{id:'s1',started_at:now/1000-60,last_active:now/1000-60,estimated_cost_usd:cost,input_tokens:10,output_tokens:5,message_count:2}]}),{status:200})});
 const U=createUsage('http://engine.invalid','tok',null),own=()=>'p1';
 assert.equal((await U.breakdown(['a'],7,own)).byPerson.p1.cost,1);assert.equal(reads,1,'nothing known yet: waits');
 await U.breakdown(['a'],7,own);assert.equal(reads,1,'younger than a minute: as it is');
 now+=5*60e3;cost=4;const t0=performance.now();const b=await U.breakdown(['a'],7,own);
 assert.ok(performance.now()-t0<20,'no wait for the engine');assert.equal(b.byPerson.p1.cost,1,'the last list');await sleep(80);assert.equal(reads,2,'read again behind it, once');
 assert.equal((await U.breakdown(['a'],7,own)).byPerson.p1.cost,4,'the next ask has the new numbers');
 now+=5*60e3;const r0=reads;const td=await U.today(['a'],'p1',own);assert.equal(reads,r0+1,'a limit waits for a new read');assert.equal(typeof td.tokens,'number');
 now+=45*60e3;cost=9;assert.equal((await U.breakdown(['a'],7,own)).byPerson.p1.cost,9,'older than half an hour: waits again')});
