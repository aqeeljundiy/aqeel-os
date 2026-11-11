// Tests for the provider "paid" callbacks (app/payment-callbacks.mjs) and the slow fallback poll in app/paid-labels.mjs.
// Run: node --test scripts/payment-callbacks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPaymentCallbacks,tripaySignature,verifyTripay,verifyXendit,callbackPath,MAX_BODY} from '../app/payment-callbacks.mjs';
import {createPaidLabels} from '../app/paid-labels.mjs';

const A='continue-support',PRIV='priv-key-for-tests-0123456789',TOKEN='xnd-token-for-tests-0123456789',REF='T1000000000001ABCDE';
const body=o=>Buffer.from(JSON.stringify(o));
const trip=(o,key=PRIV)=>{const raw=body(o);return {raw,headers:{'x-callback-signature':tripaySignature(raw,key),'x-callback-event':'payment_status'}}};
const settle=()=>new Promise(x=>setTimeout(x,25));

async function rig(){const W=await mkdtemp(path.join(tmpdir(),'pc-')),D=path.join(W,'data');await mkdir(path.join(W,A,'.secrets'),{recursive:true});await mkdir(D,{recursive:true});
 await writeFile(path.join(W,A,'.secrets','TRIPAY_PRIVATE_KEY'),PRIV+'\n');await writeFile(path.join(W,A,'.secrets','XENDIT_CALLBACK_TOKEN'),TOKEN+'\n');
 const nudged=[];let t=Date.parse('2026-11-12T05:00:00Z');
 const C=createPaymentCallbacks({DATA:D,WORK:W,nudge:async a=>{nudged.push(a)},now:()=>t,log:()=>{}});
 return {W,D,C,nudged,at:()=>t}}

test('Tripay: the signature is HMAC-SHA256 of the raw body with the private key, event payment_status',()=>{
 const {raw,headers}=trip({reference:REF,status:'PAID'});
 assert.equal(verifyTripay(raw,headers,PRIV),true);
 assert.equal(verifyTripay(raw,headers,'other-key'),false);
 assert.equal(verifyTripay(body({reference:REF,status:'PAID',x:1}),headers,PRIV),false,'a changed body');
 assert.equal(verifyTripay(raw,{...headers,'x-callback-event':'something_else'},PRIV),false);
 assert.equal(verifyTripay(raw,{'x-callback-signature':headers['x-callback-signature'].toUpperCase(),'x-callback-event':'payment_status'},PRIV),true,'hex case does not matter');
 assert.equal(verifyTripay(raw,{},PRIV),false);assert.equal(verifyTripay(raw,{'x-callback-signature':'abc'},PRIV),false);assert.equal(verifyTripay(raw,headers,''),false)});

test('Xendit: the callback token is compared as is; no token configured means refused',()=>{
 assert.equal(verifyXendit({'x-callback-token':TOKEN},TOKEN),true);
 assert.equal(verifyXendit({'x-callback-token':TOKEN+'x'},TOKEN),false);assert.equal(verifyXendit({},TOKEN),false);
 assert.equal(verifyXendit({},''),false,'an empty header never matches an empty secret');assert.equal(verifyXendit({'x-callback-token':''},''),false)});

test('a verified Tripay callback is answered {success:true} and wakes the payment check for that agent',async()=>{const {C,nudged}=await rig();
 const {raw,headers}=trip({reference:REF,merchant_ref:'BM-1',status:'PAID',total_amount:118750});
 const r=await C.receive('tripay',A,headers,raw);assert.equal(r.status,200);assert.deepEqual(r.body,{success:true});assert.equal(nudged.length,0,'the answer goes first');
 await r.after();assert.deepEqual(nudged,[A])});

test('a verified Xendit callback is answered 200 and wakes the check',async()=>{const {C,nudged}=await rig();
 const r=await C.receive('xendit',A,{'x-callback-token':TOKEN},body({id:'66b0aabbccddeeff00112233',external_id:'CC-1',status:'PAID'}));assert.equal(r.status,200);await r.after();assert.deepEqual(nudged,[A])});

test('a bad signature, a wrong token, an agent without a key, an unknown provider or agent name: refused, nothing woken',async()=>{const {C,nudged}=await rig();
 const good=trip({reference:REF,status:'PAID'});
 assert.equal((await C.receive('tripay',A,{...good.headers,'x-callback-signature':'0'.repeat(64)},good.raw)).status,401);
 assert.equal((await C.receive('tripay',A,good.headers,body({reference:REF,status:'PAID',more:1}))).status,401);
 assert.equal((await C.receive('xendit',A,{'x-callback-token':'nope'},body({status:'PAID'}))).status,401);
 assert.equal((await C.receive('tripay','biomarkers-support',good.headers,good.raw)).status,401,'no key saved for that agent');
 assert.equal((await C.receive('paypal',A,good.headers,good.raw)).status,404);assert.equal((await C.receive('tripay','../etc',good.headers,good.raw)).status,404);
 assert.equal((await C.receive('tripay',A,good.headers,Buffer.alloc(MAX_BODY+1))).status,413);
 assert.equal(nudged.length,0);assert.equal(await C.active(A,'tripay'),false)});

test('the body is never believed: a verified callback for an unpaid payment changes nothing (the provider is asked)',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'pc2-')),W=path.join(D,'ws');await mkdir(path.join(W,A,'.secrets'),{recursive:true});await mkdir(path.join(W,A,'tmp'),{recursive:true});
 await writeFile(path.join(W,A,'.secrets','TRIPAY_API_KEY'),'k');await writeFile(path.join(W,A,'.secrets','TRIPAY_PRIVATE_KEY'),PRIV);
 let t=Date.parse('2026-11-12T05:00:00Z'),state='UNPAID',asked=0;const events=[],labels=[];
 const P=createPaidLabels({DATA:D,WORK:W,log:()=>{},now:()=>t,fetchImpl:async()=>{asked++;return {ok:true,json:async()=>({success:true,data:{status:state}})}},onEvent:(a,e)=>events.push([a,e.type]),
  label:async(a,o)=>{labels.push([a,o.phone]);return {changed:['Customer']}},orders:async()=>null});
 const C=createPaymentCallbacks({DATA:D,WORK:W,nudge:a=>P.nudge(a),now:()=>t,log:()=>{}});
 await appendFile(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t-60e3).toISOString(),agent:A,conversation:'cnv_1',phone:'628000000001',run:'r1',kind:'qris',total:100,ok:true,refs:[REF]})+'\n');
 const {raw,headers}=trip({reference:REF,status:'PAID'});
 const r=await C.receive('tripay',A,headers,raw);await r.after();await settle();
 assert.equal(asked,1);assert.deepEqual(labels,[]);assert.deepEqual(events,[],'a forged "PAID": the provider says UNPAID, so nothing happens');
 state='PAID';const r2=await C.receive('tripay',A,headers,raw);await r2.after();await settle();
 assert.deepEqual(events.filter(e=>e[1]==='payment.paid'),[[A,'payment.paid']]);assert.equal(labels.length,1);
 await C.receive('tripay',A,headers,raw).then(x=>x.after());await settle();assert.equal(labels.length,1,'a repeated callback (the provider retries) labels nothing twice')});

test('after a verified callback the minute poll slows to 10 minutes; a callback asks at once; a stale record goes back to every minute',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'pc3-')),W=path.join(D,'ws');await mkdir(path.join(W,A,'.secrets'),{recursive:true});await writeFile(path.join(W,A,'.secrets','TRIPAY_API_KEY'),'k');await writeFile(path.join(W,A,'.secrets','TRIPAY_PRIVATE_KEY'),PRIV);
 let t=Date.parse('2026-11-12T05:00:00Z'),asked=0;
 const C=createPaymentCallbacks({DATA:D,WORK:W,now:()=>t,log:()=>{}});
 const P=createPaidLabels({DATA:D,WORK:W,log:()=>{},now:()=>t,callbackActive:(a,k)=>C.active(a,k),fetchImpl:async()=>{asked++;return {ok:true,json:async()=>({success:true,data:{status:'UNPAID'}})}},label:async()=>({}),orders:async()=>null});
 await appendFile(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t).toISOString(),agent:A,conversation:'c',phone:'1',run:'r',kind:'qris',total:1,ok:true,refs:[REF]})+'\n');
 await P.tick();t+=60e3;await P.tick();assert.equal(asked,2,'no callback seen yet: every minute');
 const {raw,headers}=trip({reference:REF,status:'UNPAID'});await C.receive('tripay',A,headers,raw);   // verified and remembered (no nudge wired here)
 assert.equal(await C.active(A,'tripay'),true);assert.equal(await C.active(A,'xendit'),false);
 t+=60e3;await P.tick();assert.equal(asked,2,'slow now: the last look was a minute ago');
 for(let i=0;i<8;i++){t+=60e3;await P.tick()}assert.equal(asked,2,"nothing for 9 minutes");t+=60e3;await P.tick();assert.equal(asked,3,'one look 10 minutes after the last, none in between');
 t+=60e3;await P.nudge(A);assert.equal(asked,4,'a callback asks at once');
 t+=15*86400e3;assert.equal(await C.active(A,'tripay'),false,'no callback for 14 days: back to every minute')});

test('the seen-state is a file, kept across a restart; the callback address is /hooks/pay/<provider>/<agent>',async()=>{const {C,D,W,at}=await rig();
 const {raw,headers}=trip({reference:REF,status:'PAID'});await C.receive('tripay',A,headers,raw);
 const j=JSON.parse(await readFile(path.join(D,'payment-callbacks.json'),'utf8'));assert.equal(j.seen[A+'|tripay'].n,1);assert.equal(j.seen[A+'|tripay'].last,'PAID');
 const again=createPaymentCallbacks({DATA:D,WORK:W,now:()=>at(),log:()=>{}});assert.equal(await again.active(A,'tripay'),true);
 assert.equal(callbackPath('xendit',A),'/hooks/pay/xendit/continue-support')});
