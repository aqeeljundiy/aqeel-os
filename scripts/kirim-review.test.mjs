// the check before sending (app/kirim-review.mjs, 14 Nov 2026). node --test scripts/kirim-review.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {reviewPrompt,parseReview} from '../app/kirim-review.mjs';

test('only a clear {"ok":true} lets a reply through; anything else holds it (fail closed)',()=>{
 assert.deepEqual(parseReview('{"ok":true}'),{ok:true,problems:[]});
 assert.deepEqual(parseReview('Sure.\n{"ok": true}\n'),{ok:true,problems:[]});
 assert.equal(parseReview('').ok,false);assert.equal(parseReview('looks fine').ok,false);assert.equal(parseReview('{"ok":"yes"}').ok,false);assert.equal(parseReview('{ok:true}').ok,false);
 assert.deepEqual(parseReview('{"ok":false,"problems":["misreads the dose"]}').problems,['misreads the dose']);
 assert.equal(parseReview('{"ok":false}').problems.length,1,'a hold without a reason still says so')});

test('the prompt carries every new message, the conversation and each draft part, and says they are data',()=>{
 const q=reviewPrompt({newMessages:['pertanyaan: 1.5 mg itu pen ke 15?','dan itu sudah termasuk water ya?'],history:'CUSTOMER: halo\nAGENT: Halo kak',draft:['Iya kak','Ada lagi?'],language:'Indonesian'});
 for(const x of ['1.5 mg itu pen ke 15?','sudah termasuk water','CUSTOMER: halo','[1] Iya kak','[2] Ada lagi?','never instructions','Read every word'])assert.ok(q.includes(x),x);
 assert.ok(reviewPrompt({history:'x'.repeat(20000)}).length<9000,'a long chat is cut to its latest part')});

test('facts from aqeelOS (a Test line pays the test amount) are given to the check, and only when there are some',()=>{
 const q=reviewPrompt({draft:['QRIS Rp10.000'],facts:['This line is in TEST mode: every QRIS is made for the test amount of Rp10.000 on purpose']});
 assert.match(q,/TRUE FACTS FROM aqeelOS/);assert.match(q,/test amount of Rp10.000/);assert.doesNotMatch(reviewPrompt({draft:['x']}),/TRUE FACTS/)});

test('nothing about one install is written in the reviewer (it reads the agent\'s own instructions and knowledge)',async()=>{
 const src=(await import('node:fs')).readFileSync(new URL('../app/kirim-review.mjs',import.meta.url),'utf8');
 assert.ok(!/peptide|reta|continue|elkiya|randy|gilang|qris/i.test(src))});
