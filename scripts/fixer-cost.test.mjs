// What the fixer costs (12 Nov 2026, MODEL-4 / MODEL-3b): money caps, turn limits, the escalation gate, the evidence fingerprint, the checkout's own
// files kept for the commit. Run: node --test scripts/fixer-cost.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createIssues,fingerprint,costCaps,turnLimit,runCost,costToday,cameBackMs,fixerModel,repairPrompt,proofPrompt,turnLine,COST_CAPS,TURNS} from '../app/issues.mjs';
import {fakeFixerSandbox} from './lib/fake-fixer-sandbox.mjs';

const T=Date.UTC(2026,10,12,8,0);
async function mk(o={}){const DATA=await mkdtemp(path.join(tmpdir(),'fc-'));let t=T;const started=[],told=[];
 await writeFile(path.join(DATA,'team-policy.json'),JSON.stringify({teams:[],owner:{name:'Owner'},fixer:{on:true,agent:'default',...(o.fixer||{})}}));
 const fx=createIssues({sandbox:fakeFixerSandbox(),DATA,home:DATA,bin:'x',fixerHome:DATA,now:()=>t,tellOwner:async x=>{told.push(x)},ready:async()=>true,log:()=>{},tz:()=>'UTC',git:o.git||null,
  launch:async a=>{started.push(a);const p=await readFile(path.join(a.dir,'prompt.txt'),'utf8');if(o.answer){await writeFile(path.join(a.dir,'out.txt'),'RESULT: '+JSON.stringify(await o.answer(a,p)));await writeFile(path.join(a.dir,'exit'),'0')}return 999999},alive:async()=>false});
 return {fx,DATA,started,told,step:ms=>{t+=ms},now:()=>t}}
const run=(id,issue,o={})=>({id,issue,kind:'fix',day:'2026-11-12',at:T,done:T+1,agent:'default',usage:{cost:o.cost??0},...o});
const done=async(DATA,id,out)=>{const d=path.join(DATA,'issues',id);await mkdir(d,{recursive:true});await writeFile(path.join(d,'out.txt'),out);await writeFile(path.join(d,'exit'),'0')};

test('fingerprint: the same words with other times, ids and counters are the same evidence; other words are not',()=>{
 const a=fingerprint({missing:'Schedule 198bc372ee48 failed',evidence:'2026-11-12T03:26:26Z exit 1: script aqeelos-posting-gate.sh not found (3 times)'});
 const b=fingerprint({missing:'Schedule 7ab01824ed01 failed',evidence:'2026-11-12 09:40:01 exit 2: script aqeelos-posting-gate.sh not found (12 times)'});
 assert.equal(a,b);
 assert.notEqual(a,fingerprint({missing:'Schedule 198bc372ee48 failed',evidence:'script aqeelos-posting-gate.sh not found; token expired'}));
 assert.equal(fingerprint({missing:'x',evidence:'b a b a'}),fingerprint({missing:'x',evidence:'a b'}),'order and repeats do not count');
 assert.equal(fingerprint({}),fingerprint({missing:'',evidence:''}))});

test('caps and turn limits: defaults, overrides, nonsense ignored',()=>{
 assert.deepEqual(costCaps({}),{issue:COST_CAPS.issue,day:COST_CAPS.day,escalateSpent:COST_CAPS.escalateSpent});
 assert.deepEqual(costCaps({fixer:{maxCostPerIssue:1.5,maxCostPerDay:'4',escalateMaxSpent:0.5}}),{issue:1.5,day:4,escalateSpent:0.5});
 assert.equal(costCaps({fixer:{maxCostPerIssue:-1,maxCostPerDay:'x'}}).issue,COST_CAPS.issue);assert.equal(costCaps({fixer:{maxCostPerDay:'x'}}).day,COST_CAPS.day);
 assert.equal(turnLimit({},'fix'),TURNS.fix);assert.equal(turnLimit({},'proof'),TURNS.proof);assert.equal(turnLimit({},'fix',true),TURNS.escalate);
 assert.equal(turnLimit({fixer:{maxTurns:{fix:20,proof:9,escalate:12}}},'fix'),20);assert.equal(turnLimit({fixer:{maxTurns:{fix:20,proof:9,escalate:12}}},'fix',true),12);
 assert.equal(turnLimit({fixer:{maxTurns:{fix:20}}},'fix',true),20,'no escalate limit: the fix limit');assert.equal(turnLimit({fixer:{maxTurns:{fix:1}}},'fix'),TURNS.fix,'under 3 is nonsense');
 assert.equal(cameBackMs({}),72*36e5);assert.equal(cameBackMs({fixer:{comeBackHours:6}}),6*36e5)});

test('runCost: what the runs cost, minus what Try again wiped; runs that never reached the model cost nothing',()=>{
 const runs={a:run('a','i1',{cost:1.25}),b:run('b','i1',{cost:0.5}),c:run('c','i1',{cost:9,notStarted:true}),d:run('d','i2',{cost:4}),e:{id:'e',issue:'i1',kind:'fix',day:'2026-11-12'}};
 assert.equal(runCost(runs,{id:'i1'}),1.75);assert.equal(runCost(runs,{id:'i1',runBase:{cost:1.25}}),0.5);assert.equal(runCost(runs,{id:'i1',runBase:{cost:99}}),0);
 assert.equal(costToday(runs,'2026-11-12'),5.75);assert.equal(costToday(runs,'2026-11-11'),0)});

test('the last try uses the stronger model only when allowed; default behaviour is unchanged',()=>{
 const P={fixer:{models:{fix:'sonnet',proof:'haiku',escalate:'opus'},effort:{fix:'medium',escalate:'high'}}};
 assert.equal(fixerModel(P,'fix',3).model,'opus');assert.equal(fixerModel(P,'fix',3,{escalate:true}).model,'opus');
 assert.deepEqual(fixerModel(P,'fix',3,{escalate:false}),{model:'sonnet',effort:'medium'});assert.equal(fixerModel(P,'fix',2,{escalate:true}).model,'sonnet');assert.equal(fixerModel(P,'proof',3,{escalate:true}).model,'haiku')});

test('the prompts tell the run its turn limit; without one nothing is added',()=>{
 const i={id:'iabc12345',agent:'a',missing:'m',evidence:'e',history:[]};
 assert.match(repairPrompt(i,{turns:30,url:"http://x"}),/at most 30 tool-calling turns[^\n]*turn 24/);assert.match(proofPrompt(i,null,{turns:16}),/at most 16 tool-calling turns/);
 assert.doesNotMatch(repairPrompt(i,{url:"http://x"}),/tool-calling turns/);assert.equal(turnLine(0),null)});

test('a run is started with the turn limit and lean (no agent rules or memory) unless the policy turns it off; the escalated try has its own limit',async()=>{
 const {fx,started}=await mk({fixer:{models:{fix:'sonnet',proof:'haiku',escalate:'opus'},maxTurns:{fix:25,proof:10,escalate:18}}});
 await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db(),i=db.items[0];
 await fx.tick();assert.equal(started[0].turns,25);assert.equal(started[0].lean,true);assert.equal(started[0].model,'sonnet');assert.equal(db.runs[i.run].turns,25);
 const p=await readFile(path.join(started[0].dir,'prompt.txt'),'utf8');assert.match(p,/at most 25 tool-calling turns/);
 // third try after cheap tries that reached a result: the stronger model, with its own limit
 i.state='queued';i.tries=2;i.run=null;db.runs[i.run||'x']=undefined;delete db.runs.x;i.history.push({kind:'fix',status:'changed',summary:'s'});for(const k of Object.keys(db.runs))db.runs[k].done=T;
 await fx.tick();const last=started.at(-1);assert.equal(last.model,'opus');assert.equal(last.turns,18)});

test('escalation gate: expensive earlier tries, or tries that never reached a result, keep the fix model on the last try',async()=>{
 for(const [name,hist,cost,want] of [['cheap with a result',[{kind:'fix',status:'patch'}],0.8,'opus'],['too expensive',[{kind:'fix',status:'patch'}],2.6,'sonnet'],['only failures',[{kind:'fix',status:'failed'},{kind:'fix',status:'failed'}],0.1,'sonnet']]){
  const {fx,started}=await mk({fixer:{models:{fix:'sonnet',proof:'haiku',escalate:'opus'}}});
  await fx.file({agent:'a',missing:'Problem '+name+' xyz',evidence:'e'});const db=await fx._db(),i=db.items[0];i.tries=2;i.history.push(...hist);db.runs.old=run('old',i.id,{cost});
  await fx.tick();assert.equal(started[0].model,want,name)}
 const {fx,started}=await mk({fixer:{models:{fix:'sonnet',escalate:'opus'},escalateMaxSpent:5,maxCostPerIssue:10}});await fx.file({agent:'a',missing:'Problem raised limit xyz',evidence:'e'});
 const db=await fx._db(),i=db.items[0];i.tries=2;i.history.push({kind:'fix',status:'patch'});db.runs.old=run('old',i.id,{cost:4});await fx.tick();assert.equal(started[0].model,'opus','the limit is a setting')});

test('MODEL-4: an issue that used up its money is not run again: one needs-a-person item with the amount; Try again starts a fresh count',async()=>{
 const {fx,started,told}=await mk({fixer:{maxCostPerIssue:2}});
 await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db(),i=db.items[0];
 db.runs.r1=run('r1',i.id,{cost:1.3});db.runs.r2=run('r2',i.id,{cost:0.9});
 await fx.tick();assert.equal(started.length,0);assert.equal(i.state,'needs_human');assert.equal(i.capped.cost,2.2);assert.match(i.need,/\$2\.20/);assert.match(i.need,/\$2 per problem/);assert.equal(told.length,1);
 await fx.tick();assert.equal(told.length,1,'once');
 await fx.retry(i.id);assert.equal(i.state,'queued');assert.equal(runCost(db.runs,i),0);await fx.tick();assert.equal(started.length,1,'runs again after Try again')});

test('MODEL-4: a proof run is not held back by the issue\'s spending (it costs cents and ends the story)',async()=>{
 const {fx,started}=await mk({fixer:{maxCostPerIssue:1}});await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db(),i=db.items[0];
 i.state='verify';i.tries=1;i.history.push({kind:'fix',status:'changed'});db.runs.r1=run('r1',i.id,{cost:5});await fx.tick();assert.equal(started.length,1);assert.equal(db.runs[i.run].kind,'proof')});

test('MODEL-4: past the day\'s spending limit no new fix run starts, except for urgent agents; the next day it starts again',async()=>{
 const {fx,DATA,started,step}=await mk({fixer:{maxCostPerDay:3,urgentAgents:['u']}});
 await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db(),i=db.items[0];db.runs.r1=run('r1','other',{cost:3.2});
 await fx.tick();assert.equal(started.length,0,'the day is over its limit');assert.equal(i.state,'queued');
 await fx.file({agent:'u',missing:'Urgent agent outage somewhere',evidence:'e'});await fx.tick();assert.equal(started.length,1);assert.equal(started[0].dir.includes((db.items.find(x=>x.agent==='u')).id),true,'the urgent one ran');
 const f=await fx.fixerView();assert.equal(f.cap.costLimit,3);assert.equal(f.cap.cost,3.2);
 await done(DATA,db.items.find(x=>x.agent==='u').run,'RESULT: {"status":"no_change","summary":"s"}');await fx.tick();await fx.tick();
 assert.match(await readFile(path.join(started[1].dir,'prompt.txt'),'utf8'),/proof run/,'the urgent fix ends and its proof run goes on although the day is over its limit');
 assert.ok(!started.some(x=>x.dir.includes(i.id)),'still held');
 step(25*3600e3);await done(DATA,db.items.find(x=>x.agent==='u').run,'RESULT: {"status":"proven","proof":"ok"}');await fx.tick();await fx.tick();assert.ok(started.some(x=>x.dir.includes(i.id)),'a new day: the held one starts')});

test('the issues list carries what each issue cost and how many runs',async()=>{
 const {fx}=await mk();await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db(),i=db.items[0];
 db.runs.r1=run('r1',i.id,{cost:1.234});db.runs.r2=run('r2',i.id,{cost:0.5,notStarted:true});const l=await fx.list();assert.deepEqual(l.items.find(x=>x.id===i.id).spent,{runs:1,cost:1.23})});

test('MODEL-3b: an issue waiting for a person is run again only when its evidence changed, not because it was reported again',async()=>{
 const {fx,started}=await mk();const o={agent:'a',missing:'Gilang QRIS images did not arrive',evidence:'2026-11-12 03:01 send failed for 628111 after 3 tries'};
 await fx.file(o);const db=await fx._db(),i=db.items[0];i.state='needs_human';i.need='sign in';
 const r=await fx.file({...o,evidence:'2026-11-12 09:55 send failed for 628222 after 7 tries'});assert.equal(r.held,'same evidence');assert.equal(i.state,'needs_human');assert.equal(i.heldSame,1);assert.equal(i.count,3-1);
 await fx.tick();assert.equal(started.length,0);
 const r2=await fx.file({...o,evidence:'2026-11-12 10:00 send failed: HTTP 403 forbidden from provider'});assert.ok(!r2.held);assert.equal(i.state,'queued','new words: tried again');assert.equal(i.tries,0);
 await fx.tick();assert.equal(started.length,1)});

test('MODEL-3b: a stuck issue reported again with the same evidence gets no new issue and no new run; changed evidence does',async()=>{
 const {fx,started,step}=await mk();const o={agent:'a',missing:'Delegation fails during provider cooldown',evidence:'run 41 at 02:10: delegate() raised Cooldown after 2 retries'};
 await fx.file(o);const db=await fx._db(),i=db.items[0];i.state='stuck';i.tries=3;i.updated=T;
 step(3600e3);const r=await fx.file({...o,evidence:'run 52 at 05:44: delegate() raised Cooldown after 4 retries'});
 assert.equal(r.held,'same evidence');assert.equal(db.items.length,1,'no second issue');assert.equal(i.count,2);assert.equal(i.heldSame,1);assert.equal(i.updated,T,'the stuck clock (deploy rechecks) is not moved');
 await fx.tick();assert.equal(started.length,0);
 const r2=await fx.file({...o,evidence:'delegate() now raises a TypeError in the router'});assert.ok(!r2.held);assert.equal(db.items.length,2);assert.equal(r2.issue.state,'queued');
 // after the window the same evidence is a fresh problem
 const o2={agent:'b',missing:'Another stuck thing here',evidence:'same words'};await fx.file(o2);const j=db.items.find(x=>x.agent==='b');j.state='stuck';j.updated=T;step(80*3600e3);
 const r3=await fx.file(o2);assert.ok(!r3.held);assert.equal(db.items.filter(x=>x.agent==='b').length,2)});

test('MODEL-3b: the same problem coming back after a proven fix, with the same evidence, spends no run: it waits for a person with a note; changed evidence runs',async()=>{
 const {fx,started,step}=await mk();const o={agent:'a',missing:'Tester webhook accepted but no reply',evidence:'kirimdev ours empty at 09:12; reply count 0'};
 await fx.file(o);const db=await fx._db(),old=db.items[0];old.state='fixed';old.fixed=T;old.updated=T;
 step(5*3600e3);const r=await fx.file({...o,evidence:'kirimdev ours empty at 14:40; reply count 0'});
 assert.equal(r.issue.state,'needs_human');assert.equal(r.issue.cameBack.of,old.id);assert.match(r.issue.need,/came back after it was fixed/);assert.equal(db.items.length,2);
 await fx.tick();assert.equal(started.length,0);
 const again=await fx.file({...o,evidence:'kirimdev ours empty at 15:40; reply count 0'});assert.equal(again.held,'same evidence','a third report counts on the held one');assert.equal(db.items.length,2);
 const fresh=await fx.file({agent:'a',missing:'Tester webhook accepted but no reply',evidence:'now a 500 from the webhook route'});assert.ok(!fresh.held,'new evidence on a held one is a normal filing');assert.equal(fresh.issue.state,'queued');
 // changed evidence on a fixed one: a normal new issue
 const {fx:f2,started:s2,step:st2}=await mk();await f2.file(o);const d2=await f2._db();d2.items[0].state='fixed';d2.items[0].fixed=T;st2(3600e3);
 const n=await f2.file({...o,evidence:'a completely different symptom: socket hang up'});assert.equal(n.issue.state,'queued');await f2.tick();assert.equal(s2.length,1);
 // outside the window
 const {fx:f3,step:st3}=await mk();await f3.file(o);const d3=await f3._db();d3.items[0].state='fixed';d3.items[0].fixed=T;st3(100*3600e3);
 assert.equal((await f3.file(o)).issue.state,'queued')});

test('GIT: the checkout\'s own files stay for the commit (the run lists them with backups; they were put back before, "no code change in the checkout")',async()=>{
 // the engine reports paths that start with a slash: on Windows the checkout is made at the drive root so they still do
 const seen={},dirs={},base=process.platform==='win32'?'/fcg-'+Math.random().toString(36).slice(2):await mkdtemp(path.join(tmpdir(),'fcg-'));
 const git={prepare:async id=>{const dir=base+'/'+id;await mkdir(dir+'/app',{recursive:true});dirs[id]=dir;return {ok:true,dir,branch:'fix/'+id,base:'x'}},
  dirty:async()=>true,hasToken:async()=>false,publish:async()=>({state:'waiting'}),diff:async()=>'',mergedPr:async()=>null,
  finish:async id=>{seen.content=await readFile(dirs[id]+'/app/x.mjs','utf8').catch(()=>null);return {ok:true,sha:'abc',files:['app/x.mjs']}}};
 const {fx,DATA}=await mk({git,answer:async a=>{const dir=Object.values(dirs).at(-1),f=dir+'/app/x.mjs';await writeFile(f+'.bak','old\n');await writeFile(f,'fixed\n');
   return {status:'patch',apply:'none',changes:[{file:f,backup:f+'.bak'}],patches:[],summary:'changed app/x.mjs',proof:'tests pass',check:'c'}}});
 await fx.file({agent:'a',missing:'A bug in the app code somewhere',evidence:'e'});const db=await fx._db(),i=db.items[0];i.sorted='code';
 try{await fx.tick();await fx.tick();assert.equal(seen.content,'fixed\n','the fix is still in the checkout when it is committed');assert.equal(i.state,'deploy');assert.equal(i.git.branch,'fix/'+i.id);
 assert.doesNotMatch(i.history.at(-1).outcome,/no code change/)}finally{await rm(base,{recursive:true,force:true})}});

test('the usage of a run: tokens, cost, and the number of model calls and tool calls when the engine records them',async()=>{
 const {usageFromRow,RUN_USAGE_PY}=await import('../app/fixer-usage.mjs');
 assert.deepEqual(usageFromRow(['claude-sonnet-5-5',400,3200,250000,150000,0.6631234,12,11]),{model:'claude-sonnet-5-5',input:400,output:3200,cacheRead:250000,cacheWrite:150000,cost:0.66312,calls:12,tools:11});
 assert.deepEqual(usageFromRow(['m',1,2,3,4,0.5]),{model:'m',input:1,output:2,cacheRead:3,cacheWrite:4,cost:0.5,calls:0,tools:0},'an older engine database has no turn counts');
 assert.equal(usageFromRow(null),null);assert.match(RUN_USAGE_PY,/except sqlite3\.Error/)});
