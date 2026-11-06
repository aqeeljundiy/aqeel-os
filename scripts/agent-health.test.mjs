// Tests for agent health and alerts (app/agent-health.mjs). Run: node --test scripts/agent-health.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {alertKey,alertable,dropStats,dropProblem,scheduleProblems,memberProblem,alertPlan,alertText,overview,createAgentHealth} from '../app/agent-health.mjs';
import {createBottlenecks} from '../app/bottlenecks.mjs';

const NOW=Date.parse('2026-11-05T12:00:00Z'),line=(o)=>JSON.stringify({t:(NOW-(o.ago||0))/1000,platform:'whatsapp',partial:false,retried:false,recovered:false,...o});

test('the same problem keeps one alert key while it lasts',()=>{
 assert.equal(alertKey({id:'sched|pixel|ab12|2026-11-05T20:00'}),alertKey({id:'sched|pixel|ab12|2026-11-06T00:00'}));
 assert.equal(alertKey({id:'channel|sesa|whatsapp|111'}),alertKey({id:'channel|sesa|whatsapp|222'}));
 assert.equal(alertKey({id:'event|e1',kind:'group',topic:'health|x|group|-1'}),alertKey({id:'event|e2',kind:'group',topic:'health|x|group|-1'}));
 assert.ok(!alertable({kind:'invite'})&&!alertable({kind:'selfruns',told:true})&&alertable({kind:'schedule'}));
});

test('failed messages are counted per agent, with the cause and what the retry saved',()=>{
 const t=[line({agent:'sesa',reason:'timeout',ago:10*60e3}),line({agent:'sesa',reason:'timeout',retried:true,recovered:true,ago:20*60e3}),
  line({agent:'sesa',reason:'server_error',ago:2*3600e3}),line({agent:'sesa',reason:'timeout',ago:9*86400e3}),'not json',line({agent:'pixel-agent',reason:'loop_error',partial:true})].join('\n');
 const d=dropStats(t,{now:NOW});
 assert.deepEqual({n:d.sesa.n,recovered:d.sesa.recovered,failed:d.sesa.failed,lastHour:d.sesa.lastHour,top:d.sesa.top},{n:3,recovered:1,failed:2,lastHour:1,top:'timeout'});
 assert.equal(d['pixel-agent'].n,1);
 assert.equal(dropProblem('sesa',d.sesa),null,'one failure in an hour is not an alert');
 const many=dropStats([1,2,3].map(i=>line({agent:'sesa',reason:'timeout',ago:i*60e3})).join('\n'),{now:NOW});
 assert.match(dropProblem('sesa',many.sesa).detail,/^3 failed in the last hour, mostly because the AI model did not answer in time/);
});

test('a scheduler that stopped, and a schedule long past its time, are problems',()=>{
 const tick=s=>(NOW-s*60e3)/1000;
 assert.deepEqual(scheduleProblems('a',{ticker:tick(2),jobs:[]},{now:NOW}),[]);
 assert.equal(scheduleProblems('a',{ticker:tick(40),jobs:[]},{now:NOW})[0].topic,'health|a|scheduler');
 assert.deepEqual(scheduleProblems('a',{ticker:tick(40)},{now:NOW,engineUp:false}),[],'not while the engine is off or restarting');
 const jobs=[{id:'j1',name:'Daily',enabled:true,state:'scheduled',next_run_at:new Date(NOW-2*3600e3).toISOString()},
  {id:'j2',name:'Paused',enabled:true,state:'paused',next_run_at:new Date(NOW-9*3600e3).toISOString()},
  {id:'j3',name:'Soon',enabled:true,state:'scheduled',next_run_at:new Date(NOW-20*60e3).toISOString()}];
 const p=scheduleProblems('a',{ticker:tick(1),jobs},{now:NOW});
 assert.deepEqual(p.map(x=>x.topic),['health|a|late|j1']);assert.match(p[0].text,/Daily/);
});

test('a bot no longer in its Telegram group is a problem',()=>{
 const g={id:'-100398',title:'Biomarkers team'};
 assert.equal(memberProblem('b',g,{ok:true,result:{status:'administrator'}}),null);
 assert.equal(memberProblem('b',g,{ok:false,description:'Too Many Requests: retry after 5'}),null,'a busy Telegram is not a removal');
 assert.match(memberProblem('b',g,{ok:true,result:{status:'kicked'}}).text,/Removed from the Telegram group Biomarkers team/);
 assert.equal(memberProblem('b',g,{ok:false,description:'Bad Request: chat not found'}).topic,'health|b|group|-100398');
});

test('the owner hears about a new problem once, after two checks, and again only if it comes back',()=>{
 const p={id:'sched|pixel|j1|t1',kind:'schedule',agent:'pixel',title:'A schedule failed: Check-in',text:'Claude has no login'};
 let r=alertPlan({},[p],NOW);assert.equal(r.send.length,0,'first sight: wait for the next check');
 r=alertPlan(r.state,[p],NOW+60e3);assert.equal(r.send.length,0,'too soon');
 r=alertPlan(r.state,[p],NOW+5*60e3);assert.equal(r.send.length,1);
 r=alertPlan(r.state,[{...p,id:'sched|pixel|j1|t2'}],NOW+10*60e3);assert.equal(r.send.length,0,'the same failing schedule is not told twice');
 r=alertPlan(r.state,[],NOW+15*60e3);assert.deepEqual(r.state,{told:{},seen:{}},'fixed: forgotten');
 r=alertPlan(r.state,[p],NOW+20*60e3);r=alertPlan(r.state,[p],NOW+25*60e3);assert.equal(r.send.length,1,'broken again: told again');
 const gone=alertPlan({},[p],NOW);assert.equal(alertPlan(gone.state,[],NOW+5*60e3).send.length,0,'a problem gone by the second check is never told');
 assert.equal(alertPlan({},[{...p,told:true}],NOW).state.seen[alertKey(p)],undefined,'already told by its own feature');
});

test('the alert says who and what, in plain words, with the link',()=>{
 const t=alertText([{agent:'pixel',kind:'schedule',title:'A schedule failed: Check-in',text:'Claude has no login'},{agent:'sesa',kind:'group',title:'Removed from the Telegram group Team'}],{link:'https://x/#/system/health',nameOf:a=>({pixel:'Pixel',sesa:'Sesa'})[a]});
 assert.equal(t,'2 agents need attention\n\n• Pixel: A schedule failed: Check-in. Claude has no login\n• Sesa: Removed from the Telegram group Team\n\nOpen Health: https://x/#/system/health');
 assert.ok(!/—/.test(t),'no em dashes');
});

test('every agent has a row; broken ones first; copies count as their agent',()=>{
 const rows=overview(['default','sesa','pixel'],[{agent:'pixel--2',kind:'channel',title:'x'},{kind:'down',title:'The server was off'},{kind:'invite',title:'i'}],{sesa:{n:2}},a=>a.toUpperCase());
 assert.deepEqual(rows.map(r=>[r.name,r.ok,r.problems.length]),[['aqeelOS itself',false,1],['PIXEL',false,1],['DEFAULT',true,0],['SESA',true,0]]);
 assert.equal(rows.find(r=>r.agent==='sesa').drops.n,2);
});

test('end to end: checks become Bottlenecks items, one Telegram alert, gone when fixed',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'health-')),HOME=path.join(DATA,'hermes');
 const cron=path.join(HOME,'profiles','pixel','cron');await mkdir(cron,{recursive:true});await mkdir(path.join(HOME,'logs'),{recursive:true});
 await writeFile(path.join(cron,'ticker_last_success'),String((Date.now()-60*60e3)/1000));
 await writeFile(path.join(HOME,'logs','aqeelos-dropped.jsonl'),[1,2,3].map(i=>JSON.stringify({t:(Date.now()-i*60e3)/1000,agent:'pixel',reason:'timeout',recovered:false})).join('\n')+'\n');
 const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a});
 const told=[];
 const h=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a==='pixel'?'Pixel':a,
  tellOwner:async t=>told.push(t),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
 await h.problem('pixel','handoff','A handoff to the team was not delivered',{topic:'handoff|c1',fix:'Check the team group.'});
 assert.equal(await h.tick(),0,'first check: nothing told yet');
 const v=await h.view(),px=v.agents.find(r=>r.agent==='pixel');
 assert.deepEqual(px.problems.map(x=>x.kind).sort(),['dropped','handoff','stopped']);assert.equal(px.drops.failed,3);
 // two checks later (the second check waits 3 minutes after the first sight)
 const st=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));for(const k in st.seen)st.seen[k]-=4*60e3;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st));
 const h2=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a==='pixel'?'Pixel':a,
  tellOwner:async t=>told.push(t),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
 assert.equal(await h2.tick(),3);assert.equal(told.length,1);assert.match(told[0],/^Pixel needs attention\n\n/);for(const w of ['Schedules stopped running','Messages to this agent keep failing','A handoff to the team was not delivered. Check the team group.'])assert.ok(told[0].includes('• Pixel: '+w),w);
 assert.equal(await h2.tick(),0,'not again');
 await writeFile(path.join(cron,'ticker_last_success'),String(Date.now()/1000));await h2.ok('pixel','handoff|c1');await h2.tick();
 assert.deepEqual((await h2.view()).agents.find(r=>r.agent==='pixel').problems.map(x=>x.kind),['dropped']);
});

test('an agent can report a system problem; it shows as one, not as "blocked"',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'health-'));const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a==='sesa'?'Sesa':a});
 await bn.report('sesa',{missing:'The WhatsApp bridge drops images',fix:'Restart the bridge',system:true});
 const [x]=await bn.list({admin:false,mayUse:()=>true});assert.equal(x.kind,'system');assert.equal(x.title,'Sesa reported a system problem: The WhatsApp bridge drops images');
 await bn.report('sesa',{missing:'Access to the Finance folder'});
 assert.ok((await bn.list({admin:false,mayUse:()=>true})).some(y=>y.kind==='report'&&/is blocked/.test(y.title)));
});
