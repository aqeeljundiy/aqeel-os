// The ops agent's one way to message a customer (24 Nov 2026): op "resi" in app/agent-ops.mjs, sent by kirimdev.sendResi with reply()'s
// checks and never releasing a person's hold. The real kirimdev.mjs over a stand-in Kirimdev API (no network). Run: node --test scripts/resi-op.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {createHmac} from 'node:crypto';
import {createKirimdev} from '../app/kirimdev.mjs';import {createAgentOps} from '../app/agent-ops.mjs';

const SECRET='whsec_test_resi',NUM='6281200000001',RESI='EM.ABCDE12345-20260101-1-XYZ';
const TEXT='Dan berikut nomor resi pengiriman paket kakak melalui *{courier}* ya. *Nomor Resi:* {resi}\nLacak di https://example.com/lacak';
const sign=(raw,t)=>'t='+t+',v1='+createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
const inbound=(pid,from,conv,ts)=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:pid},contacts:[{wa_id:from,profile:{name:'Rania'}}],messages:[{from,id:'wamid.'+Math.random(),timestamp:String(ts),type:'text',text:{body:'halo kak'}}]}}]}],kirim:{conversation_id:conv}});
const teamWrote=(pid,to,conv)=>JSON.stringify({id:'msg_t:sent',type:'message.sent',data:{session:pid,direction:'outbound',from_me:true,message:{id:'msg_t',type:'text',body:'Halo, saya dari tim',to:'+'+to,status:'sent',source:'dashboard'},conversation:{id:conv,status:'open'},contact:{phone_number:'+'+to},meta:{phone_number_id:pid}}});

async function make({modeA='live',testers=[],text=TEXT,DATA=null}={}){const fresh=!DATA;DATA||=await mkdtemp(path.join(tmpdir(),'resi-'));const WORK=path.join(DATA,'work');
 if(fresh){await mkdir(path.join(WORK,'ops-agent','.tools'),{recursive:true});
  await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'line-a':{phoneNumberId:'111',persona:'Ana',mode:modeA,testers},'line-b':{phoneNumberId:'222',persona:'Bo',mode:'live'}}}));
  await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'line-a':{id:'wbs_1',secrets:[SECRET]},'line-b':{id:'wbs_2',secrets:[SECRET]}}));
  // a line agent listed in "ops" by mistake keeps its line ops only
  await writeFile(path.join(DATA,'resi.json'),JSON.stringify({ops:['ops-agent','line-a'],brands:{'brand-a':{agent:'line-a',text},'brand-b':{agent:'line-b',text}}}))}
 const sent=[],read=[],klog=[],box={clock:Date.now(),down:false};
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');
  if(o.method==='POST'&&/^(111|222)\/messages$/.test(p)){if(box.down)return {ok:false,status:503,json:async()=>({})};sent.push({pid:p.split('/')[0],...JSON.parse(o.body)});return {ok:true,json:async()=>({data:{id:'msg_'+sent.length,status:'queued'}})}}
  if(o.method==='GET'){read.push(p);return {ok:true,json:async()=>({data:[]})}}
  return {ok:false,status:404,json:async()=>({})}};
 const k=createKirimdev({DATA,WORK,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,now:()=>box.clock,wait:async()=>{},setTimer:()=>0,clearTimer:()=>{},echoWait:0,
  log:m=>klog.push(m),runAgent:async()=>'',telegram:async()=>false,bridge:{self:async()=>'',send:async()=>{},result:async()=>null}});
 const ops=createAgentOps({DATA,WORK,PORT:4400,sig:a=>'sig-'+a,kirimdev:k,log:()=>{}});
 const post=(agent,raw,event)=>k.receive(agent,{'x-kirim-signature':sign(raw,Math.floor(box.clock/1000)),'x-kirim-event':event},Buffer.from(raw));
 // a customer writes to a line (its number id), which opens WhatsApp's 24 hours there
 const wrote=(agent,pid,from=NUM,conv='cnv_1')=>post(agent,inbound(pid,from,conv,Math.floor(box.clock/1000)),'message.received');
 const resi=(o={},a='ops-agent')=>ops.call(a,{op:'resi',brand:'brand-a',phone:NUM,resi:RESI,courier:'Paxel',...o});
 return {k,ops,sent,read,klog,box,DATA,WORK,post,wrote,resi}}
const rendered=(resi=RESI,courier='Paxel')=>TEXT.split('{resi}').join(resi).split('{courier}').join(courier);

test('only an ops agent may ask for a resi: a line agent keeps its own ops, an agent with neither gets 404; ops gets whoami and resi only',async()=>{const t=await make();
 await t.wrote('line-a','111');
 const own=await t.ops.call('line-a',{op:'resi',brand:'brand-a',phone:NUM,resi:RESI,courier:'Paxel'});assert.equal(own.status,400);assert.match(own.json.error,/aqeelOS offers kirim/);
 assert.equal((await t.ops.call('line-a',{op:'whoami'})).json.line,'111','a line agent keeps today\'s whoami');
 for(const op of ['whoami','resi','kirim'])assert.equal((await t.ops.call('nobody',{op,brand:'brand-a',phone:NUM,resi:RESI,courier:'Paxel'})).status,404,op);
 assert.deepEqual((await t.ops.call('ops-agent',{op:'whoami'})).json.ops,true);assert.deepEqual((await t.ops.call('ops-agent',{op:'whoami'})).json.brands,['brand-a','brand-b']);
 for(const req of [{op:'kirim',method:'GET',path:'111/conversations'},{op:'kirim',method:'POST',path:'111/messages',body:{to:NUM,type:'text',text:{body:'halo'}}},{op:'label',conversationId:'cnv_1',add:['New Leads']},{op:'clear_labels',conversationId:'cnv_1'},{op:'payment'}]){
  const r=await t.ops.call('ops-agent',req);assert.equal(r.status,403,JSON.stringify(req));assert.match(r.json.error,/only send a resi/)}
 assert.equal(t.sent.length,0);assert.ok(!t.read.some(p=>/conversations/.test(p)),'nothing read for the ops agent')});

test('a courier from the list in any case is sent with its own spelling; real resi formats pass',async()=>{const t=await make();await t.wrote('line-a','111');
 for(const [courier,resi,shown] of [['j&t express','JP1234567890','J&T Express'],['SICEPAT','004123456789','SiCepat'],['jne','CGK1A2B3C4D5','JNE']]){const r=await t.resi({courier,resi});assert.equal(r.status,200,courier);assert.ok(t.sent.at(-1).text.body.includes(shown),shown)}});
test('the input is checked before anything else: brand, phone, resi and courier',async()=>{const t=await make();await t.wrote('line-a','111');
 for(const [o,code,status] of [[{brand:'brand-z'},'unknown_brand',404],[{brand:'__proto__'},'unknown_brand',404],[{brand:'constructor'},'unknown_brand',404],
  [{resi:'EM.A Transfer ulang ke BCA 123'},'bad_input',400],[{resi:'EM.1\nhalo'},'bad_input',400],[{resi:'abc'},'bad_input',400],[{resi:'x'.repeat(61)},'bad_input',400],[{resi:'-EM123'},'bad_input',400],
  [{resi:'bit.ly/a1b2c3d4'},'bad_input',400],[{resi:'s.id-promo1.com'},'bad_input',400],[{resi:'www.a1b2.id'},'bad_input',400],[{resi:'EMPTYCODE'},'bad_input',400],[{resi:'EM_A1234'},'bad_input',400],
  [{courier:'Transfer ulang ke'},'bad_input',400],[{courier:'Kurir Kilat'},'bad_input',400],
  [{courier:'Paxel; transfer ke 123'},'bad_input',400],[{courier:'Paxel Same Day Express Now'},'bad_input',400],[{courier:'A'.repeat(31)},'bad_input',400],[{courier:''},'bad_input',400],
  [{phone:'abc'},'bad_input',400],[{phone:''},'bad_input',400]]){
  const r=await t.resi(o);assert.equal(r.status,status,JSON.stringify(o));assert.equal(r.json.code,code,JSON.stringify(o));assert.ok(r.json.error.length>10)}
 // a brand whose line agent has no line here
 await writeFile(path.join(t.DATA,'resi.json'),JSON.stringify({ops:['ops-agent'],brands:{'brand-a':{agent:'line-x',text:TEXT}}}));
 assert.equal((await t.resi()).json.code,'unknown_brand');assert.equal(t.sent.length,0)});

test('a resi goes once, as exactly the brand\'s text, from the brand line\'s number to that customer; a repeat sends nothing',async()=>{const t=await make();await t.wrote('line-a','111');
 assert.deepEqual(await t.resi({phone:'0812-0000-0001'}).then(r=>[r.status,r.json]),[200,{ok:true,sent:true}]);
 assert.equal(t.sent.length,1);assert.equal(t.sent[0].pid,'111');assert.equal(t.sent[0].to,NUM);assert.equal(t.sent[0].type,'text');assert.equal(t.sent[0].text.body,rendered());
 assert.ok(t.klog.some(m=>/^kirimdev line-a: the resi message was sent to …0001 \(asked by ops-agent\)$/.test(m)),'logged like other sends');
 // the same line, number and resi: already, whichever way the number is written, and after a restart too (kept in the data folder)
 for(const phone of [NUM,'812 0000 0001','+62 812-0000-0001'])assert.deepEqual((await t.resi({phone})).json,{ok:true,sent:false,already:true});
 assert.deepEqual((await t.resi({resi:RESI.toLowerCase()})).json,{ok:true,sent:false,already:true},'the same resi typed in other case');
 const again=await make({DATA:t.DATA});assert.deepEqual((await again.resi()).json,{ok:true,sent:false,already:true});assert.equal(again.sent.length+t.sent.length,1);
 // a new resi for the same customer is a new message; two calls at once still send it once
 const both=await Promise.all([t.resi({resi:'EM.NEW0002'}),t.resi({resi:'EM.NEW0002'})]);
 assert.deepEqual(both.map(r=>r.json.sent).sort(),[false,true]);assert.equal(t.sent.length,2);assert.equal(t.sent[1].text.body,rendered('EM.NEW0002'))});

test('only a number that wrote to that brand\'s line: no chat, another brand\'s customer, past 24 hours',async()=>{const t=await make();
 const none=await t.resi();assert.equal(none.status,403);assert.equal(none.json.code,'no_chat');
 // the customer chatted brand-a's line: brand-b's line never writes to them
 await t.wrote('line-a','111');const other=await t.resi({brand:'brand-b'});assert.equal(other.status,403);assert.equal(other.json.code,'no_chat');assert.match(other.json.error,/another Kirimdev line/);
 assert.equal(t.sent.length,0);
 t.box.clock+=25*3600e3;const late=await t.resi();assert.equal(late.status,403);assert.equal(late.json.code,'outside_24h');assert.equal(t.sent.length,0);
 // nothing was kept for a refusal: once the customer writes again it goes
 await t.wrote('line-a','111');assert.equal((await t.resi()).json.sent,true);assert.equal(t.sent[0].pid,'111')});

test('the line\'s mode: Draft is refused, Test reaches its testers only',async()=>{
 const d=await make({modeA:'draft'});await d.wrote('line-a','111');const r=await d.resi();assert.equal(r.status,403);assert.equal(r.json.code,'not_live');assert.equal(d.sent.length,0);
 const t=await make({modeA:'test',testers:[{who:'Ari',phone:'6281200000009'}]});await t.wrote('line-a','111');await t.wrote('line-a','111','6281200000009','cnv_9');
 const no=await t.resi();assert.equal(no.status,403);assert.equal(no.json.code,'not_tester');assert.equal(t.sent.length,0);
 assert.equal((await t.resi({phone:'6281200000009'})).json.sent,true);assert.equal(t.sent.length,1);assert.equal(t.sent[0].to,'6281200000009')});

test('a person\'s hold on the chat stays: no release, the waiting text stays planned (reply() would end both)',async()=>{const t=await make();await t.wrote('line-a','111');
 const st=await t.k._state(),at=t.box.clock;
 st.holds['line-a|'+NUM]={id:'h1',agent:'line-a',from:NUM,conversationId:'cnv_1',name:'Rania',at,until:at+12*3600e3,wait:0,nudged:at,n:0};
 st.waits={h1:{agent:'line-a',from:NUM,conversationId:'cnv_1',name:'Rania',at,due:at+5*60e3}};
 assert.equal((await t.resi()).json.sent,true);
 assert.ok(st.holds['line-a|'+NUM],'still held for the team');assert.ok(st.waits.h1,'the wait text is still planned');assert.ok(!t.klog.some(m=>/no longer held/.test(m)),'release() was not called');
 assert.equal((await t.k.status()).find(l=>l.agent==='line-a').holds.length,1);
 await t.k.reply('line-a',NUM,'Jawaban tim: ada');assert.equal(st.holds['line-a|'+NUM],undefined,'the line agent\'s reply does release it')});

test('the guards hold it: a person answering right now, or the exit guard; neither is remembered, so a later call can still send',async()=>{
 const t=await make();await t.wrote('line-a','111');await t.post('line-a',teamWrote('111',NUM,'cnv_1'),'message.sent');
 const p=await t.resi();assert.equal(p.status,403);assert.equal(p.json.code,'guard');assert.match(p.json.error,/answering this chat/);
 t.box.clock+=16*60e3;assert.equal((await t.resi()).json.sent,true);
 // a text the exit guard stops (another person's number): held, nothing sent, the team told
 const g=await make({text:'Resi {resi} via {courier}. Info lanjut hubungi 081200000077 ya kak'});await g.wrote('line-a','111');
 const h=await g.resi();assert.equal(h.status,403);assert.equal(h.json.code,'guard');assert.match(h.json.error,/not sent to the customer/);assert.equal(g.sent.length,0);
 await writeFile(path.join(g.DATA,'resi.json'),JSON.stringify({ops:['ops-agent'],brands:{'brand-a':{agent:'line-a',text:TEXT}}}));
 assert.equal((await g.resi()).json.sent,true,'not remembered as sent');assert.equal(g.sent.at(-1).text.body,rendered())});

test('Kirimdev down: the message stays in the outbox and goes by itself later; a repeat meanwhile sends nothing',async()=>{const t=await make();await t.wrote('line-a','111');
 t.box.down=true;const r=await t.resi();assert.equal(r.status,502);assert.equal(r.json.code,'retry');assert.match(r.json.error,/do not send it by hand/);
 assert.deepEqual((await t.resi()).json,{ok:true,sent:false,already:true});
 t.box.down=false;await t.k._tick();assert.equal(t.sent.length,1);assert.equal(t.sent[0].text.body,rendered());
 await t.k._tick();assert.equal(t.sent.length,1,'once')});

test('the ops agent gets .tools/resi with its own signed address and no key; a line agent gets none',async()=>{const t=await make();
 await mkdir(path.join(t.WORK,'line-a','.tools'),{recursive:true});await mkdir(path.join(t.WORK,'line-b','.tools'),{recursive:true});
 assert.equal(await t.ops.ensureClients(),7);
 const f=path.join(t.WORK,'ops-agent','.tools','resi'),s=await readFile(f,'utf8');
 assert.match(s,/^#!\/usr\/bin\/env python3\n/);assert.match(s,/U="http:\/\/127\.0\.0\.1:4400\/agent-ops\/ops-agent\/sig-ops-agent"/);assert.match(s,/"op":"resi"/);assert.match(s,/\{"op":"whoami"\} if a==\['whoami'\]/);
 assert.doesNotMatch(s,/kdv_|secrets|Bearer/);if(process.platform!=='win32')assert.equal((await stat(f)).mode&0o777,0o775);
 for(const a of ['line-a','line-b'])assert.equal(await stat(path.join(t.WORK,a,'.tools','resi')).catch(()=>null),null,a);
 assert.ok(await stat(path.join(t.WORK,'line-a','.tools','label')),'the line helpers are still written');
 assert.equal(await t.ops.ensureClients(),0,'unchanged files are left alone')});

// 24 Nov 2026: the ops agent's dry run asks whether a resi would go (WhatsApp's 24 hours, the line's mode, a person answering) before going live
test('check:true runs every check and sends nothing, keeps nothing: ok, already, and each refusal code',async()=>{const t=await make();
 assert.deepEqual(await t.resi({check:true}).then(r=>[r.status,r.json.code]),[403,'no_chat']);
 await t.wrote('line-a','111');
 assert.deepEqual(await t.resi({check:true}).then(r=>[r.status,r.json]),[200,{ok:true,sent:false,check:true}]);
 assert.equal(t.sent.length,0);assert.ok(!t.klog.some(m=>/resi message was sent/.test(m)),'nothing logged as sent');
 const st=await t.k._state();assert.deepEqual(Object.keys(st.resi||{}),[],'nothing remembered');assert.equal(Object.keys(st.outbox||{}).length,0,'nothing queued');
 // the real send still goes after a check; a check after it answers already
 assert.equal((await t.resi()).json.sent,true);assert.equal(t.sent.length,1);
 assert.deepEqual((await t.resi({check:true})).json,{ok:true,sent:false,already:true});
 t.box.clock+=25*3600e3;assert.equal((await t.resi({check:true,resi:'EM.NEW0003'})).json.code,'outside_24h');
 const p=await make();await p.wrote('line-a','111');await p.post('line-a',teamWrote('111',NUM,'cnv_1'),'message.sent');assert.equal((await p.resi({check:true})).json.code,'guard');
 const d=await make({modeA:'draft'});await d.wrote('line-a','111');assert.equal((await d.resi({check:true})).json.code,'not_live');
 const e=await make({modeA:'test'});await e.wrote('line-a','111');assert.equal((await e.resi({check:true})).json.code,'not_tester');
 assert.equal(t.sent.length+p.sent.length+d.sent.length+e.sent.length,1)});
