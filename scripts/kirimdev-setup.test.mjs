// Tests for Kirimdev plug and play (app/kirimdev.mjs, 7 Nov 2026): the numbers come from Kirimdev, Connect makes a line
// (webhook when aqeelOS can be reached, polling every 20 s when not), settings stay editable, Disconnect keeps the history.
// Run: node --test scripts/kirimdev-setup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKirimdev,publicReach,DEFAULT_PAUSE} from '../app/kirimdev.mjs';

const res=(status,body)=>({ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body),json:async()=>typeof body==='string'?JSON.parse(body):body});
const ACCOUNTS=[{phone_number:'+62 877-0000-1111',phone_number_id:'111111',name:'Cove Health Indonesia',status:'connected'},
 {phone_number:'+62 888-0000-2222',phone_number_id:'222222',name:'Baylabs Neolab Labs',status:'connected'}];
async function make({lines={},secrets={},url='https://ai.example.com',routes={},accounts=ACCOUNTS}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kds-'));let clock=Date.parse('2026-11-07T05:00:00Z');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines}));await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify(secrets));
 const calls=[],timers=[],solved=[];let hook=0;
 const fetchImpl=async(u,o)=>{const p=u.replace('https://api.kirimdev.com/v1/',''),m=o.method||'GET',body=o.body?JSON.parse(o.body):null;calls.push({m,p,body});
  for(const [re,fn] of Object.entries(routes))if(new RegExp(re).test(m+' '+p)){const r=fn(p,body);if(r)return r}
  if(p==='me')return res(200,{data:{organization:{name:'Elmora'},api_key:{label:'Hermes',last4:'good'}}});
  if(p==='accounts')return res(200,{data:accounts,has_more:false});
  if(m==='POST'&&p==='webhook_subscriptions')return res(200,{data:{id:'wbs_'+(++hook),status:'active',initial_secret:'whsec_'+hook}});
  if(/^\d+\/conversations/.test(p))return res(200,{data:[]});
  if(/^webhook_subscriptions\/[^/]+$/.test(p)&&m==='GET')return res(200,{data:{status:'active',consecutive_failures:0,secrets:[]}});
  return res(404,{error:{code:'not_found'}})};
 const kd=createKirimdev({DATA,WORK:DATA,PUBLIC_URL:url,apiKey:async()=>'kdv_good',fetchImpl,now:()=>clock,log:()=>{},runAgent:async()=>'',telegram:async()=>1,
  setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimer:()=>{},wait:async()=>{},echoWait:0,solved:async(a,t)=>{solved.push([a,t])},problem:async()=>{}});
 const conf=async()=>JSON.parse(await readFile(path.join(DATA,'kirimdev.json'),'utf8')),sec=async()=>JSON.parse(await readFile(path.join(DATA,'kirimdev-secrets.json'),'utf8'));
 return {kd,calls,timers,solved,conf,sec,later:ms=>{clock+=ms},now:()=>clock}}

test('the numbers show up from Kirimdev by themselves: connected ones with their line, others free, a missing one marked',async()=>{
 const t=await make({lines:{'cove-support':{phoneNumberId:'111111',persona:'Rory'},'old-support':{phoneNumberId:'999999',persona:'Old'}}});
 const n=await t.kd.numbers();assert.equal(n.ok,true);
 const by=Object.fromEntries(n.list.map(x=>[x.phoneNumberId,x]));
 assert.equal(by['111111'].agent,'cove-support');assert.equal(by['111111'].phone,'+62 877-0000-1111');
 assert.equal(by['222222'].agent,null,'nobody answers 222 yet: it gets Connect');
 assert.equal(by['999999'].gone,true,'a line whose number left Kirimdev: No longer in Kirimdev');
 await t.kd.numbers();assert.equal(t.calls.filter(c=>c.p==='accounts').length,1,'kept a minute');
 await t.kd.numbers({fresh:true});assert.equal(t.calls.filter(c=>c.p==='accounts').length,2)});

test('no key: no numbers, said plainly',async()=>{const t=await make();const kd2=createKirimdev({DATA:(await mkdtemp(path.join(tmpdir(),'kds-'))),WORK:'/',apiKey:async()=>null,fetchImpl:async()=>{throw Error('no')},log:()=>{}});
 const n=await kd2.numbers();assert.equal(n.ok,false);assert.equal(n.why,'nokey')});

test('Connect with a public address: a line in Test, quiet time 15, the webhook made and its secret kept',async()=>{
 const t=await make();
 const r=await t.kd.saveLine('bay-sales',{phoneNumberId:'222222',persona:'Gino',business:'Baylabs',testers:[{who:'Abel',phone:'+62 812-3456-7890'}],language:'Indonesian',resetWords:'reset, mulai baru',resetText:'Reset done',payment:{helper:{path:'.tools/qris',style:'picture'},currency:'Rp',min:'10000',max:'5000000'}});
 assert.equal(r.isNew,true);assert.equal(r.delivery.how,'webhook');
 const l=(await t.conf()).lines['bay-sales'];
 assert.equal(l.mode,'test');assert.equal(l.pauseMin,DEFAULT_PAUSE);assert.equal(l.pauseMin,15);assert.equal(l.delivery,undefined);
 assert.deepEqual(l.testers,[{who:'Abel',phone:'6281234567890'}]);assert.deepEqual(l.resetWords,['reset','mulai baru']);
 assert.deepEqual(l.payment,{helper:{path:'.tools/qris',style:'picture'},currency:'Rp',min:10000,max:5000000});
 const w=t.calls.find(c=>c.m==='POST'&&c.p==='webhook_subscriptions');assert.equal(w.body.url,'https://ai.example.com/kirimdev/bay-sales');assert.deepEqual(w.body.phone_number_ids,['222222']);
 assert.deepEqual((await t.sec())['bay-sales'].secrets,['whsec_1']);
 const st=(await t.kd.status())[0];assert.equal(st.delivery,'webhook');assert.equal(st.settings.persona,'Gino')});

test('Connect is refused for a number Kirimdev does not have, one already taken, or bad settings',async()=>{
 const t=await make({lines:{'cove-support':{phoneNumberId:'111111',persona:'Rory'}}});
 await assert.rejects(t.kd.saveLine('x-support',{phoneNumberId:'333333',persona:'X'}),/Kirimdev does not have this number/);
 await assert.rejects(t.kd.saveLine('x-support',{phoneNumberId:'111111',persona:'X'}),/already answered by Rory/);
 await assert.rejects(t.kd.saveLine('x-support',{phoneNumberId:'222222',persona:''}),/name as customers see/);
 await assert.rejects(t.kd.saveLine('x-support',{phoneNumberId:'222222',persona:'X',testers:[{who:'A',phone:'12'}]}),/not a phone number/);
 await assert.rejects(t.kd.saveLine('x-support',{phoneNumberId:'222222',persona:'X',payment:{min:9,max:1}}),/lowest payment is above/);
 await assert.rejects(t.kd.saveLine('cove-support',{phoneNumberId:'222222',persona:'Rory'}),/already answers another number/);
 assert.equal(Object.keys((await t.conf()).lines).length,1,'nothing saved')});

test('no public address: no webhook, polling instead, said plainly',async()=>{
 for(const u of ['http://localhost:4400','http://192.168.1.20:4400','https://box.local','http://10.0.0.5','https://172.20.1.1','http://ai.example.com'])assert.equal(publicReach(u).ok,false,u);
 assert.equal(publicReach('https://ai.elmora.example').ok,true);
 const t=await make({url:'http://localhost:4400'});
 const r=await t.kd.saveLine('bay-sales',{phoneNumberId:'222222',persona:'Gino'});
 assert.equal(r.delivery.how,'poll');assert.match(r.delivery.why,/cannot reach from the internet/);
 assert.ok(!t.calls.some(c=>c.p==='webhook_subscriptions'),'no webhook asked for');
 assert.equal((await t.conf()).lines['bay-sales'].delivery,'poll');assert.equal((await t.kd.status())[0].delivery,'poll')});

test('Kirimdev refusing the webhook falls back to polling',async()=>{
 const t=await make({routes:{'^POST webhook_subscriptions$':()=>res(422,{error:{code:'url_unreachable'}})}});
 const r=await t.kd.saveLine('bay-sales',{phoneNumberId:'222222',persona:'Gino'});
 assert.equal(r.delivery.how,'poll');assert.match(r.delivery.why,/url_unreachable/)});

test('polling: the first look marks where to start, then new customer messages are answered and team replies pause the agent',async()=>{
 let conv=[],msgs={};
 const t=await make({url:'http://localhost:4400',lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino',mode:'live',delivery:'poll',pauseMin:15}},
  routes:{'^GET 222222/conversations':()=>res(200,{data:conv}),'^GET 222222/messages':p=>res(200,{data:msgs[new URLSearchParams(p.split('?')[1]).get('conversation_id')]||[]})}});
 // the conversation has old history before polling starts: it is not answered
 conv=[{id:'cv1',last_message_at:'2026-11-07T04:00:00.000Z',contact:{phone_number:'+6281111111111',name:'Budi'}}];
 msgs.cv1=[{id:'m0',direction:'inbound',type:'text',content:'old question',created_at:'2026-11-07T04:00:00.000Z'}];
 let r=await t.kd.poll();assert.equal(r['bay-sales'].started,true);assert.equal(t.timers.length,0);
 t.later(20e3);r=await t.kd.poll();assert.equal(r['bay-sales'].messages,0,'history is not new');
 // a new message after the start
 conv=[{id:'cv1',last_message_at:'2026-11-07T05:00:30.000Z',contact:{phone_number:'+6281111111111',name:'Budi'}}];
 msgs.cv1=[...msgs.cv1,{id:'m1',direction:'inbound',type:'text',content:'berapa harganya?',created_at:'2026-11-07T05:00:30.000Z'}];
 t.later(20e3);r=await t.kd.poll();assert.equal(r['bay-sales'].messages,1);
 const s=await t.kd._state();const p=s.pending['bay-sales|222222|cv1'];assert.deepEqual(p.messages,['berapa harganya?']);assert.equal(p.from,'6281111111111');
 assert.equal(t.timers.length,1,'the answer is scheduled after the burst');
 // the same message on the next look is not taken twice
 t.later(20e3);r=await t.kd.poll();assert.equal(r['bay-sales'].messages,0);assert.deepEqual(s.pending['bay-sales|222222|cv1'].messages,['berapa harganya?']);
 // a person answers from Kirimdev: the agent waits its quiet time there
 conv=[{id:'cv1',last_message_at:'2026-11-07T05:01:30.000Z',contact:{phone_number:'+6281111111111',name:'Budi'}}];
 msgs.cv1=[...msgs.cv1,{id:'m2',direction:'outbound',type:'text',content:'Rp 500rb kak',to:'+6281111111111',created_at:'2026-11-07T05:01:30.000Z'}];
 t.later(20e3);await t.kd.poll();
 assert.ok(s.paused['bay-sales|cv1']>t.now(),'paused in that chat');assert.equal(s.pending['bay-sales|222222|cv1'],undefined,'the team answered it')});

test('a message the webhook already brought is not taken again by polling',async()=>{
 let conv=[],msgs={};
 const t=await make({lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino',mode:'live'}},routes:{'^GET 222222/conversations':()=>res(200,{data:conv}),'^GET 222222/messages':()=>res(200,{data:msgs.cv1||[]})}});
 const s=await t.kd._state();s.seen.push('in|bay-sales|cv1|'+Math.floor(Date.parse('2026-11-07T05:00:30Z')/1000)+'|halo');
 await t.kd.poll();// no webhook: polls; first look starts
 conv=[{id:'cv1',last_message_at:'2026-11-07T05:00:30.000Z',contact:{phone_number:'6281111111111'}}];msgs.cv1=[{id:'m1',direction:'inbound',type:'text',content:'halo',created_at:'2026-11-07T05:00:30.000Z'}];
 const r=await t.kd.poll();assert.equal(r['bay-sales'].messages,1);assert.equal(s.pending['bay-sales|222222|cv1'],undefined)});

test('a line with a working webhook is not polled',async()=>{
 const t=await make({lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino'}},secrets:{'bay-sales':{id:'wbs_9',secrets:['s']}}});
 const r=await t.kd.poll();assert.deepEqual(r,{});assert.ok(!t.calls.some(c=>/conversations/.test(c.p)))});

test('settings are editable later; the number and mode stay',async()=>{
 const t=await make({lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino',mode:'live',autoPhotos:{pattern:'x'},testers:[{who:'Abel',conversationId:'cv9',phone:'6281234567890'}]}}});
 await t.kd.saveLine('bay-sales',{persona:'Gino B',pauseMin:30,testers:[{who:'Abel',phone:'6281234567890'},{who:'Sari',phone:'628999'}],language:''});
 const l=(await t.conf()).lines['bay-sales'];assert.equal(l.persona,'Gino B');assert.equal(l.pauseMin,30);assert.equal(l.mode,'live');assert.deepEqual(l.autoPhotos,{pattern:'x'});
 assert.equal(l.testers[0].conversationId,'cv9','a known tester keeps its chat');assert.equal(l.testers[1].who,'Sari');
 assert.ok(!t.calls.some(c=>c.p==='webhook_subscriptions'),'editing makes no webhook')});

test('Disconnect deletes the webhook in Kirimdev, keeps history and settings, and a reconnect starts from them',async()=>{
 const t=await make({lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino',mode:'live',pauseMin:20}},secrets:{'bay-sales':{id:'wbs_9',secrets:['s']}},
  routes:{'^DELETE webhook_subscriptions/wbs_9$':()=>res(200,{data:{id:'wbs_9',deleted:true}})}});
 const s=await t.kd._state();s.recent['bay-sales|628111']=t.now();s.health={lines:{'bay-sales':{told:{'kirimdev|api':1}}}};
 const r=await t.kd.disconnect('bay-sales');assert.equal(r.webhook,'deleted');
 assert.ok(t.calls.some(c=>c.m==='DELETE'&&c.p==='webhook_subscriptions/wbs_9'));
 const c=await t.conf();assert.equal(c.lines['bay-sales'],undefined);assert.equal(c.disconnected['bay-sales'].pauseMin,20);
 assert.equal((await t.sec())['bay-sales'],undefined);assert.ok(s.recent['bay-sales|628111'],'history kept');
 assert.deepEqual(t.solved,[['bay-sales','kirimdev|api']],'its Health items go away');
 assert.equal((await t.kd.numbers({fresh:true})).list.find(x=>x.phoneNumberId==='222222').agent,null,'the number is free again');
 await t.kd.saveLine('bay-sales',{phoneNumberId:'222222',persona:'Gino'});
 const l=(await t.conf()).lines['bay-sales'];assert.equal(l.pauseMin,20,'settings came back');assert.equal(l.mode,'test','a reconnected line starts in Test')});

test('Disconnect stops when Kirimdev will not delete the webhook; a webhook already gone is fine',async()=>{
 const t=await make({lines:{a1:{phoneNumberId:'222222',persona:'G'}},secrets:{a1:{id:'wbs_9',secrets:['s']}},routes:{'^DELETE':()=>res(500,{error:{code:'oops'}})}});
 await assert.rejects(t.kd.disconnect('a1'),/did not delete the webhook/);assert.ok((await t.conf()).lines.a1,'nothing changed');
 const t2=await make({lines:{a1:{phoneNumberId:'222222',persona:'G'}},secrets:{a1:{id:'wbs_9',secrets:['s']}}});
 assert.equal((await t2.kd.disconnect('a1')).webhook,'gone')});

test('Renew webhook secret: the new one is kept, then the old ones are revoked',async()=>{
 const t=await make({lines:{a1:{phoneNumberId:'222222',persona:'G'}},secrets:{a1:{id:'wbs_9',secrets:['old']}},routes:{
  '^POST webhook_subscriptions/wbs_9/secrets$':()=>res(200,{data:{id:'sec_new',secret:'whsec_new'}}),
  '^GET webhook_subscriptions/wbs_9$':()=>res(200,{data:{secrets:[{id:'sec_old'},{id:'sec_new'}]}}),
  '^DELETE webhook_subscriptions/wbs_9/secrets/sec_old$':()=>res(200,{data:{deleted:true}})}});
 const r=await t.kd.renewSecret('a1');assert.equal(r.revoked,1);assert.deepEqual((await t.sec()).a1.secrets,['whsec_new']);
 assert.ok(!t.calls.some(c=>c.p.endsWith('/secrets/sec_new')),'the new one is never revoked')});

test('Send test message goes to a tester and does not pause the agent; outside 24 hours it says why',async()=>{
 const t=await make({lines:{a1:{phoneNumberId:'222222',persona:'Gino',testers:[{who:'Abel',phone:'6281234567890'}]}},routes:{'^POST 222222/messages$':()=>res(200,{data:{id:'msg_1',status:'accepted'}})}});
 const r=await t.kd.testSend('a1',0);assert.equal(r.to,'Abel');const c=t.calls.find(x=>x.p==='222222/messages');assert.equal(c.body.to,'6281234567890');assert.match(c.body.text.body,/Test from aqeelOS/);
 assert.ok((await t.kd._state()).ours.msg_1,'known as ours, so it pauses nothing');
 const t2=await make({lines:{a1:{phoneNumberId:'222222',persona:'Gino',testers:[{who:'Abel',phone:'6281234567890'}]}},routes:{'^POST 222222/messages$':()=>res(422,{error:{code:'outside_window'}})}});
 await assert.rejects(t2.kd.testSend('a1',0),/within 24 hours/)});

test('a line with quiet time 0 gets 15 once (Gino, 7 Nov); a later 0 by choice stays',async()=>{
 const t=await make({lines:{'bay-sales':{phoneNumberId:'222222',persona:'Gino',pauseMin:0},'cove-support':{phoneNumberId:'111111',persona:'Rory'}}});
 await t.kd.fixQuiet();let c=await t.conf();assert.equal(c.lines['bay-sales'].pauseMin,15);assert.equal(c.lines['cove-support'].pauseMin,undefined);
 await t.kd.saveLine('bay-sales',{pauseMin:0});await t.kd.fixQuiet();c=await t.conf();assert.equal(c.lines['bay-sales'].pauseMin,0)});

test('a reset word set in the dialog works for testers',async()=>{
 const t=await make({lines:{a1:{phoneNumberId:'222222',persona:'G',mode:'test',resetWords:['ulang'],resetText:'ok',testers:[{who:'Abel',phone:'6281234567890'}]}},secrets:{a1:{id:'w',secrets:['k']}},routes:{'^POST 222222/messages$':()=>res(200,{data:{id:'msg_r'}})}});
 const s=await t.kd._state();s.recent['a1|6281234567890']=t.now();s.pending['a1|222222|cv1']={agent:'a1',from:'6281234567890',conversationId:'cv1',messages:['x'],at:t.now()};
 const raw=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:'222222'},messages:[{from:'6281234567890',id:'w1',timestamp:String(Math.floor(t.now()/1000)),type:'text',text:{body:'Ulang'}}]}}]}],kirim:{conversation_id:'cv1'}});
 const {createHmac}=await import('node:crypto');const ts=Math.floor(t.now()/1000);const sig='t='+ts+',v1='+createHmac('sha256','k').update(ts+'.'+raw).digest('hex');
 const r=await t.kd.receive('a1',{'x-kirim-signature':sig,'x-kirim-event':'message.received','x-kirim-event-id':'e1'},Buffer.from(raw));assert.equal(r.status,200);
 assert.equal(s.pending['a1|222222|cv1'],undefined,'reset');assert.equal(t.calls.find(c=>c.p==='222222/messages').body.text.body,'ok')});

test('saving with the Automatic helper keeps the payment limits (Rory and Gino have no helper set)',async()=>{
 const t=await make({lines:{a1:{phoneNumberId:'222222',persona:'Rory',payment:{currency:'Rp',min:10000,max:5000000}}}});
 await t.kd.saveLine('a1',{persona:'Rory',payment:{currency:'Rp',min:'10000',max:'5000000'}});
 assert.deepEqual((await t.conf()).lines.a1.payment,{currency:'Rp',min:10000,max:5000000});
 await t.kd.saveLine('a1',{persona:'Rory'});assert.deepEqual((await t.conf()).lines.a1.payment,{currency:'Rp',min:10000,max:5000000},'no payment field: unchanged')});
