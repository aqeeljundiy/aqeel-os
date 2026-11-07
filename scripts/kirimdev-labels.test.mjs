// Tests for Kirimdev contact labels (8 Nov 2026): kirimdev.mjs labelContact, the label_contact customer tool and
// create_payment's products (customer-tools.mjs), and the paid check (paid-labels.mjs). Run: node --test scripts/kirimdev-labels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createKirimdev} from '../app/kirimdev.mjs';
import {createCustomerTools} from '../app/customer-tools.mjs';
import {createPaidLabels} from '../app/paid-labels.mjs';

const SECRET='whsec_test_123';
const LABELS=['New Leads','Consult','Checkout','Customer','Repeat Customer','I-Reta','I-NAD','S-Reta','S-Pen','Internal','Boss'];
const lid=n=>'lbl_'+n.replace(/\W/g,'').toUpperCase().padEnd(26,'0').slice(0,26);
const sign=(raw,t=Math.floor(Date.now()/1000))=>'t='+t+',v1='+createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
const meta=(from,text,conv='cnv_A')=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'111111'},contacts:[{wa_id:from,profile:{name:'Rania'}}],messages:[{from,id:'wamid.'+Math.random(),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}],kirim:{conversation_id:conv}});

async function make({mode='test',allowed=['New Leads','Consult','Checkout','I-Reta','I-NAD'],agentSays='Halo kak'}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kdl-'));
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'continue-support':{phoneNumberId:'111111',persona:'Randy',business:'Continue',mode,debounceSec:0,testers:[{who:'Team',phone:'628123'}],labels:{allowed}}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'continue-support':{id:'wbs_1',secrets:[SECRET]}}));
 const has={ctc_A:new Set(),ctc_B:new Set()},calls=[],posts=[],acts=[];
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/',''),m=o.method||'GET';calls.push(m+' '+p);const ok=d=>({ok:true,status:200,json:async()=>d});
  if(p==='accounts')return ok({data:[{phone_number_id:'111111',phone_number:'+62877',name:'Continue',status:'connected'}]});
  if(p.startsWith('labels?'))return ok({data:LABELS.map(n=>({id:lid(n),name:n})),has_more:false});
  let x=/^111111\/conversations\/(cnv_\w+)$/.exec(p);if(x)return ok({data:{id:x[1],contact:{id:x[1]==='cnv_A'?'ctc_A':'ctc_B'}}});
  x=/^111111\/contacts\/(ctc_\w+)$/.exec(p);if(x)return ok({data:{id:x[1],labels:[...has[x[1]]].map(id=>({id,name:LABELS.find(n=>lid(n)===id)}))}});
  x=/^111111\/contacts\/(ctc_\w+)\/labels$/.exec(p);if(x&&m==='POST'){has[x[1]].add(JSON.parse(o.body).label_id);return ok({data:{}})}
  x=/^111111\/contacts\/(ctc_\w+)\/labels\/(lbl_\w+)$/.exec(p);if(x&&m==='DELETE'){has[x[1]].delete(x[2]);return ok({data:{}})}
  if(/^111111\/messages$/.test(p)&&m==='POST')return ok({data:{id:'msg_'+calls.length,status:'queued'}});
  if(/^111111\/messages\?/.test(p))return ok({data:[]});
  return {ok:false,status:404,json:async()=>({})}};
 const due=new Map();let tid=0;
 const k=createKirimdev({DATA,WORK:DATA,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:()=>{},echoWait:0,
  setTimer:fn=>{const i=++tid;due.set(i,fn);return i},clearTimer:i=>due.delete(i),activity:async(a,title,text)=>{acts.push([a,title,text])},
  teamGroup:async()=>({chatId:-100,topics:{questions:3}}),telegram:async(...x)=>{posts.push(x);return 42},
  runAgent:async(a,q,ctx)=>typeof agentSays==='function'?agentSays(ctx):agentSays});
 const settle=async()=>{for(let n=0;n<20&&due.size;n++){const f=[...due.values()];due.clear();await Promise.all(f.map(x=>x()))}};
 const post=raw=>k.receive('continue-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));
 const names=c=>[...has[c]].map(id=>LABELS.find(n=>lid(n)===id)).sort();
 return {k,DATA,has,calls,posts,acts,settle,post,names}}
const L=(k,o)=>k.labelContact('continue-support',{conversationId:'cnv_A',phone:'628123',run:'r1',...o});

test('the agent sets only its allowed labels on the chat\'s own contact; repeating it changes nothing',async()=>{const t=await make();
 const r=await L(t.k,{add:['New Leads','I-Reta']});assert.equal(r.set,true);assert.deepEqual(r.changed,['+New Leads','+I-Reta']);assert.deepEqual(t.names('ctc_A'),['I-Reta','New Leads']);
 const n=t.calls.filter(c=>/^(POST|DELETE) 111111\/contacts/.test(c)).length;
 assert.deepEqual((await L(t.k,{add:['New Leads']})).changed,[],'already there: no call');
 assert.equal(t.calls.filter(c=>/^(POST|DELETE) 111111\/contacts/.test(c)).length,n);
 assert.deepEqual((await L(t.k,{add:['Consult'],remove:['New Leads']})).changed,['+Consult','−New Leads']);assert.deepEqual(t.names('ctc_A'),['Consult','I-Reta']);
 assert.equal(t.acts.length,2,'each change is in Activity');assert.match(t.acts[0][1],/Randy labelled \+628123: \+New Leads, \+I-Reta/);assert.match(t.acts[0][2],/run r1/)});

test('never Customer, S- labels, Internal, Boss or Influencer; never a label outside the allowlist or one Kirimdev lacks; a few at most',async()=>{const t=await make({allowed:['New Leads','I-Reta']});
 for(const n of ['Customer','S-Reta','Internal','Boss'])await assert.rejects(L(t.k,{add:[n]}),/never yours/,n);
 await assert.rejects(L(t.k,{add:['Consult']}),/not one of the labels you may set: New Leads, I-Reta/);
 await assert.rejects(L(t.k,{add:['VIP']}),/no label called "VIP"/);
 await assert.rejects(L(t.k,{add:['New Leads','I-Reta','a','b','c','d','e']}),/6 label changes at most/);
 assert.deepEqual(t.names('ctc_A'),[],'nothing was set')});

test('Test labels testers only; Live labels anyone; Draft proposes with the draft and sets them when a person sends it',async()=>{
 const t=await make();
 assert.equal((await t.k.labelContact('continue-support',{conversationId:'cnv_B',phone:'629999',add:['New Leads']})).set,false);assert.deepEqual(t.names('ctc_B'),[]);
 const v=await make({mode:'live'});assert.equal((await v.k.labelContact('continue-support',{conversationId:'cnv_B',phone:'629999',add:['New Leads']})).set,true);
 // Draft: the agent labels inside its run; nothing is set, the draft carries it, sending the draft sets it
 let d;d=await make({mode:'draft',agentSays:async ctx=>{const r=await d.k.labelContact('continue-support',{conversationId:ctx.run.conversation,phone:ctx.run.phone,add:['Consult','I-NAD']});assert.equal(r.proposed,true);return 'Halo kak'}});
 await d.post(meta('628123','mau konsultasi NAD'));await d.settle();
 assert.deepEqual(d.names('ctc_A'),[],'Draft: not set');assert.match(d.posts[0][3],/DRAFT #1[\s\S]*Labels, set when it is sent: \+Consult, \+I-NAD/);
 const r=await d.k.draft('continue-support',1,'send','',  'Aqeel');assert.equal(r.labels.set,true);assert.deepEqual(d.names('ctc_A'),['Consult','I-NAD']);
 assert.match(d.acts[0][2],/A sent draft \(run draft1\)/)});

test('a confirmed payment sets Customer and S- labels and removes Checkout, and nothing else',async()=>{const t=await make();
 await L(t.k,{add:['Checkout']});
 const r=await L(t.k,{add:['Customer','S-Reta','S-Pen'],remove:['Checkout'],source:'payment',run:'pay1'});assert.deepEqual(r.changed,['+Customer','+S-Reta','+S-Pen','−Checkout']);
 assert.deepEqual(t.names('ctc_A'),['Customer','S-Pen','S-Reta']);
 await assert.rejects(L(t.k,{add:['I-Reta'],source:'payment'}),/Customer and S- labels and removes Checkout only/);
 await assert.rejects(L(t.k,{remove:['Customer'],source:'payment'}),/only/)});

test('Line settings: the allowlist is saved and shown; Customer, S-, Internal are refused',async()=>{const t=await make();
 await t.k.saveLine('continue-support',{phoneNumberId:'111111',labels:['New Leads','I-Reta','I-Reta']});
 assert.deepEqual((await t.k.status()).find(l=>l.agent==='continue-support').settings.labels,['New Leads','I-Reta']);
 await assert.rejects(t.k.saveLine('continue-support',{phoneNumberId:'111111',labels:['New Leads','S-Reta','Customer']}),/S-Reta, Customer: only a person or a confirmed payment/);
 await t.k.saveLine('continue-support',{phoneNumberId:'111111',persona:'Randy'});assert.deepEqual((await t.k.status())[0].settings.labels,['New Leads','I-Reta'],'a save without labels keeps them')});

// ---- customer-tools: label_contact and create_payment's products
async function tools(){const W=await mkdtemp(path.join(tmpdir(),'ctl-')),D=path.join(W,'data');await mkdir(path.join(W,'continue-support','.tools'),{recursive:true});await writeFile(path.join(W,'continue-support','.tools','qris'),'x');
 const labelled=[];
 const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({currency:'Rp',min:10000,max:5000000}),labelRules:async()=>({allowed:['New Leads','I-Reta'],sales:['S-Pen','S-Reta']}),
  labelContact:async(a,o)=>{labelled.push([a,o]);return {set:true,changed:o.add.map(x=>'+'+x)}},googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',
  runAsAgent:async()=>({ok:true,out:'[FOTO: qris-BM-1794038325-1.png] | Rp2.660.000 | berlaku sampai 15.00 WIB'}),log:()=>{},random:n=>Buffer.alloc(n,7)});
 return {C,D,labelled}}
test('label_contact: listed with the allowed labels, always this run\'s chat and number, a few per run, no message',async()=>{const {C,labelled}=await tools();
 const list=(await C.mcp('continue-support',undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools,lt=list.find(x=>x.name==='label_contact');
 assert.ok(lt);assert.deepEqual(lt.inputSchema.properties.add.items.enum,['New Leads','I-Reta']);assert.match(lt.description,/Never Customer or S- labels/);
 assert.deepEqual(list.find(x=>x.name==='create_payment').inputSchema.properties.products.items.enum,['S-Pen','S-Reta']);
 const tok=C.begin({agent:'continue-support',line:'111111',conversation:'cnv_A',phone:'628123',mode:'test'});
 const x=await C.call('continue-support',tok,'label_contact',{add:['New Leads'],contact:'ctc_SOMEONE_ELSE',conversationId:'cnv_X'});
 assert.match(x.text,/Done: \+New Leads/);assert.deepEqual(labelled[0][1],{conversationId:'cnv_A',phone:'628123',add:['New Leads'],remove:[],source:'agent',run:labelled[0][1].run});assert.match(labelled[0][1].run,/^r[0-9a-f]{8}$/);
 await C.call('continue-support',tok,'label_contact',{add:['I-Reta','New Leads'],remove:['New Leads']});
 assert.match((await C.call('continue-support',tok,'label_contact',{add:['I-Reta','New Leads'],remove:['New Leads']})).text,/Six label changes per chat run/);assert.equal(labelled.length,2)});
test('create_payment: products are S- labels, logged with the order refs for the paid check',async()=>{const {C,D}=await tools();const tok=C.begin({agent:'continue-support',line:'111111',conversation:'cnv_A',phone:'628123',mode:'test'});
 assert.match((await C.call('continue-support',tok,'create_payment',{amounts:[2660000],order_total:2660000,name:'Ani',products:['I-Reta']})).text,/sales labels \(S-Pen, S-Reta\), not I-Reta/);
 assert.match((await C.call('continue-support',tok,'create_payment',{amounts:[2660000],order_total:2660000,name:'Ani',products:['S-Reta','S-Pen']})).text,/FOTO/);
 const p=JSON.parse((await readFile(path.join(D,'payments.jsonl'),'utf8')).trim());assert.deepEqual(p.products,['S-Reta','S-Pen']);assert.deepEqual(p.orders,['BM-1794038325-1']);assert.equal(p.conversation,'cnv_A');assert.match(p.run,/^r/)});

// ---- paid-labels: code, no AI
async function paid(statuses){const W=await mkdtemp(path.join(tmpdir(),'pl-')),D=path.join(W,'data');await mkdir(D,{recursive:true});
 const A=path.join(W,'continue-support');await mkdir(path.join(A,'.secrets'),{recursive:true});await mkdir(path.join(A,'tmp'),{recursive:true});
 await writeFile(path.join(A,'.secrets','TRIPAY_API_KEY'),'tp_key\n');
 await writeFile(path.join(A,'tmp','last_qris.json'),JSON.stringify({ref:'BM-1794038325-1',reference:'T3135339060014GCTMH',amount:2660000})+'\n'+JSON.stringify({ref:'BM-1794038325-2',reference:'T3135339060015ABCDE',amount:1000000})+'\n');
 let t=Date.parse('2026-11-08T03:00:00Z');const asked=[],labelled=[];let fail=0;
 const add=o=>appendFile(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t).toISOString(),agent:'continue-support',line:'111111',conversation:'cnv_A',phone:'628123',mode:'test',run:'rabc',kind:'qris',total:3660000,ok:true,products:['S-Reta','S-Pen'],refs:[],orders:['BM-1794038325-1','BM-1794038325-2'],...o})+'\n');
 const P=createPaidLabels({DATA:D,WORK:W,now:()=>t,log:()=>{},label:async(a,o)=>{if(fail>0){fail--;throw Error('Kirimdev answered 503')}labelled.push([a,o]);return {set:true,changed:['+Customer']}},
  fetchImpl:async(url,o)=>{const ref=new URL(url).searchParams.get('reference');asked.push([ref,o.headers.authorization]);return {ok:true,json:async()=>({success:true,data:{reference:ref,status:statuses[ref]}})}}});
 return {P,add,asked,labelled,later:ms=>{t+=ms},fail:n=>{fail=n},D}}
test('paid check: nothing while unpaid; once every part is PAID, Customer + S- labels and no Checkout, exactly once',async()=>{const st={T3135339060014GCTMH:'PAID',T3135339060015ABCDE:'UNPAID'};const s=await paid(st);await s.add();
 await s.P.tick();assert.equal(s.labelled.length,0,'one part still unpaid');assert.deepEqual(s.asked.map(x=>x[0]).sort(),['T3135339060014GCTMH','T3135339060015ABCDE']);assert.equal(s.asked[0][1],'Bearer tp_key');
 st.T3135339060015ABCDE='PAID';s.later(60e3);await s.P.tick();
 assert.deepEqual(s.labelled,[['continue-support',{conversationId:'cnv_A',phone:'628123',add:['Customer','S-Reta','S-Pen'],remove:['Checkout'],source:'payment',run:'rabc'}]]);
 s.later(60e3);const n=s.asked.length;await s.P.tick();assert.equal(s.labelled.length,1,'never twice');assert.equal(s.asked.length,n,'a done payment is not asked again');
 const again=createPaidLabels({DATA:s.D,WORK:path.dirname(s.D),label:async()=>{throw Error('must not run')},fetchImpl:async()=>{throw Error('must not ask')},now:()=>Date.parse('2026-11-08T03:03:00Z'),log:()=>{}});
 await again.tick()});
test('paid check: expired is closed without labels; a Kirimdev error is tried again; an old payment is left alone',async()=>{
 const s=await paid({T3135339060014GCTMH:'EXPIRED',T3135339060015ABCDE:'EXPIRED'});await s.add();await s.P.tick();s.later(60e3);await s.P.tick();assert.equal(s.labelled.length,0);assert.equal(s.asked.length,2,'closed after the first look');
 const r=await paid({T3135339060014GCTMH:'PAID',T3135339060015ABCDE:'PAID'});await r.add();r.fail(1);await r.P.tick();assert.equal(r.labelled.length,0);r.later(60e3);await r.P.tick();assert.equal(r.labelled.length,1,'retried');
 const o=await paid({T3135339060014GCTMH:'PAID',T3135339060015ABCDE:'PAID'});await o.add();o.later(4*3600e3);await o.P.tick();assert.equal(o.asked.length,0,'older than 3 hours: not followed')});
