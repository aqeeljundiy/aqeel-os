// node --test scripts/proof-events.test.mjs
// EVT-1 / RUN-1 (12 Nov 2026), proven without a real customer or payment: an event from outside starts the matching schedule or script
// once, a repeat is ignored and a wrong signature is refused. Two halves, because the two paths meet the outside world in different places:
//  1. Tebar: the REAL app (app/server.mjs, scripts/lib/app-rig.mjs) with a stand-in engine. A webhook signed the way Tebar signs it is posted to
//     /hooks/tebar/<agent>; the stand-in engine must get exactly one "run now" for the schedule the rule names.
//  2. A payment: the real modules joined the way server.mjs joins them (payment-callbacks, route-handlers payHook, paid-labels, event-hooks,
//     event-runs), with a stand-in Tripay over real HTTP, a stand-in engine, and the recap script run for real in the agent's folder under the
//     real lock and timeout command. A Tripay callback signed with the merchant key must end in ONE recap in the team's chat.
// Every unit of these has its own tests; this file is the chain, end to end.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createServer} from 'node:http';import {execFile} from 'node:child_process';
import {startApp} from './lib/app-rig.mjs';import {src as sourceOf} from './lib/source.mjs';
import {sign as tebarSign} from '../app/tebar.mjs';
import {createPaymentCallbacks,tripaySignature,callbackPath} from '../app/payment-callbacks.mjs';
import {payHook} from '../app/route-handlers.mjs';
import {createPaidLabels} from '../app/paid-labels.mjs';
import {createEventHooks,fallbackScript} from '../app/event-hooks.mjs';
import {createEventRuns} from '../app/event-runs.mjs';

const A='agent-a',SECRET='whsec_proof_secret_0001',JOB='a1b2c3d4e5f6',PRIVATE='tripay-private-key-for-the-proof';
const listen=h=>new Promise(r=>{const s=createServer(h);s.listen(0,'127.0.0.1',()=>r(s))});
const tick=()=>new Promise(r=>setTimeout(r,30));

/* ---------------------------------------------------------------- 1. Tebar, through the real app */
let rig;
test.before(async()=>{rig=await startApp({agents:[A,'agent-b'],seed:async({data})=>{
 await writeFile(path.join(data,'tebar.json'),JSON.stringify({hooks:{[A]:{at:1,events:['comment.created','message.received','post.failed']}},seen:[]}));
 await writeFile(path.join(data,'tebar-secrets.json'),JSON.stringify({[A]:{secrets:[SECRET],at:1}}));
 await writeFile(path.join(data,'event-runs.json'),JSON.stringify({rules:{[A]:[{event:['comment.created','message.received'],job:JOB,platforms:['threads'],minGapSec:120}]}}));
 await mkdir(path.join(data,'agent-keys',A),{recursive:true});await writeFile(path.join(data,'agent-keys',A,'TRIPAY_PRIVATE_KEY'),PRIVATE+'\n')}})});
test.after(async()=>{await rig?.stop()});
const triggers=()=>rig.seen.filter(r=>r.kind==='dash'&&r.method==='POST'&&/^\/api\/cron\/jobs\/[^/]+\/trigger$/.test(r.path));
const tebarPost=(ev,{delivery,secret=SECRET,agent=A,sig}={})=>{const raw=JSON.stringify(ev);return rig.http('POST','/hooks/tebar/'+agent,{raw,headers:{'content-type':'application/json','tebar-signature':sig||tebarSign(raw,secret),'tebar-event':ev.type,'tebar-delivery':delivery||'dlv_'+ev.id}})};
const comment=(id,platform='threads')=>({id,type:'comment.created',data:{platform,author_username:'someone',text:'Is this still available?'}});

test('Tebar: a signed webhook for a new comment starts the matching schedule once, as that agent, with the engine\'s own "run now"',async()=>{
 const r=await tebarPost(comment('evt_1'));assert.equal(r.status,200,r.text);assert.equal(r.json.ok,true);
 await rig.until(()=>triggers().length===1,'the engine to be asked to run the schedule');
 const t=triggers()[0];assert.equal(t.path,'/api/cron/jobs/'+JOB+'/trigger');assert.equal(t.q.profile,A);assert.equal(t.headers['x-hermes-session-token'],'engine-token','asked the engine as the app, not as a visitor');
 const saved=await rig.until(async()=>{const j=JSON.parse(await readFile(path.join(rig.data,'event-runs.json'),'utf8'));return j.runs?.[A+'/'+JOB]?.n===1&&j},'the start to be counted');
 assert.equal(saved.runs[A+'/'+JOB].by,'comment.created');assert.equal(saved.rules[A].length,1,'the rule is still there after the count was saved')});

test('Tebar: the same delivery again (Tebar retries for a day) is answered and starts nothing; so is the same event under a new delivery id',async()=>{
 const again=await tebarPost(comment('evt_1'));assert.equal(again.status,200);assert.equal(again.json.duplicate,true);
 const sameEvent=await tebarPost(comment('evt_1'),{delivery:'dlv_other'});assert.equal(sameEvent.json.duplicate,true);
 await rig.pause(400);assert.equal(triggers().length,1,'still one run')});

test('Tebar: a wrong signature, a stale one, no signature, an agent with no webhook: refused, nothing starts',async()=>{
 const ev=comment('evt_bad'),raw=JSON.stringify(ev);
 assert.equal((await tebarPost(ev,{secret:'whsec_someone_elses_1'})).status,401);
 assert.equal((await tebarPost(ev,{sig:tebarSign(raw,SECRET,Math.floor(Date.now()/1000)-900)})).status,401,'15 minutes old');
 assert.equal((await rig.http('POST','/hooks/tebar/'+A,{raw,headers:{'content-type':'application/json','tebar-event':ev.type}})).status,401);
 assert.equal((await tebarPost(ev,{agent:'agent-b'})).status,404,'agent-b has no Tebar webhook');
 assert.equal((await rig.http('GET','/hooks/tebar/'+A)).status,405);
 await rig.pause(400);assert.equal(triggers().length,1)});

test('Tebar: an event the rule does not name (another platform, a post that went out) starts nothing; more events inside the gap do not start a second run now',async()=>{
 assert.equal((await tebarPost(comment('evt_ig','instagram'))).status,200);
 const other=await tebarPost({id:'evt_pub',type:'post.published',data:{platform:'threads',post_id:'p1'}});assert.equal(other.status,200);assert.equal(other.json.ignored,'post.published','not one of the events picked for this webhook');
 assert.equal((await tebarPost(comment('evt_2'))).status,200);   // a real second comment 1 s later: one trailing run when the 120 s gap is over, none now
 await rig.pause(500);assert.equal(triggers().length,1,'one run for the burst')});

test('payment callback route on the real app: a Tripay body signed with the merchant key is answered {success:true} and remembered; a wrong signature is refused',async()=>{
 const raw=JSON.stringify({reference:'T0001',merchant_ref:'ORDER-1',status:'PAID'}),h={'content-type':'application/json','x-callback-event':'payment_status'};
 const bad=await rig.http('POST',callbackPath('tripay',A),{raw,headers:{...h,'x-callback-signature':tripaySignature(raw,'not-the-key')}});assert.equal(bad.status,401);
 const tampered=await rig.http('POST',callbackPath('tripay',A),{raw:raw.replace('T0001','T9999'),headers:{...h,'x-callback-signature':tripaySignature(raw,PRIVATE)}});assert.equal(tampered.status,401,'a body changed after signing');
 assert.equal((await rig.http('POST',callbackPath('tripay','agent-b'),{raw,headers:{...h,'x-callback-signature':tripaySignature(raw,PRIVATE)}})).status,401,'another agent has no key');
 const ok=await rig.http('POST',callbackPath('tripay',A),{raw,headers:{...h,'x-callback-signature':tripaySignature(raw,PRIVATE)}});assert.equal(ok.status,200,ok.text);assert.deepEqual(ok.json,{success:true});
 const seen=JSON.parse(await readFile(path.join(rig.data,'payment-callbacks.json'),'utf8')).seen;assert.deepEqual(Object.keys(seen),[A+'|tripay']);assert.equal(seen[A+'|tripay'].n,1,'only the verified one was counted');
 // the test copy answers the same and wakes nothing (route-handlers.mjs payHook, live:false): the wake itself is the next test
 assert.match(sourceOf('app/server.mjs'),/payHook\(\{provider:pm\[1\],agent:pm\[2\],headers:req\.headers,raw,receive:\(\.\.\.a\)=>paymentCallbacks\.receive\(\.\.\.a\),live:LIVE_APP\}\)/)});

test('the fallback route of an event hook is for this box and its own signature only',async()=>{
 assert.equal((await rig.http('POST','/event-hook/'+A+'/sales-recap/not-the-signature')).status,403)});

/* ---------------------------------------------------------------- 2. a payment, through the real modules and a real script */
const S='shop-support',CHAT='telegram:-1001000000001:7';
async function scene(){const DATA=await mkdtemp(path.join(tmpdir(),'aq-pay-')),WORK=path.join(DATA,'ws'),dir=path.join(WORK,S,'sales-recap');await mkdir(dir,{recursive:true});
 // the recap script: reads what aqeelOS put in its feed folder and prints one line per paid order. No model anywhere.
 await writeFile(path.join(dir,'run.sh'),['#!/bin/bash','n=$(grep -c \'"state": "labelled"\' sales-recap/feed/paid-labels.json 2>/dev/null)','rows=$(wc -l < sales-recap/feed/payments.jsonl | tr -d " ")','echo "debug line that is not kept"','echo "-> OK recap: ${n:-0} paid order(s) of $rows payment(s)"',''].join('\n'));await chmod(path.join(dir,'run.sh'),0o755);
 const at=new Date().toISOString();
 await writeFile(path.join(DATA,'payments.jsonl'),JSON.stringify({agent:S,at,ok:true,kind:'qris',total:150000,amounts:[150000],phone:'628000000001',name:'Test Buyer',conversation:'cnv_1',refs:['T0001'],products:['S-Kit'],form:'Order form: 1 kit'})+'\n'+JSON.stringify({agent:'other-agent',at,ok:true,kind:'qris',total:5,phone:'628000000002',conversation:'cnv_2',refs:['T0002']})+'\n');
 await writeFile(path.join(DATA,'event-hooks.json'),JSON.stringify({[S]:[{id:'sales-recap',on:['payment.paid','order.posted'],run:'bash sales-recap/run.sh',deliver:CHAT,feed:'sales-recap/feed',minGapSec:60,keep:'-> OK|ERROR',prefix:'Recap: ',dedupe:true}]}));
 await writeFile(path.join(DATA,'event-runs.json'),JSON.stringify({rules:{[S]:[{event:['payment.paid'],job:JOB,minGapSec:60}]}}));
 const tripay={status:'UNPAID',asked:[]},engine=[],sent=[],orders=[],labels=[],ran=[],timers=[];
 const tsrv=await listen((req,res)=>{const u=new URL(req.url,'http://x');tripay.asked.push({ref:u.searchParams.get('reference'),auth:req.headers.authorization});res.setHeader('content-type','application/json');
  res.end(JSON.stringify(req.headers.authorization==='Bearer tripay-api-key'?{success:true,data:{reference:u.searchParams.get('reference'),status:u.searchParams.get('reference')==='T0001'?tripay.status:'UNPAID'}}:{success:false,message:'Invalid API Key'}))});
 const esrv=await listen((req,res)=>{engine.push(req.method+' '+req.url);res.setHeader('content-type','application/json');res.end('{"ok":true}')});
 const runs=createEventRuns({DATA,log:()=>{},setTimer:(fn,ms)=>timers.push({fn,ms,what:'schedule'}),trigger:async(a,id)=>{const r=await fetch('http://127.0.0.1:'+esrv.address().port+'/api/cron/jobs/'+id+'/trigger?profile='+a,{method:'POST',body:'{}'});if(!r.ok)throw Error('the engine answered '+r.status)}});
 const hooks=createEventHooks({DATA,WORK,log:()=>{},setTimer:(fn,ms)=>timers.push({fn,ms,what:'hook'}),
  // server.mjs runs this over ssh as the agent's own Linux user; here the same command runs in the same folder as this user
  runAs:(a,remote,ms)=>new Promise(res=>{ran.push([a,remote]);execFile('bash',['-c',"cd '"+path.join(WORK,a)+"' && "+remote],{timeout:ms,encoding:'utf8'},(e,out,err)=>res({ok:!e,out:out||'',err:err||(e?e.message:''),code:e?(typeof e.code==='number'?e.code:1):0}))}),
  deliver:async(a,target,text)=>{sent.push([a,target,text])}});
 const emit=(a,ev)=>Promise.allSettled([runs.fire(a,ev),hooks.fire(a,ev)]);   // server.mjs emitEvent
 const paid=createPaidLabels({DATA,WORK,log:()=>{},base:'http://127.0.0.1:'+tsrv.address().port,keyOf:async(a,n)=>a===S&&n==='TRIPAY_API_KEY'?'tripay-api-key':'',onEvent:emit,
  label:async(a,o)=>{labels.push([a,o.add.join(','),o.remove.join(',')]);return {set:true,changed:o.add}},orders:async a=>a===S?{chatId:-1001000000001,threadId:9,persona:'Shop',currency:'Rp'}:null,post:async(a,t,text)=>{orders.push([a,t.threadId,text]);return 501}});
 const callbacks=createPaymentCallbacks({DATA,WORK,log:()=>{},readSecret:async(a,p)=>a===S&&p==='tripay'?PRIVATE:'',nudge:a=>paid.nudge(a)});
 // what POST /hooks/pay/tripay/<agent> does on the live app: answer first, wake after
 const call=async(body,{key=PRIVATE,agent=S}={})=>{const raw=Buffer.from(JSON.stringify(body));const r=await payHook({provider:'tripay',agent,headers:{'x-callback-signature':tripaySignature(raw,key),'x-callback-event':'payment_status'},raw,receive:(...a)=>callbacks.receive(...a),live:true,log:()=>{}});
  if(r.after)await r.after();for(let i=0;i<8;i++){await tick();await hooks.idle()}return r};   // the events are told after the answer, each in its own turn: give them time on a busy box
 const until=async(f,what)=>{for(let i=0;i<200;i++){if(f())return;await tick();await hooks.idle()}assert.fail('waited 6 s for: '+what)};
 return {DATA,WORK,tripay,engine,sent,orders,labels,ran,timers,call,until,hooks,close:()=>{tsrv.close();esrv.close()}}}

test('server.mjs joins the same parts this proof joins: every event reaches both the schedules and the script hooks, and a paid callback wakes the payment check',()=>{const s=sourceOf('app/server.mjs');
 assert.match(s,/const emitEvent=\(a,ev\)=>Promise\.allSettled\(\[eventRuns\.fire\(a,ev\),eventHooks\.fire\(a,ev\)\]\)/);
 assert.match(s,/createPaidLabels\(\{[^\n]*onEvent:\(a,ev\)=>emitEvent\(a,ev\)/);assert.match(s,/createPaymentCallbacks\(\{[^\n]*nudge:a=>paidLabels\.nudge\(a\)/);assert.match(s,/createTebar\(\{DATA,onEvent:\(a,ev\)=>emitEvent\(a,ev\)/)});

test('a payment: a signed Tripay callback ends in one recap in the team\'s chat and one start of the matching schedule; forged, unpaid and repeated callbacks do nothing more',{skip:process.platform==='win32'&&'the recap script runs under flock and timeout (Linux)'},async()=>{const s=await scene();try{
 // 1. a callback signed with the wrong key, and one for an agent with no key: refused, the provider is not even asked
 assert.equal((await s.call({reference:'T0001',status:'PAID'},{key:'someone-elses-key'})).status,401);assert.equal((await s.call({reference:'T0001',status:'PAID'},{agent:'other-agent'})).status,401);
 assert.equal(s.tripay.asked.length,0);assert.equal(s.sent.length+s.engine.length+s.orders.length,0);
 // 2. a correctly signed callback that SAYS paid while Tripay says unpaid (a replayed or made-up body): Tripay is asked, nothing happens
 const early=await s.call({reference:'T0001',status:'PAID'});assert.equal(early.status,200);assert.deepEqual(early.body,{success:true});
 assert.deepEqual(s.tripay.asked.map(x=>x.ref),['T0001'],'only this agent\'s payment was asked about, with its own key');assert.equal(s.tripay.asked[0].auth,'Bearer tripay-api-key');
 assert.equal(s.sent.length+s.engine.length+s.orders.length+s.labels.length,0,'the body is never believed');
 // 3. the customer pays; Tripay calls back
 s.tripay.status='PAID';const paidCall=await s.call({reference:'T0001',status:'PAID'});assert.equal(paidCall.status,200);await s.until(()=>s.sent.length>=1&&s.engine.length>=1,'the recap in the chat and the schedule start');
 assert.equal(s.orders.length,1,'the order form went to the Orders topic once');assert.match(s.orders[0][2],/PAID ORDER \(Shop, Test Buyer/);assert.deepEqual(s.labels,[[S,'Customer,S-Kit','Checkout']]);
 assert.deepEqual(s.engine,['POST /api/cron/jobs/'+JOB+'/trigger?profile='+S],'the schedule that waits for a payment was started once');
 assert.equal(s.ran.length,1,'the recap script ran once, though payment.paid and order.posted both arrived');assert.equal(s.ran[0][1],'flock -w 300 -E 75 .aqeelos-event-hooks.lock timeout -k 5 300 bash sales-recap/run.sh');
 assert.deepEqual(s.sent,[[S,CHAT,'Recap: -> OK recap: 1 paid order(s) of 1 payment(s)']],'what the script printed reached the chat: only its own payment in the feed, only the kept line, with the prefix');
 const state=JSON.parse(await readFile(path.join(s.DATA,'event-hooks-state.json'),'utf8')).runs[S+'/sales-recap'];assert.deepEqual([state.n,state.ok,state.sent],[1,true,1]);assert.ok(['payment.paid','order.posted'].includes(state.by),'started by the payment, not by the hourly fallback: '+state.by);
 // 4. Tripay sends the same callback again (it retries), and the minute poll looks again: nothing is posted, labelled, started or sent twice
 const asked=s.tripay.asked.length;const again=await s.call({reference:'T0001',status:'PAID'});assert.equal(again.status,200);
 assert.equal(s.tripay.asked.length,asked,'a payment already done is not asked about again');assert.equal(s.orders.length,1);assert.equal(s.labels.length,1);assert.equal(s.engine.length,1);assert.equal(s.sent.length,1);
 // 5. the second event of the burst (order.posted) waited for the gap: when it is over the script runs once more and repeats nothing in the chat
 const late=s.timers.filter(t=>t.what==='hook');assert.equal(late.length,1,'one trailing run was queued, not one per event');await late[0].fn();await s.until(()=>s.ran.length>=2,'the trailing run');
 assert.equal(s.ran.length,2);assert.equal(s.sent.length,1,'the same line is not said twice in 24 hours');
 }finally{s.close()}});

test('the hourly fallback script of a hook asks aqeelOS for the same run: silent when it went well, the reason and exit 1 when it did not',{skip:process.platform==='win32'&&'bash and curl (Linux)'},async()=>{
 let answer=[200,'ok'];const hits=[];const srv=await listen((req,res)=>{hits.push(req.method+' '+req.url);res.writeHead(answer[0],{'content-type':'text/plain'});res.end(answer[1]+'\n')});
 const d=await mkdtemp(path.join(tmpdir(),'aq-fb-')),f=path.join(d,'aqeelos-hook-'+JOB+'.sh');await writeFile(f,fallbackScript({agent:S,id:'sales-recap',port:srv.address().port,sig:'SIGNATURE'}));
 const run=()=>new Promise(r=>execFile('bash',[f],{encoding:'utf8',timeout:30000},(e,out)=>r({code:e?e.code:0,out})));
 try{const ok=await run();assert.deepEqual([ok.code,ok.out],[0,''],'nothing printed, so the schedule delivers nothing');assert.deepEqual(hits,['POST /event-hook/'+S+'/sales-recap/SIGNATURE']);
  answer=[500,'python3: can\'t open file'];const bad=await run();assert.equal(bad.code,1);assert.match(bad.out,/did not run: python3: can't open file \(500\)/)}finally{srv.close()}});
