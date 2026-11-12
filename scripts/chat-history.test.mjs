// Past chats never hand one customer's words or details to another (audit 12 Nov 2026, C1). All data here is made up.
// Run: node --test scripts/chat-history.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createChatHistory,mask,searchAnswers,searchMine,parseLines,namesIn} from '../app/chat-history.mjs';

const L=(c,dir,x,at)=>JSON.stringify({conversation_id:c,direction:dir,content:x,created_at:at});
const FORM='Nama: Dewi Lestari\nEmail: dewi.lestari@example.com\nNomor HP: 0812-0000-2222\nAlamat Lengkap: Jl. Mawar Merah No. 45, RT 03/RW 07, Bandung 40123\nPesanan: 1x Reta 10mg\nTotal Pembayaran: Rp3.040.000';
const FILE=[
 L('cnv_other','inbound','Halo kak, saya Dewi. Alamat lengkap saya Jl. Mawar Merah No. 45 Bandung, dosis 2 mg aman untuk diabetes saya?','2026-10-01T02:00'),
 L('cnv_other','outbound','Halo Kak Dewi 😊 Untuk dosis awal 2 mg per minggu ya, sebaiknya konsultasi dokter dulu untuk kondisi diabetes.','2026-10-01T02:01'),
 L('cnv_other','inbound',FORM,'2026-10-01T02:05'),
 L('cnv_other','outbound','Terima kasih kak, berikut order formnya:\n'+FORM+'\nSudah benar ya?','2026-10-01T02:06'),
 L('cnv_other','outbound','Paket untuk Dewi Lestari dikirim ke Jl. Mawar Merah No. 45, RT 03/RW 07, kurir akan hubungi 0812-0000-2222 atau dewi.lestari@example.com, resi 12345678901','2026-10-01T03:00'),
 L('cnv_other2','inbound','1 vial berapa cartridge kak?','2026-10-02T01:00'),
 L('cnv_other2','outbound','1 vial = 2 cartridge ya kak, harganya Rp3.200.000','2026-10-02T01:01'),
 L('cnv_mine','inbound','Kemarin saya tanya soal pen, alamat saya Jl. Kenanga 7','2026-10-03T01:00'),
 L('cnv_mine','outbound','Pen bisa dipakai ulang ya kak','2026-10-03T01:01'),
].join('\n');
async function make(){const d=await mkdtemp(path.join(tmpdir(),'ch-'));await writeFile(path.join(d,'a.jsonl'),FILE);
 await writeFile(path.join(d,'chat-history.json'),JSON.stringify({agents:{a1:{files:[path.join(d,'a.jsonl')]}}}));return createChatHistory({DATA:d,log:()=>{}})}
const PRIVATE=[/Dewi/,/Lestari/,/Mawar/,/0812-0000-2222/,/81200002222/,/example\.com/,/RT 03/,/40123/,/12345678901/,/diabetes saya/,/Alamat Lengkap:/i,/Nomor HP:/i];

test('a search across other chats returns the team\'s answers only: no customer text, no names, numbers, addresses or forms',async()=>{const h=await make();
 for(const q of ['alamat','Alamat Lengkap','dewi','dosis diabetes','nama email','0812 0000','081234567890','mawar','paket dikirim']){const r=await h.find('a1',q,{limit:15});
  const body=r.text.split('\n\n').slice(1).join('\n\n');   // after the first line, which repeats the words searched for
  for(const p of PRIVATE)assert.doesNotMatch(body,p,'query "'+q+'" leaked '+p);
  assert.doesNotMatch(r.text,/CUSTOMER:/,q);assert.ok(!/\d{8,}/.test(r.text.replace(/\D*\d{4}-\d{2}\D/g,' ')),'a long digit run for "'+q+'"')}
 // the answer to a customer's question is found by the question's words, without the question
 const r=await h.find('a1','dosis diabetes');assert.match(r.text,/TEAM: Halo Kak 😊 Untuk dosis awal 2 mg per minggu/);
 const c=await h.find('a1','vial cartridge');assert.match(c.text,/1 vial = 2 cartridge ya kak, harganya Rp3\.200\.000/);assert.doesNotMatch(c.text,/berapa cartridge kak\?/);assert.equal(c.total,1)});
test('the default for a customer run is that customer\'s own chat, by the run\'s conversation id; another chat is never in it',async()=>{const h=await make();
 const r=await h.find('a1','pen',{scope:'mine',conversation:'cnv_mine'});assert.match(r.text,/THIS customer's own earlier chat/);assert.match(r.text,/CUSTOMER: Kemarin saya tanya soal pen, alamat saya Jl\. Kenanga 7/);assert.match(r.text,/TEAM: Pen bisa dipakai ulang/);
 for(const p of PRIVATE.slice(0,6))assert.doesNotMatch(r.text,p);
 const all=await h.find('a1','',{scope:'mine',conversation:'cnv_mine'});assert.equal(all.total,2);
 const none=await h.find('a1','alamat',{scope:'mine',conversation:'cnv_new'});assert.match(none.text,/no earlier chat/);for(const p of PRIVATE)assert.doesNotMatch(none.text,p);
 assert.match((await h.find('a1','alamat',{scope:'mine'})).text,/no conversation to look up/)});
test('mask: forms, numbers, e-mail, street addresses and names go; prices, doses and product facts stay',()=>{
 assert.equal(mask(FORM),"[a customer's filled form, hidden]");
 const t=mask('Halo Kak Budi, paket dikirim ke Jl. Melati 12 Bandung, hubungi 0812-3456-7890 atau budi@example.com. Harga Rp3.200.000, dosis 2 mg, 1 vial = 2 cartridge.',['Budi']);
 for(const p of [/Budi/,/Melati/,/0812/,/example\.com/])assert.doesNotMatch(t,p);for(const p of [/Rp3\.200\.000/,/2 mg/,/1 vial = 2 cartridge/,/Halo Kak,/])assert.match(t,p);
 assert.equal(mask('Baik Kak Untuk pemakaian 4 minggu cukup 1 vial'),'Baik Kak Untuk pemakaian 4 minggu cukup 1 vial','a capitalised word after Kak is not a name');
 assert.match(mask('Nama: Rania\nStok ready ya kak'),/\[personal detail, hidden\]\nStok ready/);
 assert.deepEqual(namesIn(parseLines(L('c','inbound','Nama Lengkap: *Dewi Lestari*','2026-01-01'))),['Dewi','Lestari'])});
test('the pure searches: an inbound match gives the answers that follow it; only the asked conversation is "mine"',()=>{const msgs=parseLines(FILE);
 const a=searchAnswers(msgs,'cartridge');assert.equal(a.hits.length,1);assert.ok(!('context' in a.hits[0]));
 assert.equal(searchMine(msgs,'pen','cnv_mine').hits.length,2);assert.equal(searchMine(msgs,'pen','cnv_other').hits.length,0);assert.equal(searchMine(msgs,'x','nope').none,true)});
