// Tests for "better design by default" (app/design-guard.mjs; the tools in agent-versions.mjs and agent-access.mjs; the echo converter in
// agent-care.mjs; the check output in run-gates.mjs). The prompts are the real ones of the 12 Nov 2026 audit, with names and ids taken out.
// Run: node --test scripts/design-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EVENTS,EVENT_IDS,RULE_LINES,TOOL_HELP,TOOL_PROPS,classify,echoOf,step0Of,filterOf,cadenceOfText,relCommand,fileOf,checkedCommand,cleanChecks,jobScript,ownCheckScript,STEP0_NOTE,createDesignGuard} from '../app/design-guard.mjs';
import {EVENTS as TEBAR_EVENTS} from '../app/tebar.mjs';
import {cleanHook,createEventHooks} from '../app/event-hooks.mjs';
import {gateBody} from '../app/run-gates.mjs';
import {createAgentCare,scriptOnlyCommand} from '../app/agent-care.mjs';
import {createAgentVersions,VERSION_TOOLS} from '../app/agent-versions.mjs';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),src=f=>readFileSync(path.join(ROOT,f),'utf8');

// ---- the audit's real prompts ----
const RECAP_A='Shop Sales Recap tick. In the terminal run exactly: python3 -I /w/bot/sales-recap/run.py\nIf it prints nothing, your whole final answer must be exactly: [SILENT]\nIf it prints lines, your final answer is those lines verbatim, nothing added. Do not run anything else, do not change files, do not message customers.';
const RECAP_B="Run exactly this command: python3 /w/bot/sales-recap/recap.py\nIt prints one line per order it looked at. Skip lines containing 'skip:' . If any line contains '-> OK' or 'ERROR', reply with ONLY those lines, each rewritten as: 'Recap: <customer order key> <the rest of the line>' (a short Indonesian sentence is fine, no keys or tokens). If there is no such line, your entire reply must be exactly: [SILENT]. Never send WhatsApp messages, never print secrets, never run recap.py with --test or --cleanup.";
const WATCHDOG='Run exactly this terminal command: python3 /w/bot/test_chat_watchdog.py\nIf it prints nothing, your entire final response must be exactly: [SILENT]\nIf it prints text, your final response must be that text exactly, unchanged. Do nothing else: never send WhatsApp messages.';
const MEETING='You are the team agent. Standing task set by the owner on 22 Oct 2026.\n\nSTEP 0 (cheap gate): run in terminal `python3 ~/.hermes/profiles/bot/scripts/meeting_watch.py`. If it prints nothing, reply exactly [SILENT] and stop immediately without loading anything else.\n\nOtherwise load the operating rules. Each output line: STATUS, drive file id, recording name, transcript path.\n\nFAILED: post one line in the team channel naming the meeting, then mark it done.\n\nREADY:\n1. Match the client using the aliases file. No match: ask in the team channel which client. Never guess.\n2. Read the FULL transcript, the client\'s backlog and the last 7 days of its project channel.\n3. Extract decisions, action items and items confirmed finished.';
const RESUME='Watchdog for the site build. Read /w/bot/automations/resume-plan.md (jobs A, B, C and the status log).\n1. If /w/bot/automations/resume.done exists, respond exactly [SILENT].\n2. Work out the state of each job from evidence: GitHub (PRs, branches, check-runs), the audit files. If it is still running, append a one-line status to the plan file and respond [SILENT].\n3. Otherwise continue the first unfinished job yourself, from where the evidence shows it stopped. Commit and push progress.\n4. When A and B are done, do job C: create the draft and send the owner the same text.';
const TODO='Two-way STATUS sync between the Master To Do (Notion) and the team backlogs. Runs every 30 min in work hours. Be silent: final response must be EMPTY unless something needs the owner (conflict or error); then one short plain line. Never delete anything. Never change any field except Status.\n\nState file: /w/bot/automations/todo-sync-state.json (read it first; write it back at the end).';
const CHECKIN='Scheduled 4-hour check-in. Load the ops skill and run one check-in exactly as those rules say. Post only material-change project digests. If nothing material changed, post nothing and reply [SILENT].';
const INVOICE='Send the owner a short WhatsApp reminder (plain, no headers, no job IDs, no footer): ask whether the last invoices of the three clients have been paid. Two or three lines only.';
const THREADS='Open the inbox in the browser, answer the waiting DMs and replies. STEP 0 READ the three knowledge files. Then answer each one in the brand voice.';

test('the published events are the ones the code really emits, each with one line on what it is',()=>{
 assert.equal(new Set(EVENT_IDS).size,EVENTS.length);for(const e of EVENTS){assert.match(e.id,/^[a-z]+\.[a-z]+$/);assert.ok(e.what.length>=15&&e.what.length<=90,e.id)}
 for(const e of EVENTS.filter(e=>e.from==='tebar'))assert.ok(TEBAR_EVENTS.includes(e.id),e.id+' is a Tebar event');
 for(const e of EVENTS.filter(e=>e.from==='payments'))assert.ok(src('app/paid-labels.mjs').includes("type:'"+e.id+"'"),e.id+' is told by paid-labels.mjs');
 for(const e of EVENTS.filter(e=>e.from==='kirimdev'))assert.ok(src('app/kirimdev.mjs').includes("'"+e.id+"'"),e.id+' is told by kirimdev.mjs');
 assert.deepEqual([...new Set(EVENTS.map(e=>e.from))].sort(),['kirimdev','payments','tebar']);
 // every source tells the one place both an event hook and an event-started run start from
 const s=src('app/server.mjs');assert.match(s,/const emitEvent=\(a,ev\)=>Promise\.allSettled\(\[eventRuns\.fire\(a,ev\),eventHooks\.fire\(a,ev\)\]\)/);
 for(const maker of ['createTebar({DATA,onEvent:(a,ev)=>emitEvent(a,ev)','createKirimdev({onEvent:(a,ev)=>emitEvent(a,ev)','onEvent:(a,ev)=>emitEvent(a,ev),label:'])assert.ok(s.includes(maker),maker);
 // the agent sees the list in both tools, and the rule is in its context: short, in the owner's order
 for(const id of EVENT_IDS)assert.ok(TOOL_HELP.includes(id));assert.deepEqual(TOOL_PROPS.on_event.items.enum,EVENT_IDS);
 const t=VERSION_TOOLS.find(x=>x.name==='my_schedules');assert.ok(t.description.includes('payment.paid'));for(const k of ['script','checks','check_script','on_event','keep','prefix'])assert.ok(t.inputSchema.properties[k],k);
 assert.ok(src('app/agent-access.mjs').includes('TOOL_PROPS')&&s.includes('...DESIGN_RULE_LINES,'));
 const rule=RULE_LINES.join(' ');assert.ok(rule.split(/\s+/).length<=130,'the rule is paid on every turn: '+rule.split(/\s+/).length+' words');
 const order=['an event','a script on a timer','a no-AI check','the AI on a timer','one sentence','run this and repeat the output'].map(w=>rule.indexOf(w));assert.ok(order.every((x,i)=>x>0&&(i===0||x>order[i-1])),'event, script, check, AI, in that order')});

test('the audit\'s real prompts: an echo is no AI, a step 0 is a check, the rest is left alone',()=>{
 assert.deepEqual(echoOf(RECAP_A),{cmd:'python3 -I /w/bot/sales-recap/run.py',filter:null});
 assert.deepEqual(echoOf(RECAP_B),{cmd:'python3 /w/bot/sales-recap/recap.py',filter:{keep:'-> OK|ERROR',drop:'skip:',prefix:'Recap: '}});
 assert.deepEqual(echoOf(WATCHDOG),{cmd:'python3 /w/bot/test_chat_watchdog.py',filter:null});
 assert.equal(classify({prompt:RECAP_A,schedule:'every 5m'}).kind,'echo');assert.equal(classify({prompt:RECAP_B,schedule:{kind:'interval',minutes:5}}).kind,'echo');
 assert.deepEqual(classify({prompt:MEETING,schedule:'*/30 9-19 * * 1-5'}),{kind:'step0',cmd:'python3 ~/.hermes/profiles/bot/scripts/meeting_watch.py'});
 assert.equal(classify({prompt:MEETING,schedule:'*/30 9-19 * * 1-5',hasCheck:true}).kind,'ok','once the script is the check there is nothing to say');
 assert.deepEqual(classify({prompt:RESUME,schedule:'every 45m'}),{kind:'ok',trigger:'model',quiet:true});
 assert.deepEqual(classify({prompt:TODO,schedule:'5 8-18 * * 1-5'}),{kind:'ok',trigger:'model',quiet:false});
 assert.equal(classify({prompt:CHECKIN,schedule:'0 0,4,8,12,16,20 * * *'}).quiet,true);assert.equal(classify({prompt:INVOICE,schedule:'0 9 10,20 * *'}).kind,'ok');
 const f=classify({prompt:THREADS,schedule:'every 10m'});assert.equal(f.kind,'fast');assert.equal(f.every,10);assert.equal(f.suggest.checks,'--dms --comments');
 assert.equal(classify({prompt:THREADS,schedule:'every 10m',hasEvent:true}).trigger,'event');assert.equal(classify({prompt:THREADS,schedule:'every 10m',hasCheck:true}).trigger,'check');
 assert.equal(classify({prompt:'',no_agent:true,schedule:'every 2m'}).trigger,'script')});

test('an echo is only a prompt that runs one command and passes its output on',()=>{
 for(const p of ['Check the sheet and run exactly this terminal command: python3 a.py\n[SILENT] exactly','Run exactly this terminal command: python3 a.py\nThen summarize it for the team. [SILENT] if nothing, exactly.','Run exactly this terminal command: python3 a.py\nPost the result.',
  'Run this: gather the numbers and write the report. [SILENT] if nothing.','Read the plan. Run exactly this command: python3 a.py\nReply with its output verbatim.','Run exactly this command: python3 a.py\nIf it fails, fix the script and try again. Otherwise [SILENT].',
  'Write the weekly report and send it to the team.'])assert.equal(echoOf(p),null,p);
 for(const p of ['Run exactly this terminal command and nothing else: bash /x/y.sh\nReply with its output unchanged, or [SILENT] if empty.','Execute this command: `node tools/feed.mjs`\nYour final answer is its output verbatim.','In your terminal, run exactly: ./check.sh --all\nReply with only what it prints, unchanged.'])assert.ok(echoOf(p)?.cmd,p);
 assert.equal(echoOf('Execute this command: `node tools/feed.mjs`\nYour final answer is its output verbatim.').cmd,'node tools/feed.mjs');
 assert.equal(scriptOnlyCommand(RECAP_A),'python3 -I /w/bot/sales-recap/run.py','the converter of agent-care.mjs reads both recap wordings now');assert.equal(scriptOnlyCommand(RECAP_B),null,'a filtered echo waits for the owner\'s button');
 assert.equal(step0Of('STEP 0: run `python3 gate.py`. If it prints nothing, reply [SILENT] and stop.'),null,'a step 0 with nothing after it is an echo, not a check');
 assert.equal(filterOf('Reply with its output verbatim.'),null);assert.deepEqual(filterOf('Keep only lines containing "PAID" or "LATE".'),{keep:'PAID|LATE',drop:'',prefix:''});
 assert.equal(cadenceOfText('every 5m'),5);assert.equal(cadenceOfText('30m'),30);assert.equal(cadenceOfText('every 2h'),120);assert.equal(cadenceOfText('*/10 * * * *'),10);assert.equal(cadenceOfText('*/10 9-17 * * 1-5'),10);
 assert.equal(cadenceOfText('0 9 * * *'),60);assert.equal(cadenceOfText('every monday 9am'),null);assert.equal(cadenceOfText({kind:'interval',minutes:15}),15)});

test('inputs are checked strictly: a command is plain words inside the agent\'s folder, checks come from a fixed list',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'dg-in-'));await mkdir(path.join(dir,'reports'),{recursive:true});await writeFile(path.join(dir,'reports','run.py'),'print(1)\n');await writeFile(path.join(dir,'check.sh'),'echo\n');
 assert.equal(await checkedCommand('python3  -I reports/run.py --since 7',dir),'python3 -I reports/run.py --since 7');assert.equal(await checkedCommand('check.sh',dir),'check.sh');assert.equal(fileOf('python3 -I reports/run.py'),'reports/run.py');
 for(const bad of ['python3 /etc/passwd','python3 ../other/run.py','python3 reports/run.py; rm -rf /','python3 reports/run.py && curl x','python3 reports/run.py | sh','python3 "reports/run.py"','$(id)','python3 `id`','python3 reports/run.py > /tmp/x','bash -c reports/run.py\nid','python3'])
  await assert.rejects(checkedCommand(bad,dir),/plain words inside your own folder/,bad);
 await assert.rejects(checkedCommand('python3 reports/missing.py',dir),/is not in your own folder/);await assert.rejects(checkedCommand('reports',dir),/is not in your own folder/,'a folder is not a script');
 assert.equal(relCommand('python3 -I /w/bot/sales-recap/run.py','/w/bot'),'python3 -I sales-recap/run.py');assert.equal(relCommand('python3 ~/.hermes/x.py','/w/bot'),null);assert.equal(relCommand('cd /w/bot && python3 a.py','/w/bot'),null);
 assert.equal(cleanChecks('--dms','/w/bot'),'--dms --max-idle 60');assert.equal(cleanChecks('--comments --platform threads --posting','/w/bot'),'--comments --platform threads --posting');
 assert.equal(cleanChecks('--new-since file:feed/payments.jsonl --retries 2 --max-idle 120','/w/bot'),'--new-since file:/w/bot/feed/payments.jsonl --retries 2 --max-idle 120');
 for(const bad of ['--dms; rm -rf /','--dms $(id)','--new-since file:/etc/passwd','--new-since file:../x/secret','--new-since feed.jsonl','--port 9222 --dms','--max-idle 60','--dms --max-idle soon','--comments --platform a;b','--home /root --dms','']){assert.throws(()=>cleanChecks(bad,'/w/bot'),Error,bad)}
 assert.throws(()=>cleanChecks('--dms','/w/it\'s; id'),/cannot be used/)});

// ---- a guard over a fake engine ----
function fakeDash(){const jobs={};let n=0;const srv=createServer(async(req,res)=>{const u=new URL(req.url,'http://x');const prof=u.searchParams.get('profile');let body='';for await(const c of req)body+=c;const b=body?JSON.parse(body):{};
 const L=jobs[prof]||=[];const m=/^\/api\/cron\/jobs(?:\/([^/]+))?(?:\/(pause|resume|trigger|runs))?$/.exec(u.pathname);const send=(c,j)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(j))};
 if(!m)return send(404,{});const [,id]=m;
 // like an engine that takes only the plain fields at creation: the guard must set the rest with an update
 if(!id&&req.method==='GET')return send(200,L);if(!id&&req.method==='POST'){const j={id:'j'+(++n),name:b.name,prompt:b.prompt,schedule:{kind:'cron',expr:b.schedule},schedule_display:b.schedule,deliver:b.deliver,enabled:true,state:'scheduled'};L.push(j);return send(200,{job:j})}
 const j=L.find(x=>x.id===id);if(!j)return send(404,{detail:'not found'});
 if(req.method==='PUT'){Object.assign(j,b.updates);if(b.updates.schedule)j.schedule={kind:'cron',expr:b.updates.schedule},j.schedule_display=b.updates.schedule;return send(200,j)}
 if(req.method==='DELETE'){L.splice(L.indexOf(j),1);return send(200,{ok:true})}return send(405,{})});
 return new Promise(r=>srv.listen(0,'127.0.0.1',()=>r({srv,jobs,url:'http://127.0.0.1:'+srv.address().port})))}
async function make({user='ag-bot'}={}){const root=await mkdtemp(path.join(tmpdir(),'dg-')),H=path.join(root,'hermes'),DATA=path.join(root,'data'),WORK=path.join(root,'work');
 await mkdir(path.join(H,'profiles','bot','cron'),{recursive:true});await mkdir(path.join(WORK,'bot','sales-recap'),{recursive:true});await mkdir(DATA,{recursive:true});
 for(const f of ['sales-recap/run.py','sales-recap/recap.py','gate.py'])await writeFile(path.join(WORK,'bot',f),'print("x")\n');
 const d=await fakeDash(),rules={},records=[];let t=Date.UTC(2026,10,12,3,0),G;
 const v=createAgentVersions({guard:()=>G,DATA,HERMES_HOME:H,DASH:d.url,DASH_TOKEN:'x',listAgents:async()=>['bot'],nameOf:()=>'Bot',readConfig:async()=>({}),setKey:async()=>({ok:true}),pick:()=>undefined,now:()=>t,live:true,log:()=>{}});
 G=createDesignGuard({HERMES_HOME:H,DATA,WORK,PORT:4400,sig:()=>'sig123',names:()=>'Bot',homes:async()=>['bot'],ownOf:async()=>({user,cwd:'/w/bot'}),jobs:a=>v.myJobs(a),updateJob:(a,id,up)=>v.updateJob(a,id,up),
  record:async(a,e)=>{records.push(e)},eventRules:{get:async a=>rules[a]||[],set:async(a,l)=>{rules[a]=l}},now:()=>t,log:()=>{}});
 const scriptOf=n=>readFile(path.join(H,'profiles','bot','scripts',n),'utf8'),sched=(args)=>v.mySchedules('bot',args,{by:'Bot'});
 return {v,G,d,H,DATA,WORK,rules,records,scriptOf,sched,jobs:()=>d.jobs.bot||[],close:()=>d.srv.close(),tick:ms=>{t+=ms},now:()=>t}}
const WHY='It only passes on what the recap script prints, so no AI is needed.';

test('at creation: "run X and repeat the output" becomes a script-only schedule, and the agent is told why',async()=>{const x=await make();
 try{const r=await x.sched({action:'create',name:'Shop sales recap',schedule:'every 5m',prompt:RECAP_A,deliver:'telegram:-100123:5',why:WHY});
  assert.ok(!r.isError,r.text);assert.match(r.text,/Created j1/);assert.match(r.text,/aqeelOS made it a script-only schedule: the prompt only ran "python3 -I \/w\/bot\/sales-recap\/run\.py" and repeated what it printed/);assert.match(r.text,/Tell the person in one sentence/);assert.match(r.text,/on_event/);
  const j=x.jobs()[0];assert.equal(j.no_agent,true);assert.match(j.script,/^aq-script-[0-9a-f]{12}\.sh$/);
  const s=await x.scriptOf(j.script);assert.match(s,/'ag-bot@127\.0\.0\.1' "cd '\/w\/bot' && echo \S+ \| base64 -d \| bash"/);assert.equal(Buffer.from(/echo (\S+) \| base64 -d \| bash/.exec(s)[1],'base64').toString(),'python3 -I /w/bot/sales-recap/run.py');
  const tr=(await x.G.triggers([{id:'j1',profile:'bot',no_agent:true,script:j.script}]))['bot|j1'];assert.equal(tr.kind,'script');assert.equal(tr.label,'A script on a timer, no AI');assert.equal(tr.why,WHY)}finally{x.close()}});

test('at creation: an echo with a line filter is refused with the exact call; that call makes it',async()=>{const x=await make();
 try{const r=await x.sched({action:'create',name:'Lab sales recap',schedule:'every 5m',prompt:RECAP_B,deliver:'telegram:-100123:7',why:WHY});
  assert.equal(r.isError,true);assert.equal(x.jobs().length,0,'nothing was made');assert.match(r.text,/needs no AI/);
  const call=JSON.parse(/my_schedules (\{.*?\})\. If the work/.exec(r.text)[1]);
  assert.deepEqual(call,{action:'create',name:'Lab sales recap',schedule:'every 5m',deliver:'telegram:-100123:7',script:'python3 sales-recap/recap.py',keep:'-> OK|ERROR',drop:'skip:',prefix:'Recap: ',why:'<what starts it and why>'});
  const ok=await x.sched({...call,why:WHY});assert.ok(!ok.isError,ok.text);assert.match(ok.text,/script-only schedule: "python3 sales-recap\/recap\.py" runs with no AI/);
  const j=x.jobs()[0];assert.equal(j.no_agent,true);const s=await x.scriptOf(j.script);for(const v of ['-> OK|ERROR','skip:','Recap: '])assert.ok(s.includes(Buffer.from(v).toString('base64')),v+' travels as base64');assert.doesNotMatch(s,/Recap: |-> OK/);
  // the same refusal in the words of the other tool
  const m=await x.G.before('bot',{action:'create',name:'Lab sales recap',schedule:'every 5m',prompt:RECAP_B,why:WHY},null,{tool:'manage_agent'});assert.match(m.refuse,/manage_agent \{"agent":"bot","part":"schedule","op":"create","title":"Lab sales recap","schedule":"every 5m","script":"python3 sales-recap\/recap\.py"/)}finally{x.close()}});

test('at creation: "step 0: run X, stop if nothing" is sent back with X as the check in front',async()=>{const x=await make();
 try{const r=await x.sched({action:'create',name:'Meeting watcher',schedule:'*/30 9-19 * * 1-5',prompt:MEETING,why:'Transcripts appear a few times a day.'});
  assert.equal(r.isError,true);assert.equal(x.jobs().length,0);assert.match(r.text,/step 0 of this prompt runs a script and stops when it prints nothing/);assert.match(r.text,/"check_script":"<that script, as a path inside your own folder>"/);assert.match(r.text,/"prompt":"<the prompt without step 0>"/);
  const ok=await x.sched({action:'create',name:'Meeting watcher',schedule:'*/30 9-19 * * 1-5',prompt:'Each line you were given is STATUS, file id, name, path. Handle FAILED and READY as the rules say.',check_script:'python3 gate.py',why:'Transcripts appear a few times a day, so a no-AI check looks first.'});
  assert.ok(!ok.isError,ok.text);assert.match(ok.text,/Its check "python3 gate\.py" runs before each start with no AI: the AI starts only when it prints something, and gets what it printed/);
  const c=await x.scriptOf('aqeelos-check-j1.sh');assert.match(c,/"anythingToDo": false/);assert.match(c,/"anythingToDo": true/);assert.equal(Buffer.from(/echo (\S+) \| base64 -d \| bash/.exec(c)[1],'base64').toString(),'python3 gate.py');
  assert.equal(x.jobs()[0].no_agent,undefined,'the AI still does the work');assert.equal((await x.G.triggers([{id:'j1',profile:'bot'}]))['bot|j1'].kind,'check')}finally{x.close()}});

test('at creation: faster than 30 minutes needs a check or an event; the person may still accept the cost',async()=>{const x=await make();
 try{const base={action:'create',name:'Answer DMs and replies',schedule:'every 10m',prompt:THREADS};
  const no=await x.sched({...base});assert.equal(no.isError,true);assert.match(no.text,/say in why, in one sentence, what starts this work/);
  const r=await x.sched({...base,why:'People write at any time of day.'});assert.equal(r.isError,true);assert.match(r.text,/start the AI every 10 minutes with nothing that says whether there is anything to do/);assert.match(r.text,/checks "--dms --comments": unread DMs and unanswered comments/);assert.match(r.text,/on_event: payment\.paid/);assert.match(r.text,/accept_cost true/);
  assert.equal(x.jobs().length,0);
  const a=await x.sched({...base,checks:'--dms --comments',why:'People write at any time of day, so a no-AI check of the inbox decides.'});assert.ok(!a.isError,a.text);assert.match(a.text,/Its check \(--dms --comments --max-idle 60\) runs before each start with no AI/);
  const c=await x.scriptOf('aqeelos-check-j1.sh');assert.match(c,/run-check\.mjs" --agent bot .* --job j1 --dms --comments --max-idle 60\n$/);
  const b=await x.sched({...base,name:'Answer comments',on_event:['comment.created','message.received'],schedule:'*/20 * * * *',why:'Tebar tells us when a comment or DM arrives.'});assert.ok(!b.isError,b.text);
  assert.match(b.text,/starts at once when comment\.created or message\.received happens; its clock is only the slow safety run/);assert.deepEqual(x.rules.bot,[{event:['comment.created','message.received'],job:'j2'}]);
  const k=await x.sched({...base,name:'Watch the queue',accept_cost:true,why:'The owner wants it every 10 minutes whatever it costs.'});assert.ok(!k.isError);assert.match(k.text,/at most once every 30 minutes until the owner keeps it as it is in Health/);
  const e=await x.sched({action:'edit',id:'j3',schedule:'*/5 * * * *'});assert.equal(e.isError,true,'a change is reviewed too');assert.match(e.text,/every 5 minutes/);
  const u=await x.sched({...base,on_event:['order.shipped'],why:'x'.repeat(12)});assert.equal(u.isError,true);assert.match(u.text,/Unknown event "order\.shipped"\. The events this aqeelOS emits: payment\.paid/);
  const t=await x.G.triggers(x.jobs().map(j=>({...j,profile:'bot'})));assert.deepEqual([t['bot|j1'].kind,t['bot|j2'].kind,t['bot|j3'].kind],['check','event','model']);assert.equal(t['bot|j2'].detail,'comment.created, message.received')}finally{x.close()}});

test('a script that starts from an event: a hook with no schedule, or with the clock as its slow safety run',async()=>{const x=await make();
 try{const r=await x.sched({action:'create',name:'Recap on payment',script:'python3 -I sales-recap/run.py',on_event:['payment.paid','order.posted'],deliver:'telegram:-100123:5',keep:'-> OK|ERROR',prefix:'Recap: ',why:'A recap is due the moment a payment is paid, not on a clock.'});
  assert.ok(!r.isError,r.text);assert.match(r.text,/Made the event hook (h-[0-9a-f]{10}): "python3 -I sales-recap\/run\.py" runs with no AI as soon as payment\.paid or order\.posted happens, and what it prints goes to telegram:-100123:5/);assert.match(r.text,/No schedule was made/);
  assert.equal(x.jobs().length,0);const id=/hook (h-[0-9a-f]{10})/.exec(r.text)[1],file=JSON.parse(await readFile(path.join(x.DATA,'event-hooks.json'),'utf8'));
  assert.deepEqual(cleanHook(file.bot[0]),{id,on:['payment.paid','order.posted'],run:'python3 -I sales-recap/run.py',deliver:'telegram:-100123:5',feed:null,gap:60,timeoutSec:300,keep:'-> OK|ERROR',prefix:'Recap: ',dedupe:false});
  // the hook file is the one event-hooks.mjs runs from: the event starts the script as the agent's own user, and its lines are delivered
  const ran=[],sent=[],hooks=createEventHooks({DATA:x.DATA,WORK:x.WORK,runAs:async(a,cmd)=>{ran.push(cmd);return {ok:true,out:'skip: 1\nS-9 -> OK\n'}},deliver:async(a,t,text)=>{sent.push([t,text])},log:()=>{}});
  assert.deepEqual(await hooks.fire('bot',{type:'payment.paid',data:{}}),[id]);await hooks.idle();assert.match(ran[0],/timeout -k 5 300 python3 -I sales-recap\/run\.py$/);assert.deepEqual(sent,[['telegram:-100123:5','Recap: S-9 -> OK']]);
  assert.match((await x.sched({action:'list'})).text,new RegExp('- hook:'+id+' · on payment\\.paid, order\\.posted · runs python3 -I sales-recap/run\\.py'));
  assert.match((await x.sched({action:'remove',id:'hook:'+id})).text,/Removed the event hook/);assert.equal(JSON.parse(await readFile(path.join(x.DATA,'event-hooks.json'),'utf8')).bot,undefined);
  // with a schedule: the same hook, and a script-only schedule that asks aqeelOS for the same run (one lock, one delivery)
  const s=await x.sched({action:'create',name:'Recap on payment',schedule:'17 * * * *',script:'python3 -I sales-recap/run.py',on_event:['payment.paid'],deliver:'telegram:-100123:5',why:'On payment; hourly only as a safety run.'});assert.ok(!s.isError,s.text);
  const j=x.jobs()[0];assert.equal(j.no_agent,true);assert.match(j.script,/^aqeelos-hook-h-[0-9a-f]{10}\.sh$/);assert.match(await x.scriptOf(j.script),/127\.0\.0\.1:4400\/event-hook\/bot\/h-[0-9a-f]{10}\/sig123/);assert.match(s.text,/only its slow safety run/);
  assert.equal((await x.G.triggers([{...j,profile:'bot'}]))['bot|j1'].kind,'event');
  // no deliver target: said plainly
  assert.match((await x.sched({action:'create',name:'Feed on payment',script:'python3 gate.py',on_event:['payment.paid'],why:'The script writes the sheet itself on each payment.'})).text,/What it prints is not sent anywhere/)}finally{x.close()}});

test('the means are refused plainly when they cannot be had',async()=>{const x=await make({user:''});
 try{const r=await x.sched({action:'create',name:'Recap',schedule:'every 2h',script:'python3 sales-recap/run.py',why:WHY});assert.equal(r.isError,true);assert.match(r.text,/no Linux user of its own/);
  const e=await x.sched({action:'create',name:'Recap',schedule:'every 5m',prompt:RECAP_A,why:WHY});assert.equal(e.isError,true,'an echo cannot be converted here, so the 30-minute question still stands');assert.match(e.text,/every 5 minutes/);
  for(const [args,re] of [[{script:'python3 /etc/x.py'},/plain words inside your own folder/],[{script:'python3 sales-recap/run.py',checks:'--dms'},/has nothing to check first/],[{prompt:'Do it',keep:'x'},/keep, drop and prefix go with script/],
   [{prompt:'Do it',checks:'--dms; id'},/Unknown check/],[{script:'python3 sales-recap/run.py',keep:'(['},/keep is not a valid pattern/],[{prompt:'Do it',check_script:'python3 nope.py'},/is not in your own folder/]]){
   const y=await make();try{const q=await y.sched({action:'create',name:'N',schedule:'every 2h',why:WHY,...args});assert.equal(q.isError,true);assert.match(q.text,re);assert.equal(y.jobs().length,0)}finally{y.close()}}}finally{x.close()}});

test('the engine\'s own schedule tool gets the same review and is pointed to my_schedules',async()=>{const x=await make();
 try{const e=await x.G.engineCall('bot',{action:'create',name:'Shop sales recap',schedule:'every 5m',prompt:RECAP_A,deliver:'telegram:-100123:5'});
  assert.match(e,/needs no AI/);assert.match(e,/my_schedules \{"action":"create","name":"Shop sales recap","schedule":"every 5m","deliver":"telegram:-100123:5","script":"python3 -I sales-recap\/run\.py","why":"<what starts it and why>"\}/);
  assert.match(await x.G.engineCall('bot',{action:'create',name:'Meetings',schedule:'every 30m',prompt:MEETING}),/"check_script"/);assert.match(await x.G.engineCall('bot',{action:'create',name:'DMs',schedule:'*/10 * * * *',prompt:THREADS}),/every 10 minutes/);
  for(const ok of [{action:'create',name:'Report',schedule:'0 9 * * 1',prompt:'Write the weekly report.'},{action:'create',name:'Feed',schedule:'every 2m',script:'feed.sh',no_agent:true},{action:'create',name:'DMs',schedule:'*/10 * * * *',prompt:THREADS,script:'gate.sh'},{action:'list'},{action:'pause',job_id:'j1'}])assert.equal(await x.G.engineCall('bot',ok),null,JSON.stringify(ok));
  await x.sched({action:'create',name:'Report',schedule:'0 9 * * 1',prompt:'Write the weekly report.',why:'It needs judgement each week.'});
  assert.match(await x.G.engineCall('bot',{action:'update',job_id:'j1',schedule:'*/5 * * * *'}),/every 5 minutes/);assert.equal(await x.G.engineCall('bot',{action:'update',job_id:'j1',name:'Weekly report'}),null);assert.equal(await x.G.engineCall('bot',{action:'update',job_id:'gone',prompt:RECAP_A}),null);
  // the plugin asks before the call runs, and lets it through when aqeelOS does not answer
  const py=src('engine/aqeelos-live/__init__.py');assert.match(py,/def design_block\(tool_name, args, post=None\):/);assert.match(py,/"\/schedule-review"/);assert.match(py,/why = design_block\(tool_name, args\)/);
  assert.match(src('app/server.mjs'),/p==='\/agent-live\/schedule-review'[\s\S]{0,400}agentLive\.keyOk\(b\.key\)[\s\S]{0,400}designGuard\.engineCall/)}finally{x.close()}});

// ---- the feedback loop ----
const audit=(job,n,silent,{tokens=38000,at=Date.UTC(2026,10,11,12,0)}={})=>Array.from({length:n},(_,i)=>JSON.stringify({ts:new Date(at-i*600e3).toISOString(),job_id:job,prompt_tokens:tokens-90,completion_tokens:90,total_tokens:tokens,response_silent:i<silent,model:'m',error:null})).join('\n')+'\n';
async function withJobs(x,list){for(const j of list){(x.d.jobs.bot||=[]).push({id:j.id,name:j.name,prompt:j.prompt,schedule:{kind:'interval',minutes:5},deliver:'local',enabled:true,state:'scheduled',...(j.extra||{})})}}

test('weekly review: 12 or more runs and 80% or more silent is one Health item per agent, with the better design',async()=>{const x=await make();
 try{await withJobs(x,[{id:'r1',name:'Shop Sales Recap',prompt:RECAP_A},{id:'r2',name:'Lab sales recap',prompt:RECAP_B},{id:'m1',name:'Meeting watcher',prompt:MEETING},{id:'t1',name:'Master To Do sync',prompt:TODO},
   {id:'d1',name:'Answer DMs',prompt:THREADS},{id:'q1',name:'Mostly useful',prompt:CHECKIN},{id:'q2',name:'Too few runs',prompt:CHECKIN},{id:'q3',name:'Old runs only',prompt:CHECKIN},{id:'q4',name:'Paused',prompt:CHECKIN,extra:{enabled:false,state:'paused'}},{id:'q5',name:'Script',prompt:'',extra:{no_agent:true,script:'x.sh'}}]);
  await writeFile(path.join(x.H,'profiles','bot','cron','usage_audit.jsonl'),audit('r1',188,179)+audit('r2',188,180)+audit('m1',110,106,{tokens:79000})+audit('t1',75,69,{tokens:200000})+audit('d1',106,90,{tokens:474000})+
   audit('q1',40,31)+audit('q2',11,11)+audit('q3',50,50,{at:Date.UTC(2026,10,3,0,0)})+audit('q4',30,30)+audit('q5',30,30)+'not json\n'+audit('gone',30,30));
  const [it]=await x.G.needs(true);assert.equal((await x.G.needs(true)).length,1,'one item per agent');assert.equal(it.id,'design|bot');assert.equal(it.kind,'design');
  assert.equal(it.title,'Bot: 5 schedules woke the AI 624 times this week for nothing');
  assert.deepEqual(it.jobs.map(j=>[j.job,j.runs,j.silent,j.how,j.mechanical,j.label]),[['r2',188,180,'script',true,'Make it script-only'],['r1',188,179,'script',true,'Make it script-only'],['m1',110,106,'step0',true,'Move its check in front'],['d1',106,90,'check',true,'Add a check'],['t1',75,69,'ask',false,'']]);
  assert.match(it.text,/“Shop Sales Recap” started the AI 188 times in 7 days and 179 of them said nothing \(7\.1M tokens\)\. Better: it only runs one command and repeats what it prints: that runs as a script with no AI\./);
  assert.match(it.text,/“Lab sales recap”.*by a fixed line rule/);assert.match(it.text,/“Meeting watcher”.*the script becomes the check, so the AI starts only when it prints something/);assert.match(it.text,/“Master To Do sync”.*ask Bot to start it from an event, or to write a small check script/);
  assert.deepEqual(await x.G.needs(false),[],'admins only');
  // the button: the recap becomes script-only, as a version
  assert.deepEqual(await x.G.decide('bot','r1','apply'),{ok:true,how:'script',script:'aq-job-r1.sh'});const r1=x.jobs().find(j=>j.id==='r1');assert.equal(r1.no_agent,true);assert.equal(r1.script,'aq-job-r1.sh');
  assert.match(x.records[0].what,/"Shop Sales Recap" now runs its command without a model turn/);assert.equal(x.records[0].before.prompt,RECAP_A);
  // the filtered recap keeps its line rule in the script
  await x.G.decide('bot','r2','apply');const s2=await x.scriptOf('aq-job-r2.sh');for(const v of ['-> OK|ERROR','skip:','Recap: '])assert.ok(s2.includes(Buffer.from(v).toString('base64')));
  // step 0 moves in front: the check file, and the prompt says it has already run
  assert.deepEqual(await x.G.decide('bot','m1','apply'),{ok:true,how:'check',check:'python3 ~/.hermes/profiles/bot/scripts/meeting_watch.py'});assert.ok(x.jobs().find(j=>j.id==='m1').prompt.startsWith(STEP0_NOTE+'\n\nYou are the team agent.'));
  assert.match(await x.scriptOf('aqeelos-check-m1.sh'),/own check for this schedule/);
  // a standard check where the words fit; nothing mechanical for the rule-table sync, which can only be kept or handed to the agent
  assert.deepEqual(await x.G.decide('bot','d1','apply'),{ok:true,how:'check',checks:'--dms --comments --max-idle 60'});await assert.rejects(x.G.decide('bot','t1','apply'),/Nothing here can be changed by a button/);
  assert.deepEqual(await x.G.decide('bot','t1','keep'),{ok:true,kept:true});await assert.rejects(x.G.decide('bot','../x','keep'),/Unknown schedule/);await assert.rejects(x.G.decide('bot','t1','delete'),/Unknown choice/);
  const after=await x.G.needs(true);assert.deepEqual(after.flatMap(i=>i.jobs.map(j=>[j.job,j.how])),[['m1','ask'],['d1','ask']],'converted and kept ones are gone; a schedule whose check still lets everything through is said so');
  assert.match(after[0].text,/it has a check or an event already, and most runs still find nothing/);
  assert.deepEqual((await x.G.triggers([{id:'r1',profile:'bot',no_agent:true},{id:'m1',profile:'bot'}]))['bot|m1'],{kind:'check',label:'A check first, then the AI',detail:'python3 ~/.hermes/profiles/bot/scripts/meeting_watch.py',why:'aqeelOS: step 0 of the prompt was a script that decides whether there is anything to do'})}finally{x.close()}});

test('the review is kept for an hour and read again on demand; the Health card and the schedule card show it',async()=>{const x=await make();
 try{await withJobs(x,[{id:'r1',name:'Shop Sales Recap',prompt:RECAP_A}]);const f=path.join(x.H,'profiles','bot','cron','usage_audit.jsonl');
  assert.deepEqual(await x.G.review(),[]);await writeFile(f,audit('r1',12,10));assert.deepEqual(await x.G.review(),[],'kept');assert.equal((await x.G.review({force:true})).length,1);
  await writeFile(f,audit('r1',12,9));x.tick(3601e3);assert.deepEqual(await x.G.review(),[],'75% silent is under the line');
  const ui=src('app/bottlenecks.js');assert.match(ui,/x\.kind==='design'/);assert.match(ui,/\/ui\/design-guard\/decide',\{agent:x\.agent,job:j\.job,choice:'apply'\}/);assert.match(ui,/choice:'keep'/);assert.match(src('app/bottlenecks.mjs'),/case 'design':/);
  const s=src('app/server.mjs');assert.match(s,/designGuard\.needs\(admin\)/);assert.match(s,/p==='\/ui\/design-guard\/decide'&&req\.method==='POST'\)\{if\(!users\.isAdmin\(u\)\)/);assert.match(s,/d\.triggers=await schedules\.jobs\(\)/);
  const card=src('app/schedules.js');assert.match(card,/\$\{triggerLine\(j\)\}/);assert.match(card,/'Why this trigger'/)}finally{x.close()}});

// ---- the echo converter's race with the run gate ----
test('agent-care converts a recap whose only script is aqeelOS\'s own run gate; a script of the person\'s behind the gate is left alone',async()=>{
 const H=await mkdtemp(path.join(tmpdir(),'dg-care-')),W=path.join(H,'work'),S=path.join(H,'profiles','bot','scripts');await mkdir(S,{recursive:true});await mkdir(path.join(W,'bot'),{recursive:true});
 await writeFile(path.join(S,'aqeelos-gate-g1.sh'),gateBody({port:4400,agent:'bot',jobId:'g1',sig:'s'}));await writeFile(path.join(S,'aqeelos-gate-g2.sh'),gateBody({port:4400,agent:'bot',jobId:'g2',sig:'s',original:'aqeelos-posting-gate.sh'}));
 const jobs=[{id:'g1',name:'Shop Sales Recap',prompt:RECAP_A,script:'aqeelos-gate-g1.sh',enabled:true},{id:'g2',name:'Posting recap',prompt:RECAP_A,script:'aqeelos-gate-g2.sh',enabled:true},{id:'g3',name:'Own script',prompt:RECAP_A,script:'mine.py',enabled:true},
  {id:'g4',name:'Lab sales recap',prompt:RECAP_B,enabled:true},{id:'g5',name:'Plain',prompt:WATCHDOG,enabled:true},{id:'g6',name:'Meetings',prompt:MEETING,script:'aqeelos-gate-g6.sh',enabled:true}];
 const updates=[],care=createAgentCare({HERMES_HOME:H,WORK:W,homes:async()=>['bot'],readConfig:async()=>({terminal:{backend:'ssh',ssh_user:'ag-bot',cwd:'/w/bot'}}),pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),jobs:async()=>jobs,
  updateJob:async(a,id,up)=>{updates.push([id,up])},notices:{setNotices:async()=>({})},log:()=>{}});
 assert.deepEqual(await care.scriptOnly('bot'),['g1','g5']);assert.deepEqual(updates,[['g1',{no_agent:true,script:'aq-job-g1.sh'}],['g5',{no_agent:true,script:'aq-job-g5.sh'}]]);
 assert.equal(Buffer.from(/echo (\S+) \| base64/.exec(await readFile(path.join(S,'aq-job-g1.sh'),'utf8'))[1],'base64').toString(),'python3 -I /w/bot/sales-recap/run.py')});

// ---- the scripts, run for real (bash; a stand-in ssh runs the command here) ----
const bash=(()=>{try{return execFileSync('bash',['-c','command -v base64 awk sed timeout >/dev/null && echo ok'],{encoding:'utf8'}).trim()==='ok'}catch{return false}})();
test('the scripts run: a script-only schedule filters its lines, an own check stops the run or hands its output to it',{skip:!bash&&'no bash here'},async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'dg-sh-')),bin=path.join(d,'bin');await mkdir(bin);await writeFile(path.join(bin,'ssh'),'#!/bin/bash\nfor last; do :; done\neval "$last"\n',{mode:0o755});
 const run=async(name,body)=>{const f=path.join(d,name);await writeFile(f,body,{mode:0o755});try{return {out:execFileSync('bash',[f],{encoding:'utf8',cwd:d,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}}),code:0}}catch(e){return {out:String(e.stdout||''),code:e.status}}};
 const o={agent:'bot',user:'ag-bot',key:'/k/id',cwd:'.'},lines="printf 'skip: a\\nS-1 -> OK\\nS-2 pending\\nS-3 ERROR x\\n'";
 assert.deepEqual(await run('a.sh',jobScript({...o,cmd:lines})),{out:'skip: a\nS-1 -> OK\nS-2 pending\nS-3 ERROR x\n',code:0});
 assert.deepEqual(await run('b.sh',jobScript({...o,cmd:lines,keep:'-> OK|ERROR',drop:'skip:',prefix:'Recap: '})),{out:'Recap: S-1 -> OK\nRecap: S-3 ERROR x\n',code:0});
 assert.deepEqual(await run('c.sh',jobScript({...o,cmd:'true',prefix:'Recap: '})),{out:'',code:0},'nothing printed, nothing sent');
 assert.deepEqual(await run('d.sh',jobScript({...o,cmd:"echo \"it's $((1+1))\" 'q'; exit 3",keep:"it's"})),{out:'it\'s 2 q\n',code:3},'the command and the pattern travel as base64; a failure is still a failure');
 assert.throws(()=>jobScript({...o,user:'root',cmd:'id'}),/no own Linux user/);assert.throws(()=>jobScript({...o,cwd:"/w/x'; id; '",cmd:'id'}),/no own Linux user/);
 assert.equal((await run('e.sh',ownCheckScript({...o,cmd:'true'}))).out,'{"anythingToDo": false}\n');assert.equal((await run('f.sh',ownCheckScript({...o,cmd:'echo READY f1 Standup'}))).out,'READY f1 Standup\n{"anythingToDo": true}\n');
 assert.equal((await run('g.sh',ownCheckScript({...o,cmd:'exit 2'}))).out,'\n{"anythingToDo": true}\n','a check that fails never stops a run');
 // through the run gate (aqeelOS not answering, so the run would go ahead): nothing printed stops the AI, output is handed to the run
 await writeFile(path.join(d,'aqeelos-check-j1.sh'),ownCheckScript({...o,cmd:'echo READY f1 Standup'}));const go=await run('aqeelos-gate-j1.sh',gateBody({port:1,agent:'bot',jobId:'j1',sig:'s'}));
 assert.equal(go.out,'What the check of this schedule printed just now (it has run; do not run it again):\nREADY f1 Standup\naqeelOS run check: clear to run.\n{"wakeAgent": true}\n');
 await writeFile(path.join(d,'aqeelos-check-j1.sh'),ownCheckScript({...o,cmd:'true'}));assert.match((await run('aqeelos-gate-j1.sh',gateBody({port:1,agent:'bot',jobId:'j1',sig:'s'}))).out,/nothing to do this time\.\n\{"wakeAgent": false\}\n$/);
 await writeFile(path.join(d,'aqeelos-check-j1.sh'),'#!/bin/bash\necho \'{"anythingToDo": true, "reason": "there is something waiting"}\'\n');assert.equal((await run('aqeelos-gate-j1.sh',gateBody({port:1,agent:'bot',jobId:'j1',sig:'s'}))).out,'aqeelOS run check: clear to run.\n{"wakeAgent": true}\n','a standard check adds nothing to the run')});

// ---- the engine plugin's part (python) ----
const PY=`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('al',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls=[]
def fake(path,data,timeout):
    calls.append([path,sorted(data['args'].keys())])
    return {'block':'Not saved: make it with my_schedules'} if 'run exactly' in str(data['args'].get('prompt','')).lower() else {'block':None}
def down(path,data,timeout):
    raise OSError('aqeelOS is down')
out=[m.design_block(t,a,fake) for t,a in json.loads(sys.argv[2])]
print(json.dumps({'out':out,'calls':calls,'down':m.design_block('cronjob',{'action':'create','prompt':'Run exactly this command: x','schedule':'every 5m'},down)}))`;
const python=(()=>{try{return /Python 3/.test(execFileSync('python3',['--version'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))}catch{return false}})();
test('engine: the cronjob tool asks aqeelOS before a schedule is made or changed, and goes ahead when there is no answer',{skip:!python&&'no python3 here'},()=>{
 const r=JSON.parse(execFileSync('python3',['-I','-c',PY,path.join(ROOT,'engine','aqeelos-live','__init__.py'),JSON.stringify([['cronjob',{action:'create',name:'Recap',prompt:'Run exactly this command: python3 a.py',schedule:'every 5m',skills:['x']}],
  ['cronjob',{action:'create',name:'Report',prompt:'Write the weekly report',schedule:'0 9 * * 1'}],['cronjob',{action:'update',job_id:'j1',name:'New name'}],['cronjob',{action:'list'}],['skill_manage',{action:'create',prompt:'Run exactly this command: x'}]])],{encoding:'utf8'}));
 assert.deepEqual(r.out,['Not saved: make it with my_schedules',null,null,null,null]);assert.deepEqual(r.calls,[['/schedule-review',['action','name','prompt','schedule']],['/schedule-review',['action','name','prompt','schedule']]],'only a create or a change of prompt or schedule is asked about');
 assert.equal(r.down,null)});

test('a change is reviewed for what it changes: a rename or a prompt fix of an existing schedule is not held up',async()=>{const x=await make();
 try{await withJobs(x,[{id:'f1',name:'Answer DMs',prompt:THREADS},{id:'e1',name:'Shop Sales Recap',prompt:RECAP_A},{id:'s1',name:'Meeting watcher',prompt:MEETING,extra:{schedule:{kind:'cron',expr:'*/30 9-19 * * 1-5'}}}]);
  assert.ok(!(await x.sched({action:'edit',id:'f1',name:'Answer DMs and replies'})).isError);assert.ok(!(await x.sched({action:'edit',id:'f1',prompt:THREADS+' Be brief.'})).isError,'the owner may have kept it every 5 minutes');
  assert.equal((await x.sched({action:'edit',id:'f1',schedule:'every 10m'})).isError,true);assert.ok(!(await x.sched({action:'edit',id:'f1',schedule:'every 10m',checks:'--dms'})).isError,'an edit can add the check');
  assert.ok(!(await x.sched({action:'edit',id:'s1',schedule:'*/30 8-20 * * 1-5'})).isError);assert.equal((await x.sched({action:'edit',id:'s1',prompt:MEETING+'\n5. Thank the team.'})).isError,true);
  assert.equal(await x.G.engineCall('bot',{action:'update',job_id:'s1',schedule:'0 * * * *'}),null);assert.match(await x.G.engineCall('bot',{action:'update',job_id:'s1',prompt:MEETING}),/check_script/);
  // an echo whose prompt is saved again is converted on the spot
  const r=await x.sched({action:'edit',id:'e1',prompt:RECAP_A,schedule:'every 1h'});assert.ok(!r.isError,r.text);assert.match(r.text,/aqeelOS made it a script-only schedule/);assert.equal(x.jobs().find(j=>j.id==='e1').no_agent,true)}finally{x.close()}});
