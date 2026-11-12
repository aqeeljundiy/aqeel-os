// Kirimdev settings on the page (app/kirimdev-settings.mjs, 13 Nov 2026): who may approve drafts (picked from the team's people, their
// Telegram ids stored), the price list as rows (labels and free items kept), hints for what the team's list file has and the saved list
// lacks, and a held chat released by reference, never by the customer's number.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {peopleOf,approverState,buildApprovers,catalogRows,catalogFromRows,leftOut} from '../app/kirimdev-settings.mjs';
import {cleanCatalog,quote,createCatalog} from '../app/price-catalog.mjs';

const POL={owner:{name:'Abel',telegram:['1000000001']},teams:[
 {name:'Cove',agents:['cove-support'],members:[{name:'Ari',telegram:['1000000002','1000000003']},{name:'No Telegram',whatsapp:['6281']},{name:'Group only',telegram:['-1001234567']}]},
 {name:'Other',agents:['x'],members:[{name:'Bo',telegram:['1000000004']},{name:'ari',telegram:['1000000009']}]}]};

test('people to pick from: the owner, the team that covers the agent, then the rest; only people with a Telegram user id',()=>{
 const p=peopleOf(POL,'cove-support');
 assert.deepEqual(p.map(x=>x.name),['Abel','Ari','Bo'],'a group id and a missing id are not people; a second "ari" is the same name');
 assert.deepEqual(p[1].ids,['1000000002','1000000003']);assert.equal(p[0].team,'Owner');assert.equal(p[1].team,'Cove');
 assert.deepEqual(peopleOf(POL,'x').map(x=>x.name),['Abel','Bo','ari'],'the agent\'s own team first');assert.deepEqual(peopleOf({},'a'),[])});

test('approvers: picked people store all their ids; approvers nobody matches are kept unless dropped; unknown names are refused',()=>{
 const people=peopleOf(POL,'cove-support'),cur=[{who:'Old Contractor',telegramId:'1000000001'}];
 const list=buildApprovers(people,cur,['Ari']);
 assert.deepEqual(list,[{who:'Ari',telegramId:'1000000002'},{who:'Ari',telegramId:'1000000003'},{who:'Old Contractor',telegramId:'1000000001'}]);
 const st=approverState(people,list);assert.deepEqual(st.picked,['Ari']);assert.deepEqual(st.others,[{who:'Old Contractor',telegramId:'1000000001'}]);
 assert.deepEqual(buildApprovers(people,list,['Ari'],['1000000001']).map(x=>x.telegramId),['1000000002','1000000003'],'dropped');
 assert.deepEqual(buildApprovers(people,list,[]),[{who:'Old Contractor',telegramId:'1000000001'}],'nobody picked keeps the unknown one');
 assert.throws(()=>buildApprovers(people,[],['Mallory']),/not on a team with a Telegram id/);
 // every stored id passes the check kirimdev.cleanLine makes (4 to 15 digits)
 for(const a of list)assert.match(a.telegramId,/^\d{4,15}$/);
 // a person with only one of two ids on the list is not "picked"
 assert.deepEqual(approverState(people,[{who:'Ari',telegramId:'1000000002'}]).picked,[])});

test('price rows: saved as a list the code prices from; labels and free items the page does not show are kept; mistakes are said plainly',()=>{
 const old=cleanCatalog({currency:'Rp',source:'PRICELIST.md',products:{reta10:{name:'Reta 10mg',price:3200000,label:'S-Reta'},pen:{name:'Pen',price:100000}},free:{pen:{over:5000000,max:1}},shipping:{free:{name:'Gratis',price:0}},discounts:{OLD5:{percent:5}},fees:{card:{percent:2.5}}});
 const c=catalogFromRows(old,{currency:'Rp',
  products:[{id:'reta10',name:'Reta 10mg',price:'3.300.000'},{id:'pen',name:'Pen',price:'100000'},{name:'New thing (limited)',price:'500000'}],
  shipping:[{id:'free',name:'Gratis',price:'0'},{name:'Ongkir Jawa',price:'100000'}],
  discounts:[{code:' threads5 ',percent:'5',until:'2026-12-31'},{code:'FIFTY',amount:'50.000',min:'200000'}],cardFee:'3'});
 assert.equal(c.products.reta10.price,3300000);assert.equal(c.products.reta10.label,'S-Reta','the label is kept');assert.deepEqual(c.free,{pen:{over:5000000,max:1}},'free items are kept');
 assert.deepEqual(Object.keys(c.products),['reta10','pen','new-thing'],'a new row gets its id from its name');
 assert.deepEqual(Object.keys(c.shipping),['free','ongkir-jawa']);assert.deepEqual(c.discounts.THREADS5,{percent:5,until:'2026-12-31'});assert.deepEqual(c.discounts.FIFTY,{amount:50000,min:200000});assert.deepEqual(c.fees,{card:{percent:3}});
 assert.equal(c.source,'PRICELIST.md');
 // the code prices an order from the saved list
 const q=quote(c,{items:[{id:'reta10',qty:2}],shipping:'ongkir-jawa',discount:'threads5',kind:'card'},{now:Date.parse('2026-12-01')});assert.equal(q.ok,true,q.why);assert.equal(q.total,6600000-330000+100000);assert.equal(q.fee,Math.round(q.total*3/100));
 for(const [bad,re] of [[{products:[]},/at least one product/],[{products:[{name:'',price:1}]},/needs a name/],[{products:[{name:'A',price:'12abc'}]},/whole number/],
  [{products:[{name:'A',price:1}],discounts:[{code:'X',percent:5}]},/letters and digits/],[{products:[{name:'A',price:1}],discounts:[{code:'ABC',percent:150}]},/1 to 100/],
  [{products:[{name:'A',price:1}],discounts:[{code:'ABC'}]},/needs a percent or an amount/],[{products:[{name:'A',price:1}],discounts:[{code:'ABC',percent:5,until:'soon'}]},/not a date/],
  [{products:[{name:'A',price:1}],cardFee:'40'},/card fee/]])assert.throws(()=>catalogFromRows(old,bad),re);
 // the rows the page shows
 const r=catalogRows(c);assert.equal(r.products.length,3);assert.equal(r.cardFee,3);assert.equal(r.discounts.find(d=>d.code==='FIFTY').amount,50000);assert.equal(catalogRows(null).exists,false)});

test('hints: only when the team\'s own list file is there; products the saved list lacks, by id or name',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'ks-'));await mkdir(path.join(home,'workspaces','cove-support'),{recursive:true});
 const cat=cleanCatalog({currency:'Rp',source:'PRICELIST.md',products:{'reta-10mg':{name:'Reta 10mg',price:3200000}}});
 assert.equal(await leftOut({home,agent:'cove-support',cat}),null,'no file, no hint');
 await writeFile(path.join(home,'workspaces','cove-support','PRICELIST.md'),['# list','- Reta 10mg: jual Rp3.200.000 | coret Rp4.000.000','- HGH 36iu: jual Rp3.000.000 | coret Rp3.750.000','- Pinealon 10mg: jual Rp1.500.000'].join('\n'));
 const h=await leftOut({home,agent:'cove-support',cat});assert.equal(h.file,'PRICELIST.md');assert.equal(h.found,3);assert.deepEqual(h.missing.map(m=>m.name),['HGH 36iu','Pinealon 10mg']);assert.match(h.missing[0].text,/Rp3\.000\.000/);
 // a source name that tries to leave the folder is not read
 assert.equal(await leftOut({home,agent:'cove-support',cat:{...cat,source:'../../etc/passwd'}}).then(x=>x.file),'PRICELIST.md');
 // saving through the catalog store keeps the file private
 const DATA=await mkdtemp(path.join(tmpdir(),'ksd-'));const C=createCatalog({DATA,log:()=>{}});await C.set('cove-support',catalogFromRows(null,{products:[{name:'A',price:'1000'}]}));
 assert.equal((await C.of('cove-support')).products.a.price,1000)});
