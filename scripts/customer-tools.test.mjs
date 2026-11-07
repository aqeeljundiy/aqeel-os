// Tests for the customer-run sandbox (app/customer-tools.mjs). Run: node --test scripts/customer-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCustomerTools,readable} from '../app/customer-tools.mjs';

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
 const t=await tools('cove-support');assert.deepEqual(t.map(x=>x.name),['read_sheet','read_file','list_files','conversation','past_chats','create_payment']);
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
 const pay=a=>C.call('cove-support',tok,'create_payment',a);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2600000})).text,/add up to 2660000/);
 assert.match((await pay({amounts:[5],name:'Ani',order_total:5})).text,/10000 to 5000000/);
 const ok=await pay({amounts:[2660000],name:'Ani; rm -rf /',order_total:2660000});assert.match(ok.text,/FOTO/);
 assert.deepEqual(ran[0],['cove-support','.tools/qris',['2660000','--name','Ani rm -rf','--phone','6281234567890']]);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000})).text,/already made/);
 const log=(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(log.length,1);assert.equal(log[0].phone,'6281234567890');assert.equal(log[0].total,2660000);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000,expired:true})).text,/FOTO/);
 assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/Two payments/);
 tick(16*60e3);assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/only work inside a customer chat run/)});

test('Gino\'s helper sends to the run\'s customer, whatever number the model has in mind',async()=>{const {C,ran}=await make('pay');const tok=C.begin({agent:'cove-support',line:'291',conversation:'c',phone:'6287885993124'});
 await C.call('cove-support',tok,'create_payment',{kind:'va',bank:'bca',amounts:[1500000],name:'Budi',order_total:1500000,to:'6280000000000'});
 assert.deepEqual(ran[0][2],['va','BCA','1500000','--name','Budi','--to','6287885993124'])});

test('the reply guard can ask whether a payment was made for this customer since the run began',async()=>{const {C}=await make();const tok=C.begin({agent:'cove-support',line:'1',conversation:'c',phone:'628111222333'});
 assert.equal(await C.paidSince('cove-support','628111222333',0),false);
 await C.call('cove-support',tok,'create_payment',{amounts:[50000],name:'A',order_total:50000});
 assert.equal(await C.paidSince('cove-support','+62 811-1222-333',1e12-5000),true);assert.equal(await C.paidSince('bay-sales','628111222333',0),false)});

test('the payment helper can be any script named in the line\'s settings',async()=>{const W=await mkdtemp(path.join(tmpdir(),'ct2-'));await mkdir(path.join(W,'a','bin'),{recursive:true});await writeFile(path.join(W,'a','bin','stripe-link'),'x');
 const ran=[];const C=createCustomerTools({WORK:W,DATA:path.join(W,'d'),payRules:async()=>({currency:'USD',min:1,max:900,helper:{path:'bin/stripe-link',style:'send'}}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',runAsAgent:async(a,t,v)=>{ran.push([t,v]);return {ok:true,out:'sent'}},log:()=>{}});
 const tok=C.begin({agent:'a',line:'1',conversation:'c',phone:'15551234567'});
 assert.equal((await C.call('a',tok,'create_payment',{kind:'qris',amounts:[120],name:'Sam',order_total:120})).text,'sent');assert.deepEqual(ran[0],['bin/stripe-link',['qris','120','--name','Sam','--to','15551234567']])});
