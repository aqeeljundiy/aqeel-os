// Tests for what a customer gets on a Kirimdev line (19 Nov 2026, the owner's testing report and the server review): after-payment messages that
// fit the order (TS-3 pen, TS-4 premix), nothing sent twice (TS-5), a video given by its link (CH-3), the greeting template on a new lead's
// first reply (TS-7), and the layout of a text (TS-8, TS-9). Made-up line, numbers and texts. Run: node --test scripts/kirimdev-chats.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createKirimdev,linkIn} from '../app/kirimdev.mjs';

const SECRET='whsec_test_456',A='cove-support';
const LABELS=['New Leads','Checkout','Customer','S-Glow','S-Pen','S-Balm'];
const lid=n=>'lbl_'+n.replace(/\W/g,'').toUpperCase().padEnd(26,'0').slice(0,26);
const sign=(raw,t=Math.floor(Date.now()/1000))=>'t='+t+',v1='+createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
const meta=(from,text,conv='cnv_A')=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'111111'},contacts:[{wa_id:from,profile:{name:'Rania'}}],messages:[{from,id:'wamid.'+Math.random(),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}],kirim:{conversation_id:conv}});
const QR=['# Quick replies','## paid (/paid)','Pembayaran diterima kak. Setelah paket diterima, mohon diperhatikan: • Simpan di chiller 2–8°C dan jangan di freezer karena produk beku bisa rusak dan tidak bisa diganti. • Jika ragu cara pakai, jangan digunakan dulu dan tanyakan ke tim kami ya kak.','','## pen (/pen-tutor)','Cara pakai pen ada di video berikut ya kak.','','## mixing (/x-mixing)','Cara mixing ada di video berikut ya kak.',''].join('\n');
const AFTER={parts:['[REPLY: /paid]'],byLabel:[{match:'^S-Pen',parts:['[REPLY: /pen-tutor]','[VIDEO: Pen_tutorial.mp4]']},{unless:'^S-Pen',parts:['[REPLY: /x-mixing]','[VIDEO: Serum_mixing.mp4]']}]};

async function make({agentSays=['Halo kak'],history=[],greeting=null}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kdc-'));const W=path.join(DATA,A);
 await mkdir(path.join(W,'media','staff'),{recursive:true});await mkdir(path.join(W,'templates'),{recursive:true});
 await writeFile(path.join(W,'QUICK_REPLIES.md'),QR);
 await writeFile(path.join(W,'media','staff','urls.txt'),['https://media.example/lib/a/Pen_tutorial.mp4','https://media.example/lib/a/Serum_mixing.mp4'].join('\n'));
 if(greeting)await writeFile(path.join(W,'templates','GREETING.md'),greeting);
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{[A]:{phoneNumberId:'111111',persona:'Sam',business:'Cove',mode:'test',debounceSec:0,review:'off',testers:[{who:'Team',phone:'628123'}],labels:{allowed:['New Leads']},afterPaid:AFTER}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({[A]:{id:'wbs_1',secrets:[SECRET]}}));
 const sent=[],asks=[];
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/',''),m=o.method||'GET';const ok=d=>({ok:true,status:200,json:async()=>d});
  if(p==='accounts')return ok({data:[{phone_number_id:'111111',phone_number:'+62877',name:'Cove',status:'connected'}]});
  if(p.startsWith('labels?'))return ok({data:LABELS.map(n=>({id:lid(n),name:n})),has_more:false});
  if(/^111111\/conversations\/cnv_\w+$/.test(p))return ok({data:{id:'cnv_A',contact:{id:'ctc_A'}}});
  if(/^111111\/contacts\/ctc_\w+$/.test(p))return ok({data:{id:'ctc_A',labels:[]}});
  if(/^111111\/contacts\/ctc_\w+\/labels/.test(p))return ok({data:{}});
  if(/^111111\/messages$/.test(p)&&m==='POST'){sent.push(JSON.parse(o.body));return ok({data:{id:'msg_'+sent.length,status:'queued'}})}
  if(/^111111\/messages\?/.test(p))return ok({data:history.map((t,i)=>({id:'h'+i,direction:t[0],content:t[1],type:'text',created_at:'2026-11-19T0'+i+':00:00Z'}))});
  return {ok:false,status:404,json:async()=>({})}};
 const due=new Map();let tid=0,n=0;
 const k=createKirimdev({DATA,WORK:DATA,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:()=>{},echoWait:0,
  setTimer:fn=>{const i=++tid;due.set(i,fn);return i},clearTimer:i=>due.delete(i),activity:async()=>{},
  teamGroup:async()=>({chatId:-100,topics:{questions:3}}),telegram:async()=>42,
  runAgent:async(a,q)=>{asks.push(q);const x=agentSays[Math.min(n++,agentSays.length-1)];return typeof x==='function'?x(q):x}});
 const settle=async()=>{for(let i=0;i<20&&due.size;i++){const f=[...due.values()];due.clear();await Promise.all(f.map(x=>x()))}};
 const post=raw=>k.receive(A,{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received'},Buffer.from(raw));
 const paid=(o={})=>k.labelContact(A,{conversationId:'cnv_A',phone:'628123',add:['Customer',...(o.products||[])],remove:['Checkout'],source:'payment',run:o.run||'pay1',form:o.form||''});
 return {k,DATA,sent,asks,settle,post,paid}}
const texts=t=>t.sent.filter(b=>b.type==='text').map(b=>b.text.body),videos=t=>t.sent.filter(b=>b.type==='video').map(b=>b.video.link.split('/').pop());

test('after a payment, a pen named on the order form gets the pen messages although the order had no S-Pen label (TS-3)',async()=>{
 const t=await make();await t.post(meta('628123','halo'));await t.settle();t.sent.length=0;
 await t.paid({products:['S-Glow'],form:'1x Serum A Pen 10mg (cartridge premixed)\n- Konfigurasi: Pen: premixed cartridge'});
 assert.deepEqual(videos(t),['Pen_tutorial.mp4']);assert.ok(texts(t).some(x=>/Cara pakai pen/.test(x)));assert.ok(!texts(t).some(x=>/mixing/.test(x)),'no mixing tutorial')});

test('after a payment, a premix vial order gets no mixing tutorial; a self-mix one does (TS-4)',async()=>{
 const t=await make();await t.post(meta('628123','halo'));await t.settle();t.sent.length=0;
 await t.paid({products:['S-Balm'],form:'1x Serum B 10mg (vial, dibantu premix)\nKonfigurasi: Vial: dibantu premix oleh tim'});
 assert.deepEqual(videos(t),[]);assert.equal(texts(t).length,1,'only the payment confirmation');
 const u=await make();await u.post(meta('628123','halo'));await u.settle();u.sent.length=0;
 await u.paid({products:['S-Balm'],form:'1x Serum B 10mg (vial)\nKonfigurasi: Vial, mixing sendiri'});assert.deepEqual(videos(u),['Serum_mixing.mp4'])});

test('the payment confirmation keeps its points on their own lines although the quick reply stores them inline (TS-9)',async()=>{
 const t=await make();await t.post(meta('628123','halo'));await t.settle();t.sent.length=0;
 await t.paid({products:['S-Balm'],form:'Konfigurasi: Vial: dibantu premix'});
 assert.match(texts(t)[0],/diperhatikan:\n\n• Simpan di chiller[^\n]*\n\n• Jika ragu/)});

test('a video the customer already got is not sent again: neither after a payment nor in a reply (TS-5)',async()=>{
 const t=await make({agentSays:['Videonya di sini ya kak\n[VIDEO: Serum_mixing.mp4]','Videonya di sini ya kak\n[VIDEO: Serum_mixing.mp4]','Sudah saya kirim di atas ya kak, silakan dicek.']});
 await t.post(meta('628123','cara mixing gimana kak'));await t.settle();assert.deepEqual(videos(t),['Serum_mixing.mp4']);
 await t.paid({products:['S-Balm'],form:'Konfigurasi: Vial, mixing sendiri'});assert.deepEqual(videos(t),['Serum_mixing.mp4'],'the after-payment list leaves the video out');
 await t.post(meta('628123','videonya mana kak'));await t.settle();
 assert.deepEqual(videos(t),['Serum_mixing.mp4'],'the reply was written again without it');assert.match(t.asks.at(-1),/already got this from you: serum_mixing/);
 assert.ok(texts(t).some(x=>/di atas/.test(x)));assert.match(t.asks.at(-1),/Already sent to this customer[^\n]*serum_mixing/)});

test('a video given by its full link is sent when the line\'s media library has that host; an unknown one makes the agent write again (CH-3)',async()=>{
 const t=await make({agentSays:['Ini testimoninya kak\n[VIDEO: https://media.example/lib/b/Review_clip.mp4]']});
 await t.post(meta('628123','ada testimoni?'));await t.settle();assert.deepEqual(videos(t),['Review_clip.mp4']);
 const u=await make({agentSays:['Ini videonya kak\n[VIDEO: https://elsewhere.example/x/Clip.mp4]','Maaf kak, videonya belum bisa saya kirim di sini. Ada yang bisa saya bantu lagi?']});
 await u.post(meta('628123','ada video?'));await u.settle();
 assert.deepEqual(videos(u),[]);assert.match(u.asks.at(-1),/no such video/);assert.ok(texts(u).some(x=>/belum bisa/.test(x)),'the rewritten reply went out, not the one claiming a video');
 assert.equal(linkIn(['https://media.example/a/One.mp4'],'https://media.example/b/Two.mp4'),'https://media.example/b/Two.mp4');
 assert.equal(linkIn(['https://media.example/a/One.mp4'],'https://other.example/b/Two.mp4'),null);assert.equal(linkIn(['https://media.example/a/One.mp4'],'One.mp4'),null)});

const GREET='Halo kak, perkenalkan saya Sam dari tim konsultan serum. Boleh banget kalau mau tanya seputar produk kami. Supaya rekomendasinya relevan, boleh lengkapi informasi berikut: usia, tinggi badan, berat badan, tujuan utama.';
test('a new lead\'s first reply gets the line\'s greeting template in its run and is written again without it (TS-7)',async()=>{
 const t=await make({greeting:GREET,history:[['inbound','halo kak mau tanya soal serum']],agentSays:['Halo kak, boleh banget, silakan tanya soal serum. Mau cari info yang mana?',GREET]});
 await t.post(meta('628123','halo kak mau tanya soal serum'));await t.settle();
 assert.match(t.asks[0],/FIRST reply in this chat[\s\S]*perkenalkan saya Sam/);assert.match(t.asks[1],/leaves out the team's greeting template/);
 assert.equal(texts(t).length,1);assert.match(texts(t)[0],/perkenalkan saya Sam/);
 const later=await make({greeting:GREET,history:[['inbound','halo'],['outbound','Halo kak'],['inbound','harganya berapa']],agentSays:['Harganya Rp1 kak.']});
 await later.post(meta('628123','harganya berapa'));await later.settle();assert.doesNotMatch(later.asks[0],/FIRST reply/);assert.deepEqual(texts(later),['Harganya Rp1 kak.'],'not the first reply: no template, no hold');
 const en=await make({greeting:GREET,history:[['inbound','hi, how much is it?']],agentSays:['Hi! It is Rp1, and shipping is free to all of Indonesia for you.']});
 await en.post(meta('628123','hi, how much is it?'));await en.settle();assert.doesNotMatch(en.asks[0],/FIRST reply/,'an English first message gets no Indonesian template')});

// SV-2 (19 Nov 2026 server review): three Fixer issues where a payment QR or its text never reached the customer, kept from coming back
test('a QR or its text reaches the customer: the picture is attached when the reply forgets it, a big total is split, the helper\'s own sends are ours (SV-2)',async()=>{
 const {guardReply,splitReply}=await import('../app/kirimdev.mjs'),{splitAmounts}=await import('../app/price-catalog.mjs');
 // the reply says the QRIS was sent but has no [FOTO:] tag: the picture this run made goes with it (i5784e2f1)
 const g=guardReply(['QRIS-nya sudah saya kirim ya kak, silakan dibayar.'],{paid:true,qrPics:['[FOTO: qris-1.png]']});
 assert.equal(g.hold,null);assert.deepEqual(g.attached,['[FOTO: qris-1.png]']);assert.ok(g.parts.includes('[FOTO: qris-1.png]'));
 // a QR tag on its own line between "---" parts is a part of its own, never text (id1b17621)
 assert.deepEqual(splitReply('Berikut QRIS-nya kak\n---\n[FOTO: qris-2.png]\n---\nTotal Rp8.555.000'),['Berikut QRIS-nya kak','[FOTO: qris-2.png]','Total Rp8.555.000']);
 // a total above one QRIS's top amount becomes several QRs by code (id1b17621)
 const parts=splitAmounts(8555000,{min:10000,max:5000000});assert.ok(parts.length>=2&&parts.every(x=>x<=5000000));assert.equal(parts.reduce((s,x)=>s+x,0),8555000);
 // a payment helper that sends its own QR: the ids it reports are ours, so their echo is not taken for a person's reply that silences the agent (i4717e236)
 const t=await make();await t.post(meta('628123','halo'));await t.settle();
 await t.k.external(A,'628123',Promise.resolve({ids:['msg_helper_1']}));assert.ok((await t.k._state()).ours.msg_helper_1,'the helper\'s message id is ours')});
