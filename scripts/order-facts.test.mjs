// Tests for app/order-facts.mjs (19 Nov 2026, the owner's testing report TS-3 to TS-9): what an order form says (pen, vial, premix), which
// after-payment parts fit it, the layout of a customer text, and the greeting check. Made-up orders only. Run: node --test scripts/order-facts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {orderFacts,afterPaidPicks,mixPart,tidyText,mediaKey,sameText,penLabel,templateCover,quizData} from '../app/order-facts.mjs';

test('orderFacts: pen or vial and premix come from the configuration line, else the items',()=>{
 assert.deepEqual(orderFacts('Nama: Budi\n• 1x Serum A Pen 10mg (cartridge premixed)\n- Konfigurasi: Pen: premixed cartridge\nTotal Pembayaran: Rp1'),{pen:true,vial:false,premix:true,selfMix:false});
 assert.deepEqual(orderFacts('1x Serum B 10mg (vial, dibantu premix)\nKonfigurasi: Vial: dibantu premix oleh tim'),{pen:false,vial:true,premix:true,selfMix:false});
 assert.deepEqual(orderFacts('1x Serum C 1mg (vial)\nKonfigurasi: Vial, mixing sendiri'),{pen:false,vial:true,premix:false,selfMix:true});
 assert.equal(orderFacts('1x Serum D 10mg + Reusable Pen, cartridge premixed\nKonfigurasi: Pen, cartridge premixed').pen,true,'a pen in a bundle');
 assert.equal(orderFacts('Alamat: Jl. Pena 5\n1x Serum E (vial)\nKonfigurasi: Vial').pen,false,'"pen" outside the items and the configuration does not count');
 assert.equal(orderFacts('1x Serum F (vial)\nKonfigurasi: Vial, tanpa pen').pen,false,'"tanpa pen" is no pen');
 assert.equal(orderFacts('').pen,false)});

const A={parts:['[REPLY: /paid]'],byLabel:[{match:'^S-Pen',parts:['[REPLY: /pen-tutor]','[VIDEO: Pen_tutorial.mp4]']},{unless:'^S-Pen',parts:['[REPLY: /x-mixing]','[VIDEO: How_to_mix_serums.mp4]','[VIDEO: Serum_mixing.mp4]']}]};
test('afterPaidPicks: a pen named on the form gets the pen messages even without the S-Pen label (TS-3)',()=>{
 assert.deepEqual(afterPaidPicks(A,{products:['S-Glow'],facts:orderFacts('- Konfigurasi: Pen: premixed cartridge')}),['[REPLY: /paid]','[REPLY: /pen-tutor]','[VIDEO: Pen_tutorial.mp4]']);
 assert.deepEqual(afterPaidPicks(A,{products:['S-Glow','S-Pen']}),['[REPLY: /paid]','[REPLY: /pen-tutor]','[VIDEO: Pen_tutorial.mp4]'],'the label alone, as before')});
test('afterPaidPicks: a premix order never gets a mixing tutorial; a self-mix vial order does (TS-4)',()=>{
 assert.deepEqual(afterPaidPicks(A,{products:['S-Balm'],facts:orderFacts('Konfigurasi: Vial: dibantu premix oleh tim')}),['[REPLY: /paid]']);
 assert.equal(afterPaidPicks(A,{products:['S-Balm'],facts:orderFacts('Konfigurasi: Vial, mixing sendiri')}).length,4);
 assert.equal(afterPaidPicks({...A,mixWhenPremix:true},{products:['S-Balm'],facts:orderFacts('Konfigurasi: Vial: dibantu premix')}).length,4,'a line may keep them on purpose');
 assert.deepEqual(afterPaidPicks({byLabel:[{match:'@premix',parts:['[REPLY: /premix-care]']}]},{facts:orderFacts('Konfigurasi: Vial: dibantu premix')}),['[REPLY: /premix-care]'],'the facts can be matched by name')});
test('mixPart: a quick reply or file that is a mixing tutorial, never "premix"',()=>{
 for(const x of ['[REPLY: /x-mixing]','[VIDEO: Brand_-_how_to_mix_serums.mp4]','[VIDEO: Glow_mixing.mp4]'])assert.equal(mixPart(x),true,x);
 for(const x of ['[REPLY: /cont-sudahbayar]','[VIDEO: premixed_pen.mp4]','plain text about mixing','[REPLY: /remix]'])assert.equal(mixPart(x),false,x)});

test('tidyText: points written inline each get their own line, a long text gets paragraphs, nothing else changes (TS-8, TS-9)',()=>{
 const flat='Baik Kak, terima kasih sudah berbelanja. Setelah paket diterima, mohon diperhatikan beberapa hal berikut: • Segera simpan produk di dalam chiller dengan suhu 2–8°C dan jangan di freezer, karena produk beku bisa rusak. • Jika masih ragu mengenai penyimpanan atau cara pakai, mohon jangan digunakan dulu dan tanyakan ke tim kami. • Apabila ada kendala atau pertanyaan selama program, silakan hubungi kami kapan saja ya kak.';
 const t=tidyText(flat);
 assert.match(t,/berikut:\n\n• Segera/);assert.match(t,/rusak\.\n\n• Jika/,'long points are separated by a blank line');
 assert.equal(t.replace(/\s+/g,' '),flat.replace(/\s+/g,' '),'only whitespace changed');
 assert.equal(tidyText('Halo kak\n• a\n• b\nOke'),'Halo kak\n\n• a\n• b\n\nOke','short points stay together');
 assert.equal(tidyText(tidyText(flat)),tidyText(flat),'a tidy text stays as it is');
 assert.equal(tidyText('Total *Rp1.500.000*, sudah termasuk ongkir.'),'Total *Rp1.500.000*, sudah termasuk ongkir.');
 const wall=Array.from({length:8},(_,i)=>'Kalimat nomor '+(i+1)+' menjelaskan satu hal penting tentang produk ini dengan cukup panjang.').join(' ');
 assert.ok(tidyText(wall).includes('\n\n'),'a wall of text is cut into paragraphs at sentence ends');
 assert.equal(tidyText('*Rekomendasi utama*\nProduk A\n*Opsi kombinasi*\nProduk B'),'*Rekomendasi utama*\nProduk A\n\n*Opsi kombinasi*\nProduk B','a blank line before each bold heading')});

test('mediaKey and sameText: what counts as the same video or text again (TS-5)',()=>{
 assert.equal(mediaKey('[VIDEO: Glow_mixing.mp4]'),mediaKey('[VIDEO: media/staff/Glow_mixing]'));
 assert.equal(mediaKey('[VIDEO: https://media.example/lib/a/Clip_-_One.mp4?x=1]'),'video:clip_-_one');
 assert.equal(mediaKey('[FOTO: qris-1.png]'),null,'pictures are not counted: a QRIS is sent again on purpose');
 const long='Untuk tutorial mixing silakan cek video berikut ya kak, di video dijelaskan langkah demi langkah cara mencampur dan menarik dosis dengan benar.';
 assert.equal(sameText(long,long.toUpperCase()+'  '),true);assert.equal(sameText('oke kak','oke kak'),false,'a short text is never a repeat')});

test('penLabel and the greeting check',()=>{
 assert.equal(penLabel(['S-Glow','S-Pen']),'S-Pen');assert.equal(penLabel(['S-Glow']),null);
 const tpl='# Greeting\nHalo kak, perkenalkan saya {nama} dari tim konsultan serum. Boleh banget kalau mau tanya seputar produk kami. Supaya rekomendasinya relevan, boleh lengkapi informasi berikut: usia, tinggi badan, berat badan, tujuan utama.';
 assert.ok(templateCover('Ready ya kak. Halo kak, perkenalkan saya Sam dari tim konsultan serum. Boleh banget kalau mau tanya seputar produk kami. Supaya rekomendasinya relevan, boleh lengkapi informasi berikut: usia, tinggi badan, berat badan, tujuan utama.',tpl)>0.9);
 assert.ok(templateCover('Halo kak, boleh banget, silakan tanya soal serum. Mau cari info yang mana?',tpl)<0.4,'a greeting of its own');
 assert.equal(templateCover('apa saja','halo kak'),null,'too short to tell');
 assert.equal(quizData('Nama: A\nUsia: 30\nTinggi: 170\nTujuan: turun berat'),true);assert.equal(quizData('halo kak mau tanya'),false)});
