// Daily chat review (app/chat-review.mjs, EN-12, 19 Nov 2026)
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {reviewRows,summary,createChatReview,NOT_PROCESSED,UNHAPPY,OWN_SLIP} from '../app/chat-review.mjs';
const now=1795060000,H=3600;
test('unanswered, "not processed", unhappy and stored twice are counted; answered messages are not',()=>{
 const rows=[
  ['s1','telegram','user',now-5*H,'Please organise the folder'],['s1','telegram','assistant',now-5*H+60,'Done, organised.'],
  ['s1','telegram','user',now-4*H,'You removed a lot of stuff and made it ugly'],['s1','telegram','assistant',now-4*H+30,'Sorry, fixing it.'],
  ['s1','telegram','user',now-3*H,'pls check all'],['s1','telegram','user',now-3*H,'pls check all'],['s1','telegram','assistant',now-3*H+5,'Your request was not processed. Send it again if you still want me to carry it out.'],
  ['s2','whatsapp','user',now-2*H,'halo kak, belum bisa bayar'],
  ['s3','telegram','user',now-60,'just now, not late yet'],['s4','telegram','user',now-5*H,'order form posted in the team group','supergroup']];
 const r=reviewRows(rows,{now});
 assert.equal(r.unhappy,2);assert.equal(r.notProcessed,1);assert.equal(r.doubled,1);assert.equal(r.unanswered,1,'only the old one');assert.equal(r.chats,4);
 assert.ok(r.examples.some(e=>/unhappy: "You removed/.test(e)),'a team chat is quoted');
 assert.ok(!r.examples.some(e=>/belum bisa bayar/.test(e)),'a customer chat is never quoted');assert.ok(r.examples.some(e=>/\(whatsapp\)/.test(e)));
 assert.ok(NOT_PROCESSED.test('Your request was not processed.')&&UNHAPPY.test('masih belum bisa')&&!UNHAPPY.test('thanks, all good'));
 const s=summary('Donna',r);assert.match(s.title,/^Donna's chats yesterday: 1 unanswered, 1 "not processed", 2 unhappy, 1 stored twice$/);
 assert.equal(summary('Pixel',reviewRows([['a','slack','user',now-H,'hi'],['a','slack','assistant',now-H+9,'hello']],{now})),null)});
test('one Health item per agent with problems, the others cleared, once a day after the hour',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'cr-'));const filed=[],cleared=[];
 const rows={default:[['x','telegram','user',now-5*H,'still not working']],fine:[['y','slack','user',now-H,'hi'],['y','slack','assistant',now-H+5,'hey']]};
 const cr=createChatReview({DATA,HERMES_HOME:'/h',python:async()=>'py',listAgents:async()=>['default','fine','fine--chat2'],nameOf:a=>a==='default'?'Donna':a,
  problem:async(a,k,t)=>filed.push([a,k,t]),ok:async(a,k)=>cleared.push([a,k]),log:()=>{},run:async db=>db.includes('profiles')?rows.fine:rows.default});
 assert.equal(await cr.tick(new Date('2026-11-19T10:00:00Z')),false,'not before the hour');
 assert.equal(await cr.tick(new Date('2026-11-19T21:10:00Z')),true);assert.equal(await cr.tick(new Date('2026-11-19T21:15:00Z')),false,'once a day');
 assert.equal(await cr.tick(new Date('2026-11-20T21:05:00Z')),true,'and again the next day, whatever the real clock says (review 21 Nov 2026)');
 assert.equal(JSON.parse(await (await import('node:fs/promises')).readFile(path.join(DATA,'chat-review.json'),'utf8')).at,Date.parse('2026-11-20T21:05:00Z'),'stores the tick time');
 assert.deepEqual(filed.map(f=>f.slice(0,2)),[['default','chatreview'],['default','chatreview']]);assert.match(filed[0][2],/^Donna's chats yesterday: .*1 unhappy/);
 assert.deepEqual(cleared,[['fine','chatreview'],['fine','chatreview']])});

test('a person own mistake is no complaint (20 Nov 2026)',()=>{
 const rows=[['s1','telegram','user',1000,'Kak izin yah, aku salah pesan yang small, aku pesan ulang','group'],['s1','telegram','assistant',1010,'Siap kak','group'],
  ['s2','telegram','user',2000,'yang dikirim salah ukurannya','group'],['s2','telegram','assistant',2010,'Maaf kak','group']];
 const r=reviewRows(rows,{now:9999});assert.equal(r.unhappy,1,'only the second, which says something sent was wrong');
 assert.equal('aku salah pesan'.replace(OWN_SLIP,' ').includes('salah'),false)});
