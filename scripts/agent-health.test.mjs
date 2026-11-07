// Tests for agent health and alerts (app/agent-health.mjs). Run: node --test scripts/agent-health.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {alertKey,alertable,dropStats,dropProblem,scheduleProblems,memberProblem,alertPlan,alertText,overview,createAgentHealth,duplicateProcesses} from '../app/agent-health.mjs';
import {createBottlenecks} from '../app/bottlenecks.mjs';
import {skillRefs,checkSkills} from '../app/skill-check.mjs';

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

test('end to end: checks become Bottlenecks items, each filed once for the fixer, nobody told',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'health-')),HOME=path.join(DATA,'hermes');
 const cron=path.join(HOME,'profiles','pixel','cron');await mkdir(cron,{recursive:true});await mkdir(path.join(HOME,'logs'),{recursive:true});
 await writeFile(path.join(cron,'ticker_last_success'),String((Date.now()-60*60e3)/1000));
 await writeFile(path.join(HOME,'logs','aqeelos-dropped.jsonl'),[1,2,3].map(i=>JSON.stringify({t:(Date.now()-i*60e3)/1000,agent:'pixel',reason:'timeout',recovered:false})).join('\n')+'\n');
 const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a});
 const told=[],filed=[],gone=[];const fileIssue=async o=>{filed.push(o);return {issue:{id:'i'+filed.length}}},healthGone=async k=>{gone.push(k)};
 const h=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a==='pixel'?'Pixel':a,fileIssue,healthGone,
  tellOwner:async t=>told.push(t),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
 await h.problem('pixel','handoff','A handoff to the team was not delivered',{topic:'handoff|c1',fix:'Check the team group.'});
 assert.equal(await h.tick(),0,'first check: nothing told yet');
 const v=await h.view(),px=v.agents.find(r=>r.agent==='pixel');
 assert.deepEqual(px.problems.map(x=>x.kind).sort(),['dropped','handoff','stopped']);assert.equal(px.drops.failed,3);
 // two checks later (the second check waits 3 minutes after the first sight)
 const st=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));for(const k in st.seen)st.seen[k]-=4*60e3;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st));
 const h2=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a==='pixel'?'Pixel':a,fileIssue,healthGone,
  tellOwner:async t=>told.push(t),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
 assert.equal(await h2.tick(),3);assert.equal(told.length,0,'Health messages nobody');assert.equal(filed.length,3);
 assert.ok(filed.every(o=>o.agent==='pixel'&&o.source==='health'&&o.healthKey));for(const w of ['Schedules stopped running','Messages to this agent keep failing','A handoff to the team was not delivered'])assert.ok(filed.some(o=>o.missing===w),w);
 assert.match(filed.find(o=>/handoff/.test(o.missing)).evidence,/Check the team group/);
 assert.equal(await h2.tick(),0,'not again');assert.equal(filed.length,3);assert.ok(gone.at(-1).length>=3,'Health passes the problems it still sees');
 // problems Health knew before (told under the old rules) are filed once too
 {const st2=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));delete st2.filed;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st2));
  const h3=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a,fileIssue,healthGone,engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
  assert.equal(await h3.tick(),3);assert.equal(filed.length,6);assert.equal(await h3.tick(),0)}
 // the ladder: the agent tries itself first; the fixer gets it only if it is still there 45 minutes later
 {const st3=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));delete st3.filed;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st3));const asked=[];
  const h4=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a,fileIssue,healthGone,fixFirst:async(a,x)=>asked.push([a,x.title]),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
  assert.equal(await h4.tick(),0);assert.equal(asked.length,3);assert.ok(asked.every(([a])=>a==='pixel'));assert.equal(filed.length,6,'not to the fixer yet');
  const st4=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));for(const k in st4.selfTried)st4.selfTried[k]-=46*60e3;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st4));
  const h5=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a,fileIssue,healthGone,fixFirst:async(a,x)=>asked.push([a,x.title]),engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
  assert.equal(await h5.tick(),3);assert.equal(asked.length,3,'not asked twice');assert.equal(filed.length,9,'still there after 45 minutes: the fixer');
  // an agent that cannot run itself: straight to the fixer
  const st5=JSON.parse(await readFile(path.join(DATA,'agent-health.json'),'utf8'));delete st5.filed;delete st5.selfTried;await writeFile(path.join(DATA,'agent-health.json'),JSON.stringify(st5));
  const h6=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','pixel'],nameOf:a=>a,fileIssue,healthGone,fixFirst:async()=>{throw Error('it cannot run itself')},engineUp:async()=>true,botToken:async()=>null,items:()=>bn.list({admin:true,mayUse:()=>true})});
  assert.equal(await h6.tick(),3);assert.equal(filed.length,12)}
 await writeFile(path.join(cron,'ticker_last_success'),String(Date.now()/1000));await h2.ok('pixel','handoff|c1');await h2.tick();assert.equal(filed.length,12,'nothing new filed');
 assert.deepEqual((await h2.view()).agents.find(r=>r.agent==='pixel').problems.map(x=>x.kind),['dropped']);
 assert.equal(gone.at(-1).length,1,'the two that went away are no longer passed, so their queued issues close');assert.equal(told.length,0);
});

test('an agent can report a system problem; it shows as one, not as "blocked"',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'health-'));const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a==='sesa'?'Sesa':a});
 await bn.report('sesa',{missing:'The WhatsApp bridge drops images',fix:'Restart the bridge',system:true});
 const [x]=await bn.list({admin:false,mayUse:()=>true});assert.equal(x.kind,'system');assert.equal(x.title,'Sesa reported a system problem: The WhatsApp bridge drops images');
 await bn.report('sesa',{missing:'Access to the Finance folder'});
 assert.ok((await bn.list({admin:false,mayUse:()=>true})).some(y=>y.kind==='report'&&/is blocked/.test(y.title)));
});

test('the same script of one agent running twice is a problem; its subshell, other agents and new starts are not',()=>{
 const W='/home/u/workspaces/continue-threads/.tools',agentOf=r=>/continue-threads/.test(r.cwd+r.args)?'continue-threads':/sesa/.test(r.cwd)?'sesa':null;
 const rows=[{pid:10,ppid:1,age:900,user:'claude',args:'bash comment_loop.sh',cwd:W},{pid:11,ppid:10,age:900,user:'claude',args:'bash comment_loop.sh',cwd:W},
  {pid:20,ppid:1,age:400,user:'claude',args:'/bin/bash '+W+'/comment_loop.sh',cwd:'/home/u'},{pid:30,ppid:1,age:300,user:'claude',args:'bash comment_loop.sh',cwd:W},{pid:31,ppid:1,age:60,user:'claude',args:'bash comment_loop.sh',cwd:W},
  {pid:40,ppid:1,age:900,user:'claude',args:'python3 dm_watch.py',cwd:W},{pid:50,ppid:1,age:900,user:'ag-sesa',args:'python3 dm_watch.py',cwd:'/home/u/workspaces/sesa'},
  {pid:60,ppid:1,age:900,user:'claude',args:'python3 -I job.py --a',cwd:W},{pid:61,ppid:1,age:900,user:'claude',args:'python3 -I job.py --b',cwd:W},
  // one tool server per agent: the same script in each agent's own folder is not a duplicate
  {pid:70,ppid:1,age:900,user:'claude',args:'node /app/guard.mjs x',cwd:'/home/u/workspaces/continue-threads'},{pid:71,ppid:1,age:900,user:'claude',args:'node /app/guard.mjs x',cwd:'/home/u/workspaces/sesa'}];
 const d=duplicateProcesses(rows,agentOf);
 assert.equal(d.length,1,JSON.stringify(d));assert.equal(d[0].agent,'continue-threads');assert.match(d[0].text,/comment_loop.sh runs 2 times at once/);assert.match(d[0].detail,/10, 30/);
 assert.equal(d[0].topic,'health|continue-threads|twice|comment_loop.sh')});

test('a skill pointing to a missing file is found; example paths in its text are not',async()=>{
 const r=skillRefs('Read references/a.md and [b](templates/b.md). Run: python3 ~/.hermes/scripts/x.py --go\nExample: ~/project/foo.txt, scratch: python3 ~/.hermes/cache/scratch/t.py, <dir>/references/z.md');
 assert.deepEqual(r.own.sort(),['references/a.md','templates/b.md']);assert.deepEqual(r.run,['~/.hermes/scripts/x.py']);
 const D=await mkdtemp(path.join(tmpdir(),'sk-'));await mkdir(path.join(D,'skills','cat','one','references'),{recursive:true});await mkdir(path.join(D,'skills','cat','two'),{recursive:true});
 await writeFile(path.join(D,'skills','cat','one','SKILL.md'),'see references/here.md and references/gone.md');await writeFile(path.join(D,'skills','cat','one','references','here.md'),'x');
 await writeFile(path.join(D,'skills','cat','two','SKILL.md'),'run: bash ~/tool.sh');
 const res=await checkSkills(path.join(D,'skills'),{home:D});
 assert.deepEqual(res.sort((a,b)=>a.skill<b.skill?-1:1),[{skill:'cat/one',missing:['references/gone.md']},{skill:'cat/two',missing:['~/tool.sh']}]);
 await writeFile(path.join(D,'tool.sh'),'');assert.equal((await checkSkills(path.join(D,'skills'),{home:D})).length,1)});

// ---- live checks in plain code (7 Nov 2026)
import {engineEvents,engineProblems,mcpState,mcpProblems,customerProblem,failingJobs,memProblems} from '../app/agent-health.mjs';
test('engine: unclean and failed exits and a swapped state.db since the last check',()=>{
 const since=Date.parse('2026-11-07T05:00:00Z');
 const diag=[{ts:'2026-11-07T04:59:00+00:00',tag:'gateway.previous_unclean_exit'},{ts:'2026-11-07T05:10:00+00:00',tag:'gateway.previous_unclean_exit'},{ts:'2026-11-07T05:11:00+00:00',tag:'gateway.exit_nonzero'},{ts:'2026-11-07T05:12:00+00:00',tag:'gateway.exit_clean'}].map(x=>JSON.stringify(x)).join('\n')+'\nnot json';
 const err='2026-11-06 16:32:34,049 ERROR hermes_state: FATAL: state.db was replaced underneath the gateway\n2026-11-07 05:20:00,000 ERROR hermes_state: FATAL: state.db was replaced underneath the gateway';
 const e=engineEvents(diag,err,since);assert.deepEqual([e.unclean,e.nonzero,e.replaced],[1,1,1]);
 assert.deepEqual(engineProblems(e).map(x=>x.topic),['health|aqeelos|engine-exit','health|aqeelos|state-db']);
 assert.deepEqual(engineProblems(engineEvents(diag,err,Date.parse('2026-11-07T06:00:00Z'))),[])});
test('tool servers: the latest registration line, and flapping in the last hour',()=>{const now=Date.parse('2026-11-07T06:00:00Z');
 const L=(t,f)=>'2026-11-07 '+t+',100 INFO tools.mcp_tool: MCP: registered 158 tool(s) from 6 server(s)'+(f?' ('+f.length+' failed: '+f.map(x=>x+' (MCP OAuth for \''+x+'\': no tokens; run `hermes mcp login '+x+'`)').join('; ')+')':'');
 const log=[L('05:10:00',['composio','notion']),L('05:20:00',['composio']),L('05:30:00',['composio','notion']),L('05:40:00',['composio']),L('05:50:00',['composio','notion']),
  "2026-11-07 05:50:01,000 INFO tools.mcp_tool: MCP server 'aqeelos-customer' (HTTP): registered 6 tool(s): a, b"].join('\n');
 const s=mcpState(log,now);assert.deepEqual(s.failed,['composio','notion']);assert.deepEqual(Object.keys(s.flaps),['notion']);assert.equal(s.customer,6);
 assert.deepEqual(mcpProblems('a1',s).map(x=>x.topic),['health|a1|mcp-failed','health|a1|mcp-flap']);
 assert.deepEqual(mcpProblems('a1',mcpState(L('05:55:00',null),now)),[])});
test('customer tools: 6 listed and 6 registered, else a problem',()=>{
 assert.equal(customerProblem('a',{listed:6,registered:6}),null);assert.match(customerProblem('a',{listed:null,registered:6}).text,/do not answer/);
 assert.match(customerProblem('a',{listed:6,registered:0}).text,/too few/);assert.match(customerProblem('a',{listed:6,registered:null}).text,/did not register/)});
test('schedules failing twice in a row; memory and load',()=>{
 assert.deepEqual(failingJobs('a',[{id:'j1',name:'Report',failure_streak:2,last_error:'boom'},{id:'j2',failure_streak:1},{id:'j3',failure_streak:5,enabled:false}]).map(x=>x.topic),['health|a|failing|j1']);
 assert.deepEqual(memProblems({used:95,max:100,load1:30,cpus:12}).map(x=>x.topic),['health|aqeelos|memory','health|aqeelos|load']);assert.deepEqual(memProblems({used:50,max:100,load1:20,cpus:12}),[])});
test('the live checks run in tick, file nothing on their own, and clear when fine',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'health-')),HOME=path.join(DATA,'hermes');await mkdir(path.join(HOME,'logs'),{recursive:true});await mkdir(path.join(HOME,'profiles','sup','logs'),{recursive:true});
 const bn=createBottlenecks({DATA,dash:async()=>[],listAgents:async()=>[],names:a=>a});let mem={used:95,max:100,load1:1,cpus:4},listed=null;
 const h=createAgentHealth({DATA,HERMES_HOME:HOME,bottlenecks:bn,python:async()=>null,link:'L',listAgents:async()=>['default','sup'],nameOf:a=>a,engineUp:async()=>true,botToken:async()=>null,
  items:()=>bn.list({admin:true,mayUse:()=>true}),memInfo:async()=>mem,customerTools:async()=>listed,kirimdevAgents:async()=>['sup'],ps:async()=>[]});
 await h.tick();let v=await h.view();const all=v.agents.flatMap(r=>r.problems.map(p=>p.kind));assert.ok(all.includes('memory'));assert.ok(all.includes('customer'));
 mem={used:10,max:100,load1:1,cpus:4};listed=6;await writeFile(path.join(HOME,'profiles','sup','logs','agent.log'),"2026-11-07 05:50:01,000 INFO tools.mcp_tool: MCP server 'aqeelos-customer' (HTTP): registered 6 tool(s): a\n");
 await h.tick();v=await h.view();assert.deepEqual(v.agents.flatMap(r=>r.problems.map(p=>p.kind)),[])});
