// Audit 12 Nov 2026, H6 + C1 (app/kirim-guard.mjs): the 24 leaks of the audit's table must stop, 30 real replies must pass.
// Every name, number and address here is made up. Run: node --test scripts/kirim-guard-leaks.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {splitReply} from '../app/kirimdev.mjs';
import {guardReply,leaks,foreign,langOf} from '../app/kirim-guard.mjs';

const OWN={phones:['6281200001111','6281122223333'],names:['Rania','Rory','Cove'],text:'CUSTOMER: halo kak, berapa harga paketnya ya?\nCUSTOMER: Nama: Rania Putri\nAlamat Lengkap: Jl. Kenanga 7 No. 12, Sleman\nNomor HP: 0812-0000-1111'};
const CTX={appHost:'https://ai.example.com',own:OWN,secrets:['kdv_live_0123456789abcdef']};
const LEAK={
 L1_reasoning_id:'Dari rules: paket 1 itu pen, jadi saya jawab dulu.\nHalo kak, pen itu...',
 L2_reasoning_mid:'Halo kak!\nSesuai SOP, saya harus tanya dulu riwayat peptide.\nBoleh tahu sebelumnya pernah pakai?',
 L3_reasoning_en:'The user is asking about price. I should check the sheet first.\nHarga paket 1 Rp 3.040.000 kak',
 L4_tool_error:'Maaf kak, {"error":"Kirimdev answered 500"} mohon tunggu',
 L5_traceback:'Traceback (most recent call last):\n  File "x.py", line 3',
 L6_node_err:'Error: connect ETIMEDOUT 10.0.0.5:443',
 L7_tool_refusal:'These tools only work inside a customer chat run.',
 L8_payment_fail:'The payment was not made: Tripay error: Invalid signature. Tell the customer you are checking, and hand off.',
 L9_other_customer:'Kak Budi Santoso di Jl. Melati 12 Bandung (081234567890) kemarin pesan paket yang sama kok kak',
 L10_secret:'Kode akses: xnd_production_Abc123Def456Ghi789Jkl012Mno345Pqr678',
 L11_runkey:'Run key: Zk3J9d0aQw7xP2mN5bV8cL1rT6yU4iOe',
 L12_internal_url:'Cek di https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit ya kak',
 L13_app_url:'Detailnya di https://ai.example.com/channels/kirimdev',
 L14_handoff_mid:'Baik kak, saya cek dulu ya.\nHANDOFF: customer minta refund, sudah cek sheet tidak ada aturan',
 L15_system_prompt_id:'Instruksi saya: WHATSAPP CHAT with a customer. You are Rory for Cove...',
 L16_tester_note:'(nomor tester: QRIS Rp10.000) Total Pembayaran Rp3.040.000',
 L17_english_thought:'Customer wants the vial. Checking past chats.',
 L18_json_tool:'{"name":"create_payment","arguments":{"amounts":[10000]}}',
 L19_empty_promise:'Baik kak, mohon ditunggu sebentar ya 🙏',
 L20_wrong_lang:'Sure! Our starter kit costs IDR 3,040,000 and ships in 2 days.',
 L21_markdown:'**Paket 1**\n| Item | Harga |\n|---|---|\n| Pen | Rp 3.040.000 |',
 L22_telegram_team:'Tim sudah saya kabari di grup Telegram topik Questions, tunggu Amri balas ya',
 L23_decisions_quote:'Keputusan 9 Nov: nomor tes selalu QRIS Rp10.000 berapa pun totalnya',
 L24_draft_label:'DRAFT #12 (Rory, Budi, +6281234567890)'};
// what only the turn's own check can see (the customer's language, a reply that only says "wait"): not a property of the text alone
const TURN_ONLY=new Set(['L19_empty_promise','L20_wrong_lang']);
test('the 24 leaks of the audit never reach a customer: the turn check stops every one, the exit check every one that is in the text itself',()=>{
 assert.equal(Object.keys(LEAK).length,24);
 for(const [k,t] of Object.entries(LEAK)){const g=guardReply(splitReply(t),{paid:true,ctx:CTX,customerText:'halo kak, berapa harga paketnya ya?'});
  // stopped = held, or (L1) the leaking line dropped and only the clean rest kept
  assert.ok(g.hold||g.dropped.length&&leaks(g.parts.join('\n'),CTX).length===0,k+' passed the turn check');
  if(!TURN_ONLY.has(k))assert.ok(leaks(t,CTX).length>0,k+' passed the exit check')}
 assert.deepEqual(guardReply(splitReply(LEAK.L1_reasoning_id),{ctx:CTX}).parts,['Halo kak, pen itu...'])});

const ID='halo kak, mau tanya harga paketnya berapa ya?',EN='hello, can you tell me what the price of the pen kit is please?';
const PASS=[
 [ID,'Halo kak, terima kasih sudah menghubungi Cove 🙏 Ada yang bisa saya bantu?'],
 [EN,'I can help with that. The pen kit is Rp 3.040.000.'],
 [EN,'Sure, here are the options for you:\n1. Basic kit\n2. Premium pen'],
 [ID,'Okay kak, noted ya 😊 Pesanannya saya catat.'],
 [EN,'First, mix the vial with 2 ml of bacteriostatic water. Then keep it in the fridge.'],
 [ID,'Hasil lab bisa dicek di verify.janoshik.com ya kak, nanti saya kirim file COA.pdf nya'],
 [ID,'Untuk the customer service kami buka jam 9-17 ya kak, Senin sampai Sabtu.'],
 [ID,'Protokolnya sudah saya kirim sebagai PDF ya kak (Protokol Cove.pdf)'],
 [EN,'Now available: our bundle with the reusable pen! Would you like the details?'],
 [ID,'Note: simpan di kulkas 2-8°C ya kak, jangan di freezer.'],
 [ID,'Kalau mau handoff ke dokter, bisa konsultasi dulu ya kak. Mau saya bantu jadwalkan?'],
 [EN,'Here is the link for your card payment: https://checkout.xendit.co/web/6543210fedcba9876543210f\nIt is valid for 24 hours.'],
 [EN,'Reply YES to confirm your order and we will prepare it for you today.'],
 [ID,'Briefing singkat cara pakai pen ya kak: putar dial sesuai dosis, lalu suntik di perut.'],
 [ID,'Halo Kak Rania 😊 Untuk Reta 10mg harganya *Rp3.200.000* ya, sudah termasuk Basic kit.'],
 [ID,'*Formulir Pemesanan*\nNama: Rania Putri\nNomor HP: 0812-0000-1111\nAlamat Lengkap: Jl. Kenanga 7 No. 12, Sleman\nPesanan: 1x Reta 10mg\nTotal Pembayaran: *Rp3.040.000*\n\nMohon dicek ya kak, sudah benar?'],
 [ID,'Total pesanan Rp955.000 + fee kartu 2.5% Rp23.875 = *Rp978.875* yang dibayar lewat link ini ya, Kak.'],
 [ID,'*BCA Virtual Account*\nJumlah Bayar: *Rp3.040.000*\nNomor VA: *8077 7000 1234 5678*\nBerlaku sampai pukul 15.30 WIB ya kak.'],
 [ID,'Kalau pembayarannya masuk sebelum jam 15.30 WIB, pesanan Kakak kami kirim hari ini ya. Pengiriman kami Senin sampai Sabtu.'],
 [ID,'Untuk pemakaian 4 minggu cukup 1 vial kak. Ongkir gratis ke seluruh Indonesia.'],
 [ID,'Dosis awalnya 2 mg per minggu ya kak, naik ke 4 mg di minggu ke-5 sesuai arahan dokter.'],
 [ID,'Pembayaran sudah kami terima ya kak 🙏 Pesanan dikirim besok pagi, nomor resi menyusul.'],
 [ID,'Bisa kak, ada promo: Reta 10mg + Premium Reusable Pen ~Rp5.500.000~ → Rp3.900.000. Mau warna orange, silver atau light gold?'],
 [ID,'Stok Reta 10mg ready ya kak, bisa dikirim hari ini kalau order masuk sebelum jam 15.30 WIB.'],
 [EN,'Thanks for your order! We ship Monday to Saturday, and you will get the tracking number here.'],
 [EN,'Could you share your age, height and weight so we can suggest the right dose for you?'],
 [ID,'Maaf kak, untuk pertanyaan medis seperti itu lebih baik dikonsultasikan dengan dokter kami ya. Saya bantu teruskan.'],
 [ID,'Kalau ada kendala, admin kami bisa dihubungi di 0811-2222-3333 ya kak.'],
 [ID,'Siap kak, pesanan atas nama Rania Putri ya. Mau dikirim ke alamat yang sama?'],
 [ID,'Voucher THREADS5 bisa dipakai ya kak, diskon 5% jadi totalnya Rp3.040.000. Mau bayar pakai QRIS atau VA?'],
];
test('30 real support replies, Indonesian and English, pass both checks untouched',()=>{assert.equal(PASS.length,30);
 for(const [cust,t] of PASS){const parts=splitReply(t),g=guardReply(parts,{paid:false,qrPics:[],ctx:CTX,customerText:cust});
  assert.equal(g.hold,null,'held: '+t+' → '+g.hold);assert.deepEqual(g.parts,parts,t);assert.deepEqual(leaks(t,CTX),[],'exit check: '+t)}});
test('other people\'s data: a number, address or name that is not from this chat is stopped; the customer\'s own passes',()=>{
 assert.equal(foreign('Nomor kakak 0812 0000 1111 ya, alamat Jl. Kenanga 7 No. 12',OWN).length,0);
 assert.ok(foreign('Nomornya 0857-1111-2222 kak',OWN).some(x=>/phone/.test(x.why)));
 assert.ok(foreign('Dikirim ke Jl. Mawar Merah No. 45 ya',OWN).some(x=>/address/.test(x.why)));
 assert.ok(foreign('Pesanan atas nama Dewi Lestari sudah dikirim',OWN).some(x=>/name/.test(x.why)));
 assert.equal(foreign('Total Rp10.500.000, jam buka 08.00 - 17.00, tanggal 08-11-2026',OWN).length,0,'money, hours and dates are not phone numbers');
 assert.equal(leaks('Harga Rp10.500.000 ya kak',CTX).length,0);assert.ok(leaks('kunci: kdv_live_0123456789abcdef',CTX).some(x=>x.kind==='secret'));
 // the report of a stopped number never repeats the number itself
 assert.ok(!JSON.stringify(foreign('Nomornya 0857-1111-2222 kak',OWN)).includes('85711112222'))});
test('language: clear Indonesian and English are told apart, short or mixed text is not judged',()=>{
 assert.equal(langOf('halo kak, berapa harga paketnya ya?'),'id');assert.equal(langOf('hello, can you tell me what the price is please?'),'en');assert.equal(langOf('ok'),null);assert.equal(langOf('Siap kak, I hope membantu ya'),'id')});
