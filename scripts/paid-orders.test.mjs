// Fixer batch, 8 Nov 2026: one stray note no longer holds a reply, a VA can go to its own limit, check_payment answers from the provider,
// a paid order is posted once to the Orders topic, and a customer's photo reaches the run as a description.
// Run: node --test scripts/paid-orders.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCustomerTools,TOOLS,DEFAULT_VA_MAX,vaMaxOf} from '../app/customer-tools.mjs';
import {orderContextOf} from '../app/paid-labels.mjs';
import {createPaidLabels} from '../app/paid-labels.mjs';
import {splitReply,guardReply} from '../app/kirimdev.mjs';
import {cleanImageText,createImageReader} from '../app/kirimdev-agent.mjs';

const A='cove-support',REF='T1000000000001ABCDE',PHONE='628000000001';
const CTX={title:'Buyer details',missing:'not asked',fields:[{key:'past_use',label:'Past use',ask:'What they used before'},{key:'setup',label:'Setup',ask:'How they will use it'}]};
const tripay=state=>async()=>({ok:true,json:async()=>({success:true,data:{status:state.v}})});
async function make({orders={chatId:-100123,threadId:101,persona:'Sam',currency:'Rp',context:CTX},post=null}={}){
 const W=await mkdtemp(path.join(tmpdir(),'po-')),D=path.join(W,'data');await mkdir(path.join(W,A,'.secrets'),{recursive:true});await mkdir(D,{recursive:true});await writeFile(path.join(W,A,'.secrets','TRIPAY_API_KEY'),'k');
 const posts=[],labels=[],alerts=[],state={v:'UNPAID'};let t=Date.parse('2026-11-08T05:00:00Z');
 const P=createPaidLabels({DATA:D,WORK:W,log:()=>{},failed:async(...a)=>{alerts.push(a)},now:()=>t,fetchImpl:tripay(state),orders:async()=>orders,post:post||(async(a,o,text)=>{posts.push([a,o,text]);return 77}),label:async(a,o)=>{labels.push([a,o]);return {set:true,changed:['+Customer']}}});
 const pay=(o={})=>appendFile(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t-60e3).toISOString(),agent:A,line:'1',conversation:'cnv_1',phone:PHONE,mode:'live',run:'r1',kind:'qris',amounts:[1187500],total:1187500,products:['S-MotsC'],refs:[REF],orders:[],name:'Nadia',form:'Nama: Nadia\nProduk: Widget',ok:true,...o})+'\n');
 return {W,D,P,posts,labels,alerts,state,pay,later:ms=>{t+=ms}}}

test('one bracketed note about a photo is dropped and the rest goes out (DRAFT #32)',()=>{
 const g=guardReply(splitReply('Ini paket kit-nya kak.\n[Send kit photo template nt_kit_basic and nt_kit_pen]\n[TEMPLATE: nt_kit_basic]\n[TEMPLATE: nt_kit_pen]'));
 assert.equal(g.hold,null);assert.deepEqual(g.parts,['Ini paket kit-nya kak.','[TEMPLATE: nt_kit_basic]','[TEMPLATE: nt_kit_pen]']);assert.equal(g.dropped.length,1)});
test('a reply of only notes is still shown to a person, and team notes in a sentence still hold it',()=>{
 const g=guardReply(['[Kirim foto kit]']);assert.ok(g.hold);assert.equal(g.removed.length,1);assert.deepEqual(g.parts,['[Kirim foto kit]']);
 assert.ok(guardReply(['Halo kak.\nCatatan untuk tim: cek stok']).hold)});

const FORM='Nama: Nadia Putri\nAlamat: Jl. Melati No. 5, Jakarta Selatan\nNo HP: 0812xxxx\nProduk: Widget 10 x1\nTotal: Rp5.700.000';
test('a VA has its own limit, above the QRIS limit',async()=>{
 assert.equal(vaMaxOf({max:5000000}),DEFAULT_VA_MAX);assert.equal(vaMaxOf({vaMax:7000000,max:5000000}),7000000);
 const t=TOOLS('pay',{min:10000,max:5000000},{},false).find(x=>x.name==='create_payment');assert.equal(t.inputSchema.properties.amounts.items.maximum,DEFAULT_VA_MAX);
 const W=await mkdtemp(path.join(tmpdir(),'va-')),D=path.join(W,'d');await mkdir(path.join(W,A,'.tools'),{recursive:true});await writeFile(path.join(W,A,'.tools','pay'),'x');const ran=[];
 const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({min:10000,max:5000000}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async(a,tool,argv)=>{ran.push(argv);return {ok:true,out:'sent'}}});
 const tok=C.begin({agent:A,line:'1',conversation:'cnv_1',phone:PHONE,mode:'test'});
 assert.equal((await C.call(A,tok,'create_payment',{kind:'va',bank:'BRI',amounts:[5700000],name:'N',order_total:5700000,order_form:FORM})).text,'sent');
 assert.ok((await C.call(A,tok,'create_payment',{kind:'qris',amounts:[5700000],name:'N',order_total:5700000,order_form:FORM})).isError);
 assert.ok((await C.call(A,tok,'create_payment',{kind:'va',bank:'BRI',amounts:[10000001],name:'N',order_total:10000001,order_form:FORM})).isError);
 assert.equal(ran.length,1);assert.match(await readFile(path.join(D,'payments.jsonl'),'utf8'),/"form":"Nama: Nadia Putri/)});

test('check_payment answers for this customer only, from the provider',async()=>{const s=await make();await s.pay();await s.pay({phone:'628111111111',total:999});
 assert.deepEqual((await s.P.statusFor(A,PHONE)).map(x=>[x.total,x.status]),[[1187500,'UNPAID']]);s.state.v='PAID';
 assert.equal((await s.P.statusFor(A,PHONE))[0].status,'PAID');assert.deepEqual(await s.P.statusFor(A,'620000000'),[]);
 const C=createCustomerTools({WORK:s.W,DATA:s.D,payments:s.P,googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async()=>({})});const tok=C.begin({agent:A,line:'1',conversation:'cnv_1',phone:PHONE,mode:'live'});
 assert.match((await C.call(A,tok,'check_payment',{})).text,/1,187,500: PAID/);for(let i=0;i<4;i++)await C.call(A,tok,'check_payment',{});assert.ok((await C.call(A,tok,'check_payment',{})).isError)});

test('payment checks never reuse an earlier conversation, reset or confirmed order (ie33cf6cd)',async()=>{
 const s=await make();s.state.v='PAID';await s.pay({line:'1'});
 const scope={line:'1',conversation:'cnv_1',since:'2026-11-08T04:00:00Z',run:'new-run'};
 assert.deepEqual(await s.P.statusFor(A,PHONE,{...scope,conversation:'other'}),[]);
 assert.deepEqual(await s.P.statusFor(A,PHONE,{...scope,since:'2026-11-08T05:00:00Z'}),[]);
 assert.equal((await s.P.statusFor(A,PHONE,scope))[0].status,'PAID');
 assert.deepEqual(await s.P.statusFor(A,PHONE,{...scope,run:'next-order'}),[]);
 assert.equal((await s.P.statusFor(A,PHONE,scope))[0].status,'PAID','same run can retry');
 await s.pay({line:'1',at:'2026-11-08T05:00:00Z',refs:[]});
 assert.equal((await s.P.statusFor(A,PHONE,{...scope,run:'next-order'}))[0].status,'UNKNOWN','never fall back to old PAID');
 const C=createCustomerTools({WORK:s.W,DATA:s.D,payments:s.P,log:()=>{}});
 const token=C.begin({agent:A,line:'1',conversation:'cnv_1',phone:PHONE,since:'2026-11-08T05:01:00Z'});
 const reply=await C.call(A,token,'check_payment');
 assert.match(reply.text,/No payment made for this order yet/);
 assert.doesNotMatch(reply.text,/: PAID/);
});

test('a paid order is posted once with its form, nothing before it is paid',async()=>{const s=await make();await s.pay();
 await s.P.tick();assert.equal(s.posts.length,0);s.state.v='PAID';await s.P.tick();await s.P.tick();
 assert.equal(s.posts.length,1);assert.deepEqual(s.posts[0][1].threadId,101);assert.match(s.posts[0][2],/PAID ORDER \(Sam, Nadia, \+628000000001\)/);assert.match(s.posts[0][2],/Produk: Widget/);assert.equal(s.labels.length,1);
 assert.equal((await s.P.postOrder(A,PHONE,'again')).already,true);assert.equal(s.posts.length,1)});
test('a failed post is tried again without labelling twice; a line with no Orders topic posts nothing',async()=>{let fail=2,sent=0;const s=await make({post:async()=>{if(fail-->0)return false;sent++;return 5}});await s.pay();s.state.v='PAID';
 await s.P.tick();await s.P.tick();assert.equal(sent,0);await s.P.tick();await s.P.tick();assert.equal(sent,1);assert.equal(s.labels.length,1);
 const n=await make({orders:null});await n.pay();n.state.v='PAID';await n.P.tick();assert.equal(n.posts.length,0);assert.equal(n.labels.length,1);assert.match((await n.P.postOrder(A,PHONE,'x')).why,/No Orders topic/)});
test('payments labelled before this are not posted by themselves, and post_order needs a paid payment',async()=>{const s=await make();await s.pay();s.state.v='PAID';
 const at=JSON.parse((await readFile(path.join(s.D,'payments.jsonl'),'utf8')).trim()).at;await writeFile(path.join(s.D,'paid-labels.json'),JSON.stringify({done:{[A+'|'+at+'|1187500']:{state:'labelled',at:Date.now()}}}));
 await s.P.tick();assert.equal(s.posts.length,0);assert.equal((await s.P.postOrder(A,PHONE,'Nama: Nadia')).posted,true);assert.match(s.posts[0][2],/Nama: Nadia/);
 s.state.v='UNPAID';const u=await make();await u.pay();assert.match((await u.P.postOrder(A,PHONE,'x')).why,/PAID yet/)});

test('a photo is read with the customer tool set and no run key, and the session line is not kept',async()=>{let seen;const r=createImageReader({home:'/h',live:true,execute:(bin,args,opt,cb)=>{seen={args,env:opt.env};cb(null,'A BCA transfer receipt for Rp1.187.500.\n\nsession_id: local-abc\n')}});
 assert.equal(await r(A,'/d/x.jpeg'),'A BCA transfer receipt for Rp1.187.500.');assert.deepEqual(seen.args.slice(0,9),['-p',A,'chat','-Q','--source','tool','-t','aqeelos-customer','--image']);assert.equal(seen.env,undefined);assert.equal(cleanImageText('session_id: x'),'')});

test('buyer context: auto-post carries past_use and setup from the payment, or not asked with an alert',async()=>{const s=await make();await s.pay({past_use:'Widget once a day',setup:'Kit: ready made'});s.state.v='PAID';await s.P.tick();
 assert.match(s.posts[0][2],/Buyer details\*\n- Past use: Widget once a day\n- Setup: Kit: ready made/);assert.equal(s.alerts.length,0);
 const u=await make();await u.pay();u.state.v='PAID';await u.P.tick();assert.match(u.posts[0][2],/Past use: not asked\n- Setup: not asked/);assert.equal(u.alerts.length,1);assert.equal(u.alerts[0][0],A)});
test('post_order requires past_use and setup and posts them',async()=>{const s=await make();await s.pay();s.state.v='PAID';
 const at=JSON.parse((await readFile(path.join(s.D,'payments.jsonl'),'utf8')).trim()).at;await writeFile(path.join(s.D,'paid-labels.json'),JSON.stringify({done:{[A+'|'+at+'|1187500']:{state:'labelled',at:Date.now()}}}));
 const C=createCustomerTools({WORK:s.W,DATA:s.D,payments:s.P,payRules:async()=>({orderContext:CTX}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async()=>({})});const tok=C.begin({agent:A,line:'1',conversation:'cnv_1',phone:PHONE,mode:'live'});
 assert.ok((await C.call(A,tok,'post_order',{order_form:'Nama: Nadia',past_use:'Never'})).isError);assert.equal(s.posts.length,0);
 assert.equal((await C.call(A,tok,'post_order',{order_form:'Nama: Nadia',past_use:'Never',setup:'Kit: assisted'})).text,'Posted to the Orders topic.');
 assert.match(s.posts[0][2],/Past use: Never\n- Setup: Kit: assisted/);
 const po=TOOLS('pay',{min:1,max:9,orderContext:CTX},{},false,true);assert.deepEqual(po.find(x=>x.name==='post_order').inputSchema.required,['order_form','past_use','setup'])});
test('a line with no order details asks for none and posts no details block',async()=>{assert.deepEqual(TOOLS('pay',{min:1,max:9},{},false,true).find(x=>x.name==='post_order').inputSchema.required,['order_form']);
 const s=await make({orders:{chatId:-100123,threadId:101,persona:'Sam',currency:'Rp'}});await s.pay();s.state.v='PAID';await s.P.tick();assert.doesNotMatch(s.posts[0][2],/Buyer details/);assert.equal(s.alerts.length,0)});
test('a reserved or malformed key is not an order detail',()=>{assert.deepEqual(orderContextOf({orderContext:{fields:[{key:'amounts',label:'x'},{key:'Bad Key',label:'y'},{key:'ok',label:'z'}]}}).fields.map(f=>f.key),['ok'])});

test('check_payment marks a tester\'s test-amount QRIS as standing for the full order (i9530ba20)',async()=>{const s=await make();await s.pay({total:10000,amounts:[10000],testAmount:true,orderTotal:955000});s.state.v='PAID';
 const st=await s.P.statusFor(A,PHONE);assert.deepEqual(st.map(x=>[x.total,x.status,x.testAmount,x.orderTotal]),[[10000,'PAID',true,955000]]);
 const C=createCustomerTools({WORK:s.W,DATA:s.D,payments:s.P,googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async()=>({})});const tok=C.begin({agent:A,line:'1',conversation:'cnv_1',phone:PHONE,mode:'test',tester:true});
 const x=(await C.call(A,tok,'check_payment',{})).text;assert.match(x,/10,000: PAID \(TEST payment/);assert.match(x,/955,000/);assert.match(x,/send your payment-confirmed message right away/)});
