// Tests for the Kirimdev WhatsApp channel (app/kirimdev.mjs). Run: node --test scripts/kirimdev.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createDocLinks} from '../app/doc-links.mjs';
import {createKirimdev,verifySignature,parseInbound,parseSent,splitReply,withCaptions,parseApproval,chunkText} from '../app/kirimdev.mjs';

const SECRET='whsec_test_123';
const PERSON={human:true,via:'page'};   // what only the Channels page (a signed-in admin) and teamMessage (a checked Telegram sender) give

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
async function make({mode='test',agentSays='Halo kak 😊',testers=[{who:'Ari',conversationId:'cnv_A'}],postOk=true,team={chatId:-100,topics:{questions:3},mention:'@team'},pauseMin,extra={},paidSince=null,bridge={self:async()=>'',send:async()=>{},result:async()=>null},probs=[],oks=[],health=false,docLinks=null,reviewReply=null,qrSince=null,describeImage=null,chat=null}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-')),WORK=path.join(DATA,'work');
 await mkdir(path.join(WORK,'cove-support','media','staff'),{recursive:true});
 await writeFile(path.join(WORK,'cove-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\n');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'cove-support':{phoneNumberId:'111',persona:'Rory',business:'Cove',mode,debounceSec:0,testers,...LOCALE,...(pauseMin!==undefined?{pauseMin}:{}),...extra,
  autoPhotos:{pattern:'rekomendasi utama',tags:['[FOTO: Kit.jpeg]']}},
  'bay-sales':{phoneNumberId:'222',persona:'Gino',business:'Baylabs',mode:'test',debounceSec:0,testers:[{who:'Ari',conversationId:'cnv_B'}]}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'cove-support':{id:'wbs_1',secrets:[SECRET]},'bay-sales':{id:'wbs_2',secrets:[SECRET],events:['message.received','message.sent']}}));
 const sent=[],asked=[],posts=[],told=[],patched=[];let clock=Date.now();const tg={ok:postOk},box={receipt:null};
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');
  if(o.method==='POST'&&/^(111|222)\/messages$/.test(p)){const b=JSON.parse(o.body);b.pid=p.split('/')[0];sent.push(b);return {ok:true,json:async()=>({data:{id:'msg_'+sent.length,status:'queued'}})}}
  if(/^(111|222)\/messages\/msg_\d+$/.test(p)&&box.receipt)return {ok:true,json:async()=>({data:{id:p.split('/').pop(),...box.receipt}})};
  if(/^https:\/\/media\.test\//.test(url))return {ok:true,headers:{get:()=>'image/jpeg'},arrayBuffer:async()=>new ArrayBuffer(16)};
  if(/^(111|222)\/messages\?/.test(p))return {ok:true,json:async()=>({data:chat||[{direction:'inbound',content:'mau tanya',created_at:'2026-11-05T10:00:00.000Z',type:'text'}]})};
  if(p==='accounts')return {ok:true,json:async()=>({data:[{phone_number_id:'111',phone_number:'+62 811-1111-111',name:'Cove',status:'connected'}]})};
  if(p==='webhook_subscriptions')return {ok:true,json:async()=>({data:{id:'wbs_9',status:'active',initial_secret:'whsec_new'}})};
  if(o.method==='PATCH'&&p.startsWith('webhook_subscriptions/')){patched.push([p,JSON.parse(o.body)]);return {ok:true,json:async()=>({data:{id:p.split('/')[1],events:JSON.parse(o.body).events}})}}
  return {ok:false,status:404,json:async()=>({})}};
 // fake timers: the burst window only closes when the test calls settle(), never because the box was slow
 const due=new Map(),delays=[];let tid=0;const setTimer=(fn,ms)=>{const i=++tid;due.set(i,fn);delays.push(ms);return i},clearTimer=i=>{due.delete(i)};
 const k=createKirimdev({DATA,WORK,setTimer,clearTimer,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:m=>process.env.KDLOG&&console.log(m),now:()=>clock,echoWait:0,paidSince,reviewReply,qrSince,describeImage,bridge,docLinks,...(health?{problem:async(...x)=>{probs.push(x)},solved:async(...x)=>{oks.push(x)}}:{}),
  teamGroup:async a=>a==='cove-support'?team:null,
  runAgent:async(a,q,context)=>{asked.push([a,q,context]);return typeof agentSays==='function'?agentSays(q,context):agentSays},telegram:async(...x)=>{posts.push(x);return tg.ok?4242:false},tell:async t=>{told.push(t)}});
 const post=(raw,h={},agent='cove-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.received',...h},Buffer.from(raw));
 const postSent=(raw,agent='cove-support')=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(clock/1000)),'x-kirim-event':'message.sent'},Buffer.from(raw));
 const settle=async()=>{for(let n=0;n<20&&due.size;n++){const fns=[...due.values()];due.clear();await Promise.all(fns.map(f=>f()))}await new Promise(r=>setImmediate(r))};
 return {k,DATA,probs,oks,sent,asked,posts,told,patched,post,postSent,settle,tg,due,delays,setTimer,clearTimer,later:ms=>{clock+=ms},set receipt(v){box.receipt=v}}}

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
 // an hour on, nobody answered: the handoff is not posted again, the team is reminded once in their topic (audit H7)
 t.later(3600e3);await t.k._tick();assert.equal(t.posts.length,4);assert.match(t.posts[3][3],/NO REPLY SENT[\s\S]*no answer after 30 minutes[\s\S]*wa\.me\/628123/);
 t.later(3600e3);await t.k._tick();assert.equal(t.posts.length,4,'reminded once')});

test('no team group: the handoff is not posted, the customer is not told, the owner is told where to set it',async()=>{const t=await make({agentSays:'HANDOFF: x',team:null});
 await t.post(meta('628123','?'));await t.settle();assert.equal(t.posts.length,0);assert.equal(t.sent.length,0);assert.match(t.told[0],/handoff/)});

test('Draft: every customer gets a draft in the Questions topic, nothing is sent until a PERSON approves it (audit H5)',async()=>{const t=await make({mode:'draft',agentSays:'Halo kak\n---\nIni *rekomendasi utama*'});
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();
 // the draft, then the short message a person answers
 assert.equal(t.sent.length,0);assert.equal(t.posts.length,2);assert.deepEqual(t.posts[0].slice(0,3),['cove-support',-100,3]);assert.match(t.posts[0][3],/^📝 DRAFT #1/);assert.match(t.posts[0][3],/\+629999/);assert.match(t.posts[1][3],/DRAFT #1 waits for a person/);
 const s=(await t.k.status()).find(l=>l.agent==='cove-support');assert.equal(s.mode,'draft');assert.equal(s.drafts.length,1);assert.equal(s.drafts[0].posted,true);
 await assert.rejects(t.k.draft('bay-sales',1,'send','','x',PERSON),/no draft #1/);
 // the agent's own tool call carries no person: it can neither send nor drop its draft
 await assert.rejects(t.k.draft('cove-support',1,'send',undefined,'Rory (approved in Telegram)'),/Only a person on the team/);
 await assert.rejects(t.k.draft('cove-support',1,'discard',undefined,'Rory'),/Only a person on the team/);
 await assert.rejects(t.k.draft('cove-support',1,'send','teks dari agent','Rory',{human:false}),/Only a person on the team/);assert.equal(t.sent.length,0);
 // whatsapp_reply is no way around Draft either
 await assert.rejects(t.k.reply('cove-support','629999','Halo kak'),/Draft: only a person/);assert.equal(t.sent.length,0);
 assert.deepEqual(await t.k.draft('cove-support',1,'send',undefined,'Ari',PERSON),{sent:3});assert.deepEqual(t.sent.map(b=>[b.to,b.type]),[['629999','text'],['629999','text'],['629999','image']]);
 await assert.rejects(t.k.draft('cove-support',1,'send','','Ari',PERSON),/already sent/);
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();
 assert.deepEqual(await t.k.draft('cove-support',2,'send','Jawaban yang diubah tim','Ari',PERSON),{sent:1});assert.equal(t.sent.at(-1).text.body,'Jawaban yang diubah tim');
 await t.post(meta('629999','lagi 2',undefined,'cnv_Z'));await t.settle();assert.deepEqual(await t.k.draft('cove-support',3,'discard','','Ari',PERSON),{dropped:true});assert.equal(t.sent.length,4)});
test('Draft approval from Telegram: only a message from someone on the approvers list, in the team group, that is exactly an approval (audit H5)',async()=>{
 const t=await make({mode:'draft',agentSays:'Halo kak, ini jawabannya',extra:{approvers:[{who:'Mira',telegramId:'7001'}]}});
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,0);
 const say=(text,o={})=>t.k.teamMessage('cove-support',{chatId:-100,threadId:3,userId:'7001',text,...o});
 // the audit's case: "ok nanti saya cek" is not an approval
 assert.equal((await say('[Replying to your previous message: "✋ DRAFT #1 waits for a person."]\n\nok nanti saya cek')).handled,false);assert.equal(t.sent.length,0);
 // someone who is not on the list, another group, a made-up user id
 assert.equal((await say('ok',{userId:'9999'})).why,'not an approver');assert.equal((await say('ok',{chatId:-555})).why,'not the team group');assert.equal((await say('ok',{userId:''})).why,'not an approver');assert.equal(t.sent.length,0);
 const r=await say('[Replying to your previous message: "✋ DRAFT #1 waits for a person. @team Reply to THIS message"]\n\nOk');assert.equal(r.handled,true);assert.equal(r.sent,1);assert.equal(t.sent.at(-1).text.body,'Halo kak, ini jawabannya');
 assert.match(t.posts.at(-1)[3],/Draft #1 sent to the customer[\s\S]*approved by Mira/);assert.match((await t.k._state()).drafts[1].by,/Mira \(Telegram 7001\)/);
 // the changed text must be marked; two waiting drafts need a number
 await t.post(meta('629999','lagi',undefined,'cnv_Z'));await t.settle();await t.post(meta('628888','halo juga',undefined,'cnv_Y'));await t.settle();
 assert.equal((await say('ok')).why,'which draft');
 const r2=await say('kirim: Jawaban dari Mira ya kak #2');assert.equal(r2.handled,true);assert.equal(t.sent.at(-1).text.body,'Jawaban dari Mira ya kak');
 const r3=await say('no #3');assert.equal(r3.dropped,true);
 // a line with no approvers: Telegram approves nothing, the Channels page still does
 const n=await make({mode:'draft',agentSays:'Halo kak'});await n.post(meta('629999','halo',undefined,'cnv_Z'));await n.settle();
 assert.equal((await n.k.teamMessage('cove-support',{chatId:-100,threadId:3,userId:'7001',text:'ok'})).why,'not an approver');assert.equal(n.sent.length,0)});
test('parseApproval: ok, no, a marked text; chatter is nothing',()=>{
 for(const [t,want] of [['ok',{action:'send',id:null}],['Oke.',{action:'send',id:null}],['ok #12',{action:'send',id:12}],['👍',{action:'send',id:null}],['no',{action:'discard',id:null}],['batal #4',{action:'discard',id:4}],
  ['kirim: Halo kak, stok ada ya',{action:'text',text:'Halo kak, stok ada ya',id:null}],['[Replying to your previous message: "✋ DRAFT #7 waits"]\n\nya',{action:'send',id:7}]])assert.deepEqual(parseApproval(t),want,t);
 for(const t of ['ok nanti saya cek','oke sip, tapi harganya salah','Halo kak, stok ada ya','','kirim:','no problem, lanjut','[Replying to: "DRAFT #7"]\n\nsebentar'])assert.equal(parseApproval(t),null,t)});

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

// delivery checks (11 Nov 2026, if734729a): the main WhatsApp gets a picture from the line and the bridge says if it downloaded
test('a delivery check message is never answered, but opens the 24-hour window',async()=>{const t=await make();
 await t.post(meta('628999','aqeelOS delivery check, please ignore. aqeelos-probe:abc123defw'));await t.settle();
 assert.equal(t.asked.length,0);assert.equal(t.sent.length,0)});

test('a delivery check sends a marked picture to the main WhatsApp and reports what arrived',async()=>{const opened=[];let arrived={ok:true,bytes:640};
 const t=await make({bridge:{self:async()=>'628999',send:async(n,x)=>{opened.push([n,x])},result:async id=>arrived&&{id,...arrived}}});
 await t.post(meta('628999','aqeelos-probe:open000001w'));await t.settle();
 const r=await t.k.deliveryCheck('cove-support');
 assert.equal(opened.length,0,'the window was already open');
 const b=t.sent.at(-1);assert.equal(b.type,'image');assert.equal(b.to,'628999');assert.equal(b.image.link,'https://media.kirimdev.com/x/Kit.jpeg');assert.match(b.image.caption,new RegExp('aqeelos-probe:'+r.id));
 assert.deepEqual([r.sent,r.arrived,r.picture,r.bytes],[true,true,true,640]);
 arrived=null;const r2=await t.k.deliveryCheck('cove-support');assert.deepEqual([r2.sent,r2.arrived,r2.picture],[true,false,false]);assert.match(r2.why,/nothing reached/)});

test('a delivery check first opens the window from the main WhatsApp, and says so when it cannot',async()=>{const opened=[];
 const t=await make({bridge:{self:async()=>'628999',send:async(n,x)=>{opened.push([n,x])},result:async()=>null}});
 const r=await t.k.deliveryCheck('cove-support');
 assert.equal(opened.length,1);assert.equal(opened[0][0],'628111111111');assert.match(opened[0][1],/aqeelos-probe:[a-z0-9]+w/);
 assert.equal(r.sent,false);assert.match(r.why,/never received the check message/)});

// wait-then-resume after a handoff (11 Nov 2026, taken into git from fixer issue i87fbcb7b)
test('after a handoff the agent stays silent: only the wait text goes out, the agent is never asked to answer the handed-off question (audit H4)',async()=>{
 const t=await make({agentSays:q=>/NOTE: you handed|Do not hand off again/.test(q)?'Untuk COA bisa saya bantu kak':'HANDOFF: wants a person',extra:{humanWaitMin:5,humanWaitText:'Halo Kak, tim kami masih sibuk 🙏'}});
 await t.post(meta('628123','mau ngomong sama orang'));await t.settle();
 assert.equal(t.posts.length,1);assert.match(t.sent.at(-1).text.body,/teruskan ke tim/);const n=t.sent.length,runs=t.asked.length;
 t.later(4*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n,'not before 5 minutes');
 t.later(2*60e3);await t.k._tick();await t.settle();
 assert.deepEqual(t.sent.slice(n).map(b=>b.text.body),['Halo Kak, tim kami masih sibuk 🙏'],'exactly the wait text');assert.equal(t.asked.length,runs,'the agent was not run again');
 assert.ok(!t.asked.some(x=>/Do not hand off again|continue helping the customer yourself/.test(x[1])));
 // the customer writes again while the chat is with the team: kept, the team's alert is refreshed, the agent still does not answer
 t.later(11*60e3);await t.post(meta('628123','halo? ada orang?','m2'));await t.settle();
 assert.equal(t.asked.length,runs,'still silent');assert.equal(t.posts.length,2);assert.match(t.posts[1][3],/STILL WAITING[\s\S]*halo\? ada orang\?/);assert.equal(t.sent.length,n+1,'the wait text is not repeated within the hour');
 assert.equal((await t.k.status())[0].holds.length,1);
 // a person answers in Kirimdev: the hold ends, and what the tester wrote meanwhile is answered
 t.later(60e3);await t.postSent(sentEv('628123','dashboard','msg_person'));assert.deepEqual((await t.k._state()).holds,{});await t.settle();assert.equal(t.asked.length,runs+1)});
test('a second HANDOFF for the same chat refreshes the team alert instead of being dropped, and the customer is not told twice (audit H4, M5)',async()=>{
 const t=await make({mode:'live',agentSays:'HANDOFF: dose question',extra:{handoff:{...LOCALE.handoff,releaseMin:10},humanWaitMin:0}});
 await t.post(meta('628999','aman tidak dengan obat saya?','a1','cnv_Z'));await t.settle();assert.equal(t.posts.length,1);assert.match(t.posts[0][3],/^❓ HANDOFF/);const n=t.sent.length;assert.equal(n,1);
 // the long timeout (here 10 minutes) passes with no person: the next message is the agent's again, it hands off again
 t.later(11*60e3);await t.post(meta('628999','halo?','a2','cnv_Z'));await t.settle();
 assert.equal(t.posts.length,2);assert.match(t.posts[1][3],/^🔁 HANDOFF AGAIN[\s\S]*dose question/);assert.equal(t.sent.length,n,'"passed to the team" is said once');
 assert.equal(Object.keys((await t.k._state()).asked).length,1,'one open handoff per chat')});
test('a team reply after the handoff cancels the wait text; humanWaitMin 0 never sends it',async()=>{for(const [wm,team] of [[5,true],[0,false]]){
 const t=await make({mode:'live',agentSays:'HANDOFF: x',extra:{humanWaitMin:wm,humanWaitText:'W'}});
 await t.post(meta('628999','orang dong','w'+wm,'cnv_Z'));await t.settle();const n=t.sent.length;
 if(team){t.later(60e3);await t.postSent(sentEv('628999','app','msg_team','cnv_Z'));assert.deepEqual((await t.k._state()).waits,{});assert.deepEqual((await t.k._state()).holds,{})}
 t.later(30*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n,'no wait text (wm='+wm+')')}});
test('whatsapp_reply relaying the team answer ends the hold and the wait; the same text is not sent twice (audit M5)',async()=>{
 const t=await make({agentSays:'HANDOFF: x',extra:{humanWaitText:'W'}});
 await t.post(meta('628123','orang dong'));await t.settle();assert.equal(Object.keys((await t.k._state()).waits).length,1);
 await t.k.reply('cove-support','628123','Jawaban tim: ada');const n=t.sent.length;assert.deepEqual((await t.k._state()).waits,{});assert.deepEqual((await t.k._state()).holds,{});
 await assert.rejects(t.k.reply('cove-support','628123','Jawaban tim: ada'),/already sent to this customer/);assert.equal(t.sent.length,n);
 t.later(10*60e3);await t.k._tick();await t.settle();assert.equal(t.sent.length,n);
 await t.k.reply('cove-support','628123','Jawaban tim: ada');assert.equal(t.sent.length,n+1,'after 10 minutes it is a new message')});

// a payment from a recent earlier run counts for the guard (11 Nov 2026, taken into git from the box's 10 Nov drift)
test('a reply pointing back to a QRIS made in an earlier run is not held; the window is paymentRecentMin',async()=>{for(const [min,held] of [[undefined,false],[5,true]]){
 const paidAt=Date.now()-10*60e3;const t=await make({mode:'live',agentSays:'QRIS sudah saya kirim ya kak, silakan dicek',extra:min===undefined?{}:{paymentRecentMin:min},paidSince:async(a,num,since)=>since<=paidAt});
 await t.post(meta('628777','sudah ada qrisnya?',undefined,'cnv_Q'));await t.settle();
 assert.equal(t.sent.some(b=>/QRIS sudah saya kirim/.test(b.text?.body||'')),!held,'paymentRecentMin='+min)}});

test('the one exit guard: whatsapp_reply, a draft and a send of internal text never reach the customer (12 Nov 2026)',async()=>{const t=await make({mode:'live'});
 await t.post(meta('628123','halo'));await t.settle();const n=t.sent.length;
 await assert.rejects(t.k.reply('cove-support','628123','Dari rules: paket 1\n---\nHalo kak'),/not sent to the customer/);
 await assert.rejects(t.k.reply('cove-support','628123','Traceback (most recent call last):\n  File "x.py", line 3, in <module>'),/not sent to the customer/);
 // nothing went out, and the team (not only the bell) was told once, with the chat link
 assert.equal(t.sent.length,n);assert.equal(t.posts.filter(x=>/NO REPLY SENT[\s\S]*stopped before it reached the customer[\s\S]*wa\.me\/628123/.test(x[3])).length,1);
 await t.k.reply('cove-support','628123','Halo kak, ini jawabannya ya');assert.equal(t.sent.length,n+1)});
test('an agent that keeps stopping on one chat is tried again twice with waits, then handed to the team once, with one Health problem (12 Nov 2026)',async()=>{
 let runs=0;const probs=[];const t=await make({agentSays:async()=>{runs++;throw Error('the agent stopped (1)')}});
 await t.post(meta('628123','tolong','m1'));await t.settle();
 assert.equal(runs,3);assert.equal(t.sent.length,0);assert.equal(t.due.size,0,'no timer is left: nothing retries any more');
 assert.ok(t.posts.some(x=>/agent stopped 3 times/.test(String(x[3]))),'the team got the chat once');
 await t.settle();assert.equal(runs,3);
 // a new message from the customer starts a fresh try
 await t.post(meta('628123','halo lagi','m2'));await t.settle();assert.equal(runs,6)});

test('a used-up provider is not the chat fault: the chat waits for the reset, one Health problem names the reason, the first good answer clears it (12 Nov 2026, root cause of the stop loops)',async()=>{
 let runs=0,down=true;const t=await make({health:true,agentSays:async()=>{runs++;if(down)throw Error("the agent stopped (1): HTTP 429: Incomplete upstream response (first upstream attempt: status 429): You've hit your session limit · resets 10pm (UTC)");return 'Halo kak'}});
 await t.post(meta('628123','tolong','m1'));await t.settle();
 assert.equal(runs,1,'one try, then it waits for the reset instead of trying every few seconds');assert.equal(t.sent.length,0);assert.equal(t.due.size,1,'a timer holds the chat');
 assert.equal(t.posts.length,0,'not handed to the team: it is not a chat problem');
 assert.equal(t.probs.length,1);assert.equal(t.probs[0][1],'kirimdev|provider');assert.match(t.probs[0][3],/session limit/);assert.match(t.probs[0][3],/resets at [0-9]{2}:[0-9]{2} UTC/);
 // a second chat of the same line is held without even starting the engine
 await t.post(meta('628777','halo','m2','cnv_X'));
 await t.settle();assert.equal(runs,1);assert.equal(t.probs.length,1,'one problem per line, not one per chat');
 // the provider is back and the hold is over
 down=false;t.later(31*60e3);await t.post(meta('628123','halo lagi','m3'));await t.settle();
 assert.ok(runs>=2);assert.ok(t.sent.some(b=>/Halo kak/.test(b.text?.body||'')),'answered');assert.deepEqual(t.oks.map(x=>x[1]),['kirimdev|provider'])});
test('a stop that is not the provider keeps the breaker, and its reason reaches the Health problem (12 Nov 2026)',async()=>{
 let runs=0;const t=await make({health:true,agentSays:async()=>{runs++;throw Error('the agent stopped (1): Gateway did not answer session.create')}});
 await t.post(meta('628123','tolong','m1'));await t.settle();assert.equal(runs,3);assert.ok(t.probs.some(x=>x[1].startsWith('stopped|')&&/Gateway did not answer session.create/.test(x[3])),'the reason is in the problem');assert.ok(!t.probs.some(x=>x[1]==='kirimdev|provider'))});

// the protocol PDF over WhatsApp (12 Nov 2026, issue i19b649d9): Kirimdev's document message takes a public https link, never bytes
test('sendDocument: a document message with a public https link, to a number that wrote in the last 24 hours; never in Draft or to a stranger in Test',async()=>{
 const t=await make();await t.post(meta('628123','halo'));await t.settle();const n=t.sent.length;
 await assert.rejects(t.k.sendDocument('cove-support','628123',{link:'http://x/a.pdf',filename:'a.pdf'}),/public https link/);
 await assert.rejects(t.k.sendDocument('cove-support','628123',{link:Buffer.from('%PDF-1.4'),filename:'a.pdf'}),/public https link/,'bytes are not a link');
 await assert.rejects(t.k.sendDocument('cove-support','629999',{link:'https://ai.example/doc/x/a.pdf'}),/24 hours/);
 await assert.rejects(t.k.sendDocument('cove-support','628123',{link:'https://ai.example/doc/x/a.pdf',caption:'Traceback (most recent call last):\n  File "x.py", line 3, in <module>'}),/not sent to the customer/);
 assert.equal(t.sent.length,n);
 await t.k.sendDocument('cove-support','628123',{link:'https://ai.example/doc/T/Protokol.pdf',filename:'Protokol.pdf',caption:'Ini protokolnya, kak.'});
 const b=t.sent.at(-1);assert.deepEqual([b.type,b.to,b.document.link,b.document.filename,b.document.caption],['document','628123','https://ai.example/doc/T/Protokol.pdf','Protokol.pdf','Ini protokolnya, kak.']);
 const d=await make({mode:'draft'});await d.post(meta('628123','halo'));await d.settle();
 await assert.rejects(d.k.sendDocument('cove-support','628123',{link:'https://ai.example/doc/x/a.pdf'}),/Draft/)});

test('a PDF delivery check goes through the real link, the bridge must download a PDF, and the link is gone afterwards',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dl-'));const docLinks=createDocLinks({DATA,PUBLIC_URL:'https://ai.example'});let arrived={ok:true,bytes:640,type:'document'};
 const t=await make({docLinks,bridge:{self:async()=>'628999',send:async()=>{},result:async id=>arrived&&{id,...arrived}}});
 await t.post(meta('628999','aqeelos-probe:open000001w'));await t.settle();
 const r=await t.k.deliveryCheck('cove-support',{document:true});const b=t.sent.at(-1);
 assert.equal(b.type,'document');assert.equal(b.to,'628999');assert.match(b.document.link,/^https:\/\/ai\.example\/doc\/[\w-]{43}\/aqeelOS%20delivery%20check\.pdf$/);assert.match(b.document.caption,new RegExp('aqeelos-probe:'+r.id));
 assert.deepEqual([r.sent,r.arrived,r.document,r.bytes],[true,true,true,640]);assert.equal(docLinks.count(),0,'the link was dropped');assert.ok(!/doc\/[\w-]{43}\//.test(r.link),'the token is not kept in the result');
 arrived={ok:false,bytes:12,type:'document',error:'not a PDF'};const r2=await t.k.deliveryCheck('cove-support',{document:true});assert.equal(r2.document,false);assert.match(r2.why,/did not download/)});

test('a delivery check reports each step as it goes, so a waiting person sees where it is',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'dl-'));const docLinks=createDocLinks({DATA,PUBLIC_URL:'https://ai.example'});const steps=[];
 const t=await make({docLinks,bridge:{self:async()=>'628999',send:async()=>{},result:async id=>({id,ok:true,bytes:640,type:'document'})}});
 await t.post(meta('628999','aqeelos-probe:open000001w'));await t.settle();
 const r=await t.k.deliveryCheck('cove-support',{document:true,step:async s=>{steps.push(s)}});
 assert.equal(r.document,true);assert.ok(steps.length>=3,steps.join(' | '));assert.ok(steps.some(s=>/file link/.test(s)),'names the link step');assert.ok(steps.some(s=>/waiting up to 3 minutes/.test(s)),'names the wait')});

// ---- customer-safety audit, 12 Nov 2026 (H6, H7, C2, M3, M5-M8, L1)
test('a reply the exit guard holds is written once more with the reason; the clean second try goes out (audit H6)',async()=>{let n=0;
 const t=await make({mode:'live',agentSays:q=>++n===1?'Halo kak!\nSesuai SOP, saya harus tanya dulu riwayat produk.\nBoleh tahu sebelumnya pernah pakai?':'Halo kak! Boleh tahu sebelumnya pernah pakai produk?'});
 await t.post(meta('628777','halo kak mau tanya',undefined,'cnv_Q'));await t.settle();
 assert.equal(t.asked.length,2);assert.match(t.asked[1][1],/NOTE: your last reply was NOT sent[\s\S]*citing its rules/);assert.equal(t.asked[0][2].session,t.asked[1][2].session);
 assert.deepEqual(t.sent.map(b=>b.text.body),['Halo kak! Boleh tahu sebelumnya pernah pakai produk?']);assert.equal(t.posts.length,0)});
test('held twice: the customer gets nothing wrong, a person gets the chat with the held text, which only the team sees (audit H6)',async()=>{
 const t=await make({mode:'live',agentSays:'Kak Budi Santoso di Jl. Melati 12 Bandung (081234567890) kemarin pesan paket yang sama kok kak'});
 await t.post(meta('628777','ada yang pesan paket ini?',undefined,'cnv_Q'));await t.settle();
 assert.equal(t.asked.length,2,'one more try, not more');assert.equal(t.posts.length,1);assert.match(t.posts[0][3],/^❓ HANDOFF[\s\S]*exit guard stopped[\s\S]*Held text \(NOT sent to the customer\):[\s\S]*Budi Santoso/);
 // the customer hears only the line's own "passed on" text
 assert.equal(t.sent.length,1);assert.match(t.sent[0].text.body,/teruskan ke tim/);assert.ok(!JSON.stringify(t.sent).includes('Budi'))});
test('another customer\'s number never leaves through whatsapp_reply either; the customer\'s own number and a number the line allows do (audit C1)',async()=>{
 const t=await make({mode:'live',extra:{guard:{phones:['0812-0000-3333']}}});await t.post(meta('6281200001111','halo, nomor saya 0812-0000-1111'));await t.settle();const n=t.sent.length;
 await assert.rejects(t.k.reply('cove-support','6281200001111','Kemarin ada yang pesan juga, nomornya 0812-0000-2222 kak'),/not sent to the customer \(a phone number that is not this customer/);assert.equal(t.sent.length,n);
 await t.k.reply('cove-support','6281200001111','Nomor kakak 0812-0000-1111 sudah kami catat ya. Admin kami: 0812-0000-3333');assert.equal(t.sent.length,n+1)});
test('the agent wrote nothing, or only pictures aqeelOS does not have: ONE team alert with the chat link, counted for Health, never silence (audit H7)',async()=>{
 const probs=[];const t=await make({mode:'live',agentSays:'',probs,health:true});
 await t.post(meta('628777','halo?','e1','cnv_Q'));await t.settle();await t.post(meta('628777','halo??','e2','cnv_Q'));await t.settle();
 assert.equal(t.sent.length,0);assert.equal(t.posts.length,1,'one alert, not one per message');assert.match(t.posts[0][3],/NO REPLY SENT[\s\S]*wrote nothing[\s\S]*wa\.me\/628777/);
 assert.equal(probs.length,1);assert.equal(probs[0][1],'customer|empty|628777');assert.ok(!/628777/.test(probs[0][2]+probs[0][3]),'Health shows the last four digits only');
 assert.equal((await t.k.status())[0].noReply.today,1);
 const p=await make({mode:'live',agentSays:'[FOTO: missing.png]'});await p.post(meta('628777','lihat fotonya',undefined,'cnv_Q'));await p.settle();
 assert.equal(p.sent.length,0);assert.equal(p.posts.length,1);assert.match(p.posts[0][3],/only pictures aqeelOS does not have/)});
test('a message WhatsApp did not deliver is told to the team in their topic, once (audit H7)',async()=>{const t=await make({mode:'live'});
 await t.post(meta('628777','halo',undefined,'cnv_Q'));await t.settle();assert.equal(t.sent.length,1);
 t.receipt={status:'failed',error:{code:'131047'}};await t.k._tick();await t.k._tick();
 assert.equal(t.posts.filter(x=>/WhatsApp did not deliver a message[\s\S]*131047/.test(x[3])).length,1)});
test('a removed tester is a customer again: Test mode no longer answers them (audit C2)',async()=>{const t=await make();
 await t.post(meta('628123','halo'));await t.settle();assert.equal(t.sent.length,1);
 const c=JSON.parse(await readFile(path.join(t.DATA,'kirimdev.json'),'utf8'));c.lines['cove-support'].testers=[];await writeFile(path.join(t.DATA,'kirimdev.json'),JSON.stringify(c));
 await assert.rejects(t.k.reply('cove-support','628123','Halo lagi kak'),/only answers its testers/);
 await t.post(meta('628123','halo lagi','x2'));await t.settle();assert.equal(t.asked.length,1,'not answered any more')});
test('a mode change is written down with who; a mode edited in the file is not believed, the stricter one applies (audit M6)',async()=>{const probs=[];const t=await make({probs,health:true});
 await t.k.status();await t.k.setMode('cove-support','draft','Aqeel');const m=(await t.k._state()).modes['cove-support'];assert.equal(m.mode,'draft');assert.equal(m.by,'Aqeel');assert.equal(m.was,'test');
 const c=JSON.parse(await readFile(path.join(t.DATA,'kirimdev.json'),'utf8'));c.lines['cove-support'].mode='live';await writeFile(path.join(t.DATA,'kirimdev.json'),JSON.stringify(c));
 assert.equal((await t.k.status())[0].mode,'draft','a hand edit to live does not make it live');assert.ok(probs.some(x=>x[1]==='kirimdev|mode'));
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.sent.length,0,'still Draft: nothing reaches the customer')});
test('the 24-hour window counts from when the customer wrote, and a made-up test event never opens it (audit M8)',async()=>{const t=await make({mode:'live'});
 const old=JSON.parse(meta('628555','halo dari kemarin','old1','cnv_O'));old.entry[0].changes[0].value.messages[0].timestamp=String(Math.floor(Date.now()/1000)-25*3600);
 await t.post(JSON.stringify(old));await t.settle();assert.equal(t.sent.length,0,'outside the window: nothing is sent');
 await t.post(meta('628556','halo','wamid.aqtest-abc123','cnv_T').replace('"id":"wamid.aqtest-abc123"','"id":"wamid.aqtest-abc123"'));await t.settle();assert.equal(t.sent.length,0);
 await t.post(meta('628557','halo','real1','cnv_R'));await t.settle();assert.equal(t.sent.length,1)});
test('nothing is cut silently: a long text is split at a paragraph, parts beyond eight are joined (audit L1)',()=>{
 const long=('Paragraf satu. '.repeat(100)+'\n\n').repeat(4);const c=chunkText(long.trim());assert.ok(c.length>=2&&c.every(x=>x.length<=3900));assert.equal(c.join(' ').replace(/\s+/g,' '),long.trim().replace(/\s+/g,' '));
 const many=splitReply(Array.from({length:11},(_,i)=>'bagian '+(i+1)).join('\n---\n'));assert.equal(many.length,8);assert.match(many[7],/bagian 8[\s\S]*bagian 11/)});
test('finished sends leave the state after 48 hours; left-over run files are removed at start (audit M3)',async()=>{const t=await make({mode:'live'});
 await t.post(meta('628777','halo',undefined,'cnv_Q'));await t.settle();t.receipt={status:'delivered'};await t.k._tick();
 const first=Object.keys((await t.k._state()).outbox);assert.equal(first.length,1);
 // two days on, the next save drops the delivered send; the new one stays
 t.later(49*3600e3);await t.post(meta('628778','halo','n2','cnv_N'));await t.settle();
 const left=Object.keys((await t.k._state()).outbox);assert.equal(left.length,1);assert.ok(!left.includes(first[0]));
 const {utimes,stat}=await import('node:fs/promises');const old=path.join(t.DATA,'kirimdev-query-11111111-2222-3333-4444-555555555555.txt'),fresh=path.join(t.DATA,'kirimdev-query-99999999-2222-3333-4444-555555555555.txt');
 await writeFile(old,'old prompt');await writeFile(fresh,'a run in progress');const now=Date.now()+49*3600e3;await utimes(old,new Date((now-3600e3)),new Date(now-3600e3));await utimes(fresh,new Date(now),new Date(now));
 assert.equal(await t.k.sweepQueries(),1);assert.equal(await stat(old).catch(()=>null),null);assert.ok(await stat(fresh))});
test('a turn that waited more than two hours goes to a person instead of a late answer (audit M7)',async()=>{const t=await make({mode:'live'});
 await t.post(meta('628777','halo',undefined,'cnv_Q'));t.later(3*3600e3);await t.settle();
 assert.equal(t.asked.length,0);assert.equal(t.sent.length,0);assert.equal(t.posts.length,1);assert.match(t.posts[0][3],/waited 180 minutes/)});

// 13 Nov 2026: Release chat on the page. The page lists a held chat by a reference, never the customer's number; a release by reference ends the hold.
test('a held chat is released from the page by its reference: the number is not on the page, a wrong reference changes nothing, the agent answers again',async()=>{
 const t=await make({agentSays:q=>/NOTE: you handed|Do not hand off again/.test(q)?'Siap kak':'HANDOFF: wants a person',extra:{humanWaitMin:5,humanWaitText:'Sebentar ya kak'}});
 await t.post(meta('628123','mau ngomong sama orang'));await t.settle();
 const h=(await t.k.status())[0].holds;assert.equal(h.length,1);assert.match(h[0].ref,/^[0-9a-f]{12}$/);assert.equal(JSON.stringify(h).includes('628123'),false,'the customer\'s number is not in what the page gets');
 assert.equal(await t.k.releaseRef('cove-support','0'.repeat(12),'an admin'),false);assert.equal((await t.k.status())[0].holds.length,1);
 assert.equal(await t.k.releaseRef('someone-else',h[0].ref,'an admin'),false,'only the line\'s own chats');
 assert.equal(await t.k.releaseRef('cove-support',h[0].ref,'an admin'),true);assert.deepEqual((await t.k._state()).holds,{});
 assert.equal(await t.k.releaseRef('cove-support',h[0].ref,'an admin'),false,'again: already released')});

// wait for the customer to finish (owner, 14 Nov 2026): answer once they are quiet, all of it together
test('the agent waits until the customer has been quiet (90 s by default), never past the longest wait (180 s)',async()=>{const t=await make();
 await t.post(meta('628123','halo'));assert.equal(t.delays.at(-1),90000,'90 s after a message by default');
 t.later(170e3);await t.post(meta('628123','mau tanya'));assert.equal(t.delays.at(-1),10000,'only 10 s left of the 180 s longest wait');
 t.later(30e3);await t.post(meta('628123','harga?'));assert.equal(t.delays.at(-1),3000,'past the longest wait: answered in a moment');
 await t.settle();assert.equal(t.asked.length,1,'one answer for the whole burst');assert.match(t.asked[0][1],/CUSTOMER: halo\nCUSTOMER: mau tanya\nCUSTOMER: harga\?/)});

test('quietSec and maxWaitSec are per line; 0 answers at once',async()=>{const t=await make({extra:{quietSec:30,maxWaitSec:60}});
 await t.post(meta('628123','halo'));assert.equal(t.delays.at(-1),30000);
 const t0=await make({extra:{quietSec:0}});await t0.post(meta('628123','halo'));assert.equal(t0.delays.at(-1),0)});

test('a reply written while the customer kept writing is not sent; every message is answered together',async()=>{let t,n=0;
 t=await make({agentSays:async()=>{if(++n===1){t.later(20e3);await t.post(meta('628123','dan itu artinya sudah termasuk water ya?'))}return 'Jawaban '+n}});
 await t.post(meta('628123','kalau 1.5 mg itu pen ke 15?'));await t.settle();
 assert.equal(t.asked.length,2,'asked again with everything');assert.deepEqual(t.sent.map(b=>b.text?.body),['Jawaban 2'],'only the full answer is sent');
 assert.match(t.asked[1][1],/CUSTOMER: kalau 1\.5 mg itu pen ke 15\?\nCUSTOMER: dan itu artinya sudah termasuk water ya\?/)});

test('past the longest wait a reply is sent even if the customer is still writing (they are never left without an answer)',async()=>{let t,n=0;
 t=await make({extra:{maxWaitSec:60},agentSays:async()=>{if(++n===1){t.later(90e3);await t.post(meta('628123','satu lagi'))}return 'Jawaban '+n}});
 await t.post(meta('628123','halo'));await t.settle();
 assert.equal(t.sent[0]?.text?.body,'Jawaban 1','the first answer went out');assert.equal(t.asked.length,2,'the late message is answered next')});

test('the wait settings are checked when saved, and kept',async()=>{const t=await make({extra:{phoneNumberId:'111111'}});
 await assert.rejects(t.k.saveLine('cove-support',{phoneNumberId:'111111',quietSec:700}),/0 to 600/);
 await assert.rejects(t.k.saveLine('cove-support',{phoneNumberId:'111111',quietSec:120,maxWaitSec:60}),/cannot be shorter/);
 await t.k.saveLine('cove-support',{phoneNumberId:'111111',quietSec:45,maxWaitSec:120});const c=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(t.DATA,'kirimdev.json'),'utf8'));
 assert.equal(c.lines['cove-support'].quietSec,45);assert.equal(c.lines['cove-support'].maxWaitSec,120)});

// the check before sending (kirim-review.mjs, 14 Nov 2026): a draft that misreads or misses a question is written again, then a person gets it
test('the check before sending holds a draft that misses the question; the agent rewrites it with the reasons',async()=>{const seen=[];let n=0;
 const t=await make({mode:'live',agentSays:q=>/check before sending found problems/.test(q)?'Dosis 1.5 mg itu peptide saja kak, belum termasuk water.':'Halo kak',
  reviewReply:async(a,prompt)=>{seen.push(prompt);return ++n===1?'{"ok":false,"problems":["it does not answer whether 1.5 mg includes the water"]}':'{"ok":true}'}});
 await t.post(meta('628123','dan suntikan itu 1.5 mg = water dan peptide atau hanya peptide nya'));await t.settle();
 assert.equal(t.asked.length,2);assert.match(t.asked[1][1],/does not answer whether 1\.5 mg includes the water/);
 assert.deepEqual(t.sent.map(b=>b.text?.body),['Dosis 1.5 mg itu peptide saja kak, belum termasuk water.']);
 assert.match(seen[0],/1\.5 mg = water dan peptide/,'the reviewer sees the customer message');assert.match(seen[0],/Halo kak/,'and the draft')});

test('held twice by the check: nothing is sent, a person gets the chat with the held text',async()=>{
 const t=await make({mode:'live',agentSays:'Halo kak',reviewReply:async()=>'{"ok":false,"problems":["misreads the quantity"]}'});
 await t.post(meta('628123','pesan 2 ya'));await t.settle();
 assert.ok(!t.sent.some(b=>b.text?.body==='Halo kak'),'the held draft never reached the customer');assert.ok(t.posts.some(x=>/HANDOFF[\s\S]*Held text[\s\S]*Halo kak/.test(String(x[3]))),'the team sees what was held')});

test('a check that fails holds the reply (fail closed); the line can turn the check off',async()=>{
 const t=await make({mode:'live',agentSays:'Halo kak',reviewReply:async()=>{throw Error('boom')}});
 await t.post(meta('628123','halo'));await t.settle();assert.ok(!t.sent.some(b=>b.text?.body==='Halo kak'),'not sent while it could not be checked');
 let called=0;const off=await make({mode:'live',agentSays:'Halo kak',extra:{review:'off'},reviewReply:async()=>{called++;return '{"ok":false}'}});
 await off.post(meta('628123','halo'));await off.settle();assert.equal(called,0);assert.equal(off.sent.length,1)});

test('whatsapp_reply gets the full guard: a payment claim with no payment is refused for the agent to rewrite',async()=>{
 const t=await make({mode:'live',paidSince:async()=>false});await t.post(meta('628123','halo'));await t.settle();const n=t.sent.length;
 await assert.rejects(t.k.reply('cove-support','628123','QRIS sudah saya kirimkan ya kak'),/Not sent: .*no (QR picture|payment) was made/);assert.equal(t.sent.length,n)});

test('a payment lookup that fails holds a payment claim (it used to switch the check off)',async()=>{
 const t=await make({mode:'live',agentSays:'Link pembayaran sudah saya kirim ya kak',paidSince:async()=>{throw Error('disk')}});
 await t.post(meta('628123','sudah transfer?'));await t.settle();assert.ok(!t.sent.some(b=>/Link pembayaran sudah/.test(b.text?.body||'')),'the claim did not reach the customer')});

test('a QRIS made in an earlier reply counts: "the QRIS above" is sent with that picture, not handed off',async()=>{const asked=[];
 const t=await make({mode:'live',agentSays:'QRIS-nya sudah kami kirim di atas ya kak, masih berlaku',paidSince:async()=>true,qrSince:async(a,ph,since)=>{asked.push(since);return ['[FOTO: qris-123.png]']}});
 await t.post(meta('628123','qrisnya mana kak'));await t.settle();
 assert.ok(t.sent.length>=1,'sent, not handed off');assert.ok(!t.posts.some(x=>/HANDOFF/.test(String(x[3]))));
 assert.ok(asked.every(s=>s<Date.now()-50*60e3),'looked back over the payment window, not only this run')});

// customer photos (14 Nov 2026, owner: "questions with an attached photo must be read word by word"): every word reaches the agent
test('a customer photo: its words are asked for exactly, kept whole, and up to five new photos are read per reply',async()=>{
 const {IMAGE_ASK}=await import('../app/kirimdev-agent.mjs');assert.match(IMAGE_ASK,/copy every word and number you can read in it exactly/);
 const long='Text: '+'Reta 10 mg, 1.5 mg = 15 unit, water 3 ml, '.repeat(25)+' Shows: a dose chart';
 const photos=Array.from({length:6},(_,i)=>({id:'img'+i,direction:'inbound',type:'image',media_url:'https://media.test/p'+i+'.jpg',content:'',created_at:'2026-11-05T10:0'+i+':00.000Z'}));
 let read=0;const t=await make({chat:photos,describeImage:async()=>{read++;return long}});
 await t.post(meta('628123','ini maksudnya gimana?'));await t.settle();
 assert.equal(read,5,'five new photos read in one reply, the oldest left');
 const q=t.asked[0][1];assert.ok(q.includes(long.slice(0,1050)),'the whole reading reaches the agent, past the old 400 characters');
 assert.match(q,/Read every word of the customer's new messages/);assert.match(q,/ask them one short question about exactly that instead of guessing/)});

// the person taking over sees the customer's earlier orders (owner, 14 Nov 2026), not only the last question
test('a HANDOFF post carries the customer\'s earlier orders and past-use answers',async()=>{const t=await make({mode:'live',agentSays:'HANDOFF: wants a dose check'});
 await writeFile(path.join(t.DATA,'payments.jsonl'),JSON.stringify({agent:'cove-support',phone:'628123',ok:true,at:'2026-11-02T10:00:00Z',total:750000,products:['Kit A'],context:{past_use:'twice a week'}})+'\n');
 await t.post(meta('628123','dosisnya berapa ya'));await t.settle();
 const post=t.posts.map(x=>String(x[3])).find(x=>/HANDOFF/.test(x));assert.ok(post,'handed off');assert.match(post,/Earlier orders \(1\):\n- 2026-11-02, 750,000, Kit A/)});
