// Tests for the customer-run sandbox (app/customer-tools.mjs). Run: node --test scripts/customer-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCustomerTools,readable} from '../app/customer-tools.mjs';

test('a customer run reads rules and templates only, never keys, tools or hidden files',()=>{
 for(const ok of ['AQEEL_DECISIONS.md','BRIEFING.md','templates/ORDER_FORM.md','sop/refunds.md','media/staff/urls.txt'])assert.equal(readable(ok),true,ok);
 for(const no of ['.secrets/XENDIT_SECRET_KEY','.tools/qris','../biomarkers-support/BRIEFING.md','/etc/passwd','templates/../.secrets/X','BRIEFING.md.bak-1106','AQEEL_DECISIONS.md.bak-2026-11-06','tmp/last_qris.json','.env','secrets.md','test_chat_watchdog.py','templates/.hidden.md'])assert.equal(readable(no),false,no)});

async function make(kind='qris'){const W=await mkdtemp(path.join(tmpdir(),'ct-')),D=path.join(W,'data');await mkdir(path.join(W,'continue-support','.tools'),{recursive:true});await mkdir(path.join(W,'continue-support','templates'),{recursive:true});
 await writeFile(path.join(W,'continue-support','.tools',kind),'x');await writeFile(path.join(W,'continue-support','templates','ORDER_FORM.md'),'Nama:');await writeFile(path.join(W,'continue-support','BRIEFING.md'),'brief');
 await mkdir(path.join(W,'continue-support','.secrets'),{recursive:true});await writeFile(path.join(W,'continue-support','.secrets','XENDIT_SECRET_KEY'),'xnd');
 const ran=[],google=[];let t=1e12;
 const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({currency:'Rp',min:10000,max:5000000}),googleCall:async(a,req)=>{google.push(req);return {status:200,json:{values:[['a']]}}},chatFind:async()=>({text:'old chat'}),history:async r=>'chat '+r.conversation,
  runAsAgent:async(a,tool,argv)=>{ran.push([a,tool,argv]);return {ok:true,out:'[FOTO: qris-1.png] | Rp2.660.000'}},log:()=>{},now:()=>t});
 return {C,W,D,ran,google,tick:ms=>{t+=ms}}}

test('the tools exist only inside a run, bound to its agent; the run key ends with the run',async()=>{const {C}=await make();
 const list=async(a,tok)=>(await C.mcp(a,tok,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools.map(t=>t.name);
 assert.deepEqual(await list('continue-support','${TERMINAL_AQEELOS_CUSTOMER_RUN}'),[]);
 const tok=C.begin({agent:'continue-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'test'});
 assert.deepEqual(await list('continue-support',tok),['read_sheet','read_file','list_files','conversation','past_chats','create_payment']);
 assert.deepEqual(await list('biomarkers-support',tok),[]);C.end(tok);assert.deepEqual(await list('continue-support',tok),[])});

test('reading: sheets read-only through aqeelOS, files from the rule list, this chat only',async()=>{const {C,google}=await make();const tok=C.begin({agent:'continue-support',line:'140',conversation:'cnv_1',phone:'628123'});
 assert.equal((await C.call('continue-support',tok,'read_sheet',{method:'spreadsheets.values.update',params:{}})).isError,true);
 assert.match((await C.call('continue-support',tok,'read_sheet',{method:'spreadsheets.values.get',params:{spreadsheetId:'s',range:'Rules!A:Z'}})).text,/values/);assert.equal(google[0].method,'spreadsheets.values.get');
 assert.equal((await C.call('continue-support',tok,'list_files',{})).text,'BRIEFING.md\ntemplates/ORDER_FORM.md');
 assert.equal((await C.call('continue-support',tok,'read_file',{path:'/home/claude/workspaces/continue-support/templates/ORDER_FORM.md'})).text,'Nama:');
 assert.equal((await C.call('continue-support',tok,'read_file',{path:'.secrets/XENDIT_SECRET_KEY'})).isError,true);
 assert.equal((await C.call('continue-support',tok,'conversation',{})).text,'chat cnv_1')});

test('a payment is for this customer only, adds up to the order total, is logged, and is not repeated by mistake',async()=>{const {C,D,ran,tick}=await make();const tok=C.begin({agent:'continue-support',line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'live'});
 const pay=a=>C.call('continue-support',tok,'create_payment',a);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2600000})).text,/add up to 2660000/);
 assert.match((await pay({amounts:[5],name:'Ani',order_total:5})).text,/10000 to 5000000/);
 const ok=await pay({amounts:[2660000],name:'Ani; rm -rf /',order_total:2660000});assert.match(ok.text,/FOTO/);
 assert.deepEqual(ran[0],['continue-support','.tools/qris',['2660000','--name','Ani rm -rf','--phone','6281234567890']]);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000})).text,/already made/);
 const log=(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(log.length,1);assert.equal(log[0].phone,'6281234567890');assert.equal(log[0].total,2660000);
 assert.match((await pay({amounts:[2660000],name:'Ani',order_total:2660000,expired:true})).text,/FOTO/);
 assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/Two payments/);
 tick(16*60e3);assert.match((await pay({amounts:[100000],name:'Ani',order_total:100000})).text,/only work inside a customer chat run/)});

test('Gilang\'s helper sends to the run\'s customer, whatever number the model has in mind',async()=>{const {C,ran}=await make('pay');const tok=C.begin({agent:'continue-support',line:'291',conversation:'c',phone:'6287885993124'});
 await C.call('continue-support',tok,'create_payment',{kind:'va',bank:'bca',amounts:[1500000],name:'Budi',order_total:1500000,to:'6280000000000'});
 assert.deepEqual(ran[0][2],['va','BCA','1500000','--name','Budi','--to','6287885993124'])});

test('the reply guard can ask whether a payment was made for this customer since the run began',async()=>{const {C}=await make();const tok=C.begin({agent:'continue-support',line:'1',conversation:'c',phone:'628111222333'});
 assert.equal(await C.paidSince('continue-support','628111222333',0),false);
 await C.call('continue-support',tok,'create_payment',{amounts:[50000],name:'A',order_total:50000});
 assert.equal(await C.paidSince('continue-support','+62 811-1222-333',1e12-5000),true);assert.equal(await C.paidSince('biomarkers-support','628111222333',0),false)});
