// Tests for app/rule-conflicts.mjs. Run: node --test scripts/rule-conflicts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {claimsIn,cadenceMin,ruleSubject,scan,rewritePrompt,slowerCron,createConflicts} from '../app/rule-conflicts.mjs';
import {personNeed,memberCan,forPopup} from '../app/bottlenecks.mjs';
import {CONFLICT_RULE_LINES} from '../app/agent-access.mjs';

const PROMPT='You are Continue Threads Manager. Skip only if a thread went out in the last 45 minutes (check the profile). Threads do not count toward the 20-singles cap (max 8/day).\n\n1) PICK type.';
const THREADS={id:'738e7a2cea4f',name:'Threads own-post thread runner',enabled:true,state:'scheduled',prompt:PROMPT,schedule:{kind:'cron',expr:'5,35 * * * *',display:'5,35 * * * *'},script:'aqeelos-gate-738e7a2cea4f.sh'};
const RULES={'continue-threads':{on:true,gapMin:8,perHour:6,perDay:58,stopFile:'.tools/STOP_COMMENTS',checkUrl:'https://www.threads.com/@x/replies'}};
const CPROMPT='JOB: post comments (and comment-first DM pairings) until this hour has 5 comments, max 5/h, 8+ min apart, 70/day. Never end with 0.\nSTEP 2: search product threads.';
const COMMENTS={id:'198bc372ee48',name:'Threads comment + DM runner (5 comments/h, 3 DMs/h)',enabled:true,state:'scheduled',prompt:CPROMPT,schedule:{kind:'cron',expr:'*/10 * * * *',display:'*/10 * * * *'}};

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

test('threads, comments and DMs are never mixed: only same-subject numbers meet, Run rules belong to comments',()=>{
 const r=scan({agents:[{agent:'continue-threads',jobs:[THREADS,COMMENTS]}],limits:RULES});
 const by=Object.fromEntries(r.map(x=>[x.subject+'|'+x.topic,x]));assert.deepEqual(Object.keys(by).sort(),['comment|perDay','comment|perHour','thread|gap']);
 assert.deepEqual(by['comment|perHour'].sides.map(s=>s.value),[5,6]);assert.deepEqual(by['comment|perHour'].strict,{perHour:5});assert.equal(by['comment|perHour'].gates,true);
 assert.deepEqual(by['comment|perDay'].sides.map(s=>s.value),[58,70]);assert.deepEqual(by['comment|perDay'].strict,{perDay:58});
 const g=by['thread|gap'];assert.deepEqual(g.sides.map(s=>s.value),[30,45],'its own schedule against its own prompt');assert.deepEqual(g.sides.map(s=>s.sources[0].kind),['schedule','prompt']);assert.equal(g.gates,false,'no Run rules about threads');
 assert.equal(r.length,3,'no 8/day thread claim against the comment limits, no 10 minute cadence of another schedule');assert.equal(new Set(r.map(x=>x.cid)).size,3)});

test('what a number is about, and what Run rules govern',()=>{
 assert.deepEqual(claimsIn(PROMPT).map(x=>[x.topic,x.subject]),[['gap','thread'],['perDay','thread']]);
 assert.deepEqual(claimsIn(CPROMPT).map(x=>[x.topic,x.value,x.subject]).sort(),[['perDay',70,'comment'],['perHour',5,'comment'],['perHour',5,'comment']]);
 assert.equal(claimsIn('Reply within max 3 DMs/h').find(x=>x.topic==='perHour').subject,'dm');assert.equal(claimsIn('Never more than 9/day.')[0].subject,null);
 assert.equal(ruleSubject(RULES['continue-threads']),'comment');assert.equal(ruleSubject({on:true}),null);assert.equal(ruleSubject({on:true,stopFile:'.tools/STOP_COMMENTS',subject:'thread'}),'thread')});

test('a claim of unknown subject is compared with nothing; it is only a note; unknown Run rules join nothing',()=>{
 const j={...THREADS,schedule:{kind:'cron',expr:'0 9 * * 1'},prompt:'Do not post more than max 5/day. Skip if a thread went out in the last 20 minutes.'};
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:RULES}).length,0,'a thread gap alone, an unknown per day against comment rules');
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[{...COMMENTS,prompt:'max 6 comments/h.'}]}],limits:RULES}).length,0,'the same number is no conflict');
 const n=scan({agents:[{agent:'continue-threads',jobs:[{...COMMENTS,prompt:'max 3 comments/h. Also never go over max 9/h.'}]}],limits:RULES});assert.equal(n.length,1);assert.equal(n[0].notes.length,1);assert.match(n[0].notes[0],/"9"/);assert.deepEqual(n[0].sides.map(s=>s.value),[3,6]);
 assert.equal(scan({agents:[{agent:'x',jobs:[COMMENTS]}],limits:{x:{on:true,perHour:6}}}).length,0,'Run rules whose subject is unknown are compared with nothing')});

test('a genuine three-sided case: same subject, prompt, schedule and Run rules (explicit subject) on the gap',()=>{
 const j={...THREADS,prompt:'Skip only if a thread went out in the last 45 minutes.'};
 const r=scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:{'continue-threads':{on:true,gapMin:8,subject:'thread'}}});assert.equal(r.length,1);
 assert.deepEqual(r[0].sides.map(s=>s.value),[8,30,45]);assert.deepEqual(r[0].strict,{gapMin:45});assert.deepEqual(r[0].sides.map(s=>s.sources[0].kind),['rules','schedule','prompt']);assert.equal(r[0].gates,true)});

test('two sides: a prompt against Run rules with no schedule claim; nothing when they agree or Run rules are off',()=>{
 const j={...COMMENTS,schedule:{kind:'cron',expr:'0 9 * * 1'},prompt:'Do not post more than max 5 comments/day.'};
 const r=scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:RULES});assert.equal(r.length,1);assert.equal(r[0].sides.length,2);assert.equal(r[0].topic,'perDay');
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[{...j,prompt:'max 58 comments/day'}]}],limits:RULES}).length,0);
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[{...j,prompt:'max 5 threads/day'}]}],limits:RULES}).length,0,'threads against comment limits is no conflict');
 assert.equal(scan({agents:[{agent:'continue-threads',jobs:[j]}],limits:{'continue-threads':{...RULES['continue-threads'],on:false}}}).length,0);
 assert.equal(scan({agents:[{agent:'x',jobs:[{...j,enabled:false}]}],limits:{}}).length,0)});

test('applying a choice sets one number everywhere and removes the losers (Run rules, prompt, a slower schedule)',async()=>{
 const {C,set,h,jobs2,locks}=await make({jobs:[THREADS,COMMENTS]});
 assert.equal(await C.sync(),3);const open=await C.open();assert.equal(open.length,3);const gap=open.find(x=>x.topic==='gap');
 assert.equal(gap.kind,'conflict');assert.equal(gap.sides.length,2);assert.match(gap.text,/nothing is held back/);assert.deepEqual(await C.strict('continue-threads'),{perDay:58,perHour:5},'only comment numbers reach the gate, the threads 45 minutes never');
 // the threads gap: its prompt and its own schedule; the Run rules (comments) are not touched
 const b=gap.sides.find(s=>s.value===30);const r=await C.decide(gap.cid,{choice:b.key},'owner');
 assert.equal(r.state,'answered');assert.deepEqual(set,[],'Run rules are about comments, not threads');
 const js=await jobs2(),j=js.find(x=>x.id===THREADS.id),cj=js.find(x=>x.id===COMMENTS.id);assert.match(j.prompt,/last 30 minutes/);assert.doesNotMatch(j.prompt,/45 minutes/);assert.match(j.prompt,/max 8\/day/,'the other topic is left alone');assert.equal(j.schedule.expr,'5,35 * * * *','30 minutes already tiles the hour');
 assert.equal(cj.prompt,CPROMPT,'the comments schedule is untouched');
 assert.ok(locks[0].endsWith(path.join('cron','.jobs.lock')),'edited under the engine\'s lock');assert.ok((await readdir(path.join(h,'cron'))).some(f=>/^jobs\.json\.bak-\d{8}-conflict$/.test(f)),'a backup first');
 // the comments a day question: Something else with a number rewrites Run rules and the comments prompt, never the threads one
 const day=(await C.open()).find(x=>x.topic==='perDay');await C.decide(day.cid,{choice:'other',value:20},'owner');
 assert.deepEqual(set.at(-1),['continue-threads',{perDay:20}]);const after=await jobs2();assert.match(after.find(x=>x.id===COMMENTS.id).prompt,/20\/day/);assert.match(after.find(x=>x.id===THREADS.id).prompt,/max 8\/day/,'threads keep their own number');
 // the hour question
 const hr=(await C.open()).find(x=>x.topic==='perHour');await C.decide(hr.cid,{choice:hr.sides[0].key},'owner');assert.deepEqual(set.at(-1),['continue-threads',{perHour:5}]);
 // nothing is left to ask: the same facts do not come back
 assert.equal((await C.open()).length,0);assert.equal(await C.sync(),0);assert.equal((await C.list()).filter(x=>x.state==='open').length,0)});

test('on sync an open scan conflict that the logic no longer produces is closed, and its throttle lifts',async()=>{
 const {C,DATA}=await make({jobs:[THREADS,COMMENTS]});await C.sync();
 const old={cid:'cold1',source:'scan',agent:'continue-threads',topic:'gap',title:'old',question:'q',sides:[],strict:{gapMin:45},strictText:'',jobs:[],state:'open',created:1,gates:true};
 const f=path.join(DATA,'conflicts.json'),d=JSON.parse(await readFile(f,'utf8'));d.items.push(old,{...old,cid:'cold2',strict:{perDay:8},topic:'perDay',gates:undefined});await writeFile(f,JSON.stringify(d));
 const C2=createConflicts({DATA,HERMES_HOME:path.join(path.dirname(DATA),'hermes'),now:()=>Date.parse('2026-11-11T10:00:00Z'),log:()=>{}});
 assert.deepEqual(await C2.strict('continue-threads'),{gapMin:45,perDay:58,perHour:5},'before the sync the old wrong one still throttles');
 await C2.sync();const items=await C2.list();assert.equal(items.filter(x=>x.state==='open'&&/^cold/.test(x.cid)).length,0);assert.equal(items.some(x=>x.cid==="cold1"||x.cid==="cold2"),false,"closed and dropped");
 assert.deepEqual(await C2.strict('continue-threads'),{perDay:58,perHour:5})});

test('a longer gap slows a schedule that tiles the hour; a faster one never speeds it up',()=>{
 assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},60),'5 * * * *');assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},45),null);assert.equal(slowerCron({kind:'cron',expr:'5,35 * * * *'},10),null);
 assert.equal(slowerCron({kind:'cron',expr:'*/10 * * * *'},30),'0,30 * * * *');
 assert.equal(rewritePrompt(PROMPT,'gap',120).includes('last 120 minutes'),true);assert.equal(rewritePrompt('skip for 1 hour',  'gap',120),'skip for 2 hour')});

test('the run gate counts the strictest side while a conflict is open (never more posts than any side allows)',async()=>{
 const {createRunGates}=await import('../app/run-gates.mjs');const {C,H,DATA}=await make({jobs:[THREADS,COMMENTS]});await C.sync();
 const G=createRunGates({strict:a=>C.strict(a),HERMES_HOME:H,DATA,WORK:path.join(DATA,'w'),PORT:1,sig:()=>'s',live:false,now:()=>Date.parse('2026-11-11T10:00:00Z'),log:()=>{}});
 await mkdir(path.join(DATA,'posting-log'),{recursive:true});await writeFile(path.join(DATA,'posting-log','continue-threads.json'),JSON.stringify([{at:Date.parse('2026-11-11T10:00:00Z')-20*60e3,status:'visible'}]));
 await writeFile(path.join(H,'profiles','continue-threads','cron','jobs.json'),JSON.stringify({jobs:[{...THREADS,script:'aqeelos-posting-gate.sh'}]}));
 const out=await G.check('continue-threads',THREADS.id);assert.doesNotMatch(out,/wakeAgent": false/,'20 minutes since the last comment is fine: the threads 45 minutes never applies to comments');
 const t0=Date.parse('2026-11-11T10:00:00Z');await writeFile(path.join(DATA,'posting-log','continue-threads.json'),JSON.stringify([2,13,24,35,46].map(m=>({at:t0-m*60e3,status:'visible'}))));
 const out2=await G.check('continue-threads',THREADS.id);assert.match(out2,/wakeAgent": false/);assert.match(out2,/limit is 5/,'the comments 5 an hour of the prompt is the strictest side')});

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

test('"until this hour has 5 comments" is the hour\'s number too: the conflict is found, and the answer is written into every place (12 Nov, Continue Threads comment runner)',async()=>{
 const REAL='You are Continue Threads Manager. JOB: post comments (and comment-first DM pairings) until this hour has 5 comments, max 6/h, 8+ min apart, 70/day. Never end with 0.';
 assert.deepEqual(claimsIn(REAL).filter(c=>c.topic==='perHour').map(c=>[c.value,c.subject,c.text]),[[5,'comment','5'],[6,'comment','6']]);
 assert.deepEqual(claimsIn('keep going till the hour reaches 4 posts').map(c=>[c.topic,c.value]),[['perHour',4]]);assert.deepEqual(claimsIn('wait until this hour is over'),[]);
 const job={...COMMENTS,prompt:REAL};
 const found=scan({agents:[{agent:'continue-threads',jobs:[job]}],limits:{'continue-threads':{...RULES['continue-threads'],perHour:6,perDay:70}}});
 const c=found.find(x=>x.topic==='perHour');assert.ok(c,'5 against 6 is a conflict');assert.deepEqual(c.sides.map(s=>s.value),[5,6]);assert.equal(c.gates,true);
 const fixed=rewritePrompt(REAL,'perHour',6,'comment');assert.match(fixed,/until this hour has 6 comments, max 6\/h, 8\+ min apart, 70\/day/);
 assert.deepEqual(scan({agents:[{agent:'continue-threads',jobs:[{...job,prompt:fixed}]}],limits:{'continue-threads':{...RULES['continue-threads'],perHour:6,perDay:70}}}),[],'nothing left to ask after the rewrite');
 // through the apply path: Run rules and the prompt, with a backup, under the jobs lock
 const {C,jobs2,locks}=await make({jobs:[job],limits:{'continue-threads':{...RULES['continue-threads'],perHour:6,perDay:70}}});
 await C.sync();const item=(await C.list()).find(x=>x.topic==='perHour');await C.decide(item.cid,{choice:item.sides.find(s=>s.value===6).key},'owner');
 assert.match((await jobs2())[0].prompt,/has 6 comments, max 6\/h/);assert.equal(locks.length,1);assert.equal(await C.sync(),0)});
