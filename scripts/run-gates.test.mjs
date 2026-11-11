// Tests for app/run-gates.mjs. Run: node --test scripts/run-gates.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {holdIn,backoffUntil,runsPerHour,sendLimit,proposalFor,nextHourly,gateBody,createRunGates,GATE_PREFIX} from '../app/run-gates.mjs';

const T=Date.parse('2026-11-11T15:00:00Z');
const sched=expr=>({kind:'cron',expr,display:expr});
const job=(id,name,o={})=>({id,name,prompt:'x',script:null,no_agent:false,enabled:true,state:'scheduled',schedule:sched('*/10 * * * *'),next_run_at:'2026-11-11T22:10:00.000000+07:00',...o});

async function make(jobsByAgent,{now=T,approved}={}){const root=await mkdtemp(path.join(tmpdir(),'gates-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data'),WORK=path.join(root,'work');
 for(const [a,jobs] of Object.entries(jobsByAgent)){const h=a==='default'?H:path.join(H,'profiles',a);await mkdir(path.join(h,'cron'),{recursive:true});await mkdir(path.join(h,'scripts'),{recursive:true});
  await writeFile(path.join(h,'cron','jobs.json'),JSON.stringify({jobs,updated_at:'x'},null,2))}
 const locks=[];const G=createRunGates({HERMES_HOME:H,DATA,WORK,PORT:4400,sig:a=>'sig-'+a,lock:async(f,fn)=>{locks.push(f);return fn()},now:()=>now,log:()=>{}});
 const jobsOf=async a=>JSON.parse(await readFile(path.join(a==='default'?H:path.join(H,'profiles',a),'cron','jobs.json'),'utf8')).jobs;
 const logTo=async(a,t)=>{const d=path.join(a==='default'?H:path.join(H,'profiles',a),'logs');await mkdir(d,{recursive:true});await writeFile(path.join(d,'agent.log'),t)};
 return {G,H,DATA,WORK,locks,jobsOf,logTo,root}}

test('the proxy hold is found in log text, the latest time wins',()=>{
 const t='x bili is holding outbound sends until 2026-11-11T15:08:03.389Z (~312s)\n y holding outbound sends until 2026-11-11T14:20:39.851Z (~9s)';
 assert.equal(holdIn(t),Date.parse('2026-11-11T15:08:03.389Z'));assert.equal(holdIn('nothing'),null)});

test('a backoff counts only while it is in the future and not absurdly far away',()=>{
 const j={last_failure:{detail:'holding outbound sends until 2026-11-11T15:08:03.389Z'}};
 assert.ok(backoffUntil({job:j,now:T}));assert.equal(backoffUntil({job:j,now:T+10*60e3}),null,'over');
 assert.equal(backoffUntil({job:{quota_hold_until:'2026-11-20T00:00:00Z'},now:T}),null,'more than 6 hours away is not believed');
 assert.ok(backoffUntil({job:{quota_hold_until:'2026-11-11T16:00:00+00:00'},now:T}),'the engine\'s own park marker');
 assert.ok(backoffUntil({job:{},logText:'holding outbound sends until 2026-11-11T15:30:00Z',now:T}),'a hold only the log knows')});

test('how often a schedule fires, read from the schedule alone',()=>{
 assert.equal(runsPerHour(sched('*/15 * * * *')),4);assert.equal(runsPerHour(sched('5-59/10 * * * *')),6);assert.equal(runsPerHour(sched('5,35 * * * *')),2);
 assert.equal(runsPerHour(sched('0 * * * *')),1);assert.equal(runsPerHour(sched('0 9 * * 1')),null,'a fixed hour is not an hourly rate');
 assert.equal(runsPerHour({kind:'interval',minutes:5}),12);assert.equal(runsPerHour({kind:'once'}),null)});

test('only an outbound DM schedule that runs more than hourly gets a proposal',()=>{
 const out=job('a','Threads outbound DM runner (3 DMs/h)',{schedule:sched('*/15 * * * *')});
 const p=proposalFor(out);assert.equal(p.to,'7 * * * *');assert.match(p.why,/3 an hour/);assert.match(p.why,/4 times an hour/);
 assert.equal(proposalFor(job('b','Threads comment + DM runner (5 comments/h, 3 DMs/h)')),null);
 assert.equal(proposalFor(job('c','Threads DM + reply answering runner')),null);
 assert.equal(proposalFor({...out,schedule:sched('0 * * * *')}),null,'already hourly');assert.deepEqual(sendLimit(out),{perHour:3,what:'dms'})});

test('the next hourly run is in the job\'s own zone',()=>{
 assert.equal(nextHourly(7,Date.parse('2026-11-11T15:00:00Z'),420),'2026-11-11T22:07:00.000000+07:00');
 assert.equal(nextHourly(7,Date.parse('2026-11-11T15:07:00Z'),420),'2026-11-11T23:07:00.000000+07:00');
 assert.equal(nextHourly(7,Date.parse('2026-11-11T15:00:00Z'),0),'2026-11-11T15:07:00.000000+00:00')});

test('the gate script asks aqeelOS, runs a job\'s own check, and chains an existing script',()=>{
 const plain=gateBody({port:4400,agent:'x',jobId:'j1',sig:'s'});assert.match(plain,/127\.0\.0\.1:4400\/run-gate\/x\/j1\/s/);assert.match(plain,/aqeelos-check-j1\.sh/);assert.doesNotMatch(plain,/exec bash/);
 assert.match(plain,/\{"wakeAgent": true\}/,'never an empty answer: the engine skips the AI on empty output');
 const chained=gateBody({port:4400,agent:'x',jobId:'j1',sig:'s',original:'aqeelos-posting-gate.sh'});assert.match(chained,/original=aqeelos-posting-gate\.sh/);assert.match(chained,/exec bash "\$D\/aqeelos-posting-gate\.sh"/)});

test('install: a gate for every schedule that starts the AI, none for scripts that are the whole job, hand-set scripts chained',async()=>{
 const {G,H,jobsOf,DATA}=await make({'continue-threads':[job('p1','plain'),job('p2','posting',{script:'aqeelos-posting-gate.sh'}),job('n1','no model',{no_agent:true,script:'x.sh'}),
  job('y1','python',{script:'digest.py'}),job('d1','disabled',{enabled:false,state:'paused'})]});
 assert.deepEqual(await G.install(),['continue-threads']);const j=await jobsOf('continue-threads'),by=Object.fromEntries(j.map(x=>[x.id,x]));
 assert.equal(by.p1.script,GATE_PREFIX+'p1.sh');assert.equal(by.p2.script,GATE_PREFIX+'p2.sh');assert.equal(by.n1.script,'x.sh');assert.equal(by.y1.script,'digest.py');assert.equal(by.d1.script,null);
 const wrap=await readFile(path.join(H,'profiles','continue-threads','scripts',GATE_PREFIX+'p2.sh'),'utf8');assert.match(wrap,/original=aqeelos-posting-gate\.sh/);
 assert.equal((await stat(path.join(H,'profiles','continue-threads','scripts',GATE_PREFIX+'p1.sh'))).mode&0o100,process.platform==='win32'?0:0o100);
 const baks=(await readdir(path.join(H,'profiles','continue-threads','cron'))).filter(f=>/^jobs\.json\.bak-\d{8}-gates$/.test(f));assert.equal(baks.length,1);
 assert.equal(JSON.parse(await readFile(path.join(H,'profiles','continue-threads','cron','jobs.json.bak-20261111-gates'),'utf8')).jobs[0].script,null,'the backup is the file as it was');
 const st=JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8'));assert.equal(st.jobs['continue-threads/y1'].unchained,'digest.py');assert.equal(st.jobs['continue-threads/p2'].original,'aqeelos-posting-gate.sh')});

test('install is idempotent: the second pass changes nothing and takes no second backup',async()=>{
 const {G,H,jobsOf,locks}=await make({sales:[job('p1','plain')]});assert.deepEqual(await G.install(),['sales']);const before=JSON.stringify(await jobsOf('sales')),n=locks.length;
 assert.deepEqual(await G.install(),[]);assert.equal(JSON.stringify(await jobsOf('sales')),before);assert.ok(locks.length>n,'the engine\'s job lock is taken');
 assert.equal((await readdir(path.join(H,'profiles','sales','cron'))).filter(f=>f.includes('-gates')).length,1)});

test('the off file puts the original scripts back',async()=>{
 const {G,H,jobsOf}=await make({sales:[job('p1','plain'),job('p2','posting',{script:'aqeelos-posting-gate.sh'})]});await G.install();
 await writeFile(path.join(H,'.aqeelos-run-gates-off'),'');assert.deepEqual(await G.install(),['sales']);
 const j=await jobsOf('sales');assert.equal(j[0].script,null);assert.equal(j[1].script,'aqeelos-posting-gate.sh');assert.equal((await G.view()).on,false)});

test('the owner\'s approved schedule change is made once, with the next run set; other proposals only recorded',async()=>{
 const t=Date.parse('2026-11-11T15:00:00Z');
 const {G,jobsOf,DATA}=await make({'continue-threads':[job('o1','Threads outbound DM runner (3 DMs/h)',{schedule:sched('*/15 * * * *')})],other:[job('o2','Shop outbound DM runner (2 DMs/h)',{schedule:sched('*/15 * * * *')})]},{now:t});
 await G.install();const o1=(await jobsOf('continue-threads'))[0];assert.equal(o1.schedule.expr,'7 * * * *');assert.equal(o1.schedule_display,'7 * * * *');assert.equal(o1.next_run_at,'2026-11-11T22:07:00.000000+07:00');
 assert.equal((await jobsOf('other'))[0].schedule.expr,'*/15 * * * *','not approved: unchanged');
 const v=await G.view();assert.deepEqual(v.proposals.map(p=>[p.agent,p.status]).sort(),[['continue-threads','applied'],['other','proposed']]);
 await G.install();assert.equal((await jobsOf('continue-threads'))[0].schedule.expr,'7 * * * *');
 assert.ok(JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8')).proposals['continue-threads/o1'].approvedBy==='owner')});

test('a hand-changed schedule that was already applied is not changed again',async()=>{
 const {G,H,jobsOf}=await make({'continue-threads':[job('o1','Threads outbound DM runner (3 DMs/h)',{schedule:sched('*/15 * * * *')})]});await G.install();
 const file=path.join(H,'profiles','continue-threads','cron','jobs.json');const d=JSON.parse(await readFile(file,'utf8'));d.jobs[0].schedule=sched('*/30 * * * *');await writeFile(file,JSON.stringify(d));
 await G.install();assert.equal((await jobsOf('continue-threads'))[0].schedule.expr,'*/30 * * * *')});

test('check: a pause asked for by the AI service skips the run and is counted in the shape the Efficiency view reads',async()=>{
 const {G,DATA,logTo}=await make({sales:[job('p1','plain')]},{now:T});await logTo('sales','... bili is holding outbound sends until 2026-11-11T15:08:03.389Z (~312s)');
 const a=await G.check('sales','p1');assert.equal(a.trim().split('\n').pop(),'{"wakeAgent": false}');assert.match(a,/9 min/);
 const st=JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8'));assert.equal(st.jobs['sales/p1'].skips,1);assert.equal(st.jobs['sales/p1'].runs,0);assert.equal(st.jobs['sales/p1'].by.backoff,1)});

test('check: no pause means go, counted as a run; a job we do not know also goes',async()=>{
 const {G,DATA}=await make({sales:[job('p1','plain')]},{now:T});
 assert.equal((await G.check('sales','p1')).trim().split('\n').pop(),'{"wakeAgent": true}');assert.equal((await G.check('sales','ghost')).trim().split('\n').pop(),'{"wakeAgent": true}');
 assert.equal(JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8')).jobs['sales/p1'].runs,1)});

test('check: a job\'s own check saying nothing to do is counted as a skip',async()=>{
 const {G}=await make({sales:[job('p1','plain')]},{now:T});const a=await G.check('sales','p1',{nothing:true});assert.equal(a.trim().split('\n').pop(),'{"wakeAgent": false}');assert.equal((await G.view()).jobs[0].skippedBy['nothing to do'],1)});

test('check: posting limits skip a posting schedule only, with the reason',async()=>{
 const {G,DATA,H,jobsOf}=await make({'continue-threads':[job('c1','comments',{script:'aqeelos-posting-gate.sh'}),job('o1','own posts')]},{now:T});await G.install();
 await mkdir(path.join(DATA,'posting-log'),{recursive:true});
 await writeFile(path.join(DATA,'posting-limits.json'),JSON.stringify({agents:{'continue-threads':{on:true,perHour:3,gapMin:10,perDay:20,tz:'UTC'}}}));
 await writeFile(path.join(DATA,'posting-log','continue-threads.json'),JSON.stringify([T-2*60e3,T-20*60e3,T-40*60e3].map(at=>({at,lead:'hot',status:'visible'}))));
 const a=await G.check('continue-threads','c1');assert.equal(a.trim().split('\n').pop(),'{"wakeAgent": false}');assert.match(a,/posting limits/);
 assert.equal((await G.check('continue-threads','o1')).trim().split('\n').pop(),'{"wakeAgent": true}','a schedule that is not a posting one is not held by them');
 assert.equal((await G.view()).jobs.find(j=>j.job==='c1').skippedBy['posting limits'],1);void H;void jobsOf});

test('a broken jobs.json or missing agent never throws',async()=>{
 const {G,H}=await make({sales:[job('p1','plain')]});await writeFile(path.join(H,'profiles','sales','cron','jobs.json'),'{not json');
 assert.deepEqual(await G.install(),[]);assert.match(await G.check('sales','p1'),/wakeAgent/)});
