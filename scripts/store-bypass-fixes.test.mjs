// Modules moved onto app/store.mjs after the maintainability audit (12 Nov 2026), each with a CORRUPT file: one bad read must never turn into a
// save that wipes the data. price-catalog.json (customer price lists), install.json (address and time zone), and the new sync functions.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {readStoreSync,saveStoreSync,writeStoreSync,storeBad,StoreRefused} from '../app/store.mjs';
const DIR=mkdtempSync(path.join(tmpdir(),'aq-store-fix-'));
const origWarn=console.warn;console.warn=()=>{};   // the store says what it found; not needed here
process.env.UI_DATA_DIR=path.join(DIR,'install-data');
for(const k of ['PUBLIC_URL','AQEELOS_LIVE','UI_PORT','UI_SECRET'])delete process.env[k];
const I=await import('../app/install.mjs');
const {createCatalog}=await import('../app/price-catalog.mjs');

test('sync store: new file is the fallback, a bad file is kept, saves are refused until it reads again',()=>{
 const f=path.join(DIR,'s','x.json');
 assert.deepEqual(readStoreSync(f,{a:1}),{a:1});saveStoreSync(f,{v:1});saveStoreSync(f,{v:2});
 assert.equal(JSON.parse(readFileSync(f,'utf8')).v,2);assert.equal(JSON.parse(readFileSync(f+'.last-good','utf8')).v,1);
 writeFileSync(f,'{"v":');assert.deepEqual(readStoreSync(f,{}),{v:1},'the last good copy is used');assert.ok(storeBad(f));
 assert.throws(()=>saveStoreSync(f,{v:3}),e=>e instanceof StoreRefused&&e.code==='STORE_BAD'&&/x\.json/.test(e.message));
 assert.equal(readFileSync(f,'utf8'),'{"v":','the bad file is untouched');
 writeFileSync(f,'{"v":5}');saveStoreSync(f,{v:6});assert.equal(storeBad(f),null);assert.equal(JSON.parse(readFileSync(f,'utf8')).v,6);
 writeFileSync(f,'');readStoreSync(f,{});assert.throws(()=>writeStoreSync(f,'{}'),StoreRefused,'an empty file is bad too')});

test('install.json: a bad read no longer wipes the address and time zone',()=>{
 const f=path.join(DIR,'install-data','install.json'),id=I.installId();assert.ok(id);assert.ok(existsSync(f));
 I.saveSettings({publicUrl:'https://os.example.test'});I.saveSettings({timezone:'Asia/Jakarta'});
 const good=readFileSync(f,'utf8');assert.equal(JSON.parse(good).publicUrl,'https://os.example.test');
 writeFileSync(f,'{"publicUrl":"https://os.exa');I.reloadSettings();
 assert.equal(I.settings().publicUrl,'https://os.example.test','the last good copy still answers');
 assert.throws(()=>I.saveSettings({maintenance:{on:1}}),e=>e instanceof StoreRefused&&/install\.json/.test(e.message));
 assert.equal(readFileSync(f,'utf8'),'{"publicUrl":"https://os.exa','the unreadable file was not written over');
 writeFileSync(f,good);   // repaired: settings are read again, nothing stays cached from the bad time
 assert.equal(I.settings().timezone,'Asia/Jakarta');I.saveSettings({supervision:true});
 const now=JSON.parse(readFileSync(f,'utf8'));assert.equal(now.publicUrl,'https://os.example.test');assert.equal(now.timezone,'Asia/Jakarta');assert.equal(now.supervision,true);assert.equal(now.id,id)});

test('install.json: a missing file starts fresh and keeps one id; an unreadable first read does not make a new file',()=>{
 const base=path.join(DIR,'fresh'),f=path.join(base,'install.json');
 assert.deepEqual(readStoreSync(f,{}),{});assert.ok(!existsSync(f));
 saveStoreSync(f,{id:'abc'});assert.equal(readStoreSync(f,{}).id,'abc')});

test('price-catalog.json: an unreadable file is not an empty list, so one save cannot drop the other agents',async()=>{
 const DATA=path.join(DIR,'catalog'),c=createCatalog({DATA,log:()=>{}}),F=c.file;
 const list=n=>({currency:'Rp',products:{[n]:{name:'Product '+n,price:1000000}}});
 await c.set('shop-a',list('a1'));await c.set('shop-b',list('b1'));
 assert.equal((await c.of('shop-a')).products.a1.price,1000000);
 const goodText=readFileSync(F,'utf8'),corrupt='{"shop-a":{"products":{"a1":';writeFileSync(F,corrupt);
 await assert.rejects(()=>c.set('shop-c',list('c1')),e=>e.code==='STORE_BAD'&&/price-catalog\.json/.test(e.message));
 assert.equal(readFileSync(F,'utf8'),corrupt,'the file is as it was found');
 writeFileSync(F,goodText);   // repaired
 await c.set('shop-c',list('c1'));
 const all=JSON.parse(readFileSync(F,'utf8'));assert.deepEqual(Object.keys(all).sort(),['shop-a','shop-b','shop-c'])});

test.after(()=>{console.warn=origWarn});
