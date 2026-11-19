// choose_browser (app/browser-ask.mjs, EN-8 / issue i26680424): a card waits for an answer only while a web chat for that
// agent is asking for its cards; with nobody looking (the person is on Telegram) the tool answers at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardWatched,createBrowserAsks} from '../app/browser-ask.mjs';

test('a card counts as watched only for 20 s after the last poll',()=>{
 assert.equal(cardWatched(0,1000),false,'never polled');
 assert.equal(cardWatched(1000,1000),true);
 assert.equal(cardWatched(1000,21000),true);
 assert.equal(cardWatched(1000,21001),false);
 assert.equal(cardWatched(5000,1000),false,'a poll from the future is not trusted');
 assert.equal(cardWatched(1000,3000,1000),false,'own window');});

test('nobody looking: the answer comes at once and no card is left',async()=>{let t=100000;const b=createBrowserAsks({now:()=>t});
 const r=await b.ask('donna--chat1',{task:'read a page'});
 assert.match(r.text,/not looking at an aqeelOS chat page/);assert.equal(b.asks.size,0);
 b.seen('other');assert.match((await b.ask('donna',{})).text,/not looking/,'another agent\'s page does not count');
 b.seen('donna');t+=30000;assert.match((await b.ask('donna',{})).text,/not looking/,'a page that stopped polling does not count')});

test('a web chat is looking: the card waits, the person answers',async()=>{let t=100000;const b=createBrowserAsks({now:()=>t});
 b.seen('donna');t+=2500;const p=b.ask('donna--chat1',{task:'x'.repeat(300),suggest:'yours',why:'signed in'});
 assert.equal(b.asks.size,1);const [rec]=b.asks.values();
 assert.equal(rec.base,'donna');assert.equal(rec.agent,'donna--chat1');assert.equal(rec.suggest,'yours');assert.equal(rec.task.length,160);assert.equal(rec.t,t);
 b.asks.delete(rec.id);rec.resolve({text:'chosen'});assert.equal((await p).text,'chosen')});

test('unanswered card ends after its wait with the old answer',async()=>{const b=createBrowserAsks({waitMs:20});b.seen('donna');
 // the card's timer is unref'd (it never holds the server open), so something must keep this test's event loop alive (GitHub run, 19 Nov)
 const hold=setTimeout(()=>{},5000);const r=await b.ask('donna',{suggest:'bogus'});clearTimeout(hold);assert.match(r.text,/did not choose in time/);assert.equal(b.asks.size,0)});
