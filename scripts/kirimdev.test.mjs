// Tests for the Kirimdev WhatsApp channel (app/kirimdev.mjs). Run: node --test scripts/kirimdev.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createKirimdev,verifySignature,parseInbound,parseSent,splitReply} from '../app/kirimdev.mjs';

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
 await k.receive('continue-support',headers,Buffer.from(raw));await t.settle();assert.equal(calls.length,1);
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
const sentEv=(to,source,id='msg_'+Math.random(),conv='cnv_A',pid='111')=>JSON.stringify({id:id+':sent',type:'message.sent',data:{session:pid,direction:'outbound',from_me:true,message:{id,type:'text',body:'Halo, saya Amri dari tim',to:'+'+to,status:'sent',source},conversation:{id:conv,status:'open'},contact:{phone_number:'+'+to},meta:{phone_number_id:pid}}});

// an Indonesian line, as the owner runs it: these are settings (kirimdev.json), not code
const LOCALE={language:'Indonesian',localPrefix:{country:'62',local:'0'},resetText:'✅ Test reset. Chat dari awal ya, anggap kamu customer baru.',handoff:{customerText:'Baik kak, untuk pertanyaan ini saya bantu teruskan ke tim kami dulu ya 🙏 Mohon ditunggu sebentar.'}};
async function make({mode='test',agentSays='Halo kak 😊',testers=[{who:'Amri',conversationId:'cnv_A'}],postOk=true,team={chatId:-100,topics:{questions:3},mention:'@team'},pauseMin}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-')),WORK=path.join(DATA,'work');
 await mkdir(path.join(WORK,'continue-support','media','staff'),{recursive:true});
 await writeFile(path.join(WORK,'continue-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\n');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'continue-support':{phoneNumberId:'111',persona:'Randy',business:'Continue',mode,debounceSec:0,testers,...LOCALE,...(pauseMin!==undefined?{pauseMin}:{}),
  autoPhotos:{pattern:'rekomendasi utama',tags:['[FOTO: Kit.jpeg]']}},
  'biomarkers-support':{phoneNumberId:'222',persona:'Gilang',business:'Biomarkers',mode:'test',debounceSec:0,testers:[{who:'Amri',conversationId:'cnv_B'}]}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'continue-support':{id:'wbs_1',secrets:[SECRET]},'biomarkers-support':{id:'wbs_2',secrets:[SECRET],events:['message.received','message.sent']}}));
 const sent=[],asked=[],posts=[],told=[],patched=[];let clock=Date.now();const tg={ok:postOk};
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');
  if(o.method==='POST'&&/^(111|222)\/messages$/.test(p)){const b=JSON.parse(o.body);b.pid=p.split('/')[0];sent.push(b);return {ok:true,json:async()=>({data:{id:'msg_'+sent.length,status:'queued'}})}}
  if(/^(111|222)\/messages\?/.test(p))return {ok:true,json:async()=>({data:[{direction:'inbound',content:'mau tanya',created_at:'2026-11-05T10:00:00.000Z',type:'text'}]})};
  if(p==='webhook_subscriptions')return {ok:true,json:async()=>({data:{id:'wbs_9',status:'active',initial_secret:'whsec_new'}})};
  if(o.method==='PATCH'&&p.startsWith('webhook_subscriptions/')){patched.push([p,JSON.parse(o.body)]);return {ok:true,json:async()=>({data:{id:p.split('/')[1],events:JSON.parse(o.body).events}})}}
  return {ok:false,status:404,json:async()=>({})}};
 // fake timers: the burst window only closes when the test calls settle(), never because the box was slow
 const due=new Map();let tid=0;const setTimer=(fn)=>{const i=++tid;due.set(i,fn);return i},clearTimer=i=>{due.delete(i)};
 const k=createKirimdev({DATA,WORK,setTimer,clearTimer,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:m=>process.env.KDLOG&&console.log(m),now:()=>clock,echoWait:0,
  teamGroup:async a=>a==='continue-support'?team:null,
  runAgent:async(a,q,context)=>{asked.push([a,q,context]);return typeof agentSays==='function'?agentSays(q,context):agentSays},telegram:async(...x)=>{posts.push(x);return tg.ok?4242:false},tell:async t=>{told.push(t)}});
 const post=(raw,h={},agent='continue-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.received',...h},Buffer.from(raw));
 const postSent=(raw,agent='continue-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.sent'},Buffer.from(raw));
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
 assert.equal((await t.k.receive('continue-support',{'x-kirim-signature':sign(raw,undefined,'wrong')},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('continue-support',{'x-kirim-signature':sign(raw,Math.floor(Date.now()/1000)-600)},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('nobody',{'x-kirim-signature':sign(raw)},Buffer.from(raw))).status,404);
 assert.equal((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).status,200);assert.ok((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).body.duplicate);
 await t.settle();assert.equal(t.asked.length,1);assert.equal(t.sent[0].to,'629999')});

test('a handoff goes to the Telegram topic and the customer is told; reset starts the chat again',async()=>{const t=await make({agentSays:'HANDOFF: COA question'});
 await t.post(meta('628123','ada COA?'));await t.settle();
 assert.equal(t.posts.length,1);assert.deepEqual(t.posts[0].slice(0,3),['continue-support',-100,3]);assert.equal(t.told.length,0);assert.match(t.posts[0][3],/\+628123/);assert.match(t.posts[0][3],/@team/);
 assert.match(t.sent[0].text.body,/teruskan ke tim/);
 await t.post(meta('628123','reset'));await t.settle();assert.match(t.sent.at(-1).text.body,/Test reset/);assert.equal(t.asked.length,1)});

test('whatsapp_reply: only to someone who wrote in the last 24 hours, a tester while in Test',async()=>{const t=await make();
 await assert.rejects(t.k.reply('continue-support','628123','halo'),/24 hours/);
 await t.post(meta('628123','halo'));await t.settle();
 const r=await t.k.reply('continue-support','+62 812 3','Jawaban tim: COA ada di link ini');assert.equal(r.length,1);assert.equal(t.sent.at(-1).to,'628123');
 await assert.rejects(t.k.reply('pixel-agent','628123','x'),/no Kirimdev line/)});

test('connect makes the webhook and keeps the secret Kirimdev returns; status and mode',async()=>{const t=await make();
 assert.deepEqual(await t.k.connect('continue-support'),{id:'wbs_9',status:'active'});
 const sec=JSON.parse(await readFile(path.join(t.DATA,'kirimdev-secrets.json'),'utf8'));assert.deepEqual(sec['continue-support'].secrets,['whsec_new']);
 assert.equal((await t.k.status())[0].mode,'test');await t.k.setMode('continue-support','live');assert.equal((await t.k.status())[0].mode,'live');
 await assert.rejects(t.k.setMode('continue-support','loud'),/test, draft or live/)});

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
 assert.equal(t.sent.length,0);assert.equal(t.posts.length,1);assert.deepEqual(t.posts[0].slice(0,3),['continue-support',-100,3]);assert.match(t.posts[0][3],/DRAFT #1/);assert.match(t.posts[0][3],/\+629999/);
 const s=(await t.k.status()).find(l=>l.agent==='continue-support');assert.equal(s.mode,'draft');assert.equal(s.drafts.length,1);assert.equal(s.drafts[0].posted,true);
 await assert.rejects(t.k.draft('biomarkers-support',1,'send'),/no draft #1/);
 assert.deepEqual(await t.k.draft('continue-support',1,'send',undefined,'Amri'),{sent:3});assert.deepEqual(t.sent.map(b=>[b.to,b.type]),[['629999','text'],['629999','text'],['629999','image']]);
 await assert.rejects(t.k.draft('continue-support',1,'send'),/already sent/);
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();
 assert.deepEqual(await t.k.draft('continue-support',2,'send','Jawaban yang diubah tim'),{sent:1});assert.equal(t.sent.at(-1).text.body,'Jawaban yang diubah tim');
 await t.post(meta('629999','lagi 2',undefined,'cnv_Z'));await t.settle();assert.deepEqual(await t.k.draft('continue-support',3,'discard'),{dropped:true});assert.equal(t.sent.length,4)});

test('a team member who replies pauses the agent in that chat for the quiet time; our own sends do not',async()=>{const t=await make({mode:'live',pauseMin:10});
 // our own send echoes back: no pause
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,1);
 assert.deepEqual((await t.postSent(sentEv('629999','api','msg_1','cnv_Z'))).body,{ours:true});
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,2);
 // a person writes from the Kirimdev dashboard: the agent stops answering this chat, others go on
 assert.ok((await t.postSent(sentEv('629999','dashboard','msg_human','cnv_Z'))).body.paused);
 await t.post(meta('629999','kak?',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,2);
 const s=(await t.k.status()).find(l=>l.agent==='continue-support');assert.equal(s.pauseMin,10);assert.equal(s.paused.length,1);assert.equal(s.paused[0].who,'…9999');
 await t.post(meta('628888','halo',undefined,'cnv_Y'));await t.settle();assert.equal(t.sent.at(-1).to,'628888');
 // the phone app counts too; an API send aqeelOS did not make counts too
 assert.ok((await t.postSent(sentEv('628888','api','msg_other','cnv_Y'))).body.paused);
 // after the quiet time it answers again
 t.later(10*60e3+1);await t.post(meta('629999','halo lagi',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.at(-1).to,'629999');
 await t.k.setPause('continue-support',30);assert.equal((await t.k.status())[0].pauseMin,30);await assert.rejects(t.k.setPause('continue-support',-1),/whole number/)});

test('brands never mix: a line takes only its own number\'s events, and whatsapp_reply refuses the other line\'s customers',async()=>{const t=await make({mode:'live'});
 // Biomarkers' number posted to Randy's address, or with no number at all: dropped
 await t.post(meta('627777','halo',undefined,'cnv_X','222'));await t.post(meta('627777','halo',undefined,'cnv_X',''));await t.settle();
 assert.equal(t.asked.length,0);assert.equal(t.sent.length,0);
 assert.deepEqual((await t.postSent(sentEv('627777','dashboard','msg_h','cnv_X','222'))).body,{ignored:'other line'});
 // a customer of Gilang's line (a tester there) cannot be answered by Randy
 await t.post(meta('627777','halo',undefined,'cnv_B','222'),{},'biomarkers-support');await t.settle();assert.equal(t.asked.at(-1)[0],'biomarkers-support');assert.ok(t.sent.every(b=>b.pid==='222'));
 await assert.rejects(t.k.reply('continue-support','627777','halo'),/another Kirimdev line \(biomarkers-support\)/);
 assert.equal((await t.k.reply('biomarkers-support','627777','halo')).length,1);assert.equal(t.sent.at(-1).pid,'222')});

test('a webhook made before message.sent gets it added; message.sent parses',async()=>{const t=await make();
 assert.deepEqual(await t.k.ensureEvents('continue-support'),['message.received','message.sent']);assert.equal(t.patched.length,1);assert.equal(t.patched[0][0],'webhook_subscriptions/wbs_1');
 await t.k.ensureEvents('continue-support');await t.k.ensureEvents('biomarkers-support');assert.equal(t.patched.length,1);
 assert.equal((await t.k.status())[0].hearsTeam,true);
 assert.deepEqual(parseSent(JSON.parse(sentEv('628123','app','msg_9','cnv_Q'))),{pid:'111',id:'msg_9',source:'app',to:'628123',conversationId:'cnv_Q',name:''})});

test('with agent health there, a failed handoff is a health problem, solved once a retry posts it',async()=>{const probs=[],oks=[];const t=await make({agentSays:'HANDOFF: x',postOk:false});
 // a second instance on the same data, with health hooks (as server.mjs wires it)
 const k2=createKirimdev({DATA:t.DATA,WORK:t.DATA,setTimer:t.setTimer,clearTimer:t.clearTimer,apiKey:async()=>'k',PUBLIC_URL:'x',fetchImpl:async(u,o)=>({ok:true,json:async()=>({data:o.method==='POST'?{id:'m'}:[]})}),wait:async()=>{},log:()=>{},echoWait:0,
  teamGroup:async()=>({chatId:-1,topics:{questions:3}}),runAgent:async()=>'HANDOFF: x',telegram:async()=>probs.length>0&&oks.length===0&&k2.ok?7:false,
  problem:async(a,topic,title)=>{probs.push([a,topic,title])},solved:async(a,topic)=>{oks.push([a,topic])},now:()=>Date.now()+(k2.later||0)});
 const raw=meta('628123','?');await k2.receive('continue-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));await t.settle();
 assert.equal(probs.length,1);assert.match(probs[0][1],/^handoff\|h/);assert.match(probs[0][2],/could not post a handoff/);
 k2.ok=true;k2.later=61e3;await k2._tick();assert.deepEqual(oks,[['continue-support',probs[0][1]]])});

test('a handoff nobody answers in 30 minutes is a health problem once; the team answering on WhatsApp clears it',async()=>{const probs=[],oks=[];let later=0;
 const t=await make({agentSays:'HANDOFF: x'});
 const k2=createKirimdev({DATA:t.DATA,WORK:t.DATA,setTimer:t.setTimer,clearTimer:t.clearTimer,apiKey:async()=>'k',fetchImpl:async(url,o)=>({ok:true,json:async()=>(/\/messages\?/.test(url)?{data:[]}:{data:{id:'m'+Math.random(),status:'queued'}})}),echoWait:0,
  teamGroup:async()=>({chatId:-1,topics:{questions:3}}),runAgent:async()=>'HANDOFF: x',telegram:async()=>7,
  problem:async(a,topic,title)=>{probs.push([a,topic,title])},solved:async(a,topic)=>{oks.push([a,topic])},now:()=>Date.now()+later});
 const raw=meta('628123','ada COA?');await k2.receive('continue-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));await t.settle();
 await k2._tick();assert.equal(probs.length,0,'not before 30 minutes');
 later=31*60e3;await k2._tick();await k2._tick();assert.equal(probs.length,1,'told once');assert.match(probs[0][1],/^unanswered\|h/);assert.match(probs[0][2],/no answer after 30 minutes/);
 const s=sentEv('628123','app','msg_team','cnv_A');await k2.receive('continue-support',{'x-kirim-signature':sign(s,Math.floor((Date.now()+later)/1000)),'x-kirim-event':'message.sent'},Buffer.from(s));
 assert.deepEqual(oks,[['continue-support',probs[0][1]]]);later=40*60e3;await k2._tick();assert.equal(probs.length,1,'not again')});

test('burst is deterministic: nothing runs until the window closes, however slow the box',async()=>{const t=await make();
 await t.post(meta('628123','satu'));await new Promise(r=>setTimeout(r,50));assert.equal(t.asked.length,0);assert.equal(t.due.size,1);
 await t.post(meta('628123','dua'));assert.equal(t.due.size,1);await t.settle();assert.equal(t.asked.length,1);assert.match(t.asked[0][1],/CUSTOMER: mau tanya/)});
