// Tests for the limits that bind at the point of action (app/posting-limits.mjs guard + limits per kind, app/run-gates.mjs, scripts/posting-guard.py).
// Run: node --test scripts/posting-guard.test.mjs   (the Python helper is tested when python is found: $PYTHON, else python3 / python)
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {clean,ruleFor,decideKind,jobKinds,gateTextKinds,jobDecision,createPostingLimits,KINDS} from '../app/posting-limits.mjs';
import {createRunGates,gateBody} from '../app/run-gates.mjs';
import {postingAllowed} from '../app/run-checks.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
// Continue Threads' Run rules of 12 Nov 2026: comments 6 an hour, 70 a day, 8 minutes apart; own threads 60 minutes apart, 8 a day
const RULES={on:true,tz:'Asia/Jakarta',perDay:70,perHour:6,gapMin:8,perRun:2,quietFrom:0,quietTo:0,stopFile:'.tools/STOP_COMMENTS',checkUrl:'https://www.threads.com/@a/replies',
 subjects:{comment:{perDay:70,perHour:6,gapMin:8,perRun:2},thread:{perDay:8,perHour:1,gapMin:60,perRun:1},dm:{perDay:30,perHour:3,gapMin:10,perRun:1},reply:{perDay:80,perHour:20,gapMin:0,perRun:20}},
 jobs:{'7ab':['reply','comment']}};
const at=(hhmm,day='12')=>Date.parse('2026-11-'+day+'T'+hhmm+':00+07:00');

async function rig({rules=RULES,stop=false,pages=['continue.products\nhalo kak ini jawabannya lengkap banget']}={}){const dir=await mkdtemp(path.join(tmpdir(),'pg-'));const DATA=path.join(dir,'data'),WORK=path.join(dir,'ws'),HH=path.join(dir,'hermes');
 await mkdir(path.join(WORK,'ct','.tools'),{recursive:true});if(stop)await writeFile(path.join(WORK,'ct','.tools','STOP_COMMENTS'),'');
 let t=at('10:00');const events=[],solved=[];let n=0;
 const pl=createPostingLimits({DATA,WORK,HERMES_HOME:HH,PORT:4400,sig:a=>'sig-'+a,setKey:async()=>({ok:true}),readConfig:async()=>({}),pick:()=>null,
  look:async()=>pages[Math.min(n++,pages.length-1)],event:async(...x)=>events.push(x),solved:async(...x)=>solved.push(x),telegram:async()=>true,log:()=>{},now:()=>t,retryMs:0});
 await pl.set('ct',{rules});
 return {pl,dir,DATA,WORK,HH,events,solved,tick:ms=>{t+=ms},at:()=>t}}

test('limits per kind: each kind has its own numbers, inherits the rest, and a kind without a rule may not post',()=>{
 const r=clean(RULES);assert.deepEqual(Object.keys(r.subjects).sort(),['comment','dm','reply','thread']);
 assert.equal(ruleFor(r,'thread').gapMin,60);assert.equal(ruleFor(r,'thread').perDay,8);assert.equal(ruleFor(r,'thread').tz,'Asia/Jakarta','inherits what it does not set');
 assert.equal(ruleFor(clean({...RULES,subjects:{comment:{perHour:6}}}),'dm'),null);
 const d=decideKind(clean({...RULES,subjects:{comment:{perHour:6}}}),[],'dm',{now:at('10:00')});assert.equal(d.allow,false);assert.match(d.reason,/no Run rule for DMs/);
 assert.throws(()=>clean({subjects:{tweet:{perDay:1}}}),/Limits per kind/);assert.throws(()=>clean({jobs:{x:['nope']}}),/posts/);
 // the old single rule still governs everything
 const old=clean({on:true,perHour:2,perDay:5,gapMin:0});assert.equal(ruleFor(old,'dm').perHour,2);assert.equal(ruleFor(old,'dm').gapMin,0);
 assert.equal(clean({subjects:{comment:{perDay:9999}}}).subjects.comment.perDay,500)});

test('one kind does not use up another: threads and comments count apart',()=>{
 const r=clean(RULES);const l=[{at:at('09:55'),kind:'comment',status:'visible'}];
 assert.equal(decideKind(r,l,'comment',{now:at('10:00')}).allow,false,'5 min after a comment: 8 apart');assert.equal(decideKind(r,l,'thread',{now:at('10:00')}).allow,true);
 const t=[{at:at('09:30'),kind:'thread',status:'recorded'}];assert.match(decideKind(r,t,'thread',{now:at('10:00')}).reason,/posted in the last hour/);assert.equal(decideKind(r,t,'thread',{now:at('10:31')}).allow,true);
 const eight=Array.from({length:8},(_,i)=>({at:at('00:10')+i*61*60e3,kind:'thread',status:'recorded'}));assert.match(decideKind(r,eight,'thread',{now:at('19:00')}).reason,/Done for today: 8 of 8/);
 assert.equal(decideKind(r,[{at:at('09:55'),status:'visible'}],'comment',{now:at('10:00')}).allow,false,'an entry with no kind is a comment')});

test('the four runners of continue-threads: which kinds each one posts',()=>{
 const R=clean(RULES);const k=(id,name)=>jobKinds({id,name},R);
 assert.deepEqual(k('198bc372ee48','Threads comment + DM runner (6 comments/h, 3 DMs/h)'),['comment','dm']);
 assert.deepEqual(k('738e7a2cea4f','Threads own-post thread runner'),['thread']);
 assert.deepEqual(k('2ea603717676','Threads outbound DM runner (3 DMs/h)'),['dm']);
 assert.deepEqual(k('7ab01824ed01','Threads DM + reply answering runner'),['reply'],'by its name; the owner\'s list names the public replies too');
 assert.deepEqual(k('7ab','Threads DM + reply answering runner'),['reply','comment']);
 assert.deepEqual(k('zz','Weekly sales recap'),[])});

test('guard: a check is a ticket that counts at once; the second one inside the gap is refused; cancel gives the slot back',async()=>{
 const x=await rig();const a=await x.pl.guard('ct','comment');assert.equal(a.allow,true);assert.ok(a.ticket);
 const b=await x.pl.guard('ct','comment');assert.equal(b.allow,false);assert.match(b.reason,/0 min ago|at least 8 min|min ago/);
 assert.equal((await x.pl.guard('ct','thread')).allow,true,'another kind has its own count');
 assert.deepEqual(await x.pl.mark('ct',a.ticket,'cancel'),{ok:true,text:'Cancelled: it no longer counts.'});
 assert.equal((await x.pl.guard('ct','comment')).allow,true);
 assert.equal((await x.pl.guard('ct','tweet')).allow,false);assert.match((await x.pl.guard('ct','tweet')).reason,/Unknown kind/)});

test('guard: the pause file stops every kind; limits off or no rule for the kind refuse',async()=>{
 const x=await rig({stop:true});for(const k of KINDS){const g=await x.pl.guard('ct',k);assert.equal(g.allow,false,k);assert.match(g.reason,/Paused/)}
 const y=await rig({rules:{...RULES,on:false}});assert.equal((await y.pl.guard('ct','comment')).allow,false);
 const z=await rig({rules:{...RULES,subjects:{comment:{perHour:6}}}});assert.match((await z.pl.guard('ct','dm')).reason,/no Run rule for DMs/)});

test('guard: ticket, sending, record. A record closes the ticket once; a thread needs no text; a dm is never looked up on a public page',async()=>{
 const x=await rig();let g=await x.pl.guard('ct','dm');assert.equal(g.allow,true);
 assert.equal((await x.pl.mark('ct',g.ticket,'sending')).ok,true);
 let r=await x.pl.record('ct',{kind:'dm',ticket:g.ticket,ref:'https://www.threads.com/messages/t/1'});assert.match(r.text,/Recorded\. Today: 1 of 30 \(DMs\)/);assert.equal(r.isError,undefined);
 assert.match((await x.pl.record('ct',{kind:'dm',ticket:g.ticket})).text,/Already recorded/);
 const v=await x.pl.view('ct');assert.equal(v.recent[0].status,'recorded');assert.equal(v.recent[0].kind,'dm');
 g=await x.pl.guard('ct','thread');await x.pl.mark('ct',g.ticket,'sending');r=await x.pl.record('ct',{kind:'thread',ticket:g.ticket,ref:'new thread',text:'part one'});assert.match(r.text,/Recorded/);
 assert.equal((await x.pl.mark('ct',g.ticket,'cancel')).ok,false,'not after the action: it counts')});

test('guard: a comment is looked up on the public page, and a missing one fails the run like record_post',async()=>{
 const text='halo kak ini jawabannya lengkap banget';let x=await rig({pages:['p\n'+text]});let g=await x.pl.guard('ct','comment');await x.pl.mark('ct',g.ticket,'sending');
 let r=await x.pl.record('ct',{kind:'comment',ticket:g.ticket,ref:'https://www.threads.com/@a/post/1',text});assert.match(r.text,/visible to the public/);assert.match(r.text,/\(comments\)/);
 x=await rig({pages:['p\nother']});g=await x.pl.guard('ct','comment');await x.pl.mark('ct',g.ticket,'sending');
 r=await x.pl.record('ct',{kind:'comment',ticket:g.ticket,ref:'https://www.threads.com/@a/post/1',text});assert.equal(r.isError,true);assert.match(r.text,/\[CRON_FAILURE\]/)});

test('record_post without a ticket closes the open ticket of that kind, so the post is not counted twice',async()=>{
 const text='halo kak ini jawabannya lengkap banget';const x=await rig({pages:['p\n'+text]});const g=await x.pl.guard('ct','comment');await x.pl.mark('ct',g.ticket,'sending');
 const r=await x.pl.record('ct',{kind:'comment',post_url:'https://www.threads.com/@a/post/9',text,lead:'hot'});assert.match(r.text,/Today: 1 of 70/);
 assert.equal((await x.pl.view('ct')).recent.length,1)});

test('a post over the limits, or with the pause file there, is recorded and answered as STOP',async()=>{
 const x=await rig();const text='halo kak ini jawabannya lengkap banget';
 await x.pl.record('ct',{kind:'comment',post_url:'https://www.threads.com/@a/post/1',text});   // posted without asking
 const r=await x.pl.record('ct',{kind:'comment',post_url:'https://www.threads.com/@a/post/2',text});assert.equal(r.isError,true);assert.match(r.text,/^STOP posting this run: this post was over the limits/);
 assert.ok(x.events.some(e=>/posted over its limits/.test(e[1])));
 const y=await rig({stop:true});const q=await y.pl.record('ct',{kind:'comment',post_url:'https://www.threads.com/@a/post/1',text});assert.equal(q.isError,true);assert.match(q.text,/STOP posting this run/);assert.match(q.text,/Paused/)});

test('unrecorded action: sent, never recorded -> counted, ONE Health item per agent, cleared by a late record; a ticket never sent just runs out',async()=>{
 const x=await rig();const g=await x.pl.guard('ct','comment');await x.pl.mark('ct',g.ticket,'sending');const lost=await x.pl.guard('ct','thread');
 x.tick(11*60e3);await x.pl.tick();
 let v=await x.pl.view('ct');assert.equal(v.unrecorded,1);assert.equal(v.recent.find(e=>e.id===g.ticket).status,'unrecorded');assert.equal(v.recent.some(e=>e.id===lost.ticket),false,'never sent: dropped');
 const ev=x.events.filter(e=>e[3]?.topic==='unrecorded');assert.equal(ev.length,1);assert.match(ev[0][1],/1 posting action without a record/);assert.equal(ev[0][3].agent,'ct');
 await x.pl.tick();assert.equal(x.events.filter(e=>e[3]?.topic==='unrecorded').length,1,'not filed again every minute');
 assert.equal((await x.pl.line('ct')).unrecorded,1);assert.match((await x.pl.line('ct')).text,/Unrecorded actions: 1\./);
 // it still counts against the limits: 11 minutes on, a comment is allowed by the gap but today's count has it
 assert.equal((await x.pl.allowNow('ct','comment')).today,1);
 const r=await x.pl.record('ct',{kind:'comment',ticket:g.ticket,ref:'https://www.threads.com/@a/post/1',text:'halo kak ini jawabannya lengkap banget'});assert.match(r.text,/Recorded/);
 v=await x.pl.view('ct');assert.equal(v.unrecorded,0);x.tick(11*60e3);await x.pl.tick();assert.ok(x.solved.some(s=>s[1]==='unrecorded'),'the item goes away')});

test('the Health line: today per kind against its limits, and the unrecorded count',async()=>{
 const x=await rig();const g=await x.pl.guard('ct','dm');await x.pl.mark('ct',g.ticket,'sending');await x.pl.record('ct',{kind:'dm',ticket:g.ticket,ref:'x'});
 const l=await x.pl.line('ct');assert.equal(l.text,'Posting today: comments 0/70 (hour 0/6), DMs 1/30 (hour 1/3), own threads 0/8 (hour 0/1), DM answers 0/80 (hour 0/20). Unrecorded actions: 0.');
 assert.equal(await (await rig({rules:{...RULES,on:false}})).pl.line('ct'),null)});

test('allowNow takes the kind; with no kind it is the comment limit, and the old single rule still answers',async()=>{
 const x=await rig();assert.equal((await x.pl.allowNow('ct','thread')).gapMin,60);assert.equal((await x.pl.allowNow('ct')).kind,'comment');
 const old=await rig({rules:{on:true,perHour:2,perDay:5,gapMin:0,tz:'UTC'}});assert.equal((await old.pl.allowNow('ct')).allow,true)});

test('the gate text for a schedule that posts several kinds lists each, and skips only when none has room',()=>{
 const r=clean(RULES);const list=['comment','dm'].map(kind=>({kind,d:decideKind(r,[{at:at('09:55'),kind:'comment',status:'visible'}],kind,{now:at('10:00')}),rule:ruleFor(r,kind)}));
 const j=jobDecision(list);assert.equal(j.allow,true,'the DM has room');const t=gateTextKinds(list,j);assert.match(t,/- comments: none now\./);assert.match(t,/- DMs: today 0 of 30/);assert.match(t,/REFUSED_POSTING_LIMIT/);assert.doesNotMatch(t,/wakeAgent/);
 const none=gateTextKinds(list.slice(0,1),jobDecision(list.slice(0,1)));assert.equal(none.trim().split('\n').pop(),'{"wakeAgent": false}')});

// ---- the run gate in front of all four runners ----
const job=(id,name,o={})=>({id,name,prompt:'x',script:null,no_agent:false,enabled:true,state:'scheduled',schedule:{kind:'cron',expr:'0 * * * *',display:'0 * * * *'},next_run_at:'2026-11-12T10:00:00.000000+07:00',...o});
async function gates(entries,{rules=RULES,now=at('10:00')}={}){const root=await mkdtemp(path.join(tmpdir(),'pgg-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data'),WORK=path.join(root,'work');
 const jobs=[job('198bc372ee48','Threads comment + DM runner (6 comments/h, 3 DMs/h)',{script:'aqeelos-posting-gate.sh'}),job('738e7a2cea4f','Threads own-post thread runner'),job('2ea603717676','Threads outbound DM runner (3 DMs/h)'),
  job('7ab','Threads DM + reply answering runner'),job('sales','Weekly sales recap')];
 const h=path.join(H,'profiles','ct');await mkdir(path.join(h,'cron'),{recursive:true});await mkdir(path.join(h,'scripts'),{recursive:true});await mkdir(path.join(DATA,'posting-log'),{recursive:true});await mkdir(path.join(WORK,'ct','.tools'),{recursive:true});
 await writeFile(path.join(h,'cron','jobs.json'),JSON.stringify({jobs}));await writeFile(path.join(DATA,'posting-limits.json'),JSON.stringify({agents:{ct:rules}}));await writeFile(path.join(DATA,'posting-log','ct.json'),JSON.stringify(entries));
 const G=createRunGates({HERMES_HOME:H,DATA,WORK,PORT:4400,sig:a=>'sig-'+a,now:()=>now,log:()=>{},rule:()=>false,limitsText:async(a,kinds)=>'LIMITS '+kinds.join(',')+'\n{"wakeAgent": true}'});
 return {G,H,DATA,WORK,h};}
const last=s=>s.trim().split('\n').pop();

test('run gate: every schedule that posts asks the limits of the kinds it posts; one with no post of its own is left alone',async()=>{
 const e=[{at:at('09:30'),kind:'thread',status:'recorded'},{at:at('09:55'),kind:'comment',status:'visible'},{at:at('08:00'),kind:'dm',status:'recorded'}];
 const {G}=await gates(e);
 let a=await G.check('ct','738e7a2cea4f');assert.equal(last(a),'{"wakeAgent": false}');assert.match(a,/posted in the last hour/,'the own-thread runner was ungated before');
 a=await G.check('ct','198bc372ee48');assert.equal(last(a),'{"wakeAgent": true}','comments are in the gap but the DM has room');assert.match(a,/LIMITS comment,dm/);
 a=await G.check('ct','2ea603717676');assert.equal(last(a),'{"wakeAgent": true}');assert.match(a,/LIMITS dm/);
 a=await G.check('ct','7ab');assert.equal(last(a),'{"wakeAgent": true}');
 a=await G.check('ct','sales');assert.equal(last(a),'{"wakeAgent": true}');assert.doesNotMatch(a,/LIMITS/)});

test('run gate: when every kind of a schedule is over its limit it does not start, with the reasons',async()=>{
 const e=[{at:at('09:55'),kind:'comment',status:'visible'},...[1,2,3].map(i=>({at:at('09:00')+i*10*60e3,kind:'dm',status:'recorded'}))];
 const {G}=await gates(e);const a=await G.check('ct','198bc372ee48');assert.equal(last(a),'{"wakeAgent": false}');assert.match(a,/comments: .*min ago/);assert.match(a,/DMs: /);
 assert.equal((await G.view()).jobs.find(j=>j.job==='198bc372ee48').skippedBy['posting limits'],1);
 // the pause file stops the public replies of the answering runner too
 const p=await gates([]);await writeFile(path.join(p.WORK,'ct','.tools','STOP_COMMENTS'),'');assert.equal(last(await p.G.check('ct','738e7a2cea4f')),'{"wakeAgent": false}')});

test('run gate: an agent with the one old rule is limited as before (only a marked schedule), and its posting gate still runs',async()=>{
 const old={on:true,perHour:1,perDay:5,gapMin:30,tz:'UTC'};const {G}=await gates([{at:at('09:55'),status:'visible'}],{rules:old});
 assert.equal(last(await G.check('ct','198bc372ee48')),'{"wakeAgent": false}');assert.equal(last(await G.check('ct','738e7a2cea4f')),'{"wakeAgent": true}','named own-post, but not marked: unchanged')});

test('the generated gate script of a posting schedule prints the answer with its limits instead of the generic posting gate',()=>{
 const s=gateBody({port:4400,agent:'ct',jobId:'j',sig:'s',original:'aqeelos-posting-gate.sh',posting:true});assert.doesNotMatch(s,/exec bash/);assert.match(s,/original=aqeelos-posting-gate\.sh/);
 assert.match(gateBody({port:4400,agent:'ct',jobId:'j',sig:'s',original:'aqeelos-posting-gate.sh'}),/exec bash/)});

test('run-check --posting: the kinds a schedule posts decide; any with room says go',async()=>{
 const x=await rig();const e=[{at:at('09:55'),kind:'comment',status:'visible'}];await mkdir(path.join(x.DATA,'posting-log'),{recursive:true});await writeFile(path.join(x.DATA,'posting-log','ct.json'),JSON.stringify(e));
 const pa=kinds=>postingAllowed({DATA:x.DATA,WORK:x.WORK,agent:'ct',kinds,now:at('10:00')});
 assert.equal((await pa(['comment'])).allow,false);assert.equal((await pa(['comment','dm'])).allow,true);assert.equal((await pa([])).allow,true,'no list: every kind with a rule')});

// ---- the helper the scripts call, against the real limits behind a local http server ----
const PY=[process.env.PYTHON,'python3','python',process.env.LOCALAPPDATA&&path.join(process.env.APPDATA||'','uv','python','cpython-3.12.15-windows-x86_64-none','python.exe')].filter(Boolean).find(p=>{try{return spawnSync(p,['-c','import sys;print(sys.version_info[0])'],{encoding:'utf8'}).stdout.trim()==='3'}catch{return false}});
async function serve(pl){const srv=http.createServer(async(req,res)=>{const m=/^\/posting-(gate|record|check|sending|cancel)\/([\w-]+)\/([\w-]+)/.exec(req.url);const send=(c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
  if(!m||m[3]!=='sig-ct')return send(403,{error:'bad signature'});let b='';for await(const c of req)b+=c;b=b?JSON.parse(b):{};
  if(m[1]==='gate')return send(200,await pl.allowNow(m[2],new URL(req.url,'http://x').searchParams.get('kind')||''));
  if(m[1]==='check'){const g=await pl.guard(m[2],b.kind);return send(g.allow?200:409,g)}
  if(m[1]==='sending'||m[1]==='cancel'){const g=await pl.mark(m[2],b.ticket,m[1]);return send(g.ok?200:409,g)}
  const r=await pl.record(m[2],b);return send(r.isError?409:200,{ok:!r.isError,text:r.text})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {srv,base:'http://127.0.0.1:'+srv.address().port}}
const run=(args,env)=>new Promise(res=>execFile(PY,args,{encoding:'utf8',env:{...process.env,...env},timeout:60000},(e,stdout,stderr)=>res({status:e?(typeof e.code==='number'?e.code:-1):0,stdout,stderr})));

test('posting-guard.py: check/sending/record as a command, refusal exits 7 with the reason, a dead aqeelOS exits 8',{skip:!PY&&'no python found'},async()=>{
 const x=await rig();const {srv,base}=await serve(x.pl);const conf=path.join(x.dir,'pg.json');await writeFile(conf,JSON.stringify({base,agent:'ct',sig:'sig-ct'}));const env={POSTING_GUARD_CONF:conf};const cli=path.join(HERE,'posting-guard.py');
 try{let r=await run([cli,'check','comment'],env);assert.equal(r.status,0,r.stderr);const T=r.stdout.trim();assert.match(T,/^[0-9a-f]{10}$/);
  r=await run([cli,'check','comment'],env);assert.equal(r.status,7);assert.match(r.stderr,/^REFUSED_POSTING_LIMIT: .*min/);assert.equal(r.stdout,'');
  assert.equal((await run([cli,'sending',T],env)).status,0);
  r=await run([cli,'record','comment','https://www.threads.com/@a/post/1','--ticket',T,'--text','halo kak ini jawabannya lengkap banget'],env);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/POSTING_GUARD: Recorded and visible/);
  r=await run([cli,'act','dm','chat-1'],env);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Recorded\. Today: 1 of 30 \(DMs\)/);
  r=await run([cli,'check','dm'],env);assert.equal(r.status,7);assert.match(r.stderr,/at least 10 min apart|min ago/);
  r=await run([cli,'peek','thread'],env);assert.equal(JSON.parse(r.stdout).allow,true);
  r=await run([cli,'check','tweet'],env);assert.equal(r.status,7);assert.match(r.stderr,/unknown kind/);
  const bad=path.join(x.dir,'bad.json');await writeFile(bad,JSON.stringify({base,agent:'ct',sig:'wrong'}));assert.equal((await run([cli,'check','thread'],{POSTING_GUARD_CONF:bad})).status,7,'a refusal from aqeelOS (bad signature) is a refusal');
  const dead=path.join(x.dir,'dead.json');await writeFile(dead,JSON.stringify({base:'http://127.0.0.1:1',agent:'ct',sig:'sig-ct'}));r=await run([cli,'check','thread'],{POSTING_GUARD_CONF:dead});assert.equal(r.status,8);assert.match(r.stderr,/did not answer/)}
 finally{srv.close()}});

test('posting-guard.py as a module in a posting script: refused = the script stops before it acts; allowed = sending and record happen; no --send asks for nothing; a dm_outbound-style parent hands its ticket to a child',{skip:!PY&&'no python found'},async()=>{
 const x=await rig();const {srv,base}=await serve(x.pl);const dir=path.join(x.dir,'tools');await mkdir(dir,{recursive:true});
 await writeFile(path.join(dir,'posting_guard.py'),await readFile(path.join(HERE,'posting-guard.py'),'utf8'));await writeFile(path.join(dir,'posting-guard.json'),JSON.stringify({base,agent:'ct',sig:'sig-ct'}));
 await writeFile(path.join(dir,'comment_send.py'),'import sys\nimport posting_guard as pg; pg.begin("comment")\nprint("BROWSER OPENED")\npg.sending()\nprint("CLICKED")\npg.record("comment", "https://www.threads.com/@a/post/7", "halo kak ini jawabannya lengkap banget")\n');
 await writeFile(path.join(dir,'dm_send.py'),'import sys\nimport posting_guard as pg; pg.begin("reply")\npg.sending()\nprint("ENTER")\npg.record("reply", "chat")\n');
 await writeFile(path.join(dir,'dm_outbound.py'),'import sys, subprocess, os\nimport posting_guard as pg; pg.check("dm")\nfor i in (1,2):\n    print(subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),"dm_send.py"), "u", "f", "--send"], capture_output=True, text=True).stdout.strip())\n');
 await writeFile(path.join(dir,'aborts.py'),'import sys\nimport posting_guard as pg; pg.begin("thread")\nprint("NO COMPOSER BUTTON")\n');
 try{let r=await run([path.join(dir,'comment_send.py'),'u','f','--send'],{});assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/BROWSER OPENED\r?\nCLICKED\r?\nPOSTING_GUARD: Recorded and visible/);
  r=await run([path.join(dir,'comment_send.py'),'u','f','--send'],{});assert.equal(r.status,7);assert.match(r.stdout,/^REFUSED_POSTING_LIMIT: /);assert.doesNotMatch(r.stdout,/BROWSER OPENED/,'stopped before the browser was touched');
  r=await run([path.join(dir,'comment_send.py'),'u','f'],{});assert.match(r.stdout,/BROWSER OPENED/,'a dry run (no --send) is not limited');assert.equal(r.stderr.includes('Traceback'),false);
  r=await run([path.join(dir,'dm_outbound.py')],{});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.match(/ENTER/g).length,2,'both parts');
  const v=await x.pl.view('ct');assert.equal(v.recent.filter(e=>e.kind==='dm').length,1,'one DM, not two');assert.equal(v.recent.filter(e=>e.kind==='reply').length,0);
  r=await run([path.join(dir,'aborts.py'),'--send'],{});assert.equal(r.status,0);assert.equal((await x.pl.view('ct')).recent.some(e=>e.kind==='thread'),false,'a script that gave up before it posted leaves nothing counted')}
 finally{srv.close()}});
