// Card payments in customer chats (8 Nov 2026): create_payment kind card (customer-tools.mjs), the reply guard, and the
// paid check for Xendit card invoices (paid-labels.mjs). Run: node --test scripts/customer-card.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCustomerTools,TOOLS} from '../app/customer-tools.mjs';
import {createPaidLabels} from '../app/paid-labels.mjs';
import {guardReply} from '../app/kirimdev.mjs';

const A='continue-support',LINK='https://checkout.xendit.co/web/6aefe9edcc1f71c06def4151',INV='6aefe9edcc1f71c06def4151';
async function make({card=true,qris=true,rules={}}={}){const W=await mkdtemp(path.join(tmpdir(),'cc-')),D=path.join(W,'data');await mkdir(path.join(W,A,'.tools'),{recursive:true});
 if(card)await writeFile(path.join(W,A,'.tools','card'),'x');if(qris)await writeFile(path.join(W,A,'.tools','qris'),'x');
 const ran=[];let t=1e12;
 const C=createCustomerTools({WORK:W,DATA:D,payRules:async()=>({currency:'Rp',min:10000,max:5000000,...rules}),googleCall:async()=>({}),chatFind:async()=>({}),history:async()=>'',log:()=>{},now:()=>t,
  runAsAgent:async(a,tool,argv)=>{ran.push([a,tool,argv]);return tool.includes('card')?{ok:true,out:LINK+' | Rp3.900.000 | berlaku sampai 09/11 10.18 WIB | CC-1794107884-1 | '+INV}:{ok:true,out:'[FOTO: qris-BM-1794038325-1.png] | Rp3.900.000'}}});
 const tok=()=>C.begin({agent:A,line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'test'});
 const list=async()=>(await C.mcp(A,undefined,{jsonrpc:'2.0',id:1,method:'tools/list'})).body.result.tools.find(x=>x.name==='create_payment');
 const log=async()=>(await readFile(path.join(D,'payments.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 return {C,W,D,ran,tok,list,log,later:ms=>{t+=ms}}}
const card=(C,tok,a={})=>C.call(A,tok,'create_payment',{kind:'card',amounts:[3900000],order_total:3900000,name:'Ani',...a});

test('card is offered only when the line has a card helper; QRIS and VA stay as they were',async()=>{
 assert.deepEqual((await (await make({card:false})).list()).inputSchema.properties.kind.enum,['qris'],'no helper: no card');
 const t=await make();const l=await t.list();assert.deepEqual(l.inputSchema.properties.kind.enum,['qris','card']);assert.match(l.description,/kind card, only when the customer chose credit or debit card/);
 assert.deepEqual(TOOLS('pay',{},{},true).find(x=>x.name==='create_payment').inputSchema.properties.kind.enum,['qris','va','card']);
 assert.deepEqual((await (await make({qris:false})).list()).inputSchema.properties.kind.enum,['card'],'a card helper alone still gives the tool');
 const n=await make({card:false});assert.match((await card(n.C,n.tok())).text,/no card payment helper/);assert.equal(n.ran.length,0)});

test('a card link is for this customer only, within the limits, adds up, one amount; the model gets the link and not the ids',async()=>{const t=await make(),k=t.tok();
 assert.match((await card(t.C,k,{amounts:[5],order_total:5})).text,/10000 to 5000000/);
 assert.match((await card(t.C,k,{amounts:[6000000],order_total:6000000})).text,/10000 to 5000000/);
 assert.match((await card(t.C,k,{order_total:1000000})).text,/add up to 3900000/);
 assert.match((await card(t.C,k,{amounts:[2000000,1900000]})).text,/one amount: the whole order total/);
 assert.match((await card(t.C,k,{products:['I-Reta']})).text,/sales labels/);assert.equal(t.ran.length,0,'none of those ran the helper');
 const r=await card(t.C,k,{name:'Ani; rm -rf /',phone:'6289999999999',to:'6289999999999',products:['S-Reta','S-Pen']});
 assert.deepEqual(t.ran[0],[A,'.tools/card',['3900000','--name','Ani rm -rf','--phone','6281234567890','--items','S-Reta','S-Pen']]);
 assert.ok(r.text.startsWith(LINK+' | Rp3.900.000 | berlaku sampai'));assert.doesNotMatch(r.text,/CC-1794107884/);assert.equal(r.text.split(' | ').length,3,'link, amount and expiry only');
 const [p]=await t.log();assert.equal(p.kind,'card');assert.equal(p.ok,true);assert.equal(p.phone,'6281234567890');assert.deepEqual(p.invoices,[INV]);assert.deepEqual(p.orders,['CC-1794107884-1']);assert.deepEqual(p.products,['S-Reta','S-Pen'])});

test('the line\'s card setting names the helper; a file that is not there or outside its folder falls back to .tools/card',async()=>{
 const t=await make({rules:{card:'.tools/card2'}});await writeFile(path.join(t.W,A,'.tools','card2'),'x');await card(t.C,t.tok());assert.equal(t.ran[0][1],'.tools/card2');
 for(const bad of ['.tools/gone','../other/.tools/card','/etc/passwd']){const u=await make({rules:{card:bad}});await card(u.C,u.tok());assert.equal(u.ran[0][1],'.tools/card',bad)}});

test('repeat guard and two per run; switching between QRIS and card is a new payment',async()=>{const t=await make(),k=t.tok();
 assert.match((await t.C.call(A,k,'create_payment',{amounts:[3900000],order_total:3900000,name:'Ani'})).text,/FOTO/);
 assert.ok((await card(t.C,k)).text.startsWith(LINK),'QRIS to card with the same total goes through');
 assert.match((await card(t.C,k)).text,/Two payments were already made/);
 const k2=t.tok();assert.match((await card(t.C,k2)).text,/already made for this customer/,'the same card link again');
 assert.ok((await card(t.C,k2,{expired:true})).text.startsWith(LINK),'unless it expired');
 t.later(31*60e3);assert.ok((await card(t.C,t.tok())).text.startsWith(LINK),'after 30 minutes');
 assert.match((await t.C.call(A,t.tok(),'create_payment',{kind:'cash',amounts:[3900000],order_total:3900000,name:'Ani'})).text,/kind is qris, va or card/)});

test('the reply guard counts a card link as a real payment',async()=>{const t=await make(),T=1e12;await card(t.C,t.tok());
 const say=['Berikut link pembayaran kartu kakak: '+LINK];
 assert.equal(guardReply(say,{paid:await t.C.paidSince(A,'6281234567890',T)}).hold,null);
 assert.match(guardReply(say,{paid:false}).hold,/no payment was made/)});

async function paid(st){const W=await mkdtemp(path.join(tmpdir(),'cp-')),D=path.join(W,'data');await mkdir(D,{recursive:true});await mkdir(path.join(W,A,'.secrets'),{recursive:true});await mkdir(path.join(W,A,'tmp'),{recursive:true});
 await writeFile(path.join(W,A,'.secrets','XENDIT_SECRET_KEY'),'xnd_key\n');await writeFile(path.join(W,A,'tmp','last_card.json'),JSON.stringify({ref:'CC-1794107884-1',invoice:INV,amount:3900000})+'\n');
 let t=Date.parse('2026-11-08T03:00:00Z'),now=()=>t;const asked=[],labelled=[];
 const add=o=>appendFile(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t).toISOString(),agent:A,line:'140',conversation:'cnv_1',phone:'6281234567890',mode:'test',run:'rcard',kind:'card',total:3900000,ok:true,products:['S-Reta','S-Pen'],refs:[],orders:['CC-1794107884-1'],invoices:[INV],...o})+'\n');
 const P=createPaidLabels({DATA:D,WORK:W,now,log:()=>{},label:async(a,o)=>{labelled.push([a,o]);return {set:true,changed:['+Customer']}},
  fetchImpl:async(url,o)=>{asked.push([url,o.headers.authorization]);return {ok:true,status:200,json:async()=>({id:INV,status:st.v})}}});
 return {P,add,asked,labelled,st,later:ms=>{t+=ms}}}
const WANT=[A,{conversationId:'cnv_1',phone:'6281234567890',add:['Customer','S-Reta','S-Pen'],remove:['Checkout'],source:'payment',run:'rcard'}];
test('paid check: a Xendit card invoice labels once it is PAID or SETTLED, exactly once, with the agent\'s own key',async()=>{
 const s=await paid({v:'PENDING'});await s.add();await s.P.tick();assert.equal(s.labelled.length,0);
 assert.equal(s.asked[0][0],'https://api.xendit.co/v2/invoices/'+INV);assert.equal(s.asked[0][1],'Basic '+Buffer.from('xnd_key:').toString('base64'));
 s.st.v='PAID';s.later(60e3);await s.P.tick();assert.deepEqual(s.labelled,[WANT]);s.later(60e3);await s.P.tick();assert.equal(s.labelled.length,1,'never twice');
 const u=await paid({v:'SETTLED'});await u.add();await u.P.tick();assert.deepEqual(u.labelled,[WANT])});
test('paid check: expired closes without labels; a card link is followed for 25 hours, slowly after the first hour; the invoice can be found from our ref',async()=>{
 const e=await paid({v:'EXPIRED'});await e.add();await e.P.tick();e.later(60e3);await e.P.tick();assert.equal(e.labelled.length,0);assert.equal(e.asked.length,1,'closed');
 const f=await paid({v:'PAID'});await f.add({invoices:undefined});await f.P.tick();assert.equal(f.labelled.length,1,'from tmp/last_card.json');
 const o=await paid({v:'PENDING'});await o.add();o.later(2*3600e3);await o.P.tick();assert.equal(o.asked.length,1);o.later(60e3);await o.P.tick();assert.equal(o.asked.length,1,'not every minute');o.later(10*60e3);await o.P.tick();assert.equal(o.asked.length,2);
 o.st.v='PAID';o.later(10*60e3);await o.P.tick();assert.equal(o.labelled.length,1,'paid hours later still counts');
 const old=await paid({v:'PAID'});await old.add();old.later(26*3600e3);await old.P.tick();assert.equal(old.asked.length,0,'older than 25 hours: not followed')});
