// Tests for the Kirimdev API health checks (app/kirimdev.mjs check/setKey, 7 Nov 2026). Run: node --test scripts/kirimdev-health.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKirimdev} from '../app/kirimdev.mjs';

const res=(status,body)=>({ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
async function make({routes={},key='kdv_good',webhook=true,inbound=null}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kdh-'));let clock=Date.parse('2026-11-07T05:00:00Z');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'bay-sales':{phoneNumberId:'222',persona:'Gino',business:'Baylabs',mode:'live'}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify(webhook?{'bay-sales':{id:'wbs_2',secrets:['s'],events:['message.received','message.sent'],at:clock-86400e3}}:{}));
 const calls=[],problems=[],solved=[],saved=[];let k=key;
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');const auth=o.headers.authorization;calls.push(p);
  for(const [re,fn] of Object.entries(routes))if(new RegExp(re).test(p)){const r=fn(p,auth);if(r instanceof Error)throw r;return r}
  if(auth!=='Bearer kdv_good')return res(401,{error:{code:'unauthorized'}});
  if(p==='me')return res(200,{data:{organization:{name:'Elmora'},api_key:{label:'Hermes',last4:'good'}}});
  if(p.startsWith('222/conversations'))return res(200,{data:[{id:'c1',last_inbound_at:new Date(clock-(inbound??-1)*1).toISOString()}].filter(()=>inbound!=null)});
  if(p==='webhook_subscriptions/wbs_2')return res(200,{data:{id:'wbs_2',status:'active',consecutive_failures:0}});
  return res(404,{})};
 const kd=createKirimdev({DATA,WORK:DATA,apiKey:async()=>k,saveKey:async(v,agents)=>{saved.push([v,agents]);k=v},fetchImpl,now:()=>clock,log:()=>{},
  problem:async(a,topic,title,detail)=>{problems.push({a,topic,title,detail})},solved:async(a,topic)=>{solved.push([a,topic])}});
 return {kd,calls,problems,solved,saved,later:ms=>{clock+=ms},setKeyRaw:v=>{k=v}}}

test('a working key and line: all fine, nothing reported',async()=>{
 const t=await make();const h=await t.kd.check();
 assert.equal(h.account.ok,true);assert.equal(h.account.org,'Elmora');assert.equal(h.account.last4,'good');
 assert.equal(h.lines['bay-sales'].api.ok,true);assert.equal(h.lines['bay-sales'].webhook.state,'ok');
 assert.ok(t.calls.includes('222/conversations?limit=50'));assert.equal(t.problems.length,0)});

test('an empty or non-JSON conversations answer is a Kirimdev API problem, reported after two checks, solved when it answers',async()=>{
 let bad=true;const t=await make({routes:{'^222/conversations':()=>bad?res(200,''):res(200,{data:[]})}});
 let h=await t.kd.check();
 assert.equal(h.lines['bay-sales'].api.ok,false);assert.equal(h.lines['bay-sales'].api.why,'empty');assert.match(h.lines['bay-sales'].api.text,/empty reply/);
 assert.equal(t.problems.length,0,'one bad answer is not reported yet');
 await t.kd.check();assert.equal(t.problems.length,1);
 assert.equal(t.problems[0].topic,'kirimdev|api');assert.match(t.problems[0].title,/^Kirimdev line \(Gino\): the Kirimdev API/);assert.doesNotMatch(t.problems[0].title,/WhatsApp/);
 await t.kd.check();assert.equal(t.problems.length,1,'reported once while it lasts');
 bad=false;h=await t.kd.check();assert.equal(h.lines['bay-sales'].api.ok,true);assert.deepEqual(t.solved,[['bay-sales','kirimdev|api']])});

test('HTML instead of JSON and a timeout are told apart',async()=>{
 let mode='html';const t=await make({routes:{'^222/conversations':()=>mode==='html'?res(502,'<html>Bad gateway</html>'):Object.assign(Error('t'),{name:'TimeoutError'})}});
 let h=await t.kd.check();assert.match(h.lines['bay-sales'].api.text,/HTTP 502 with a reply that is not JSON/);
 mode='down';h=await t.kd.check();assert.equal(h.lines['bay-sales'].api.why,'down');assert.match(h.lines['bay-sales'].api.text,/within 30 seconds/)});

test('a refused key is one key problem per line, not an API problem',async()=>{
 const t=await make({key:'kdv_old'});await t.kd.check();await t.kd.check();
 assert.deepEqual(t.problems.map(p=>p.topic),['kirimdev|key']);assert.match(t.problems[0].title,/API key does not work/);
 assert.ok(!t.calls.some(c=>c.includes('conversations')),'no use asking for chats with a refused key')});

test('no key saved',async()=>{const t=await make({key:null});const h=await t.kd.check();assert.equal(h.account.why,'nokey');await t.kd.check();assert.match(t.problems[0].title,/no Kirimdev API key is saved/)});

test('the webhook is optional; switched off or not delivering is reported',async()=>{
 const none=await make({webhook:false});let h=await none.kd.check();assert.equal(h.lines['bay-sales'].webhook.state,'none');await none.kd.check();assert.equal(none.problems.length,0);
 const off=await make({routes:{'^webhook_subscriptions/':()=>res(200,{data:{status:'disabled',disabled_reason:'too_many_failures'}})}});
 h=await off.kd.check();assert.equal(h.lines['bay-sales'].webhook.state,'off');assert.match(h.lines['bay-sales'].webhook.text,/too_many_failures/);
 await off.kd.check();assert.equal(off.problems[0].topic,'kirimdev|webhook');
 // Kirimdev has a customer message from an hour ago, aqeelOS never heard of one: not delivering
 const late=await make({inbound:3600e3});h=await late.kd.check();assert.equal(h.lines['bay-sales'].webhook.state,'late');assert.match(h.lines['bay-sales'].webhook.text,/never reached aqeelOS/);
});

test('a new key is checked with Kirimdev before it is saved',async()=>{
 const t=await make({key:'kdv_old'});
 await assert.rejects(t.kd.setKey('kdv_wrong_one'),/refused this key/);assert.equal(t.saved.length,0);
 await assert.rejects(t.kd.setKey('x'),/does not look like/);
 const h=await t.kd.setKey('kdv_good');assert.deepEqual(t.saved,[['kdv_good',['bay-sales']]]);assert.equal(h.account.ok,true)});

test('the 30-second tick does not call Kirimdev for the check (it has its own 10-minute timer from resume)',async()=>{
 const t=await make();await t.kd._tick();assert.equal(t.calls.filter(c=>c==='me').length,0)});
