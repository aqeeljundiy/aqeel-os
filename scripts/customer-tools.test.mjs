// Tests for the customer-run sandbox (app/customer-tools.mjs). Run: node --test scripts/customer-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCustomerTools as _createCustomerTools,readable} from '../app/customer-tools.mjs';
// The amount charged is the total line of the confirmed order form (audit 12 Nov 2026, C2). These tests are about limits, repeats and
// logging on a line without a price list ("prices: form"), so the harness writes the form's total line from the test's order_total.
const createCustomerTools=o=>{const C=_createCustomerTools({...o,payRules:async a=>({prices:'form',...(o.payRules?await o.payRules(a):{})})}),call=C.call;
 C.call=(a,t,n,args)=>call(a,t,n,n==='create_payment'&&args?.order_form&&args.order_total!=null&&!/^total/im.test(args.order_form)?{...args,order_form:args.order_form+'\nTotal Pembayaran: Rp'+args.order_total}:args);return C};


test('a customer run reads rules and templates only, never keys, tools or hidden files',()=>{
 for(const ok of ['DECISIONS.md','BRIEFING.md','templates/ORDER_FORM.md','sop/refunds.md','media/staff/urls.txt'])assert.equal(readable(ok),true,ok);
 for(const no of ['.secrets/XENDIT_SECRET_KEY','.tools/qris','../bay-sales/BRIEFING.md','/etc/passwd','templates/../.secrets/X','BRIEFING.md.bak-1106','DECISIONS.md.bak-2026-11-06','tmp/last_qris.json','.env','secrets.md','test_chat_watchdog.py','templates/.hidden.md'])assert.equal(readable(no),false,no)});

async function make(kind='qris'){const W=await mkdtemp(path.join(tmpdir(),'ct-')),D=path.join(W,'data');await mkdir(path.join(W,'cove-support','.tools'),{recursive:true});await mkdir(path.join(W,'cove-support','templates'),{recursive:true});
 await writeFile(path.join(W,'cove-support','.tools',kind),'x');await writeFile(path.join(W,'cove-support','templates','ORDER_FORM.md'),'Nama:');await writeFile(path.join(W,'cove-support','BRIEFING.md'),'brief');
 await mkdir(path.join(W,'cove-support','.secrets'),{recursive:true});await writeFile(path.join(W,'cove-support','.secrets','XENDIT_SECRET_KEY'),'xnd');
 const ran=[],google=[];let t=1e12;
 const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({currency:'Rp',min:10000,max:5000000}),googleCall:async(a,req)=>{google.push(req);return {status:200,json:{values:[['a']]}}},chatFind:async()=>({text:'old chat'}),history:async r=>'chat '+r.conversation,
  runAsAgent:async(a,tool,argv)=>{ran.push([a,tool,argv]);return {ok:true,out:'[FOTO: qris-1.png] | Rp2.660.000'}},log:()=>{},now:()=>t});
 return {C,W,D,ran,google,tick:ms=>{t+=ms}}}

test('the tools are listed on any connection (the gateway serves customer runs), each needs the run key, which ends with the run',async()=>{const {C}=await make();
 const tools=async a=>(await C.mcp(a,undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools;
 const t=await tools('cove-support');assert.deepEqual(t.map(x=>x.name),['read_sheet','read_file','list_files','conversation','past_chats','create_payment','check_payment']);
 for(const x of t){assert.equal(x.inputSchema.required[0],'run',x.name);assert.equal(x.inputSchema.properties.run.type,'string')}
 const callOf=async(a,args,hdr)=>(await C.mcp(a,hdr,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'list_files',arguments:args}})).body.result;
 assert.equal((await callOf('cove-support',{})).isError,true,'no key: refused');
 assert.equal((await callOf('cove-support',{run:'made-up'})).isError,true,'a wrong key: refused');
 const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'test'});
 assert.equal((await callOf('cove-support',{run:tok})).content[0].text,'BRIEFING.md\ntemplates/ORDER_FORM.md','the key in the call works');
 assert.equal((await callOf('cove-support',{},tok)).content[0].text,'BRIEFING.md\ntemplates/ORDER_FORM.md','the old header still works');
 assert.equal((await callOf('bay-sales',{run:tok})).isError,true,'another agent\'s key: refused');
 C.end(tok);assert.equal((await callOf('cove-support',{run:tok})).isError,true,'ended run: refused')});

test('reading: sheets read-only through aqeelOS, files from the rule list, this chat only',async()=>{const {C,google}=await make();const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_1',phone:'628123'});
 assert.equal((await C.call('cove-support',tok,'read_sheet',{method:'spreadsheets.values.update',params:{}})).isError,true);
 assert.match((await C.call('cove-support',tok,'read_sheet',{method:'spreadsheets.values.get',params:{spreadsheetId:'s',range:'Rules!A:Z'}})).text,/values/);assert.equal(google[0].method,'spreadsheets.values.get');
 assert.equal((await C.call('cove-support',tok,'list_files',{})).text,'BRIEFING.md\ntemplates/ORDER_FORM.md');
 assert.equal((await C.call('cove-support',tok,'read_file',{path:'/home/claude/workspaces/cove-support/templates/ORDER_FORM.md'})).text,'Nama:');
 assert.equal((await C.call('cove-support',tok,'read_file',{path:'.secrets/XENDIT_SECRET_KEY'})).isError,true);
 assert.equal((await C.call('cove-support',tok,'conversation',{})).text,'chat cnv_1')});

test('a payment is for this customer only, adds up to the order total, is logged, and is not repeated by mistake',async()=>{const {C,D,ran,tick}=await make();const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'live'});
 const pay=a=>C.call('cove-support',tok,'create_payment',{order_form:'Nama: Ani Wijaya\nAlamat: Jl. Merdeka 10, Bandung 40111\nNo HP: 08123456789\nPesanan: 1x Pen',...a});
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2600000})).text,/add up to 2660000/);
 assert.match((await pay({amounts:[5],name:'Ani',order_total:5})).text,/10000 to 5000000/);
 const ok=await pay({amounts:[2660000],name:'Ani; rm -rf /',order_total:2660000});assert.match(ok.text,/FOTO/);
 assert.deepEqual(ran[0],['cove-support','.tools/qris',['2660000','--name','Ani rm -rf','--phone','6281234567890']]);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000})).text,/already made/);
 const log=(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(log.length,1);assert.equal(log[0].phone,'6281234567890');assert.equal(log[0].total,2660000);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000,expired:true})).text,/FOTO/);
 assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/Two payments/);
 tick(16*60e3);assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/only work inside a customer chat run/)});

test('Gino\'s helper sends to the run\'s customer, whatever number the model has in mind',async()=>{const {C,ran}=await make('pay');const tok=C.begin({agent:'cove-support',line:'291',conversation:'c',phone:'6280000000001',mode:'test'});
 await C.call('cove-support',tok,'create_payment',{kind:'va',bank:'bca',amounts:[1500000],name:'Budi',order_total:1500000,order_form:'Nama: Ani Wijaya\nAlamat: Jl. Merdeka 10, Bandung 40111\nNo HP: 08123456789\nPesanan: 1x Pen',to:'6280000000000'});
 assert.deepEqual(ran[0][2],['va','BCA','1500000','--name','Budi','--to','6280000000001'])});

test('the reply guard can ask whether a payment was made for this customer since the run began',async()=>{const {C}=await make();const tok=C.begin({agent:'cove-support',line:'1',conversation:'c',phone:'6280000000007'});
 assert.equal(await C.paidSince('cove-support','6280000000007',0),false);
 await C.call('cove-support',tok,'create_payment',{amounts:[50000],name:'A',order_total:50000,order_form:'Nama: Ani Wijaya\nAlamat: Jl. Merdeka 10, Bandung 40111\nNo HP: 08123456789\nPesanan: 1x Pen'});
 assert.equal(await C.paidSince('cove-support','+62 8000-0000-007',1e12-5000),true);assert.equal(await C.paidSince('bay-sales','6280000000007',0),false)});

test('the payment helper can be any script named in the line\'s settings',async()=>{const W=await mkdtemp(path.join(tmpdir(),'ct2-'));await mkdir(path.join(W,'a','bin'),{recursive:true});await writeFile(path.join(W,'a','bin','stripe-link'),'x');
 const ran=[];const C=createCustomerTools({WORK:W,DATA:path.join(W,'d'),payRules:async()=>({currency:'USD',min:1,max:900,helper:{path:'bin/stripe-link',style:'send'}}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async(a,t,v)=>{ran.push([t,v]);return {ok:true,out:'sent'}},log:()=>{}});
 const tok=C.begin({agent:'a',line:'1',conversation:'c',phone:'15551234567',mode:'test'});
 assert.equal((await C.call('a',tok,'create_payment',{kind:'qris',amounts:[120],name:'Sam',order_total:120,order_form:'Nama: Ani Wijaya\nAlamat: Jl. Merdeka 10, Bandung 40111\nNo HP: 08123456789\nPesanan: 1x Pen'})).text,'sent');assert.deepEqual(ran[0],['bin/stripe-link',['qris','120','--name','Sam','--to','15551234567']])});

test('a tester of the line pays a Rp10.000 test QRIS, logged testAmount; a customer pays the order total',async()=>{const {C,D,ran}=await make();
 const form='Nama: Tester\nAlamat: Jalan Test 1, Jakarta\nNo HP: 628111\nPesanan: 1x Widget premium pack';
 const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_t',phone:'628111',mode:'test',tester:true});
 const x=await C.call('cove-support',tok,'create_payment',{amounts:[2000000,660000],order_total:2660000,name:'Tester',order_form:form});
 assert.equal(!!x.isError,false,x.text);assert.deepEqual(ran.at(-1)[2].slice(0,1),['10000']);
 const c=C.begin({agent:'cove-support',line:'140',conversation:'cnv_c',phone:'628222',mode:'live'});
 await C.call('cove-support',c,'create_payment',{amounts:[2000000,660000],order_total:2660000,name:'Cust',order_form:form});assert.deepEqual(ran.at(-1)[2].slice(0,2),['2000000','660000']);
 const log=(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(log[0].testAmount,true);assert.equal(log[0].total,10000);assert.equal(log[0].orderTotal,2660000);assert.equal(log[1].testAmount,undefined);assert.equal(log[1].total,2660000);
 assert.equal((await C.call('cove-support',tok,'create_payment',{amounts:[2660000],order_total:2660000,name:'Tester',order_form:form})).isError,true,'a repeat is still caught')});

// website_form (i77296280, 10 Nov 2026): made by the fixer on the live box, taken into git 11 Nov
test('website_form returns only THIS chat\'s own quiz, matched by the run\'s phone, login cached',async()=>{const W=await mkdtemp(path.join(tmpdir(),'ct3-'));await mkdir(path.join(W,'a','.secrets'),{recursive:true});await writeFile(path.join(W,'a','.secrets','STORE_PW'),'pw\n');
 const calls=[];const fetchFn=async(u,o={})=>{calls.push(u);if(u.endsWith('/api/login')){assert.equal(JSON.parse(o.body).password,'pw');return {ok:true,status:200,headers:{getSetCookie:()=>['sess=1; Path=/']}}}
  assert.equal(o.headers.cookie,'sess=1');return {ok:true,status:200,json:async()=>({contacts:[{id:'c1',phone:'+6280000000003'},{id:'c2',phone:'+628111'}],activities:[{contactId:'c1',type:'program_quiz',message:'MINE BMI 35',createdAt:'2026-11-09T23:48:00Z',product:'Program Reta'},{contactId:'c2',type:'program_quiz',message:'OTHER',createdAt:'2026-11-09T23:50:00Z'},{contactId:'c1',type:'newsletter',message:'skip'}]})}};
 const C=createCustomerTools({WORK:W,DATA:path.join(W,'d'),fetchFn,formRules:async()=>({baseUrl:'https://s.example',username:'randy',secret:'STORE_PW'}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async()=>({}),log:()=>{}});
 const list=(await C.mcp('a','',{id:1,method:'tools/list'})).body.result.tools.map(t=>t.name);assert.ok(list.includes('website_form'));
 const tok=C.begin({agent:'a',line:'1',conversation:'c',phone:'080000000003'});
 const x=await C.call('a',tok,'website_form',{phone:'628111'});assert.ok(x.text.includes('MINE BMI 35'));assert.ok(!x.text.includes('OTHER'));assert.ok(!x.text.includes('skip'));
 await C.call('a',tok,'website_form',{});assert.equal(calls.filter(u=>u.endsWith('/api/login')).length,1);
 const t2=C.begin({agent:'a',line:'1',conversation:'c2',phone:'6289999999'});assert.ok(/No website quiz/.test((await C.call('a',t2,'website_form',{})).text))});

test('a payment whose delivery to the customer failed is not "made": not counted, not a repeat, tells the agent to send again (11 Nov 2026)',async()=>{
 const W=await mkdtemp(path.join(tmpdir(),'ct3-')),D=path.join(W,'d');await mkdir(path.join(W,'a','.tools'),{recursive:true});await writeFile(path.join(W,'a','.tools','qris'),'x');
 let out='[FOTO: qris-1.png] status failed: could not deliver';const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({currency:'Rp',min:10000,max:5000000}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async()=>({ok:true,out}),log:()=>{},now:()=>1e12});
 const tok=C.begin({agent:'a',line:'1',conversation:'c',phone:'6280000000007'});
 const pay=()=>C.call('a',tok,'create_payment',{amounts:[50000],name:'A',order_total:50000,order_form:'Nama: Ani Wijaya\nAlamat: Jl. Merdeka 10, Bandung 40111\nNo HP: 08123456789\nPesanan: 1x Pen'});
 assert.match((await pay()).text,/has NOT received/);
 assert.equal(await C.paidSince('a','6280000000007',0),false);
 out='[FOTO: qris-2.png] | Rp50.000';assert.match((await pay()).text,/FOTO/);   // not refused as a repeat, and the failed one did not use up the run's two payments
 assert.equal(await C.paidSince('a','6280000000007',0),true);
});

// ---- customer-safety audit, 12 Nov 2026: C2 (the amount comes from code), H2 (no direct sends), H8a (one member), M9, C1 (past chats)
import {quote,formTotal,splitAmounts,parsePriceList,parseMoney,cleanCatalog} from '../app/price-catalog.mjs';
import {createPaymentProviders} from '../app/payment-providers.mjs';
import {createAgentKeys} from '../app/agent-keys.mjs';
const CAT=cleanCatalog({currency:'Rp',products:{'reta-10mg':{name:'Reta 10mg',price:3200000,label:'S-Reta'},'reta-30mg':{name:'Reta 30mg',price:6000000},pen:{name:'Premium Reusable Pen',price:1000000,label:'S-Pen'},'bac-water':{name:'Bacteriostatic Water',price:300000}},
 shipping:{free:{name:'Gratis',price:0,default:true},jawa:{name:'Ongkir Jawa',price:100000}},discounts:{THREADS5:{percent:5},OLD10:{percent:10,until:'2020-01-01'}},free:{pen:{over:5000000}},fees:{card:{percent:2.5}}});
const FORM3=t=>'Nama: Ani Wijaya\nEmail: ani@example.com\nNomor HP: 08123456789\nAlamat Lengkap: Jl. Merdeka 10, Bandung 40111\nPesanan: 1x Reta 10mg\nVoucher: THREADS5\nTotal Pembayaran: *'+t+'*';
async function shop({mode='live',tester=false,pr={},cat=CAT,helper='qris'}={}){const W=await mkdtemp(path.join(tmpdir(),'cs-')),D=path.join(W,'data');await mkdir(path.join(W,'cove-support','.tools'),{recursive:true});if(helper)await writeFile(path.join(W,'cove-support','.tools',helper),'x');
 const ran=[];let t=Date.parse('2026-11-12T03:00:00Z');
 const C=_createCustomerTools({WORK:W,DATA:D,catalogOf:async()=>cat,payRules:async()=>({currency:'Rp',min:10000,max:5000000,...pr}),labelRules:async()=>({sales:['S-Reta','S-Pen']}),googleCall:async()=>({}),chatFind:async(a,q,o)=>({text:JSON.stringify(o)}),history:async()=>'',log:()=>{},now:()=>t,
  runAsAgent:async(a,tool,argv)=>{ran.push([tool,argv]);return {ok:true,out:'[FOTO: qris-BM-1794038325-1.png] | Rp'+argv[0]}}});
 const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode,tester});
 const pay=a=>C.call('cove-support',tok,'create_payment',{name:'Ani',...a});const log=async()=>(await readFile(path.join(D,'payments.jsonl'),'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(JSON.parse);
 return {C,W,D,ran,tok,pay,log}}

test('the price list prices the order: products, quantities, a listed promo code, shipping, a free item, the card fee',()=>{
 const q=quote(CAT,{items:[{id:'reta-10mg',qty:1}],discount:'threads5'});assert.deepEqual([q.subtotal,q.discount.amount,q.total,q.labels],[3200000,160000,3040000,['S-Reta']]);
 assert.equal(quote(CAT,{items:[{id:'reta-10mg'},{id:'bac-water',qty:2}],shipping:'jawa'}).total,3900000);
 assert.match(quote(CAT,{items:[{id:'reta-10mg'}],discount:'FRIEND50'}).why,/not a promo code of the price list/);assert.match(quote(CAT,{items:[{id:'reta-10mg'}],discount:'OLD10'}).why,/ended/);
 assert.match(quote(CAT,{items:[{id:'reta-99mg'}]}).why,/not a product id/);assert.match(quote(CAT,{items:[{id:'reta-10mg',qty:0}]}).why,/quantity/);
 assert.match(quote(CAT,{items:[{id:'reta-10mg'},{id:'pen',free:true}]}).why,/free only when/);assert.equal(quote(CAT,{items:[{id:'reta-30mg'},{id:'pen',free:true}]}).total,6000000);
 assert.match(quote(CAT,{items:[{id:'reta-30mg'},{id:'bac-water',free:true}]}).why,/never free/);
 const c=quote(CAT,{items:[{id:'bac-water',qty:3},{id:'reta-10mg',qty:0+1}],kind:'card'});assert.deepEqual([c.total,c.fee,c.charge],[4100000,102500,4202500]);
 assert.equal(formTotal('Subtotal: Rp3.200.000\nDiskon THREADS5 (5%): -Rp160.000\n*Total Pembayaran:* Rp3.040.000 (QRIS)'),3040000);assert.equal(formTotal('Total: ~Rp5.500.000~ → Rp3.900.000'),3900000);assert.equal(formTotal('Pesanan: 1x Pen'),null);
 assert.deepEqual(splitAmounts(5700000,{min:10000,max:5000000}),[5000000,700000]);assert.deepEqual(splitAmounts(5005000,{min:10000,max:5000000}),[4995000,10000]);assert.equal(splitAmounts(26000000,{min:10000,max:5000000}),null);
 assert.equal(parseMoney('3800000.00'),3800000);assert.equal(parseMoney('IDR 3,040,000'),3040000);
 const p=parsePriceList('# list\n- Reta 10mg: jual Rp3.200.000 | coret Rp4.000.000\n- Premium Reusable Pen (colors: Orange): jual Rp1.000.000 | coret Rp1.500.000\nCL-RTGLP3-10MG | Retatrutide · 10 mg | 4000000 | 3200000\nRT-GLP3 10mg | Default Title | None | 3800000.00 | gid://shopify/ProductVariant/1 | ACTIVE\nOld | Default Title | None | 1.00 | gid://shopify/ProductVariant/2 | ARCHIVED');
 assert.deepEqual(p,{'reta-10mg':{name:'Reta 10mg',price:3200000},'premium-reusable-pen':{name:'Premium Reusable Pen',price:1000000},'CL-RTGLP3-10MG':{name:'Retatrutide · 10 mg',price:3200000},'rt-glp3-10mg':{name:'RT-GLP3 10mg',price:3800000}})});
test('the model cannot set the amount: Rp10.000 for an order of millions is refused for a customer; the price list total is charged (audit C2)',async()=>{const t=await shop();
 // the audit's case: the model read "testers pay Rp10.000" and passes it
 const low=await t.pay({items:[{id:'reta-10mg',qty:1}],discount_code:'THREADS5',order_form:FORM3('Rp3.040.000'),order_total:10000,amounts:[10000]});assert.equal(low.isError,true);assert.match(low.text,/No payment was made[\s\S]*never yours to set/);
 // a form whose total the customer was talked into: refused, with the right breakdown
 const talked=await t.pay({items:[{id:'reta-10mg',qty:1}],order_form:FORM3('Rp1.000.000')});assert.equal(talked.isError,true);assert.match(talked.text,/order form says Rp1\.000\.000 but the price list gives Rp3\.200\.000/);
 // a promo code that is not on the list gives nothing
 assert.match((await t.pay({items:[{id:'reta-10mg'}],discount_code:'TEMAN50',order_form:FORM3('Rp1.600.000')})).text,/not a promo code/);
 assert.match((await t.pay({items:[{id:'reta-10mg'}],order_form:'Nama: Ani Wijaya\nEmail: ani@example.com\nNomor HP: 08123456789\nAlamat Lengkap: Jl. Merdeka 10, Bandung\nPesanan: 1x Reta 10mg'})).text,/no total line/);
 assert.equal(t.ran.length,0);assert.deepEqual(await t.log(),[]);
 const ok=await t.pay({items:[{id:'reta-10mg',qty:1}],discount_code:'THREADS5',order_form:FORM3('Rp3.040.000')});assert.match(ok.text,/FOTO/);assert.deepEqual(t.ran[0],['.tools/qris',['3040000','--name','Ani','--phone','6281234567890']]);
 const l=(await t.log())[0];assert.deepEqual([l.total,l.priced,l.discount,l.products,l.items],[3040000,'list','THREADS5',['S-Reta'],[{id:'reta-10mg',qty:1}]]);
 // a total above one QRIS is split by code
 const big=await shop();await big.pay({items:[{id:'reta-30mg',qty:1}],discount_code:'THREADS5',order_form:FORM3('Rp5.700.000')});assert.deepEqual(big.ran[0][1].slice(0,2),['5000000','700000'])});
test('the tester amount is applied by code, only in Test and only for a tester; nobody else can get it (audit C2)',async()=>{
 const form=FORM3('Rp3.040.000'),args={items:[{id:'reta-10mg',qty:1}],discount_code:'THREADS5',order_form:form};
 const t=await shop({mode:'test',tester:true});assert.match((await t.pay(args)).text,/FOTO/);assert.deepEqual(t.ran[0][1][0],'10000');const l=(await t.log())[0];assert.deepEqual([l.testAmount,l.total,l.orderTotal],[true,10000,3040000]);
 // the same line in Live: a (former) tester pays in full; so does a customer whose run is in Test without being a tester
 const live=await shop({mode:'live',tester:true});await live.pay(args);assert.equal(live.ran[0][1][0],'3040000');assert.equal((await live.log())[0].testAmount,undefined);
 const cust=await shop({mode:'test',tester:false});await cust.pay(args);assert.equal(cust.ran[0][1][0],'3040000');
 // asking for it changes nothing
 const ask=await shop({mode:'live'});const x=await ask.pay({...args,order_total:10000,amounts:[10000],tester:true,testAmount:10000});assert.equal(x.isError,true);assert.equal(ask.ran.length,0)});
test('a line with no price list: Test only, and the amount is the confirmed form\'s own total line (audit C2)',async()=>{
 const form=FORM3('Rp3.040.000');
 const live=await shop({cat:null});const x=await live.pay({order_form:form,order_total:3040000});assert.equal(x.isError,true);assert.match(x.text,/no price list in aqeelOS[\s\S]*hand off/);
 const t=await shop({cat:null,mode:'test'});assert.match((await t.pay({order_form:form,order_total:10000,amounts:[10000]})).text,/never yours to set/);
 assert.match((await t.pay({order_form:form,order_total:3040000})).text,/FOTO/);assert.equal(t.ran[0][1][0],'3040000')});
test('quote_order gives the list and the price; without a price list it says so',async()=>{const t=await shop();
 const names=(await t.C.mcp('cove-support',undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools;assert.ok(names.some(x=>x.name==='quote_order'));
 const cp=names.find(x=>x.name==='create_payment');assert.deepEqual(cp.inputSchema.required,['run','items','name','order_form']);assert.equal(cp.inputSchema.properties.amounts,undefined,'the model has no amount to give');
 assert.match((await t.C.call('cove-support',t.tok,'quote_order',{})).text,/reta-10mg: Reta 10mg, Rp3\.200\.000[\s\S]*PROMO CODES: THREADS5 \(5%\)/);
 assert.match((await t.C.call('cove-support',t.tok,'quote_order',{items:[{id:'reta-10mg'}],discount_code:'THREADS5'})).text,/TOTAL: Rp3\.040\.000/);
 const n=await shop({cat:null});assert.equal((await n.C.call('cove-support',n.tok,'quote_order',{})).isError,true)});
test('a helper that sends by itself is refused in Draft and Live, and counts as ours in Test (audit H2)',async()=>{
 const form=FORM3('Rp3.040.000'),args={kind:'qris',items:[{id:'reta-10mg',qty:1}],discount_code:'THREADS5',order_form:form};
 for(const mode of ['draft','live']){const t=await shop({mode,helper:'pay'});const x=await t.pay(args);assert.equal(x.isError,true);assert.match(x.text,/sends to the customer by itself[\s\S]*No payment was made/);assert.equal(t.ran.length,0)}
 const W=await mkdtemp(path.join(tmpdir(),'cs2-'));await mkdir(path.join(W,'a','.tools'),{recursive:true});await writeFile(path.join(W,'a','.tools','pay'),'x');const noted=[];
 const C=_createCustomerTools({WORK:W,DATA:path.join(W,'d'),catalogOf:async()=>CAT,payRules:async()=>({min:10000,max:5000000}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},
  noteSend:async(a,to,p)=>{const r=await p;noted.push([a,to,r.ids]);return r},runAsAgent:async()=>({ok:true,out:'QRIS Rp10.000 ref T123 -> WhatsApp msg_abc status delivered (valid until 10.00 WIB)'})});
 const tok=C.begin({agent:'a',line:'1',conversation:'c',phone:'628111',mode:'test',tester:true});assert.equal(!!(await C.call('a',tok,'create_payment',{name:'T',...args})).isError,false);assert.deepEqual(noted,[['a','628111',['msg_abc']]])});
test('with the line\'s provider set, aqeelOS makes the payment itself with keys the agent cannot read; the QR is a picture part of the reply (audit H2, H3)',async()=>{
 const W=await mkdtemp(path.join(tmpdir(),'pp-')),D=path.join(W,'data');await mkdir(path.join(W,'cove-support','.tools'),{recursive:true});await writeFile(path.join(W,'cove-support','.tools','pay'),'x');
 const keys=createAgentKeys({DATA:D,WORK:W,log:()=>{}});await keys.set('cove-support','TRIPAY_API_KEY','tp-key');await keys.set('cove-support','TRIPAY_PRIVATE_KEY','tp-priv');await keys.set('cove-support','XENDIT_SECRET_KEY','xnd-key');
 const calls=[];const fetchFn=async(url,o)=>{const b=JSON.parse(o.body);calls.push([url,o.headers.authorization,b]);
  if(url.includes('tripay'))return {ok:true,status:200,json:async()=>({success:true,data:{reference:'T90001ABCD'+calls.length,qr_url:'https://tripay.co.id/qr/'+b.merchant_ref,pay_code:'8077700012345678',amount:b.amount}})};
  return {ok:true,status:200,json:async()=>({id:'6aefe9edcc1f71c06def4151',invoice_url:'https://checkout.xendit.co/web/6aefe9edcc1f71c06def4151',expiry_date:'2026-11-13T03:00:00Z'})}};
 const providers=createPaymentProviders({DATA:D,keyOf:keys.get,fetchFn,now:()=>Date.parse('2026-11-12T03:00:00Z'),log:()=>{}});const ran=[];
 const pr={currency:'Rp',min:10000,max:5000000,provider:{tripay:{merchantCode:'T99999',refPrefix:'BM'},xendit:{}}};
 const C=_createCustomerTools({WORK:W,DATA:D,catalogOf:async()=>CAT,providers,keyOf:keys.get,payRules:async()=>pr,googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},now:()=>Date.parse('2026-11-12T03:00:00Z'),runAsAgent:async(...a)=>{ran.push(a);return {ok:true,out:''}}});
 // Draft: allowed, because nothing is sent by the payment itself; the QR rides in the draft a person approves
 const tok=C.begin({agent:'cove-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'draft'});
 const x=await C.call('cove-support',tok,'create_payment',{kind:'qris',name:'Ani',items:[{id:'reta-10mg',qty:1}],discount_code:'THREADS5',order_form:FORM3('Rp3.040.000')});
 assert.match(x.text,/^\[FOTO: qris-BM-\d+-\d+\.png\] \| Rp3\.040\.000 \| berlaku sampai 11\.00 WIB/);assert.equal(ran.length,0,'the agent\'s own script is not run');
 assert.equal(calls[0][1],'Bearer tp-key');assert.equal(calls[0][2].amount,3040000);assert.equal(calls[0][2].customer_phone,'081234567890');assert.match(calls[0][2].signature,/^[0-9a-f]{64}$/);
 const file=/\[FOTO: ([^\]]+)\]/.exec(x.text)[1];assert.equal(await providers.mediaLink('cove-support',file),'https://tripay.co.id/qr/'+calls[0][2].merchant_ref);assert.equal(await providers.mediaLink('bay-sales',file),null);
 const log=(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual([log[0].by,log[0].refs,log[0].total],['aqeelOS',['T90001ABCD1'],3040000]);assert.ok(await C.qrSince('cove-support','6281234567890',0).then(t=>t[0]===`[FOTO: ${file}]`));
 const t2=C.begin({agent:'cove-support',line:'140',conversation:'cnv_2',phone:'6281234567891',mode:'live'});
 const va=await C.call('cove-support',t2,'create_payment',{kind:'va',bank:'bca',name:'Budi',items:[{id:'bac-water',qty:1}],order_form:FORM3('Rp300.000').replace('1x Reta 10mg','1x Bacteriostatic Water')});
 assert.match(va.text,/BCA Virtual Account \| nomor VA 8077700012345678 \| Rp300\.000 \| berlaku sampai 11\.00 WIB/);assert.equal(calls[1][2].method,'BCAVA');
 const cd=await C.call('cove-support',t2,'create_payment',{kind:'card',name:'Budi',items:[{id:'reta-10mg',qty:1}],order_form:FORM3('Rp3.200.000'),expired:true});
 assert.match(cd.text,/^https:\/\/checkout\.xendit\.co\/web\/6aefe9edcc1f71c06def4151 \| Rp3\.280\.000[\s\S]*card fee 2\.5% Rp80\.000/);assert.equal(calls[2][2].amount,3280000);assert.equal(calls[2][1],'Basic '+Buffer.from('xnd-key:').toString('base64'));
 // the keys are where the agent's user cannot go, and nowhere in its workspace
 assert.equal(await keys.where('cove-support','TRIPAY_API_KEY'),'app');assert.deepEqual(await keys.exposed(['cove-support']),[]);
 // a provider that fails: no payment, the agent hands off
 const bad=createPaymentProviders({DATA:D,keyOf:keys.get,fetchFn:async()=>({ok:false,status:500,json:async()=>({message:'down'})}),log:()=>{}});
 const C2=_createCustomerTools({WORK:W,DATA:path.join(W,'d2'),catalogOf:async()=>CAT,providers:bad,payRules:async()=>pr,googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async()=>({})});
 const t3=C2.begin({agent:'cove-support',line:'140',conversation:'c',phone:'628111',mode:'live'});const f=await C2.call('cove-support',t3,'create_payment',{kind:'qris',name:'A',items:[{id:'bac-water'}],order_form:FORM3('Rp300.000')});assert.equal(f.isError,true);assert.match(f.text,/payment was not made[\s\S]*hand off/)});
test('past_chats: the customer\'s own chat by default, the run\'s conversation, never the model\'s (audit C1)',async()=>{const t=await shop();
 assert.deepEqual(JSON.parse((await t.C.call('cove-support',t.tok,'past_chats',{query:'alamat',conversation:'cnv_other'})).text),{scope:'mine',conversation:'cnv_1'});
 assert.deepEqual(JSON.parse((await t.C.call('cove-support',t.tok,'past_chats',{query:'vial',scope:'answers',limit:3})).text),{limit:3,scope:'answers',conversation:'cnv_1'})});
test('rule files only: task, recap and tester notes are not readable, and a line can name its own list (audit M9)',()=>{
 for(const no of ['SALES_RECAP_TASK.md','TESTER_NOTES.md','watchdog.md','RECAP.md'])assert.equal(readable(no),false,no);
 for(const ok of ['AQEEL_DECISIONS.md','PRICELIST.md','TUTORIAL_RULE.md','FIRST_REPLY_RULE_CURRENT.md'])assert.equal(readable(ok),true,ok);
 assert.equal(readable('AQEEL_DECISIONS.md',{deny:['AQEEL_DECISIONS.md']}),false);assert.equal(readable('BRIEFING.md',{allow:['PRICELIST.md']}),false);assert.equal(readable('PRICELIST.md',{allow:['PRICELIST.md']}),true);assert.equal(readable('.secrets/X',{allow:['.secrets/X']}),false)});
test('get_protocol gives one member\'s protocol or nothing: two members on one number is a handoff, for the app\'s reader and for a helper (audit H8a)',async()=>{
 const W=await mkdtemp(path.join(tmpdir(),'gp-'));await mkdir(path.join(W,'a','.tools'),{recursive:true});await writeFile(path.join(W,'a','.tools','protocol'),'x');
 const mk=(o={})=>_createCustomerTools({WORK:W,DATA:path.join(W,'d'),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},runAsAgent:async()=>({ok:true,out:'Protocol: P1\nMember: Ani W\nProduct: Reta\n\nProtocol: P2\nMember: Budi W\nProduct: Reta'}),...o});
 const h=mk();const k=h.begin({agent:'a',line:'1',conversation:'c',phone:'628111',mode:'live'});const x=await h.call('a',k,'get_protocol',{});assert.match(x.text,/More than one member has this number[\s\S]*hand off/);assert.doesNotMatch(x.text,/Ani|Budi|Reta/);
 const one=mk({runAsAgent:async()=>({ok:true,out:'Protocol: P1\nMember: Ani W\nProduct: Reta'})});assert.match((await one.call('a',one.begin({agent:'a',line:'1',conversation:'c',phone:'628111'}),'get_protocol',{})).text,/Protocol: P1/);
 const app=mk({pdfRules:async()=>({baseUrl:'https://m.example'}),protocolText:async(a,phone)=>phone==='628111'?{none:'More than one member has this number, so it is not certain whose protocol this is.'}:{text:'Protocol: Mine'}});
 assert.match((await app.call('a',app.begin({agent:'a',line:'1',conversation:'c',phone:'628111'}),'get_protocol',{})).text,/More than one member[\s\S]*hand off/);
 assert.equal((await app.call('a',app.begin({agent:'a',line:'1',conversation:'c',phone:'628222'}),'get_protocol',{phone:'628111'})).text,'Protocol: Mine')});
