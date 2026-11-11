// Tests for event hooks: a payment found PAID runs the agent's recap script at once, no model (app/event-hooks.mjs, app/paid-labels.mjs events,
// scripts/hooks-wire.mjs). Run: node --test scripts/event-hooks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPaidLabels} from '../app/paid-labels.mjs';
import {commandOf,remoteCommand,cleanHook,writeFeed,fallbackScript,createEventHooks,BUSY} from '../app/event-hooks.mjs';

const A='continue-support',B='biomarkers-support',CHAT='telegram:-1003999095054:5';
const HOOK={id:'sales-recap',on:['payment.paid','order.posted'],run:'python3 -I sales-recap/run.py',deliver:CHAT,feed:'sales-recap/feed',minGapSec:60};
const ev=(type='payment.paid')=>({type,data:{kind:'qris'}});

test('a hook command is plain words inside the agent\'s folder, run under the agent\'s lock with a timeout',()=>{
 assert.deepEqual(commandOf('python3 -I sales-recap/run.py'),['python3','-I','sales-recap/run.py']);
 assert.deepEqual(commandOf('sales-recap/run.py'),['python3','sales-recap/run.py']);assert.deepEqual(commandOf('x/y.sh a=b'),['bash','x/y.sh','a=b']);assert.deepEqual(commandOf('bin/tool --x'),['./bin/tool','--x']);
 for(const bad of ['','/etc/x.py','python3 ../x.py','python3 x.py; rm -rf ~','python3 x.py | cat','python3 $(id)','python3 `id`','-I x.py','python3','python3 "x y.py"'])assert.equal(commandOf(bad),null,bad);
 assert.equal(remoteCommand('python3 -I sales-recap/run.py',{timeoutSec:120,lockWait:30}),'flock -w 30 -E 75 .aqeelos-event-hooks.lock timeout -k 5 120 python3 -I sales-recap/run.py');
 assert.throws(()=>remoteCommand('x; y'))});

test('a hook as written is cleaned; a bad one is dropped, not guessed at',()=>{
 assert.deepEqual(cleanHook({...HOOK,keep:'-> OK|ERROR',prefix:'Recap: ',dedupe:true,timeoutSec:99999}),{...cleanHook(HOOK),keep:'-> OK|ERROR',prefix:'Recap: ',dedupe:true,timeoutSec:1800});
 const h=cleanHook({on:'payment.paid',run:'sales-recap/run.py',deliver:CHAT});assert.match(h.id,/^h-[0-9a-f]{10}$/);assert.equal(h.gap,60);assert.equal(h.timeoutSec,300);assert.equal(h.feed,null);
 for(const bad of [null,{run:'x.py'},{on:'a',run:'../x.py'},{on:'a',run:'x.py',deliver:'chat 5'},{on:'a',run:'x.py',feed:'/etc'},{on:'a',run:'x.py',feed:'../x'},{on:'a',run:'x.py',keep:'('}])assert.equal(cleanHook(bad),null,JSON.stringify(bad))});

async function mk(hooks={[A]:[HOOK]},o={}){const DATA=await mkdtemp(path.join(tmpdir(),'aq-eh-')),WORK=path.join(DATA,'ws');await mkdir(path.join(WORK,A),{recursive:true});await mkdir(path.join(WORK,B),{recursive:true});
 await writeFile(path.join(DATA,'event-hooks.json'),JSON.stringify(hooks));
 await writeFile(path.join(DATA,'payments.jsonl'),[{agent:A,at:'t1',total:5,form:'x'},{agent:B,at:'t2',total:6},{agent:A,at:'t3',total:7}].map(p=>JSON.stringify(p)).join('\n')+'\nnot json\n');
 await writeFile(path.join(DATA,'paid-labels.json'),JSON.stringify({done:{[A+'|t1|5']:{state:'labelled',order:{state:'posted'}},[B+'|t2|6']:{state:'labelled'}}}));
 const ran=[],sent=[],probs=[],oks=[],timers=[];let t=1e6,out='',res=null,deliverErr=null,holding=false,waiters=[],active=0,maxActive=0;
 const E=createEventHooks({DATA,WORK,now:()=>t,log:()=>{},setTimer:(fn,ms)=>timers.push({fn,ms}),enabled:()=>o.enabled!==false,
  runAs:async(a,remote,ms)=>{ran.push([a,remote,ms]);active++;maxActive=Math.max(maxActive,active);if(holding)await new Promise(r=>waiters.push(r));active--;return res||{ok:true,out,err:'',code:0}},
  deliver:async(a,target,text)=>{if(deliverErr)throw Error(deliverErr);sent.push([a,target,text])},problem:async(a,topic,title)=>probs.push([a,topic,title]),solved:async(a,topic)=>oks.push([a,topic])});
 return {E,DATA,WORK,ran,sent,probs,oks,timers,tick:ms=>{t+=ms},say:v=>{out=v},result:v=>{res=v},failDelivery:v=>{deliverErr=v},hold:()=>{holding=true},free:()=>{holding=false},go:async()=>{while(!waiters.length)await new Promise(r=>setImmediate(r));waiters.shift()()},peak:()=>maxActive}}

test('the feed holds the agent\'s own payments and paid state only, and is rewritten only when it changed',async()=>{const {DATA,WORK}=await mk();
 assert.deepEqual(await writeFeed({DATA,WORK,agent:A,dir:'sales-recap/feed'}),['payments.jsonl','paid-labels.json']);
 const dir=path.join(WORK,A,'sales-recap','feed'),rows=(await readFile(path.join(dir,'payments.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 assert.deepEqual(rows.map(r=>r.at),['t1','t3']);assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(dir,'paid-labels.json'),'utf8')).done),[A+'|t1|5']);
 if(process.platform!=='win32')assert.equal((await stat(path.join(dir,'payments.jsonl'))).mode&0o077,0o040,'its group may read it, nobody else');
 assert.deepEqual(await writeFeed({DATA,WORK,agent:A,dir:'sales-recap/feed'}),[],'nothing changed');
 await appendFile(path.join(DATA,'payments.jsonl'),JSON.stringify({agent:A,at:'t4',total:8})+'\n');assert.deepEqual(await writeFeed({DATA,WORK,agent:A,dir:'sales-recap/feed'}),['payments.jsonl'])});

test('an event runs the script at once as the agent\'s own user, refreshes the feed first, and delivers what it printed to the schedule\'s chat',async()=>{const s=await mk();s.say('Sales Recap:\nline one\nline two\n');
 assert.deepEqual(await s.E.fire(A,ev()),['sales-recap']);await s.E.idle();
 assert.equal(s.ran.length,1);assert.equal(s.ran[0][0],A);assert.match(s.ran[0][1],/^flock -w 300 -E 75 \.aqeelos-event-hooks\.lock timeout -k 5 300 python3 -I sales-recap\/run\.py$/);
 assert.deepEqual(s.sent,[[A,CHAT,'Sales Recap:\nline one\nline two']]);await stat(path.join(s.WORK,A,'sales-recap','feed','paid-labels.json'));
 assert.equal((await s.E.view()).runs[A+'/sales-recap'].sent,3);
 s.tick(61e3);s.say('');await s.E.fire(A,ev('order.posted'));await s.E.idle();assert.equal(s.ran.length,2);assert.equal(s.sent.length,1,'nothing printed = nothing sent')});

test('events nobody listens for, other agents, and a switched-off app start nothing',async()=>{const s=await mk();
 assert.deepEqual(await s.E.fire(A,ev('comment.created')),[]);assert.deepEqual(await s.E.fire(B,ev()),[]);assert.deepEqual(await s.E.fire('../x',ev()),[]);assert.equal(s.ran.length,0);
 const off=await mk({[A]:[HOOK]},{enabled:false});assert.deepEqual(await off.E.fire(A,ev()),[]);assert.equal(off.ran.length,0)});

test('several events inside the gap become one run when the gap is over; runs of one agent never overlap',async()=>{const s=await mk({[A]:[HOOK,{...HOOK,id:'other',run:'python3 other/run.py',feed:undefined}]});s.hold();s.say('x');
 await s.E.fire(A,ev());await s.E.fire(A,ev());await s.E.fire(A,ev('order.posted'));
 assert.equal(s.timers.length,2,'one trailing run for each hook');assert.ok(s.timers.every(x=>x.ms===60000));
 await s.go();await s.go();await s.E.idle();assert.equal(s.peak(),1,'one at a time');assert.equal(s.ran.length,2);
 s.free();s.tick(60e3);s.timers[0].fn();await s.E.idle();assert.equal(s.ran.length,3)});

test('a delivery that failed is kept and goes out first on the next run, so a line the script printed once is not lost',async()=>{const s=await mk();s.say('first');s.failDelivery('Telegram did not take the message');
 await s.E.fire(A,ev());await s.E.idle();assert.equal(s.sent.length,0);assert.match((await s.E.view()).runs[A+'/sales-recap'].error,/not delivered: Telegram/);
 s.failDelivery(null);s.tick(61e3);s.say('second');await s.E.fire(A,ev());await s.E.idle();assert.deepEqual(s.sent.map(x=>x[2]),['first\nsecond'])});

test('keep, prefix and dedupe: only wanted lines, each said once in 24 hours',async()=>{const s=await mk({[B]:[{id:'recap',on:'payment.paid',run:'python3 sales-recap/recap.py',deliver:CHAT,keep:'-> OK|ERROR',prefix:'Recap: ',dedupe:true,minGapSec:0}]});
 s.say('k1 -> skip: tester\nk2 -> OK rows 3\nk3 -> ERROR boom\n');await s.E.fire(B,ev());await s.E.idle();assert.deepEqual(s.sent.map(x=>x[2]),['Recap: k2 -> OK rows 3\nRecap: k3 -> ERROR boom']);
 s.tick(1e3);await s.E.fire(B,ev());await s.E.idle();assert.equal(s.sent.length,1,'the same lines are not sent again');
 s.say('k3 -> ERROR boom\nk4 -> OK rows 1\n');s.tick(1e3);await s.E.fire(B,ev());await s.E.idle();assert.equal(s.sent[1][2],'Recap: k4 -> OK rows 1');
 s.tick(25*3600e3);await s.E.fire(B,ev());await s.E.idle();assert.equal(s.sent.length,3,'after a day an error is said again')});

test('health: one line when a run fails twice in a row, with the script\'s error; cleared when it works again',async()=>{const s=await mk();
 s.result({ok:false,out:'',err:'Traceback (most recent call last):\n  File "run.py", line 9\nKeyError: \'form\'\n',code:1});
 await s.E.fire(A,ev());await s.E.idle();assert.equal(s.probs.length,0,'once is not news');s.tick(61e3);await s.E.fire(A,ev());await s.E.idle();
 assert.equal(s.probs.length,1);assert.equal(s.probs[0][0],A);assert.equal(s.probs[0][1],'event-hook|sales-recap');assert.match(s.probs[0][2],/failed twice in a row: .*KeyError: 'form'/);assert.ok(!s.probs[0][2].includes('\n'));
 s.tick(61e3);await s.E.fire(A,ev());await s.E.idle();assert.equal(s.probs.length,1,'told once while it lasts');assert.equal(s.sent.length,0);
 s.result(null);s.say('');s.tick(61e3);await s.E.fire(A,ev());await s.E.idle();assert.deepEqual(s.oks,[[A,'event-hook|sales-recap']]);
 s.result({ok:false,out:'',err:'',code:124});s.tick(61e3);await s.E.fire(A,ev());await s.E.idle();assert.match((await s.E.view()).runs[A+'/sales-recap'].error,/longer than 300 s/);
 s.result({ok:false,out:'',err:'',code:BUSY});s.tick(61e3);await s.E.fire(A,ev());await s.E.idle();assert.match((await s.E.view()).runs[A+'/sales-recap'].error,/held the lock/)});

test('the fallback run is the same run, in line with the others, and reports its error',async()=>{const s=await mk();s.say('news');
 assert.equal(await s.E.runNow(A,'sales-recap'),null);assert.deepEqual(s.sent.map(x=>x[2]),['news']);assert.equal(await s.E.runNow(A,'nope'),'no such hook');
 s.result({ok:false,out:'',err:'boom',code:1});assert.equal(await s.E.runNow(A,'sales-recap'),'boom')});

const PAY={at:'2026-11-12T05:00:00.000Z',agent:A,line:'1',conversation:'cnv_1',phone:'628000000001',mode:'live',run:'r1',kind:'qris',amounts:[1187500],total:1187500,products:['S-X'],refs:['T1000000000001ABCDE'],orders:[],name:'N',form:'Nama: N\nProduk: W',ok:true};
async function paidLabels(o={}){const W=await mkdtemp(path.join(tmpdir(),'aq-ehp-')),D=path.join(W,'data'),got=[],state={v:'UNPAID'};let t=Date.parse(PAY.at)+60e3,post=o.post||(async()=>77);
 await mkdir(path.join(W,A,'.secrets'),{recursive:true});await mkdir(D,{recursive:true});await writeFile(path.join(W,A,'.secrets','TRIPAY_API_KEY'),'k');await writeFile(path.join(D,'payments.jsonl'),JSON.stringify(PAY)+'\n');
 const P=createPaidLabels({DATA:D,WORK:W,log:()=>{},now:()=>t,fetchImpl:async()=>({ok:true,json:async()=>({success:true,data:{status:state.v}})}),orders:async()=>({chatId:-1,threadId:2,persona:'S',currency:'Rp'}),post:(...a)=>post(...a),label:async()=>({set:true,changed:[]}),
  onEvent:(a,e)=>{got.push([a,e.type,JSON.stringify(e.data)]);if(o.boom)throw Error('listener down')}});
 return {P,got,D,state,setPost:f=>{post=f}}}

test('paid-labels tells onEvent once when a payment is found PAID and its order posted, with nothing about the customer; nothing while unpaid',async()=>{const s=await paidLabels();
 await s.P.tick();assert.deepEqual(s.got,[]);s.state.v='PAID';await s.P.tick();await new Promise(r=>setImmediate(r));
 assert.deepEqual(s.got,[[A,'payment.paid','{"kind":"qris"}'],[A,'order.posted','{"kind":"qris"}']]);await s.P.tick();await new Promise(r=>setImmediate(r));assert.equal(s.got.length,2,'once');
 assert.equal((await readFile(path.join(s.D,'paid-labels.json'),'utf8')).includes('"order"'),true,'the state was saved before the event')});

test('an order that could not be posted says payment.paid now and order.posted on the retry; a failing listener changes nothing',async()=>{const s=await paidLabels({post:async()=>false,boom:true});s.state.v='PAID';
 await s.P.tick();await new Promise(r=>setImmediate(r));assert.deepEqual(s.got.map(x=>x[1]),['payment.paid']);
 s.setPost(async()=>9);await s.P.tick();await new Promise(r=>setImmediate(r));assert.deepEqual(s.got.map(x=>x[1]),['payment.paid','order.posted']);
 assert.equal(JSON.parse(await readFile(path.join(s.D,'paid-labels.json'),'utf8')).done[A+'|'+PAY.at+'|1187500'].state,'labelled')});

test('the fallback script asks aqeelOS for the hook, is silent when it went well and says why when it did not',()=>{
 const w=fallbackScript({agent:A,id:'sales-recap',port:4400,sig:'SIG'});
 assert.match(w,/^#!\/bin\/bash\n/);assert.match(w,/http:\/\/127\.0\.0\.1:4400\/event-hook\/continue-support\/sales-recap\/SIG/);assert.match(w,/\[ "\$code" = 200 \] && exit 0/);assert.match(w,/exit 1\n$/);assert.doesNotMatch(w,/ssh|python/)});

const run=(file,args,env={})=>new Promise(res=>execFile(process.execPath,[file,...args],{env:{...process.env,...env},encoding:'utf8',timeout:60000},(e,stdout,stderr)=>res({code:e?e.code:0,stdout,stderr})));
const WIRE=path.join(import.meta.dirname,'hooks-wire.mjs');
async function engine(job){const calls=[];const srv=createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{calls.push([req.method,req.url,b]);res.setHeader('content-type','application/json');
  res.end(req.method==='GET'?JSON.stringify({jobs:[job]}):'{"ok":true}')})});await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {calls,url:'http://127.0.0.1:'+srv.address().port,close:()=>srv.close()}}

test('hooks-wire: a dry run only prints; --apply writes the hook and the fallback and turns the model schedule into the hourly script-only one; --undo puts it back',async()=>{
 const job={id:'8181388f19ee',name:'Sales Recap',no_agent:false,script:'aqeelos-gate-8181388f19ee.sh',schedule_display:'every 5m',deliver:'origin',origin:{platform:'telegram',chat_id:'-1003999095054',thread_id:'3'}};
 const eng=await engine(job),DATA=await mkdtemp(path.join(tmpdir(),'aq-hw-')),home=await mkdtemp(path.join(tmpdir(),'aq-hwh-'));await writeFile(path.join(DATA,'ui-secret'),'s'.repeat(40));
 const base=['--agent',A,'--job',job.id,'--run','python3 -I sales-recap/run.py','--feed','sales-recap/feed','--data',DATA,'--home',home,'--port','4400'],env={HERMES_DASH:eng.url,HERMES_DASHBOARD_SESSION_TOKEN:'tok',UI_SECRET:''};
 const dry=await run(WIRE,base,env);assert.equal(dry.code,0,dry.stderr);assert.match(dry.stdout,/\[dry run\] 1\. in .*event-hooks\.json/);assert.match(dry.stdout,/"deliver":"telegram:-1003999095054:3"/,'origin when the schedule says origin');
 assert.match(dry.stdout,/"updates":\{"no_agent":true,"script":"aqeelos-hook-8181388f19ee\.sh","schedule":"17 \* \* \* \*"\}/);assert.doesNotMatch(dry.stdout,/s{32}/);
 assert.equal(await stat(path.join(DATA,'event-hooks.json')).then(()=>1,()=>0),0);assert.deepEqual(eng.calls.map(c=>c[0]),['GET']);
 const ap=await run(WIRE,[...base,'--apply'],env);assert.equal(ap.code,0,ap.stderr);
 const hooks=JSON.parse(await readFile(path.join(DATA,'event-hooks.json'),'utf8'));assert.deepEqual(hooks[A],[{id:'sales-recap',on:['payment.paid','order.posted'],run:'python3 -I sales-recap/run.py',deliver:'telegram:-1003999095054:3',feed:'sales-recap/feed',minGapSec:60}]);
 assert.ok(cleanHook(hooks[A][0]),'the app accepts what the script wrote');
 const sc=await readFile(path.join(home,'scripts','aqeelos-hook-8181388f19ee.sh'),'utf8');assert.match(sc,/event-hook\/continue-support\/sales-recap\/[\w-]{32}'/);
 const put=eng.calls.find(c=>c[0]==='PUT');assert.match(put[1],/^\/api\/cron\/jobs\/8181388f19ee\?profile=continue-support$/);assert.deepEqual(JSON.parse(put[2]),{updates:{no_agent:true,script:'aqeelos-hook-8181388f19ee.sh',schedule:'17 * * * *'}});
 const un=await run(WIRE,['--agent',A,'--job',job.id,'--data',DATA,'--home',home,'--undo'],env);assert.equal(un.code,0,un.stderr);
 assert.deepEqual(JSON.parse(eng.calls.filter(c=>c[0]==='PUT')[1][2]),{updates:{no_agent:false,script:'aqeelos-gate-8181388f19ee.sh',schedule:'every 5m'}});assert.deepEqual(JSON.parse(await readFile(path.join(DATA,'event-hooks.json'),'utf8')),{});
 const bad=await run(WIRE,[...base.slice(0,4),'--run','python3 x.py; rm -rf /','--data',DATA,'--home',home],env);assert.equal(bad.code,2);eng.close()});
