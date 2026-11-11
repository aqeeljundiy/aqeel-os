// Tests for app/rule-conflicts.mjs. Run: node --test scripts/rule-conflicts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {claimsIn,cadenceMin,scan,rewritePrompt,slowerCron,createConflicts} from '../app/rule-conflicts.mjs';
import {personNeed,memberCan,forPopup} from '../app/bottlenecks.mjs';
import {CONFLICT_RULE_LINES} from '../app/agent-access.mjs';

const PROMPT='You are Continue Threads Manager. Skip only if a thread went out in the last 45 minutes (check the profile). Threads do not count toward the 20-singles cap (max 8/day).\n\n1) PICK type.';
const THREADS={id:'738e7a2cea4f',name:'Threads own-post thread runner',enabled:true,state:'scheduled',prompt:PROMPT,schedule:{kind:'cron',expr:'5,35 * * * *',display:'5,35 * * * *'},script:'aqeelos-gate-738e7a2cea4f.sh'};
const RULES={'continue-threads':{on:true,gapMin:8,perHour:6,perDay:58}};

async function make({jobs=[THREADS],limits=RULES}={}){const root=await mkdtemp(path.join(tmpdir(),'conf-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data');
 const h=path.join(H,'profiles','continue-threads');await mkdir(path.join(h,'cron'),{recursive:true});await mkdir(DATA,{recursive:true});
 await writeFile(path.join(h,'cron','jobs.json'),JSON.stringify({jobs,updated_at:'x'},null,2));await writeFile(path.join(DATA,'posting-limits.json'),JSON.stringify({agents:limits}));
 const set=[],locks=[];const C=createConflicts({DATA,HERMES_HOME:H,lock:async(f,fn)=>{locks.push(f);return fn()},setRules:async(a,r)=>{set.push([a,r]);const f=path.join(DATA,'posting-limits.json'),d=JSON.parse(await readFile(f,'utf8'));Object.assign(d.agents[a],r);await writeFile(f,JSON.stringify(d))},now:()=>Date.parse('2026-11-11T10:00:00Z'),log:()=>{}});
 const jobs2=async()=>JSON.parse(await readFile(path.join(h,'cron','jobs.json'),'utf8')).jobs;
 return {C,H,h,DATA,set,locks,jobs2}}

test('what a prompt says about timing and limits, and how a schedule repeats',()=>{
 const c=claimsIn(PROMPT);assert.deepEqual(c.map(x=>[x.topic,x.value]),[['gap',45],['perDay',8]]);
 assert.equal(claimsIn('wait at least 2 hours between posts')[0].value,120);assert.deepEqual(claimsIn('write a poem'),[]);
 assert.equal(cadenceMin({kind:'cron',expr:'5,35 * * * *'}),30);assert.equal(cadenceMin({kind:'cron',expr:'*/10 * * * *'}),10);assert.equal(cadenceMin({kind:'cron',expr:'0 9 * * 1'}),null);assert.equal(cadenceMin({kind:'interval',minutes:15}),15)});

test('three sides: the schedule, the prompt and Run rules disagree on the gap; the per-day limit is its own two-sided question',()=>{
 const r=scan({agents:[{agent:'continue-threads',jobs:[THREADS]}],limits:RULES});assert.equal(r.length,2);
 const gap=r.find(x=>x.topic==='gap'),day=r.find(x=>x.topic==='perDay');
 assert.equal(gap.sides.length,3);assert.deepEqual(gap.sides.map(s=>s.value),[8,30,45]);assert.deepEqual(gap.strict,{gapMin:45},'the longest gap is the strictest');
 assert.deepEqual(gap.sides.map(s=>s.sources[0].kind),['rules','schedule','prompt']);assert.match(gap.sides[2].text,/Threads own-post thread runner/);
 assert.equal(day.sides.length,2);assert.deepEqual(day.strict,{perDay:8},'the smaller number of posts is the strictest');
 assert.equal(r.map(x=>x.cid).length,new Set(r.map(x=>x.cid)).size)});

test('two sides: a prompt against Run rules with no schedule claim; nothing when they agree or Run rules are off',()=>{
 const j={...THREADS,schedule:{kind:'cron',expr:'0 9 * * 1'},prompt:'Do not post more than max 5/day.'};
 const r=scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:RULES});assert.equal(r.length,1);assert.equal(r[0].sides.length,2);assert.equal(r[0].topic,'perDay');
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[{...j,prompt:'max 58/day'}]}],limits:RULES}).length,0);
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:{'continue-threads':{...RULES['continue-threads'],on:false}}}).length,0);
 assert.equal(scan({agents:[{agent:'x',jobs:[{...j,enabled:false}]}],limits:{}}).length,0)});

test('applying a choice sets one number everywhere and removes the losers (Run rules, prompt, a slower schedule)',async()=>{
 const {C,set,h,jobs2,locks}=await make({jobs:[{...THREADS,schedule:{kind:'cron',expr:'5,35 * * * *'}}]});
 assert.equal(await C.sync(),2);const open=await C.open();assert.equal(open.length,2);const gap=open.find(x=>x.topic==='gap');
 assert.equal(gap.kind,'conflict');assert.equal(gap.sides.length,3);assert.match(gap.text,/strictest/);assert.deepEqual(await C.strict('continue-threads'),{gapMin:45,perDay:8});
 const b=gap.sides.find(s=>s.value===30);const r=await C.decide(gap.cid,{choice:b.key},'owner');
 assert.equal(r.state,'answered');assert.deepEqual(set,[['continue-threads',{gapMin:30}]]);
 const j=(await jobs2())[0];assert.match(j.prompt,/last 30 minutes/);assert.doesNotMatch(j.prompt,/45 minutes/);assert.match(j.prompt,/max 8\/day/,'the other topic is left alone');assert.equal(j.schedule.expr,'5,35 * * * *','30 minutes already tiles the hour');
 assert.ok(locks[0].endsWith(path.join('cron','.jobs.lock')),'edited under the engine\'s lock');assert.ok((await readdir(path.join(h,'cron'))).some(f=>/^jobs\.json\.bak-\d{8}-conflict$/.test(f)),'a backup first');
 // the day question: Something else with a number
 const day=(await C.open()).find(x=>x.topic==='perDay');await C.decide(day.cid,{choice:'other',value:20},'owner');
 assert.deepEqual(set.at(-1),['continue-threads',{perDay:20}]);assert.match((await jobs2())[0].prompt,/max 20\/day/);
 // nothing is left to ask: the same facts do not come back
 assert.equal((await C.open()).length,0);assert.equal(await C.sync(),0);assert.equal((await C.list()).filter(x=>x.state==='open').length,0)});

test('a longer gap slows a schedule that tiles the hour; a faster one never speeds it up',()=>{
 assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},60),'5 * * * *');assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},45),null);assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},10),null);
 assert.equal(slowerCron({kind:'cron',expr:'*/10 * * * *'},30),'0,30 * * * *');
 assert.equal(rewritePrompt(PROMPT,'gap',120).includes('last 120 minutes'),true);assert.equal(rewritePrompt('skip for 1 hour',  'gap',120),'skip for 2 hour')});

test('the run gate counts the strictest side while a conflict is open (never more posts than any side allows)',async()=>{
 const {createRunGates}=await import('../app/run-gates.mjs');const {C,H,DATA}=await make();await C.sync();
 const G=createRunGates({strict:a=>C.strict(a),HERMES_HOME:H,DATA,WORK:path.join(DATA,'w'),PORT:1,sig:()=>'s',live:false,now:()=>Date.parse('2026-11-11T10:00:00Z'),log:()=>{}});
 await mkdir(path.join(DATA,'posting-log'),{recursive:true});await writeFile(path.join(DATA,'posting-log','continue-threads.json'),JSON.stringify([{at:Date.parse('2026-11-11T10:00:00Z')-20*60e3,status:'visible'}]));
 await writeFile(path.join(H,'profiles','continue-threads','cron','jobs.json'),JSON.stringify({jobs:[{...THREADS,script:'aqeelos-posting-gate.sh'}]}));
 const out=await G.check('continue-threads',THREADS.id);assert.match(out,/wakeAgent": false/,'20 minutes since the last post is under the strictest 45');assert.match(out,/at least 45 min/)});

test('an agent files a conflict with any number of sides; the same topic merges; the answer goes back to the agent once',async()=>{
 const {C}=await make();
 await assert.rejects(C.file('continue-threads',{topic:'tone',sides:[{what:'formal'}]}),/at least two sides/);
 const a=await C.file('continue-threads',{topic:'Reply tone',sides:[{what:'Be formal',where:'instructions',when:'3 Nov'},{what:'Be casual',where:'decisions file',when:'9 Nov'}]});
 const b=await C.file('continue-threads',{topic:'reply tone',sides:[{what:'Be casual',where:'x'},{what:'Use emojis',where:'Rina in chat',when:'today'}]});
 assert.equal(a.cid,b.cid);assert.equal(b.sides.length,3,'one question, three sides');
 const items=await C.open();assert.equal(items.length,1);assert.equal(items[0].sides.length,3);assert.match(items[0].sides[0].text,/instructions, 3 Nov/);
 await assert.rejects(C.decide(a.cid,{choice:'zz'},'owner'),/Pick one/);await assert.rejects(C.decide(a.cid,{choice:'other'},'owner'),/Say what/);
 await C.decide(a.cid,{choice:'b'},'owner');assert.equal((await C.open()).length,0);
 const lines=await C.contextLines('continue-threads');assert.match(lines.join('\n'),/Be casual/);assert.match(lines.join('\n'),/conflict_done/);assert.deepEqual(await C.contextLines('other'),[]);
 await C.ack('continue-threads',a.cid);assert.deepEqual(await C.contextLines('continue-threads'),[],'said once');
 await assert.rejects(C.decide(a.cid,{choice:'a'},'owner'),/already answered/)});

test('people who disagree go to the owner only; the popup shows a conflict with its sides, and the rule is in every turn',async()=>{
 const {C}=await make();await C.file('continue-threads',{topic:'Posting hours',people:true,sides:[{what:'Post at night',where:'Rina'},{what:'Never at night',where:'Dewi'}]});
 await C.file('continue-threads',{topic:'Greeting',sides:[{what:'Hi',where:'a'},{what:'Hello',where:'b'}]});
 assert.equal((await C.open(()=>true,true)).length,2);const m=await C.open(()=>true,false);assert.equal(m.length,1);assert.equal(m[0].topic,'Greeting');
 const it=(await C.open())[0];assert.match(personNeed(it),/strictest/);assert.equal(memberCan(it),true);assert.equal(forPopup([it]).length,1);
 const t=CONFLICT_RULE_LINES.join(' ');for(const w of ['strictest','file_conflict','every side','something else','conflict_done'])assert.match(t,new RegExp(w));assert.ok(t.length<1700,'short: it is added to every turn')});
