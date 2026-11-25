// Lab results (COA) for customer chats without a browser (app/lab-results.mjs, AU-36, 21 Nov 2026).
import test from 'node:test';import assert from 'node:assert/strict';
import {parseLabResults,pick,createLabResults} from '../app/lab-results.mjs';
import {TOOLS} from '../app/customer-tools.mjs';
const card=(id,name,code,batch,purity,date)=>`<a class="panel librarycard" href="/verify/${id}"><div class="producticon">X</div><h2>${name}<!-- --> </h2><p class="mini">${code}<!-- --> · <!-- -->25<!-- --> reported tests</p><div class="summaryline"><span>Batch / lot</span><strong>${batch}</strong></div><div class="summaryline"><span>Kemurnian</span><strong>${purity}</strong></div><div class="summaryline"><span>Tanggal analisis</span><span>${date}</span></div></a>`;
const PAGE='<html><div class="librarygrid">'+[card('CT-RT10-A','Examplin 10mg','RT10','HKP-0826-03-RT10','99.37%','28 Aug 2026'),card('CT-RT30-B','Examplin 30mg','RT30','HKP-0826-03-RT30','99.41%','28 Aug 2026'),card('CT-RT10-C','Examplin 10mg','RT10','YBT-0826-03-RT10','99.36%','24 Aug 2026'),card('CT-BPC10-D','BPC-157 10mg','BPC10','LD-0826-03-BPC10','99.39%','25 Aug 2026')].join('')+'</div></html>';

test('every report card is read: product, code, batch, purity, date and its own link',()=>{
 const l=parseLabResults(PAGE);assert.equal(l.length,4);
 assert.deepEqual(l[0],{product:'Examplin 10mg',code:'RT10',batch:'HKP-0826-03-RT10',purity:'99.37%',date:'28 Aug 2026',path:'/verify/CT-RT10-A'});
 assert.deepEqual(parseLabResults('<html>no cards</html>'),[])});

test('the product as a customer says it, newest first; nothing named: the newest of each product',()=>{
 const l=parseLabResults(PAGE);
 assert.deepEqual(pick(l,'examp 10').map(r=>r.batch),['HKP-0826-03-RT10','YBT-0826-03-RT10']);
 assert.deepEqual(pick(l,'RT30').map(r=>r.batch),['HKP-0826-03-RT30']);assert.deepEqual(pick(l,'Examplin 30mg').map(r=>r.code),['RT30']);
 assert.deepEqual(pick(l,'tirzepatide'),[]);assert.deepEqual(pick(l,'').map(r=>r.code),['RT10','RT30','BPC10'],'one per product')});

test('lookup gives each report\'s link on the line\'s own address, reads the page once per 15 minutes, and refuses a line with no page',async()=>{
 let t=0,n=0;const L=createLabResults({fetchFn:async()=>{n++;return {ok:true,text:async()=>PAGE}},now:()=>t});
 const r=await L.lookup({url:'https://verify.example.com/lab-results'},'examp 10');assert.equal(r[0].link,'https://verify.example.com/verify/CT-RT10-A');
 await L.lookup({url:'https://verify.example.com/lab-results'},'BPC');assert.equal(n,1,'cached');t+=16*60e3;await L.lookup({url:'https://verify.example.com/lab-results'},'');assert.equal(n,2);
 await assert.rejects(L.lookup({url:''},'x'),/no lab results page/);
 const bad=createLabResults({fetchFn:async()=>({ok:false,status:502,text:async()=>''})});await assert.rejects(bad.lookup({url:'https://x.test/lab-results'},'x'),/answered 502/)});

test('the tool is offered only on a line that has a lab results page',()=>{
 const names=l=>TOOLS('',{},{},false,false,false,false,false,null,l).map(t=>t.name);
 assert.ok(names(true).includes('lab_results'));assert.ok(!names(false).includes('lab_results'))});
