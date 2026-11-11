// Tests for app/run-checks.mjs (the standard no-model checks). Run: node --test scripts/run-checks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cdpPortOf,titleCount,unreadDms,unansweredComments,postingAllowed,combine,listOf,wordsOf,runCommand,commandWork} from '../app/run-checks.mjs';

test('the DevTools port comes from the agent config; the title count from the page title',()=>{
 assert.equal(cdpPortOf('browser:\n  headed: true\n  cdp_url: http://127.0.0.1:9600\n  x: 1'),9600);assert.equal(cdpPortOf('a: b'),null);assert.equal(cdpPortOf('  cdp_url: "https://evil.com:9600"'),null);
 assert.equal(titleCount('(3) Search • Threads'),3);assert.equal(titleCount('Threads'),0);assert.equal(titleCount('(12+) Threads'),12)});

const pages=t=>async u=>/json\/list/.test(u)?[{type:'page',url:'https://www.threads.com/x',title:t}]:null;
test('unread DMs: title mode, inbox mode, both, and unknown',async()=>{
 assert.deepEqual(await unreadDms({port:9600,mode:'title',fetchJson:pages('(2) Threads')}),{count:2,known:true,why:'title 2'});
 assert.equal((await unreadDms({port:9600,mode:'title',fetchJson:pages('Threads')})).count,0);
 const inbox=n=>async()=>({login:false,count:n,rows:4});
 assert.equal((await unreadDms({port:9600,mode:'inbox',lookFn:inbox(5),wake:async()=>true})).count,5);
 assert.equal((await unreadDms({port:9600,fetchJson:pages('Threads'),lookFn:inbox(1)})).count,1,'both: the larger');
 const u=await unreadDms({port:9600,fetchJson:async()=>null,lookFn:async()=>null});assert.equal(u.known,false);assert.equal(u.count,null);
 assert.equal((await unreadDms({port:9600,mode:'inbox',wake:async()=>true,lookFn:async()=>({login:true})})).known,false,'signed out is unknown, not zero');
 assert.equal((await unreadDms({port:9600,mode:'inbox',wake:async()=>true,lookFn:async()=>({login:false,count:0,rows:0})})).known,false,'an inbox that did not load is unknown');
 assert.equal((await unreadDms({})).known,false)});

const resp=(j,ok=true,status=200)=>async()=>({ok,status,json:async()=>j});
test('Tebar comments: only the unanswered ones, per platform; any failure is unknown',async()=>{
 const l=[{id:1,reply_status:'unreplied',platform:'threads'},{id:2,reply_status:'replied',platform:'threads'},{id:3,platform:'instagram'}];
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({data:l})})).count,2);
 assert.equal((await unansweredComments({key:'k',platform:'threads',fetchFn:resp(l)})).count,1);
 assert.equal((await unansweredComments({fetchFn:resp(l)})).known,false,'no key');
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({},false,401)})).known,false);
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({oops:1})})).known,false,'not a list');
 assert.equal((await unansweredComments({key:'k',fetchFn:async()=>{throw Error('down')}})).known,false);
 assert.deepEqual(listOf({comments:[1]}),[1])});

test('posting allowed: the posting limits decide; off or missing says nothing',async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'aq-rc-'));const now=Date.parse('2026-11-11T08:00:00Z');
 assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,null);
 await writeFile(path.join(DATA,'posting-limits.json'),JSON.stringify({agents:{ct:{on:true,tz:'UTC',perHour:2,gapMin:10,perDay:20,quietFrom:0,quietTo:0}}}));
 await mkdir(path.join(DATA,'posting-log'));
 assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,true);
 await writeFile(path.join(DATA,'posting-log','ct.json'),JSON.stringify([{at:now-5*60e3,lead:'hot',status:'visible'}]));
 const x=await postingAllowed({DATA,agent:'ct',now});assert.equal(x.allow,false);assert.match(x.why,/min ago/);
 await writeFile(path.join(DATA,'posting-log','ct.json'),JSON.stringify([{at:now-70*60e3,lead:'hot'}]));assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,true,'gap over')});

test('combine: nothing waiting stops the run; unknown or something waiting lets it go; a closed posting limit stops it',()=>{
 const z={count:0,known:true,why:'0'},n={count:null,known:false,why:'?'},p={count:2,known:true,why:'2'};
 assert.equal(combine({work:[z,z]}).anythingToDo,false);assert.equal(combine({work:[z,p]}).anythingToDo,true);assert.equal(combine({work:[z,n]}).anythingToDo,true,'unknown never stops a run');
 assert.equal(combine({work:[p],need:[{allow:false,known:true,why:'a post 5 min ago'}]}).anythingToDo,false);
 assert.equal(combine({work:[p],need:[{allow:null,known:false,why:'off'}]}).anythingToDo,true);assert.equal(combine({}).anythingToDo,true,'no check given');
 assert.match(JSON.stringify(combine({work:[z]})),/"anythingToDo":false/)});

test('a schedule check wakes a sleeping browser first and waits for it; one that does not wake is unknown, never zero',async()=>{
 const {wakeBrowser,unreadDms}=await import('../app/run-checks.mjs');
 let waited=0;
 const slow=async u=>{waited++;await new Promise(r=>setTimeout(r,30));return /json\/version/.test(u)?{webSocketDebuggerUrl:'ws://x'}:null};
 assert.equal(await wakeBrowser({port:9600,fetchJson:slow}),true);assert.equal(waited,1);
 assert.equal(await wakeBrowser({port:9600,fetchJson:async()=>null}),false);assert.equal(await wakeBrowser({port:0}),false);
 const seen=[];
 const r=await unreadDms({port:9600,mode:'title',fetchJson:async()=>[{type:'page',url:'https://www.threads.com/',title:'(3) Threads'}],wake:async o=>{seen.push(o.port);return true}});
 assert.equal(r.count,3);assert.deepEqual(seen,[9600]);
 const r2=await unreadDms({port:9600,mode:'title',fetchJson:async()=>[],wake:async()=>false});
 assert.equal(r2.count,null);assert.equal(r2.known,false);assert.match(r2.why,/asleep/)});

import {newSince,fingerprint,idleSafety,loadState,saveState} from '../app/run-checks.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';

test('new since: a changed source is work, then retries, then a safety run, then nothing; unreadable is unknown',async()=>{
 const files={'file:/f/a.jsonl':'h1:10','file:/f/b.json':'h2:5'},fp=async x=>files[x]??null,src=Object.keys(files),T=Date.parse('2026-11-12T00:00:00Z');
 let r=await newSince({sources:src,state:{},now:T,retries:2,fp});assert.equal(r.count,2);assert.match(r.why,/first look/);
 let st=r.next;r=await newSince({sources:src,state:st,now:T+300e3,retries:2,fp});assert.equal(r.count,1);assert.match(r.why,/retry.*1 more/);st=r.next;
 r=await newSince({sources:src,state:st,now:T+600e3,retries:2,fp});assert.equal(r.count,1);assert.match(r.why,/0 more/);st=r.next;
 r=await newSince({sources:src,state:st,now:T+900e3,retries:2,fp});assert.equal(r.count,0);assert.equal(r.known,true);st=r.next;
 files['file:/f/a.jsonl']='h1:11';r=await newSince({sources:src,state:st,now:T+1200e3,retries:2,fp});assert.equal(r.count,1);assert.match(r.why,/1 of 2 sources changed/);st=r.next;
 await newSince({sources:src,state:st,now:T+1500e3,retries:2,fp}).then(x=>{st=x.next});await newSince({sources:src,state:st,now:T+1800e3,retries:2,fp}).then(x=>{st=x.next});
 r=await newSince({sources:src,state:st,now:T+2100e3,retries:2,maxIdleMin:60,fp});assert.equal(r.count,0,'28 min since the last go');st=r.next;
 r=await newSince({sources:src,state:st,now:T+1800e3+61*60e3,retries:2,maxIdleMin:60,fp});assert.equal(r.count,1);assert.match(r.why,/safety run/);
 delete files['file:/f/b.json'];r=await newSince({sources:src,state:st,fp});assert.equal(r.known,false);assert.equal(r.count,null);assert.match(r.why,/could not read f\/b.json/);
 assert.equal((await newSince({sources:[],fp})).known,false)});

test('fingerprint changes when the file changes and is null when it is not there',async()=>{const d=await mkdtemp(path.join(tmpdir(),'aq-ns-'));const f=path.join(d,'p.jsonl');
 assert.equal(await fingerprint('file:'+f),null);await writeFile(f,'{"a":1}\n');const a=await fingerprint('file:'+f);await writeFile(f,'{"a":1}\n{"a":2}\n');assert.notEqual(await fingerprint(f),a);assert.match(a,/^[0-9a-f]{16}:8$/)});

test('safety run: only after the answer was nothing for that long, and never over a closed posting limit',()=>{
 const no={anythingToDo:false,reason:'nothing'},T=1e12;
 assert.equal(idleSafety(no,{state:{lastGo:T-30*60e3},now:T,maxIdleMin:60}).result.anythingToDo,false);
 const s=idleSafety(no,{state:{lastGo:T-61*60e3},now:T,maxIdleMin:60});assert.equal(s.result.anythingToDo,true);assert.equal(s.next.lastGo,T);
 assert.equal(idleSafety({anythingToDo:true},{state:{lastGo:1},now:T,maxIdleMin:60}).next.lastGo,T);
 assert.equal(idleSafety(no,{state:{},now:T,maxIdleMin:60}).result.anythingToDo,false,'the first look starts the clock')});

const run=promisify(execFile);
test('run-check.mjs --new-since end to end: state file kept per job, quick exit, JSON on the last line',async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'aq-rc2-')),data=path.join(d,'data'),feed=path.join(d,'payments.jsonl');await writeFile(feed,'{"id":1}\n');
 const go=async()=>{const t=Date.now();const {stdout}=await run(process.execPath,[path.join(import.meta.dirname,'run-check.mjs'),'--agent','x','--home',d,'--data',data,'--job','j1','--new-since','file:'+feed,'--retries','1'],{timeout:20000});
  return {...JSON.parse(stdout.trim().split('\n').pop()),ms:Date.now()-t}};
 assert.equal((await go()).anythingToDo,true);assert.equal((await go()).anythingToDo,true,'one retry');
 const q=await go();assert.equal(q.anythingToDo,false);assert.match(q.reason,/nothing waiting: nothing new/);assert.ok(q.ms<5000);
 await writeFile(feed,'{"id":1}\n{"id":2}\n');assert.equal((await go()).anythingToDo,true);
 assert.match(await readFile(path.join(data,'run-checks','j1.json'),'utf8'),/"ns"/)});

test('--comments without a Tebar key is unknown and lets the run go; no unread chats with no browser is unknown too',async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'aq-rc3-'));
 const {stdout}=await run(process.execPath,[path.join(import.meta.dirname,'run-check.mjs'),'--agent','x','--home',d,'--dms','--comments'],{timeout:20000,env:{...process.env,TEBAR_API_KEY:''}});
 const o=JSON.parse(stdout.trim());assert.equal(o.anythingToDo,true);assert.match(o.detail.join(' '),/no Tebar API key/);assert.match(o.detail.join(' '),/no DevTools port/)});

// ---- a command that prints when there is work ----
const fake=(out,ok=true,code=0,err='')=>{const calls=[];const f=async(file,args,opt)=>{calls.push([file,args,opt]);return {ok,out,err,code}};f.calls=calls;return f};
test('a command is plain words; anything else is refused before it runs',()=>{
 assert.deepEqual(wordsOf('python3 -I x/run.py --a=1'),['python3','-I','x/run.py','--a=1']);
 for(const bad of ['','a; b','a | b','$(id)','a `b`','a "b c"','a > f','a && b'])assert.equal(wordsOf(bad),null,bad)});
test('--cmd: printed lines are work, nothing printed is not, a failed command is unknown (the run goes ahead)',async()=>{
 let w=await commandWork({label:'c',cmd:'node check.mjs',exec:fake('READY abc\nFAILED def\n')});assert.equal(w.count,2);assert.equal(w.known,true);
 w=await commandWork({label:'c',cmd:'node check.mjs',exec:fake('\n  \n')});assert.equal(w.count,0);assert.equal(w.known,true);
 w=await commandWork({label:'c',cmd:'node check.mjs',exec:fake('',false,1,'boom')});assert.equal(w.known,false);assert.equal(w.count,null);assert.match(w.why,/boom/);
 w=await commandWork({label:'c',cmd:'node check.mjs',exec:fake('',false,124)});assert.match(w.why,/longer than/);
 assert.equal((await commandWork({label:'c',cmd:'a; b',exec:fake('x')})).known,false);
 assert.equal(combine({work:[await commandWork({label:'c',cmd:'node c.mjs',exec:fake('x')})]}).anythingToDo,true);
 assert.equal(combine({work:[await commandWork({label:'c',cmd:'node c.mjs',exec:fake('')})]}).anythingToDo,false);
 assert.equal(combine({work:[await commandWork({label:'c',cmd:'node c.mjs',exec:fake('',false,1)})]}).anythingToDo,true,'unknown never stops a run')});
test('--cmd-once: the same output is not work twice, a changed one is, and an empty answer forgets',async()=>{
 let w=await commandWork({label:'c',cmd:'x.sh',once:true,exec:fake('stage 2 due 2026-10 R2\n')});assert.equal(w.count,1);
 let w2=await commandWork({label:'c',cmd:'x.sh',once:true,state:{cmd:w.next},exec:fake('stage 2 due 2026-10 R2\n')});assert.equal(w2.count,0);assert.match(w2.why,/already reported/);
 let w3=await commandWork({label:'c',cmd:'x.sh',once:true,state:{cmd:w.next},exec:fake('stage 2 due 2026-10 R3\n')});assert.equal(w3.count,1);
 let w4=await commandWork({label:'c',cmd:'x.sh',once:true,state:{cmd:w.next},exec:fake('')});assert.equal(w4.count,0);assert.deepEqual(w4.next,{});
 let w5=await commandWork({label:'c',cmd:'x.sh',once:true,state:{cmd:w4.next},exec:fake('stage 2 due 2026-10 R2\n')});assert.equal(w5.count,1,'it came back, so it is work again');
 let n=await commandWork({label:'c',cmd:'x.sh',once:false,state:{cmd:w.next},exec:fake('stage 2 due 2026-10 R2\n')});assert.equal(n.count,1,'without once every print is work')});
test('--agent-cmd: ssh as the agent\'s own user, cd into its folder, a timeout, paths stay inside; no own user is unknown',async()=>{
 const as={user:'ag-pixel-agent',key:'/k/id',dir:'/home/claude/workspaces/pixel-agent'};const f=fake('READY 1\n');
 const r=await runCommand({cmd:'.hermes/profiles/pixel-agent/scripts/meeting_watch.py',as,timeoutSec:25,exec:f});assert.equal(r.ok,true);
 const [file,args,opt]=f.calls[0];assert.equal(file,'ssh');assert.ok(args.includes('ag-pixel-agent@127.0.0.1'));assert.ok(args.includes('BatchMode=yes'));
 assert.equal(args.at(-1),"cd '/home/claude/workspaces/pixel-agent' && timeout -k 3 22 python3 .hermes/profiles/pixel-agent/scripts/meeting_watch.py");assert.equal(opt.timeout,25000);
 for(const bad of ['/etc/x.py','python3 ../x.py'])assert.equal((await runCommand({cmd:bad,as,exec:fake('x')})).ok,false);
 assert.equal((await runCommand({cmd:'x.py',as:{...as,user:undefined},exec:fake('x')})).ok,false);
 const l=fake('x');await runCommand({cmd:'node /opt/c.mjs --a',exec:l});assert.deepEqual([l.calls[0][0],l.calls[0][1]],['node',['/opt/c.mjs','--a']],'--cmd runs here, no shell')});
