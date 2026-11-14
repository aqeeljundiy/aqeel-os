// the customer's history for whoever takes over (app/customer-history.mjs, 14 Nov 2026). node --test scripts/customer-history.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {customerOrders,historyText,customerHistory} from '../app/customer-history.mjs';
const FIELDS=[{key:'past_use',label:'Past use'},{key:'setup',label:'Setup'}];
async function data(rows){const D=await mkdtemp(path.join(tmpdir(),'ch-'));await writeFile(path.join(D,'payments.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');return D}
const row=(at,o={})=>({agent:'cove-support',phone:'628100000001',ok:true,at,total:500000,products:['Widget'],context:{past_use:'Widget once a day',setup:'not asked'},...o});

test('earlier paid orders of this customer on this line, newest first; other customers, lines, failures and later ones left out',async()=>{
 const D=await data([row('2026-11-01T10:00:00Z',{products:['Kit A']}),row('2026-11-03T10:00:00Z',{products:['Kit B']}),row('2026-11-04T10:00:00Z',{ok:false}),
  row('2026-11-05T10:00:00Z',{phone:'628199999999'}),row('2026-11-06T10:00:00Z',{agent:'other'}),row('2026-11-09T10:00:00Z',{products:['Now']})]);
 const l=await customerOrders(D,'cove-support','+62 8100-0000-01',{before:Date.parse('2026-11-09T10:00:00Z')});
 assert.deepEqual(l.map(p=>p.products[0]),['Kit B','Kit A'])});

test('the text: date, total, products and the answers the line asks for; the line\'s "not asked" word is no answer',()=>{
 const t=historyText([row('2026-11-03T10:00:00Z',{orderTotal:955000,testAmount:true,total:10000})],{currency:'Rp',fields:FIELDS,missing:'not asked'});
 assert.match(t,/Earlier orders \(1\):\n- 2026-11-03 \(test\), Rp 955,000, Widget\n  Past use: Widget once a day/);assert.doesNotMatch(t,/Setup: not asked/);
 assert.equal(historyText([]),'Earlier orders: none on this line.')});

test('no file, no number: no history, no error',async()=>{assert.equal(await customerHistory(await mkdtemp(path.join(tmpdir(),'ch-')),'a','628'),'Earlier orders: none on this line.');
 assert.deepEqual(await customerOrders(await data([row('2026-11-01T10:00:00Z')]),'cove-support',''),[])});
