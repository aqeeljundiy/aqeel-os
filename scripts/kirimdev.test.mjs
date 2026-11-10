// Tests for the Kirimdev WhatsApp channel (app/kirimdev.mjs). Run: node --test scripts/kirimdev.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createKirimdev,verifySignature,parseInbound,parseSent,splitReply,withCaptions} from '../app/kirimdev.mjs';

const SECRET='whsec_test_123';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const flush=()=>new Promise(r=>setImmediate(r));
test('concurrent customers isolate engine sessions and prompt text; message-id retries do not rerun',async()=>{
 const gate=deferred(),started=deferred();let n=0;
 const t=await make({mode:'live',agentSays:async q=>{if(++n===2)started.resolve();await gate.promise;return q.includes('customer-one')?'one':'two'}});
 await Promise.all([t.post(meta('628001','customer-one','id1','c1')),t.post(meta('628002','customer-two','id2','c2'))]);
 const work=t.settle();await started.promise;
 assert.notEqual(t.asked[0][2].session,t.asked[1][2].session);
 assert.ok(t.asked.every(x=>!(x[1].includes('customer-one')&&x[1].includes('customer-two'))));
 gate.resolve();await work;
 assert.deepEqual(t.sent.map(x=>[x.to,x.text.body]).sort(),[['628001','one'],['628002','two']]);
 await t.post(meta('628001','customer-one','id1','c1'),{'x-kirim-event-id':'different-event'});await t.settle();assert.equal(t.asked.length,2);
});
test('new inbound during active turn is retained and serialized in same session',async()=>{
 const gate=deferred(),started=deferred();let n=0;
 const t=await make({agentSays:async()=>{if(++n===1){started.resolve();await gate.promise}return 'answer'}});
 await t.post(meta('628123','first','first'));const work=t.settle();await started.promise;
 await t.post(meta('628123','second','second'));gate.resolve();await work;
 assert.equal(t.asked.length,2);assert.equal(t.asked[0][2].session,t.asked[1][2].session);
 assert.match(t.asked[1][1],/CUSTOMER: second/);assert.deepEqual((await t.k._state()).pending,{});
});
test('human reply while thinking suppresses stale output',async()=>{
 const gate=deferred(),started=deferred();const t=await make({agentSays:async()=>{started.resolve();await gate.promise;return 'stale'}});
 await t.post(meta('628123','hello'));const work=t.settle();await started.promise;
 await t.postSent(sentEv('628123','dashboard','human'));gate.resolve();await work;assert.equal(t.sent.length,0);
});
test('pending snapshot survives service recreation; stable session and durable dedup survive restart',async()=>{
 const t=await make();const raw=meta('628123','durable','durable-id');await t.post(raw);
 const before=JSON.parse(await readFile(path.join(t.DATA,'kirimdev-state.json'),'utf8'));assert.equal(Object.values(before.pending)[0].messages[0],'durable');
 t.due.clear();const calls=[];
 const k=createKirimdev({DATA:t.DATA,WORK:t.DATA,apiKey:async()=>'test',setTimer:t.setTimer,clearTimer:t.clearTimer,wait:async()=>{},log:()=>{},
  runAgent:async(a,q,c)=>{calls.push(c);return ''},fetchImpl:async()=>({ok:true,json:async()=>({data:[]})})});
 await k.resume();await t.settle();assert.equal(calls.length,1);
 const headers={'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'};
 await k.receive('cove-support',headers,Buffer.from(raw));await t.settle();assert.equal(calls.length,1);
 await t.post(meta('628123','next','next-id'));await t.settle();assert.equal(calls[0].session,t.asked[0][2].session);
});


test('reset during an active run suppresses old output and keeps the new message in a new session',async()=>{
 const gate=deferred(),started=deferred();let n=0;
 const t=await make({agentSays:async()=>{if(++n===1){started.resolve();await gate.promise}return 'reply'}});
 await t.post(meta('628123','old','old'));const work=t.settle();await started.promise;
 await t.post(meta('628123','reset','reset'));await t.post(meta('628123','fresh','fresh'));
 gate.resolve();await work;assert.equal(t.asked.length,2);
 assert.notEqual(t.asked[0][2].session,t.asked[1][2].session);assert.match(t.asked[1][1],/CUSTOMER: fresh/);
 assert.equal(t.sent.filter(x=>x.text.body==='reply').length,1);
});
test('an interrupted agent turn remains durable until a successful retry',async()=>{
 let n=0;const t=await make({agentSays:async()=>{if(++n===1)throw Error('simulated interruption');return 'retried'}});
 await t.post(meta('628123','must survive','survive'));
 const f=[...t.due.values()][0];t.due.clear();await f();
 const disk=JSON.parse(await readFile(path.join(t.DATA,'kirimdev-state.json'),'utf8'));
 assert.equal(Object.values(disk.pending)[0].messages[0],'must survive');
 await t.settle();assert.equal(t.sent[0].text.body,'retried');assert.equal(t.asked[0][2].session,t.asked[1][2].session);
});

const sign=(raw,t=Math.floor(Date.now()/1000),s=SECRET)=>'t='+t+',v1='+createHmac('sha256',s).update(t+'.'+raw).digest('hex');
const meta=(from,text,id='wamid.'+Math.random(),conv='cnv_A',pid='111')=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:pid?{phone_number_id:pid}:{},contacts:[{wa_id:from,profile:{name:'Rania'}}],messages:[{from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}],kirim:{conversation_id:conv}});

// Kirimdev's message.sent envelope (docs.kirimdev.com/webhooks/events)
const sentEv=(to,source,id='msg_'+Math.random(),conv='cnv_A',pid='111')=>JSON.stringify({id:id+':sent',type:'message.sent',data:{session:pid,direction:'outbound',from_me:true,message:{id,type:'text',body:'Halo, saya Ari dari tim',to:'+'+to,status:'sent',source},conversation:{id:conv,status:'open'},contact:{phone_number:'+'+to},meta:{phone_number_id:pid}}});

// an Indonesian line, as the owner runs it: these are settings (kirimdev.json), not code
const LOCALE={language:'Indonesian',localPrefix:{country:'62',local:'0'},resetText:'✅ Test reset. Chat dari awal ya, anggap kamu customer baru.',handoff:{customerText:'Baik kak, untuk pertanyaan ini saya bantu teruskan ke tim kami dulu ya 🙏 Mohon ditunggu sebentar.'}};
async function make({mode='test',agentSays='Halo kak 😊',testers=[{who:'Ari',conversationId:'cnv_A'}],postOk=true,team={chatId:-100,topics:{questions:3},mention:'@team'},pauseMin,extra={},paidSince=null}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-')),WORK=path.join(DATA,'work');
 await mkdir(path.join(WORK,'cove-support','media','staff'),{recursive:true});
 await writeFile(path.join(WORK,'cove-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\n');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'cove-support':{phoneNumberId:'111',persona:'Rory',business:'Cove',mode,debounceSec:0,testers,...LOCALE,...(pauseMin!==undefined?{pauseMin}:{}),...extra,
  autoPhotos:{pattern:'rekomendasi utama',tags:['[FOTO: Kit.jpeg]']}},
  'bay-sales':{phoneNumberId:'222',persona:'Gino',business:'Baylabs',mode:'test',debounceSec:0,testers:[{who:'Ari',conversationId:'cnv_B'}]}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'cove-support':{id:'wbs_1',secrets:[SECRET]},'bay-sales':{id:'wbs_2',secrets:[SECRET],events:['message.received','message.sent']}}));
 const sent=[],asked=[],posts=[],told=[],patched=[];let clock=Date.now();const tg={ok:postOk};
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');
  if(o.method==='POST'&&/^(111|222)\/messages$/.test(p)){const b=JSON.parse(o.body);b.pid=p.split('/')[0];sent.push(b);return {ok:true,json:async()=>({data:{id:'msg_'+sent.length,status:'queued'}})}}
  if(/^(111|222)\/messages\?/.test(p))return {ok:true,json:async()=>({data:[{direction:'inbound',content:'mau tanya',created_at:'2026-11-05T10:00:00.000Z',type:'text'}]})};
  if(p==='webhook_subscriptions')return {ok:true,json:async()=>({data:{id:'wbs_9',status:'active',initial_secret:'whsec_new'}})};
  if(o.method==='PATCH'&&p.startsWith('webhook_subscriptions/')){patched.push([p,JSON.parse(o.body)]);return {ok:true,json:async()=>({data:{id:p.split('/')[1],events:JSON.parse(o.body).events}})}}
  return {ok:false,status:404,json:async()=>({})}};
 // fake timers: the burst window only closes when the test calls settle(), never because the box was slow
 const due=new Map();let tid=0;const setTimer=(fn)=>{const i=++tid;due.set(i,fn);return i},clearTimer=i=>{due.delete(i)};
 const k=createKirimdev({DATA,WORK,setTimer,clearTimer,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:m=>process.env.KDLOG&&console.log(m),now:()=>clock,echoWait:0,paidSince,
  teamGroup:async a=>a==='cove-support'?team:null,
  runAgent:async(a,q,context)=>{asked.push([a,q,context]);return typeof agentSays==='function'?agentSays(q,context):agentSays},telegram:async(...x)=>{posts.push(x);return tg.ok?4242:false},tell:async t=>{told.push(t)}});
 const post=(raw,h={},agent='cove-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.received',...h},Buffer.from(raw));
 const postSent=(raw,agent='cove-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.sent'},Buffer.from(raw));
 const settle=async()=>{for(let n=0;n<20&&due.size;n++){const fns=[...due.values()];due.clear();await Promise.all(fns.map(f=>f()))}await new Promise(r=>setImmediate(r))};
 return {k,DATA,sent,asked,posts,told,patched,post,postSent,settle,tg,due,setTimer,clearTimer,later:ms=>{clock+=ms}}}

test('signature: any v1 from any secret, within 5 minutes, raw bytes',()=>{const raw='{"a":1}',t=Math.floor(Date.now()/1000);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t),[SECRET]),true);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t,'old')+','+sign(raw,t).split(',')[1],['x',SECRET]),true);
 assert.equal(verifySignature(Buffer.from(raw+' '),sign(raw,t),[SECRET]),false);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t-301),[SECRET]),false);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t+301),[SECRET]),false);
 for(const h of ['', 't=1', 'v1=ab', 't=x,v1=ab', 't=1,t=2,v1=ab', 'é'])assert.equal(verifySignature(Buffer.from(raw),h,[SECRET]),false,h)});

test('parse and split: Meta body to messages; parts, pictures, and no backup-model note',()=>{
 const m=parseInbound(JSON.parse(meta('628123','halo')));assert.equal(m.length,1);assert.deepEqual([m[0].from,m[0].text,m[0].conversationId,m[0].name,m[0].pid],['628123','halo','cnv_A','Rania','111']);
 assert.deepEqual(splitReply('Satu\n---\nDua [FOTO: Kit.jpeg]\n\n(Answered with GPT, Claude was down.)'),['Satu','Dua','[FOTO: Kit.jpeg]'])});

test('a tester gets one answer for a burst, with the picture; a stranger in Test gets none',async()=>{const t=await make({agentSays:'Ini *rekomendasi utama* kak'});
 assert.equal((await t.post(meta('628123','halo'))).status,200);assert.equal((await t.post(meta('628123','mau tanya'))).status,200);
 await t.settle();assert.equal(t.asked.length,1);assert.match(t.asked[0][1],/TEST CHAT/);assert.match(t.asked[0][1],/CUSTOMER: mau tanya/);
 assert.deepEqual(t.sent.map(b=>b.type),['text','image']);assert.equal(t.sent[0].to,'628123');assert.equal(t.sent[1].image.link,'https://media.kirimdev.com/x/Kit.jpeg');
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.asked.length,1)});

test('Live answers everyone; a bad signature, an old one and a repeated event id are refused or ignored',async()=>{const t=await make({mode:'live'});
 const raw=meta('629999','halo',undefined,'cnv_Z');
 assert.equal((await t.k.receive('cove-support',{'x-kirim-signature':sign(raw,undefined,'wrong')},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('cove-support',{'x-kirim-signature':sign(raw,Math.floor(Date.now()/1000)-600)},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('nobody',{'x-kirim-signature':sign(raw)},Buffer.from(raw))).status,404);
 assert.equal((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).status,200);assert.ok((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).body.duplicate);
 await t.settle();assert.equal(t.asked.length,1);assert.equal(t.sent[0].to,'629999')});

test('a handoff goes to the Telegram topic and the customer is told; reset starts the chat again',async()=>{const t=await make({agentSays:'HANDOFF: COA question'});
 await t.post(meta('628123','ada COA?'));await t.settle();
 assert.equal(t.posts.length,1);assert.deepEqual(t.posts[0].slice(0,3),['cove-support',-100,3]);assert.equal(t.told.length,0);assert.match(t.posts[0][3],/\+628123/);assert.match(t.posts[0][3],/@team/);
 assert.match(t.sent[0].text.body,/teruskan ke tim/);
 await t.post(meta('628123','reset'));await t.settle();assert.match(t.sent.at(-1).text.body,/Test reset/);assert.equal(t.asked.length,1)});

test('whatsapp_reply: only to someone who wrote in the last 24 hours, a tester while in Test',async()=>{const t=await make();
 await assert.rejects(t.k.reply('cove-support','628123','halo'),/24 hours/);
 await t.post(meta('628123','halo'));await t.settle();
 const r=await t.k.reply('cove-support','+62 812 3','Jawaban tim: COA ada di link ini');assert.equal(r.length,1);assert.equal(t.sent.at(-1).to,'628123');
 await assert.rejects(t.k.reply('pine-agent','628123','x'),/no Kirimdev line/)});

test('connect makes the webhook and keeps the secret Kirimdev returns; status and mode',async()=>{const t=await make();
 assert.deepEqual(await t.k.connect('cove-support'),{id:'wbs_9',status:'active'});
 const sec=JSON.parse(await readFile(path.join(t.DATA,'kirimdev-secrets.json'),'utf8'));assert.deepEqual(sec['cove-support'].secrets,['whsec_new']);
 assert.equal((await t.k.status())[0].mode,'test');await t.k.setMode('cove-support','live');assert.equal((await t.k.status())[0].mode,'live');
 await assert.rejects(t.k.setMode('cove-support','loud'),/test, draft or live/)});

test('a failed handoff post tells the customer nothing, tells the owner, and is tried again; then the customer hears it',async()=>{const t=await make({agentSays:'HANDOFF: COA question',postOk:false});
 await t.post(meta('628123','ada COA?'));await t.settle();
 assert.equal(t.posts.length,1);assert.equal(t.sent.length,0);assert.equal(t.told.length,1);assert.match(t.told[0],/could not post a handoff/);
 await t.k._tick();assert.equal(t.posts.length,1,'not before its time');
 t.later(61e3);await t.k._tick();assert.equal(t.posts.length,2);assert.equal(t.sent.length,0);assert.equal(t.told.length,1,'the owner is told once');
 t.tg.ok=true;t.later(5*60e3+1);await t.k._tick();assert.equal(t.posts.length,3);assert.equal(t.sent.length,1);assert.match(t.sent[0].text.body,/teruskan ke tim/);
 t.later(3600e3);await t.k._tick();assert.equal(t.posts.length,3,'done, not posted again')});

test('no team group: the handoff is not posted, the customer is not told, the owner is told where to set it',async()=>{const t=await make({agentSays:'HANDOFF: x',team:null});
 await t.post(meta('628123','?'));await t.settle();assert.equal(t.posts.length,0);assert.equal(t.sent.length,0);assert.match(t.told[0],/handoff/)});

test('Draft: every customer gets a draft in the Questions topic, nothing is sent until a person approves it',async()=>{const t=await make({mode:'draft',agentSays:'Halo kak\n---\nIni *rekomendasi utama*'});
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();
 assert.equal(t.sent.length,0);assert.equal(t.posts.length,1);assert.deepEqual(t.posts[0].slice(0,3),['cove-support',-100,3]);assert.match(t.posts[0][3],/DRAFT #1/);assert.match(t.posts[0][3],/\+629999/);
 const s=(await t.k.status()).find(l=>l.agent==='cove-support');assert.equal(s.mode,'draft');assert.equal(s.drafts.length,1);assert.equal(s.drafts[0].posted,true);
 await assert.rejects(t.k.draft('bay-sales',1,'send'),/no draft #1/);
 assert.deepEqual(await t.k.draft('cove-support',1,'send',undefined,'Ari'),{sent:3});assert.deepEqual(t.sent.map(b=>[b.to,b.type]),[['629999','text'],['629999','text'],['629999','image']]);
 await assert.rejects(t.k.draft('cove-support',1,'send'),/already sent/);
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();
 assert.deepEqual(await t.k.draft('cove-support',2,'send','Jawaban yang diubah tim'),{sent:1});assert.equal(t.sent.at(-1).text.body,'Jawaban yang diubah tim');
 await t.post(meta('629999','lagi 2',undefined,'cnv_Z'));await t.settle();assert.deepEqual(await t.k.draft('cove-support',3,'discard'),{dropped:true});assert.equal(t.sent.length,4)});

test('a team member who replies pauses the agent in that chat for the quiet time; our own sends do not',async()=>{const t=await make({mode:'live',pauseMin:10});
 // our own send echoes back: no pause
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,1);
 assert.deepEqual((await t.postSent(sentEv('629999','api','msg_1','cnv_Z'))).body,{ours:true});
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,2);
 // a person writes from the Kirimdev dashboard: the agent stops answering this chat, others go on
 assert.ok((await t.postSent(sentEv('629999','dashboard','msg_human','cnv_Z'))).body.paused);
 await t.post(meta('629999','kak?',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,2);
 const s=(await t.k.status()).find(l=>l.agent==='cove-support');assert.equal(s.pauseMin,10);assert.equal(s.paused.length,1);assert.equal(s.paused[0].who,'…9999');
 await t.post(meta('628888','halo',undefined,'cnv_Y'));await t.settle();assert.equal(t.sent.at(-1).to,'628888');
 // the phone app counts too; an API send aqeelOS did not make counts too
 assert.ok((await t.postSent(sentEv('628888','api','msg_other','cnv_Y'))).body.paused);
 // after the quiet time it answers again
 t.later(10*60e3+1);await t.post(meta('629999','halo lagi',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.at(-1).to,'629999');
 await t.k.setPause('cove-support',30);assert.equal((await t.k.status())[0].pauseMin,30);await assert.rejects(t.k.setPause('cove-support',-1),/whole number/)});

// 7 Nov 2026 (fixer issue i670b6106): a tester's reset confirmation came back as message.sent with an id aqeelOS had not
// written down, counted as a team reply, and held the tester's next question for the 15-minute quiet time
const sentText=(to,source,id,conv,body)=>{const j=JSON.parse(sentEv(to,source,id,conv));j.data.message.body=body;return JSON.stringify(j)};
test('aqeelOS\'s own sends never count as a team reply: a reset confirmation or reply echoed with an unknown id is matched by its text',async()=>{const t=await make({mode:'live',pauseMin:15});
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,1);
 // the echo carries a different id than the receipt, but it is the text aqeelOS queued for this person: ours, no pause
 assert.deepEqual((await t.postSent(sentText('629999','api','msg_echo_other','cnv_Z',t.sent[0].text.body))).body,{ours:true});
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,2,'answered at once');
 // the same text to someone else, or other text, is not ours
 assert.ok((await t.postSent(sentText('628888','api','msg_x','cnv_Y',t.sent[0].text.body))).body.paused);
 assert.ok((await t.postSent(sentText('629999','dashboard','msg_y','cnv_Z','Halo kak, ini Ari'))).body.paused)});
test('a tester\'s chat never pauses for its own test traffic: reset, then the next question is answered at once',async()=>{const t=await make({pauseMin:15});
 await t.post(meta('628123','halo'));await t.settle();assert.equal(t.sent.length,1);
 await t.post(meta('628123','reset'));await t.settle();assert.match(t.sent.at(-1).text.body,/Test reset/);
 // the reset confirmation's echo (any id, any source) and even a person writing in the test chat: no pause
 assert.deepEqual((await t.postSent(sentText('628123','api','msg_reset_echo','cnv_A',t.sent.at(-1).text.body))).body,{ours:true});
 assert.deepEqual((await t.postSent(sentEv('628123','dashboard','msg_team_in_test','cnv_A'))).body,{tester:true});
 t.later(2000);await t.post(meta('628123','berapa harganya?'));await t.settle();assert.equal(t.asked.length,2,'the test question is answered');
 assert.equal(t.sent.at(-1).to,'628123');assert.doesNotMatch(t.sent.at(-1).text.body,/Test reset/);
 const s=(await t.k.status()).find(l=>l.agent==='cove-support');assert.equal(s.paused.length,0);
 // a pause left from before (the old code) is cleared by the next reset, and the confirmation is not held
 const v=await make({pauseMin:15});await writeFile(path.join(v.DATA,'kirimdev-state.json'),JSON.stringify({paused:{'cove-support|628123':Date.now()+15*60e3,'cove-support|cnv_A':Date.now()+15*60e3}}));
 await v.post(meta('628123','reset'));await v.settle();assert.equal(v.sent.length,1);assert.match(v.sent[0].text.body,/Test reset/);
 await v.post(meta('628123','halo'));await v.settle();assert.equal(v.asked.length,1,'and the next question is answered')});
test('a real team reply in a customer chat still pauses, and a reply the agent was writing is still dropped (a tester\'s chat too)',async()=>{
 const gate=deferred(),started=deferred();const t=await make({mode:'live',pauseMin:15,agentSays:async()=>{started.resolve();await gate.promise;return 'stale'}});
 await t.post(meta('629999','halo',undefined,'cnv_Z'));const work=t.settle();await started.promise;
 assert.ok((await t.postSent(sentEv('629999','app','msg_person','cnv_Z'))).body.paused,'a customer chat pauses');gate.resolve();await work;assert.equal(t.sent.length,0,'customer chat: dropped');
 const g2=deferred(),s2=deferred();const u=await make({agentSays:async()=>{s2.resolve();await g2.promise;return 'stale'}});
 await u.post(meta('628123','halo'));const w2=u.settle();await s2.promise;
 assert.deepEqual((await u.postSent(sentEv('628123','dashboard','msg_person2','cnv_A'))).body,{tester:true});g2.resolve();await w2;assert.equal(u.sent.length,0,'tester chat: dropped too')});

test('brands never mix: a line takes only its own number\'s events, and whatsapp_reply refuses the other line\'s customers',async()=>{const t=await make({mode:'live'});
 // Baylabs' number posted to Rory's address, or with no number at all: dropped
 await t.post(meta('627777','halo',undefined,'cnv_X','222'));await t.post(meta('627777','halo',undefined,'cnv_X',''));await t.settle();
 assert.equal(t.asked.length,0);assert.equal(t.sent.length,0);
 assert.deepEqual((await t.postSent(sentEv('627777','dashboard','msg_h','cnv_X','222'))).body,{ignored:'other line'});
 // a customer of Gino's line (a tester there) cannot be answered by Rory
 await t.post(meta('627777','halo',undefined,'cnv_B','222'),{},'bay-sales');await t.settle();assert.equal(t.asked.at(-1)[0],'bay-sales');assert.ok(t.sent.every(b=>b.pid==='222'));
 await assert.rejects(t.k.reply('cove-support','627777','halo'),/another Kirimdev line \(bay-sales\)/);
 assert.equal((await t.k.reply('bay-sales','627777','halo')).length,1);assert.equal(t.sent.at(-1).pid,'222')});

test('a webhook made before message.sent gets it added; message.sent parses',async()=>{const t=await make();
 assert.deepEqual(await t.k.ensureEvents('cove-support'),['message.received','message.sent']);assert.equal(t.patched.length,1);assert.equal(t.patched[0][0],'webhook_subscriptions/wbs_1');
 await t.k.ensureEvents('cove-support');await t.k.ensureEvents('bay-sales');assert.equal(t.patched.length,1);
 assert.equal((await t.k.status())[0].hearsTeam,true);
 assert.deepEqual(parseSent(JSON.parse(sentEv('628123','app','msg_9','cnv_Q'))),{pid:'111',id:'msg_9',source:'app',to:'628123',conversationId:'cnv_Q',name:'',text:'Halo, saya Ari dari tim'})});

test('with agent health there, a failed handoff is a health problem, solved once a retry posts it',async()=>{const probs=[],oks=[];const t=await make({agentSays:'HANDOFF: x',postOk:false});
 // a second instance on the same data, with health hooks (as server.mjs wires it)
 const k2=createKirimdev({DATA:t.DATA,WORK:t.DATA,setTimer:t.setTimer,clearTimer:t.clearTimer,apiKey:async()=>'k',PUBLIC_URL:'x',fetchImpl:async(u,o)=>({ok:true,json:async()=>({data:o.method==='POST'?{id:'m'}:[]})}),wait:async()=>{},log:()=>{},echoWait:0,
  teamGroup:async()=>({chatId:-1,topics:{questions:3}}),runAgent:async()=>'HANDOFF: x',telegram:async()=>probs.length>0&&oks.length===0&&k2.ok?7:false,
  problem:async(a,topic,title)=>{probs.push([a,topic,title])},solved:async(a,topic)=>{oks.push([a,topic])},now:()=>Date.now()+(k2.later||0)});
 const raw=meta('628123','?');await k2.receive('cove-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));await t.settle();
 assert.equal(probs.length,1);assert.match(probs[0][1],/^handoff\|h/);assert.match(probs[0][2],/could not post a handoff/);
 k2.ok=true;k2.later=61e3;await k2._tick();assert.deepEqual(oks,[['cove-support',probs[0][1]]])});

test('a handoff nobody answers in 30 minutes is a health problem once; the team answering on WhatsApp clears it',async()=>{const probs=[],oks=[];let later=0;
 const t=await make({agentSays:'HANDOFF: x'});
 const k2=createKirimdev({DATA:t.DATA,WORK:t.DATA,setTimer:t.setTimer,clearTimer:t.clearTimer,apiKey:async()=>'k',fetchImpl:async(url,o)=>({ok:true,json:async()=>(/\/messages\?/.test(url)?{data:[]}:{data:{id:'m'+Math.random(),status:'queued'}})}),echoWait:0,
  teamGroup:async()=>({chatId:-1,topics:{questions:3}}),runAgent:async()=>'HANDOFF: x',telegram:async()=>7,
  problem:async(a,topic,title)=>{probs.push([a,topic,title])},solved:async(a,topic)=>{oks.push([a,topic])},now:()=>Date.now()+later});
 const raw=meta('628123','ada COA?');await k2.receive('cove-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));await t.settle();
 await k2._tick();assert.equal(probs.length,0,'not before 30 minutes');
 later=31*60e3;await k2._tick();await k2._tick();assert.equal(probs.length,1,'told once');assert.match(probs[0][1],/^unanswered\|h/);assert.match(probs[0][2],/no answer after 30 minutes/);
 const s=sentEv('628123','app','msg_team','cnv_A');await k2.receive('cove-support',{'x-kirim-signature':sign(s,Math.floor((Date.now()+later)/1000)),'x-kirim-event':'message.sent'},Buffer.from(s));
 assert.deepEqual(oks,[['cove-support',probs[0][1]]]);later=40*60e3;await k2._tick();assert.equal(probs.length,1,'not again')});

test('burst is deterministic: nothing runs until the window closes, however slow the box',async()=>{const t=await make();
 await t.post(meta('628123','satu'));await new Promise(r=>setTimeout(r,50));assert.equal(t.asked.length,0);assert.equal(t.due.size,1);
 await t.post(meta('628123','dua'));assert.equal(t.due.size,1);await t.settle();assert.equal(t.asked.length,1);assert.match(t.asked[0][1],/CUSTOMER: mau tanya/)});

test('[VIDEO: name] goes as a real video with caption; .mp4 via FOTO too; a missing video is dropped, never sent as text',async()=>{const logs=[];
 const t=await make({agentSays:'Ini tutorialnya\n[VIDEO: mixing | Cara mixing]\n[VIDEO: nope]\n[FOTO: inject.mp4]'});
 await writeFile(path.join(t.DATA,'work','cove-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\nhttps://media.kirimdev.com/x/mixing.mp4\nhttps://media.kirimdev.com/x/inject.mp4\n');
 assert.deepEqual(splitReply('a [VIDEO: mixing] b'),['a','[VIDEO: mixing]','b']);
 await t.post(meta('628123','video dong'));await t.settle();
 assert.deepEqual(t.sent.map(b=>b.type),['text','video','video']);
 assert.deepEqual(t.sent[1].video,{link:'https://media.kirimdev.com/x/mixing.mp4',caption:'Cara mixing'});
 assert.deepEqual(t.sent[2].video,{link:'https://media.kirimdev.com/x/inject.mp4'});
 assert.ok(!t.sent.some(b=>/VIDEO/.test(b.text?.body||'')))});

test('[FOTO: name] finds a Tripay link whose name sits after ?f= (regression i9530ba20)',async()=>{const t=await make({agentSays:'Silakan bayar kak\n[FOTO: qris-BM-1794214604-1.png]'});
 await writeFile(path.join(t.DATA,'work','cove-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\nhttps://tripay.co.id/qr/show?f=/qris-BM-1794214604-1.png\n');
 await t.post(meta('628123','bayar'));await t.settle();
 assert.deepEqual(t.sent.map(b=>b.type),['text','image']);assert.equal(t.sent[1].image.link,'https://tripay.co.id/qr/show')});  // the ?f= marker is only for matching; WhatsApp gets Tripay's own link (if734729a)

// if734729a (11 Nov 2026): Randy's QRIS went text, picture, text and the picture never showed; Gilang's went as one picture with
// a caption and arrived. A bare picture followed by text now goes as one message, and [FOTO: name | caption] works.
test('a QRIS picture followed by text goes as one picture with that text as its caption',async()=>{
 const t=await make({agentSays:'Siap Kak, ini QRIS-nya ya:\n[FOTO: qris-BM-1.png]\n*Total: Rp10.000* Berlaku 30 menit (sampai 19.06 WIB)'});
 await writeFile(path.join(t.DATA,'work','cove-support','media','staff','urls.txt'),'https://tripay.co.id/qr/T1?f=/qris-BM-1.png\n');
 await t.post(meta('628123','bayar'));await t.settle();
 assert.deepEqual(t.sent.map(b=>b.type),['text','image']);
 assert.deepEqual(t.sent[1].image,{link:'https://tripay.co.id/qr/T1',caption:'*Total: Rp10.000* Berlaku 30 menit (sampai 19.06 WIB)'});
 assert.deepEqual(withCaptions(['a','[FOTO: x.png]','[FOTO: y.png]','b']),['a','[FOTO: x.png]','[FOTO: y.png | b]']);
 assert.deepEqual(withCaptions(['[FOTO: x.png | already]','b']),['[FOTO: x.png | already]','b']);
 assert.deepEqual(withCaptions(['[FOTO: x.png]','x'.repeat(1025)]),['[FOTO: x.png]','x'.repeat(1025)])});

// wait-then-resume after a handoff (11 Nov 2026, taken into git from fixer issue i87fbcb7b)
test('after a handoff with no team reply in humanWaitMin minutes, the agent continues with the wait text and does not hand off again',async()=>{
 const t=await make({agentSays:q=>/NOTE: you handed/.test(q)?'Untuk COA bisa saya bantu kak':'HANDOFF: wants a person',extra:{humanWaitMin:5,humanWaitText:'Halo Kak, tim kami masih sibuk 🙏'}});
 await t.post(meta('628123','mau ngomong sama orang'));await t.settle();
 assert.equal(t.posts.length,1);assert.match(t.sent.at(-1).text.body,/teruskan ke tim/);const n=t.sent.length;
 t.later(4*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n,'not before 5 minutes');
 t.later(2*60e3);await t.k._tick();await t.settle();
 assert.equal(t.posts.length,1,'no second handoff');assert.equal(t.sent[n].text.body,'Halo Kak, tim kami masih sibuk 🙏');assert.match(t.sent[n+1].text.body,/COA/);
 t.later(14*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n+2,'resumes once')});
test('a HANDOFF reply on resume is dropped: only the wait text goes out',async()=>{
 const t=await make({agentSays:'HANDOFF: still wants a person',extra:{humanWaitText:'W'}});
 await t.post(meta('628123','orang dong'));await t.settle();const n=t.sent.length;
 t.later(6*60e3);await t.k._tick();await t.settle();assert.equal(t.posts.length,1);assert.deepEqual(t.sent.slice(n).map(b=>b.text.body),['W'])});
test('a team reply after the handoff cancels the resume; humanWaitMin 0 never resumes',async()=>{for(const [wm,team] of [[5,true],[0,false]]){
 const t=await make({mode:'live',agentSays:'HANDOFF: x',extra:{humanWaitMin:wm,humanWaitText:'W'}});
 await t.post(meta('628999','orang dong','w'+wm,'cnv_Z'));await t.settle();const n=t.sent.length;
 if(team){t.later(60e3);await t.postSent(sentEv('628999','app','msg_team','cnv_Z'));assert.deepEqual((await t.k._state()).waits,{})}
 t.later(30*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n,'no resume (wm='+wm+')')}});
test('whatsapp_reply relaying the team answer cancels the resume',async()=>{
 const t=await make({agentSays:'HANDOFF: x',extra:{humanWaitText:'W'}});
 await t.post(meta('628123','orang dong'));await t.settle();assert.equal(Object.keys((await t.k._state()).waits).length,1);
 await t.k.reply('cove-support','628123','Jawaban tim: ada');const n=t.sent.length;assert.deepEqual((await t.k._state()).waits,{});
 t.later(10*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n)});

// a payment from a recent earlier run counts for the guard (11 Nov 2026, taken into git from the box's 10 Nov drift)
test('a reply pointing back to a QRIS made in an earlier run is not held; the window is paymentRecentMin',async()=>{for(const [min,held] of [[undefined,false],[5,true]]){
 const paidAt=Date.now()-10*60e3;const t=await make({mode:'live',agentSays:'QRIS sudah saya kirim ya kak, silakan dicek',extra:min===undefined?{}:{paymentRecentMin:min},paidSince:async(a,num,since)=>since<=paidAt});
 await t.post(meta('628777','sudah ada qrisnya?',undefined,'cnv_Q'));await t.settle();
 assert.equal(t.sent.some(b=>/QRIS sudah saya kirim/.test(b.text?.body||'')),!held,'paymentRecentMin='+min)}});
