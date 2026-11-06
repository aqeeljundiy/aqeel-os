import test from 'node:test';import assert from 'node:assert/strict';
import {splitReply,guardReply} from '../app/kirimdev.mjs';
test('team notes and image descriptions never reach the customer',()=>{
 const g=guardReply(splitReply('Halo kak, ini rekomendasinya.\n[Gambar: Package 1 - Basic Kit]\nCatatan untuk tim (tidak dikirim ke customer): cek stok\n---\n[FOTO: Continue_pen_kit.jpeg]'));
 assert.deepEqual(g.parts,['Halo kak, ini rekomendasinya.','[FOTO: Continue_pen_kit.jpeg]']);assert.equal(g.removed.length,2);assert.equal(g.hold,null)});
test('a QRIS promise without the picture is held',()=>{
 const g=guardReply(splitReply('Siap kak, totalnya Rp5.700.000.\n---\nBerikut kami kirimkan QRIS untuk pembayarannya.'));assert.ok(g.hold)});
test('a QRIS with its picture goes out',()=>{
 const g=guardReply(splitReply('Berikut QRIS-nya kak\n[FOTO: qris_T123.png]'));assert.equal(g.hold,null);assert.equal(g.parts.length,2)});
test('normal sales text is untouched',()=>{
 const t='*Main Recommendation*\n*Retatrutide 10mg*\n~Rp4.000.000~ → Rp3.200.000';assert.deepEqual(guardReply(splitReply(t)).parts,[t])});
