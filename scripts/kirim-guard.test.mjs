import test from 'node:test';import assert from 'node:assert/strict';
import {splitReply,guardReply,internalText} from '../app/kirimdev.mjs';
const held=t=>{const g=guardReply(splitReply(t));assert.ok(g.hold&&g.removed.length,'should hold: '+t);return g};
test('team notes and image descriptions hold the whole reply',()=>{
 {const g=guardReply(splitReply('Halo kak, ini rekomendasinya.\n[Gambar: Package 1 - Basic Kit]\n---\n[FOTO: Cove_pen_kit.jpeg]'));assert.equal(g.hold,null);assert.deepEqual(g.parts,['Halo kak, ini rekomendasinya.','[FOTO: Cove_pen_kit.jpeg]'])}   // only a note: dropped, the rest goes out
 held('Halo kak.\nCatatan untuk tim (tidak dikirim ke customer): cek stok');held('Halo kak (test mode) ya')});
test('english reasoning before the reply is held',()=>{
 held("I read the Rules tab and this doesn't need a handoff.\n\nHalo kak, untuk Product A 10mg harganya Rp3.200.000 ya.");
 held('Halo kak.\nBased on the decisions file, promo applies.');held('Let me check.\n---\nHalo kak');held('Halo kak, cek KITS.md dulu')});
test('leading operator preambles are dropped without losing the customer reply',()=>{
 const reply='Pertanyaan penting kak, kami bantu cek ya.';
 for(const prefix of ['Ini balasan yang saya siapkan. Saya belum mengirim apa pun:', 'Saya belum mengirim apa pun:', 'Here is the reply:', 'Draft reply:', "I haven't sent anything:"]){
  for(const separator of ['\n\n','\n---\n']){
   const g=guardReply(splitReply(prefix+separator+reply));
   assert.equal(g.hold,null,prefix);assert.deepEqual(g.parts,[reply]);assert.deepEqual(g.dropped,[prefix]);
  }
 }
 assert.ok(guardReply(splitReply('Ini balasan yang saya siapkan. Saya belum mengirim apa pun:')).hold);
 for(const text of ['Balasan yang saya siapkan untuk pertanyaan kakak sudah lengkap.', 'Kak, saya belum mengirim pesanan karena alamat belum lengkap.']){
  assert.deepEqual(guardReply(splitReply(text)).parts,[text]);
 }
 held('Halo kak.\nIni balasan yang saya siapkan:');
});
test('a QRIS promise without the picture is held',()=>{
 const g=guardReply(splitReply('Siap kak, totalnya Rp5.700.000.\n---\nBerikut kami kirimkan QRIS untuk pembayarannya.'));assert.ok(g.hold);assert.equal(g.removed.length,0)});
test('a QRIS with its picture goes out',()=>{
 const g=guardReply(splitReply('Berikut QRIS-nya kak\n[FOTO: qris_T123.png]'));assert.equal(g.hold,null);assert.equal(g.parts.length,2)});
test('normal sales text is untouched',()=>{
 for(const t of['*Main Recommendation*\n*Product A 10mg*\n~Rp4.000.000~ → Rp3.200.000','Halo kak, terima kasih sudah menghubungi Baylabs 😊\nBoleh tahu usia, tinggi dan berat badan kakak?','Untuk pemakaian 4 minggu cukup 1 vial kak. Ongkir gratis ke seluruh Indonesia.','Siap kak, I hope membantu ya'])
 {const g=guardReply(splitReply(t));assert.equal(g.hold,null,t);assert.deepEqual(g.parts,[t])}});
test('an order form that lists QRIS as a payment option is not held',()=>{
 const t='Berikut order formnya kak:\n*Formulir Pemesanan*\nMetode Pembayaran (pilih salah satu):\n• QRIS (maks. Rp5.000.000)\n• Virtual account';
 assert.equal(guardReply(splitReply(t)).hold,null)});
test('saying the QRIS is here without the picture is still held',()=>{
 assert.ok(guardReply(splitReply('Siap kak, berikut QRIS-nya ya, berlaku 30 menit.')).hold)});

test('a reply that says a payment was sent needs a payment made in this run (7 Nov 2026)',async()=>{const {guardReply}=await import('../app/kirimdev.mjs');
 const held=(t,paid)=>!!guardReply([t],{paid}).hold;
 for(const t of ['QRIS sudah saya kirim ya kak','Link pembayaran berikut ya kak','Berikut nomor VA BCA kakak','Invoice sudah kami kirimkan ke WhatsApp kakak'])assert.equal(held(t,false),true,t);
 for(const t of ['Silakan pilih metode pembayaran: QRIS atau VA','Terima kasih kak, pesanan dicatat','Mau bayar pakai QRIS atau transfer VA kak?'])assert.equal(held(t,false),false,t);
 assert.equal(held('QRIS sudah saya kirim ya kak',true),false);assert.equal(held('Nomor VA BCA sudah terkirim',null),false)});
test('a QRIS promise without its tag gets the picture this run made, not a hold (i49f4e694)',()=>{
 const g=guardReply(['Berikut QRIS untuk pembayaran kakak ya'],{paid:true,qrPics:['[FOTO: qris-BM-1-1.png]']});
 assert.equal(g.hold,null);assert.deepEqual(g.parts,['Berikut QRIS untuk pembayaran kakak ya','[FOTO: qris-BM-1-1.png]']);
 assert.ok(guardReply(['Berikut QRIS untuk pembayaran kakak ya'],{paid:false,qrPics:[]}).hold)});

test('asking which payment method is not a payment claim (i1b25ec10)',()=>{
 assert.equal(guardReply(['Pembayarannya mau pakai QRIS, Virtual Account, kartu debit/kredit, atau Alfamart/Indomaret?'],{paid:false}).hold,null);
 for(const x of ['Siap Kak, pakai QRIS ya. Form ordernya saya kirim di bawah ini, mohon dicek dulu.','Bisa pakai QRIS atau VA kak, nanti setelah form dikonfirmasi saya kirimkan ya. Mau yang mana?','Oke Kak, pembayaran via Virtual Account ya. Sebelum saya kirimkan, mohon konfirmasi form order berikut:'])assert.equal(guardReply(splitReply(x),{paid:false,qrPics:[]}).hold,null,x);
 assert.ok(guardReply(['Berikut QRIS-nya ya kak, berlaku sampai 15:00.'],{paid:false,qrPics:[]}).hold)});
test('loose photo tags become real picture tags, never text (11 Nov 2026, taken into git from fixer issue ie54d1284)',()=>{
 for(const [t,want] of [['[kirim foto nt_kit_basic]','[TEMPLATE: nt_kit_basic]'],['[foto nt_kit_basic]','[TEMPLATE: nt_kit_basic]'],['[send photo kit.jpg]','[FOTO: kit.jpg]'],['[Gambar: Kit.jpeg]','[FOTO: Kit.jpeg]']]){
  const g=guardReply(splitReply('Ini paketnya kak\n'+t));assert.equal(g.hold,null,t);assert.deepEqual(g.parts,['Ini paketnya kak',want])}
 assert.ok(guardReply(['[tolong kirim foto paket ya]']).hold);
 {const g=guardReply(splitReply('Ini paketnya kak\n[tolong kirim foto paket ya]\n[FOTO: kit.jpg]'));assert.equal(g.hold,null);assert.deepEqual(g.parts,['Ini paketnya kak','[FOTO: kit.jpg]']);assert.deepEqual(g.dropped,['[tolong kirim foto paket ya]'])}});
test('leading rule quotes and plans are dropped; reasoning-only is held (i5e349bf6, taken from the box drift)',()=>{
 const r='Halo kak, pen itu sekali pakai dan vial perlu dilarutkan dulu ya.';
 const lead='Dari rules: Paket 1 = Basic Kit\nPertanyaan pertama adalah soal produk, jadi saya jawab dulu, lalu minta data profil.';
 const g=guardReply(splitReply(lead+'\n\n'+r));assert.equal(g.hold,null);assert.deepEqual(g.parts,[r]);
 assert.ok(guardReply(splitReply(lead)).hold);
 for(const x of ['Rules: Paket 1','Aturannya: tanya dulu','Thinking: jawab']){assert.equal(guardReply(splitReply(x+'\n\n'+r)).hold,null)}
 assert.deepEqual(guardReply(splitReply('Saya akan cek stok dulu ya kak.')).parts,['Saya akan cek stok dulu ya kak.']);
});
test('internalText: notes, reasoning and error traces are caught, ordinary sales text is not',()=>{
 for(const t of ['Dari rules: x','Catatan untuk tim: cek','Draft reply:','Traceback (most recent call last):\n  File "x.py", line 3','TypeError: Cannot read properties of undefined','    at foo (/app/server.mjs:12:3)','Halo kak\n(test mode) ya'])assert.equal(internalText(t),true,t);
 for(const t of ['Halo kak, pesanannya sudah kami catat ya 😊','Total Rp3.200.000, transfer ke QRIS di bawah','Saya akan cek stok dulu ya kak.'])assert.equal(internalText(t),false,t)});

test('round 18 leaked notes are dropped, the answer stays (13 Nov 2026)',()=>{
 const cases=[['Strike-through = 1.25 x 900.000 = 1.125.000.','Halo kak, untuk BPC-157 5mg harganya ~Rp1.125.000~ *Rp900.000*.'],
  ['Product dan jumlah suntikan belum diketahui, jadi saya tanya dulu.','Halo Kak, boleh tahu Kakak pakai produk apa dan ini suntikan yang ke berapa?'],
  ["Product and injection count aren't known yet, so I ask that first. The reply also includes the safety line for the reaction.",'Kak, boleh tahu dulu ini habis suntik produk apa?']];
 for(const [lead,r] of cases){const g=guardReply(splitReply(lead+'\n\n'+r));assert.equal(g.hold,null,lead);assert.deepEqual(g.parts,[r],lead)}
 for(const ok of ['Boleh saya tanya dulu, Kakak pakai produk apa?','Harga coret Rp1.125.000, sekarang Rp900.000 ya kak.','Total Rp3.710.000 ya kak.'])assert.deepEqual(guardReply(splitReply(ok)).parts,[ok],ok);
});
