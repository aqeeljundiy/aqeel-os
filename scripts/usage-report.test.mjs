// System › Usage shows at once (1 Nov 2026): the engine's usage report is answered from the last read straight away and
// read again behind the scenes once it is older than the time to live; only the first read (or fresh=true) waits.
// 12 Nov 2026 (audit H11): these tests measured milliseconds on real timers and closed their server as the last statement, so on a busy box
// an assert failed, the server stayed open and the whole run hung (a 4.4-hour node process on the live box). Now they count the reads the
// engine got (what "at once" means: no new read was waited for), wait on conditions instead of fixed sleeps, and always close the server.
import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {createUsage} from '../app/usage.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(f,what,ms=10000)=>{const t=Date.now();while(!await f()){if(Date.now()-t>ms)assert.fail('waited '+ms+' ms for: '+what);await sleep(10)}};
// a stand-in engine: answers {read:n} after `delay`; answered = how many answers went out; closed with the test, whatever happens
async function engine(t,delay){let n=0,answered=0;const srv=createServer((req,res)=>{n++;const v=n;setTimeout(()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({read:v}));answered++},delay)});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>{srv.closeAllConnections?.();srv.close()});
 return {url:'http://127.0.0.1:'+srv.address().port,reads:()=>n,answered:()=>answered}}

test('the first read waits, the next answers at once from the last one',async t=>{const e=await engine(t,120);const u=createUsage(e.url,'t',null,{ttl:60000});
 assert.equal((await u.report('usage','a',7)).read,1);assert.equal(e.answered(),1,'the first read waited for the engine');
 assert.equal((await u.report('usage','a',7)).read,1);assert.equal(e.reads(),1,'answered from the last read: the engine was not asked again')});

test('older than the time to live: the old answer at once, a new one read behind for the next ask',async t=>{const e=await engine(t,120);const u=createUsage(e.url,'t',null,{ttl:50});
 await u.report('usage','a',7);await sleep(80);
 assert.equal((await u.report('usage','a',7)).read,1,'still the old answer');assert.equal(e.answered(),1,'without waiting for the new read');
 await until(()=>e.answered()===2,'the read behind the scenes');await sleep(20);assert.equal(e.reads(),2,'read again behind the scenes once');
 await until(async()=>(await u.report('usage','a',7)).read>=2,'the new answer to be the one shown')});

test('one refresh at a time, and fresh waits for a new answer',async t=>{const e=await engine(t,100);const u=createUsage(e.url,'t',null,{ttl:10});
 await u.report('models','b',7);await sleep(30);await Promise.all([u.report('models','b',7),u.report('models','b',7),u.report('models','b',7)]);
 await until(()=>e.answered()===2,'the one refresh');assert.equal(e.reads(),2,'three asks, one refresh');
 const v=createUsage(e.url,'t',null,{ttl:60000});assert.equal((await v.report('models','b',7)).read,3);   // nothing in flight here, the last read is new
 const before=e.answered(),r=await v.report('models','b',7,{fresh:true});assert.equal(e.answered(),before+1,'fresh waited for a new answer');assert.equal(r.read,4)});

test('too old to show: waits for a new answer',async t=>{const e=await engine(t,60);const u=createUsage(e.url,'t',null,{ttl:10,stale:40});
 await u.report('usage','c',62);await sleep(70);assert.equal((await u.report('usage','c',62)).read,2);assert.equal(e.answered(),2)});

test('each answer says when it was read, so the page can say "as of" once it is old',async t=>{const e=await engine(t,10);const u=createUsage(e.url,'t',null,{ttl:60000});
 const a=await u.report('usage','d',7);assert.ok(Math.abs(a.read_at-Date.now()/1000)<60)});
