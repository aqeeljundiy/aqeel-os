// System › Usage shows at once (1 Nov 2026): the engine's usage report is answered from the last read straight away and
// read again behind the scenes once it is older than the time to live; only the first read (or fresh=true) waits.
import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {createUsage} from '../app/usage.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function engine(delay){let n=0;const srv=createServer((req,res)=>{n++;const v=n;setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({read:v}))},delay)});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {url:'http://127.0.0.1:'+srv.address().port,reads:()=>n,close:()=>srv.close()}}

test('the first read waits, the next answers at once from the last one',async()=>{const e=await engine(120);const u=createUsage(e.url,'t',null,{ttl:1000});
 let t=Date.now();assert.equal((await u.report('usage','a',7)).read,1);assert.ok(Date.now()-t>=100);
 t=Date.now();assert.equal((await u.report('usage','a',7)).read,1);assert.ok(Date.now()-t<50);assert.equal(e.reads(),1);e.close()});

test('older than the time to live: the old answer at once, a new one read behind for the next ask',async()=>{const e=await engine(120);const u=createUsage(e.url,'t',null,{ttl:50});
 await u.report('usage','a',7);await sleep(80);
 const t=Date.now();assert.equal((await u.report('usage','a',7)).read,1,'still the old answer');assert.ok(Date.now()-t<50,'without waiting');
 await sleep(200);assert.equal(e.reads(),2,'read again behind the scenes once');assert.equal((await u.report('usage','a',7)).read,2);e.close()});

test('one refresh at a time, and fresh waits for a new answer',async()=>{const e=await engine(100);const u=createUsage(e.url,'t',null,{ttl:10});
 await u.report('models','b',7);await sleep(30);await Promise.all([u.report('models','b',7),u.report('models','b',7),u.report('models','b',7)]);await sleep(150);assert.equal(e.reads(),2);
 const t=Date.now();assert.equal((await u.report('models','b',7,{fresh:true})).read,3);assert.ok(Date.now()-t>=80);e.close()});

test('too old to show: waits for a new answer',async()=>{const e=await engine(60);const u=createUsage(e.url,'t',null,{ttl:10,stale:40});
 await u.report('usage','c',62);await sleep(70);assert.equal((await u.report('usage','c',62)).read,2);e.close()});

test('each answer says when it was read, so the page can say "as of" once it is old',async()=>{const e=await engine(10);const u=createUsage(e.url,'t',null,{ttl:1000});
 const a=await u.report('usage','d',7);assert.ok(Math.abs(a.read_at-Date.now()/1000)<5);e.close()});
