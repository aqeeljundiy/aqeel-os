// Tests for the Kirimdev WhatsApp channel (app/kirimdev.mjs). Run: node --test scripts/kirimdev.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createKirimdev,verifySignature,parseInbound,splitReply} from '../app/kirimdev.mjs';

const SECRET='whsec_test_123';
const sign=(raw,t=Math.floor(Date.now()/1000),s=SECRET)=>'t='+t+',v1='+createHmac('sha256',s).update(t+'.'+raw).digest('hex');
const meta=(from,text,id='wamid.'+Math.random(),conv='cnv_A')=>JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'111'},contacts:[{wa_id:from,profile:{name:'Rania'}}],messages:[{from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:text}}]}}]}],kirim:{conversation_id:conv}});

async function make({mode='test',agentSays='Halo kak 😊',testers=[{who:'Amri',conversationId:'cnv_A'}]}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-')),WORK=path.join(DATA,'work');
 await mkdir(path.join(WORK,'continue-support','media','staff'),{recursive:true});
 await writeFile(path.join(WORK,'continue-support','media','staff','urls.txt'),'https://media.kirimdev.com/x/Kit.jpeg\n');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{'continue-support':{phoneNumberId:'111',persona:'Randy',business:'Continue',mode,debounceSec:0,testers,
  handoff:{chatId:-100,threadId:3,mention:'@team'},autoPhotos:{pattern:'rekomendasi utama',tags:['[FOTO: Kit.jpeg]']}}}}));
 await writeFile(path.join(DATA,'kirimdev-secrets.json'),JSON.stringify({'continue-support':{id:'wbs_1',secrets:[SECRET]}}));
 const sent=[],asked=[],posts=[],told=[];
 const fetchImpl=async(url,o)=>{const p=url.replace('https://api.kirimdev.com/v1/','');
  if(o.method==='POST'&&p==='111/messages'){sent.push(JSON.parse(o.body));return {ok:true,json:async()=>({data:{id:'msg_'+sent.length,status:'queued'}})}}
  if(p.startsWith('111/messages?'))return {ok:true,json:async()=>({data:[{direction:'inbound',content:'mau tanya',created_at:'2026-11-05T10:00:00.000Z',type:'text'}]})};
  if(p==='webhook_subscriptions')return {ok:true,json:async()=>({data:{id:'wbs_9',status:'active',initial_secret:'whsec_new'}})};
  return {ok:false,status:404,json:async()=>({})}};
 const k=createKirimdev({DATA,WORK,apiKey:async()=>'kdv_test',PUBLIC_URL:'https://ai.example',fetchImpl,wait:async()=>{},log:()=>{},
  runAgent:async(a,q)=>{asked.push([a,q]);return typeof agentSays==='function'?agentSays(q):agentSays},telegram:async(...x)=>{posts.push(x);return true},tell:async t=>{told.push(t)}});
 const post=(raw,h={})=>k.receive('continue-support',{'x-kirim-signature':sign(raw),'x-kirim-event':'message.received',...h},Buffer.from(raw));
 const settle=()=>new Promise(r=>setTimeout(r,300));
 return {k,DATA,sent,asked,posts,told,post,settle}}

test('signature: any v1 from any secret, within 5 minutes, raw bytes',()=>{const raw='{"a":1}',t=Math.floor(Date.now()/1000);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t),[SECRET]),true);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t,'old')+','+sign(raw,t).split(',')[1],['x',SECRET]),true);
 assert.equal(verifySignature(Buffer.from(raw+' '),sign(raw,t),[SECRET]),false);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t-301),[SECRET]),false);
 assert.equal(verifySignature(Buffer.from(raw),sign(raw,t+301),[SECRET]),false);
 for(const h of ['', 't=1', 'v1=ab', 't=x,v1=ab', 't=1,t=2,v1=ab', 'é'])assert.equal(verifySignature(Buffer.from(raw),h,[SECRET]),false,h)});

test('parse and split: Meta body to messages; parts, pictures, and no backup-model note',()=>{
 const m=parseInbound(JSON.parse(meta('628123','halo')));assert.equal(m.length,1);assert.deepEqual([m[0].from,m[0].text,m[0].conversationId,m[0].name,m[0].pid],['628123','halo','cnv_A','Rania','111']);
 assert.deepEqual(splitReply('Satu\n---\nDua [FOTO: Kit.jpeg]\n\n(Answered with GPT, Claude was down.)'),['Satu','Dua','[FOTO: Kit.jpeg]'])});

test('a tester gets one answer for a burst, with the picture; a stranger in Test gets none',async()=>{const t=await make({agentSays:'Ini *rekomendasi utama* kak'});
 assert.equal((await t.post(meta('628123','halo'))).status,200);assert.equal((await t.post(meta('628123','mau tanya'))).status,200);
 await t.settle();assert.equal(t.asked.length,1);assert.match(t.asked[0][1],/TEST CHAT/);assert.match(t.asked[0][1],/CUSTOMER: mau tanya/);
 assert.deepEqual(t.sent.map(b=>b.type),['text','image']);assert.equal(t.sent[0].to,'628123');assert.equal(t.sent[1].image.link,'https://media.kirimdev.com/x/Kit.jpeg');
 await t.post(meta('629999','halo',undefined,'cnv_Z'));await t.settle();assert.equal(t.asked.length,1)});

test('Live answers everyone; a bad signature, an old one and a repeated event id are refused or ignored',async()=>{const t=await make({mode:'live'});
 const raw=meta('629999','halo',undefined,'cnv_Z');
 assert.equal((await t.k.receive('continue-support',{'x-kirim-signature':sign(raw,undefined,'wrong')},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('continue-support',{'x-kirim-signature':sign(raw,Math.floor(Date.now()/1000)-600)},Buffer.from(raw))).status,401);
 assert.equal((await t.k.receive('nobody',{'x-kirim-signature':sign(raw)},Buffer.from(raw))).status,404);
 assert.equal((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).status,200);assert.ok((await t.post(raw,{'x-kirim-event-id':'wamid.1'})).body.duplicate);
 await t.settle();assert.equal(t.asked.length,1);assert.equal(t.sent[0].to,'629999')});

test('a handoff goes to the Telegram topic and the customer is told; reset starts the chat again',async()=>{const t=await make({agentSays:'HANDOFF: COA question'});
 await t.post(meta('628123','ada COA?'));await t.settle();
 assert.equal(t.posts.length,1);assert.deepEqual(t.posts[0].slice(0,3),['continue-support',-100,3]);assert.match(t.posts[0][3],/\+628123/);assert.match(t.posts[0][3],/@team/);
 assert.match(t.sent[0].text.body,/teruskan ke tim/);
 await t.post(meta('628123','reset'));await t.settle();assert.match(t.sent.at(-1).text.body,/Test reset/);assert.equal(t.asked.length,1)});

test('whatsapp_reply: only to someone who wrote in the last 24 hours, a tester while in Test',async()=>{const t=await make();
 await assert.rejects(t.k.reply('continue-support','628123','halo'),/24 hours/);
 await t.post(meta('628123','halo'));await t.settle();
 const r=await t.k.reply('continue-support','+62 812 3','Jawaban tim: COA ada di link ini');assert.equal(r.length,1);assert.equal(t.sent.at(-1).to,'628123');
 await assert.rejects(t.k.reply('pixel-agent','628123','x'),/no WhatsApp line/)});

test('connect makes the webhook and keeps the secret Kirimdev returns; status and mode',async()=>{const t=await make();
 assert.deepEqual(await t.k.connect('continue-support'),{id:'wbs_9',status:'active'});
 const sec=JSON.parse(await readFile(path.join(t.DATA,'kirimdev-secrets.json'),'utf8'));assert.deepEqual(sec['continue-support'].secrets,['whsec_new']);
 assert.equal((await t.k.status())[0].mode,'test');await t.k.setMode('continue-support','live');assert.equal((await t.k.status())[0].mode,'live');
 await assert.rejects(t.k.setMode('continue-support','loud'),/test or live/)});
