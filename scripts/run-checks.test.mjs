// Tests for app/run-checks.mjs (the standard no-model checks). Run: node --test scripts/run-checks.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {cdpPortOf,titleCount,unreadDms,unansweredComments,postingAllowed,combine,listOf} from '../app/run-checks.mjs';

test('the DevTools port comes from the agent config; the title count from the page title',()=>{
 assert.equal(cdpPortOf('browser:\n  headed: true\n  cdp_url: http://127.0.0.1:9600\n  x: 1'),9600);assert.equal(cdpPortOf('a: b'),null);assert.equal(cdpPortOf('  cdp_url: "https://evil.com:9600"'),null);
 assert.equal(titleCount('(3) Search • Threads'),3);assert.equal(titleCount('Threads'),0);assert.equal(titleCount('(12+) Threads'),12)});

const pages=t=>async u=>/json\/list/.test(u)?[{type:'page',url:'https://www.threads.com/x',title:t}]:null;
test('unread DMs: title mode, inbox mode, both, and unknown',async()=>{
 assert.deepEqual(await unreadDms({port:9600,mode:'title',fetchJson:pages('(2) Threads')}),{count:2,known:true,why:'title 2'});
 assert.equal((await unreadDms({port:9600,mode:'title',fetchJson:pages('Threads')})).count,0);
 const inbox=n=>async()=>({login:false,count:n,rows:4});
 assert.equal((await unreadDms({port:9600,mode:'inbox',lookFn:inbox(5),wake:async()=>true})).count,5);
 assert.equal((await unreadDms({port:9600,fetchJson:pages('Threads'),lookFn:inbox(1)})).count,1,'both: the larger');
 const u=await unreadDms({port:9600,fetchJson:async()=>null,lookFn:async()=>null});assert.equal(u.known,false);assert.equal(u.count,null);
 assert.equal((await unreadDms({port:9600,mode:'inbox',wake:async()=>true,lookFn:async()=>({login:true})})).known,false,'signed out is unknown, not zero');
 assert.equal((await unreadDms({port:9600,mode:'inbox',wake:async()=>true,lookFn:async()=>({login:false,count:0,rows:0})})).known,false,'an inbox that did not load is unknown');
 assert.equal((await unreadDms({})).known,false)});

const resp=(j,ok=true,status=200)=>async()=>({ok,status,json:async()=>j});
test('Tebar comments: only the unanswered ones, per platform; any failure is unknown',async()=>{
 const l=[{id:1,reply_status:'unreplied',platform:'threads'},{id:2,reply_status:'replied',platform:'threads'},{id:3,platform:'instagram'}];
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({data:l})})).count,2);
 assert.equal((await unansweredComments({key:'k',platform:'threads',fetchFn:resp(l)})).count,1);
 assert.equal((await unansweredComments({fetchFn:resp(l)})).known,false,'no key');
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({},false,401)})).known,false);
 assert.equal((await unansweredComments({key:'k',fetchFn:resp({oops:1})})).known,false,'not a list');
 assert.equal((await unansweredComments({key:'k',fetchFn:async()=>{throw Error('down')}})).known,false);
 assert.deepEqual(listOf({comments:[1]}),[1])});

test('posting allowed: the posting limits decide; off or missing says nothing',async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'aq-rc-'));const now=Date.parse('2026-11-11T08:00:00Z');
 assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,null);
 await writeFile(path.join(DATA,'posting-limits.json'),JSON.stringify({agents:{ct:{on:true,tz:'UTC',perHour:2,gapMin:10,perDay:20,quietFrom:0,quietTo:0}}}));
 await mkdir(path.join(DATA,'posting-log'));
 assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,true);
 await writeFile(path.join(DATA,'posting-log','ct.json'),JSON.stringify([{at:now-5*60e3,lead:'hot',status:'visible'}]));
 const x=await postingAllowed({DATA,agent:'ct',now});assert.equal(x.allow,false);assert.match(x.why,/min ago/);
 await writeFile(path.join(DATA,'posting-log','ct.json'),JSON.stringify([{at:now-70*60e3,lead:'hot'}]));assert.equal((await postingAllowed({DATA,agent:'ct',now})).allow,true,'gap over')});

test('combine: nothing waiting stops the run; unknown or something waiting lets it go; a closed posting limit stops it',()=>{
 const z={count:0,known:true,why:'0'},n={count:null,known:false,why:'?'},p={count:2,known:true,why:'2'};
 assert.equal(combine({work:[z,z]}).anythingToDo,false);assert.equal(combine({work:[z,p]}).anythingToDo,true);assert.equal(combine({work:[z,n]}).anythingToDo,true,'unknown never stops a run');
 assert.equal(combine({work:[p],need:[{allow:false,known:true,why:'a post 5 min ago'}]}).anythingToDo,false);
 assert.equal(combine({work:[p],need:[{allow:null,known:false,why:'off'}]}).anythingToDo,true);assert.equal(combine({}).anythingToDo,true,'no check given');
 assert.match(JSON.stringify(combine({work:[z]})),/"anythingToDo":false/)});

test('a schedule check wakes a sleeping browser first and waits for it; one that does not wake is unknown, never zero',async()=>{
 const {wakeBrowser,unreadDms}=await import('../app/run-checks.mjs');
 let waited=0;
 const slow=async u=>{waited++;await new Promise(r=>setTimeout(r,30));return /json\/version/.test(u)?{webSocketDebuggerUrl:'ws://x'}:null};
 assert.equal(await wakeBrowser({port:9600,fetchJson:slow}),true);assert.equal(waited,1);
 assert.equal(await wakeBrowser({port:9600,fetchJson:async()=>null}),false);assert.equal(await wakeBrowser({port:0}),false);
 const seen=[];
 const r=await unreadDms({port:9600,mode:'title',fetchJson:async()=>[{type:'page',url:'https://www.threads.com/',title:'(3) Threads'}],wake:async o=>{seen.push(o.port);return true}});
 assert.equal(r.count,3);assert.deepEqual(seen,[9600]);
 const r2=await unreadDms({port:9600,mode:'title',fetchJson:async()=>[],wake:async()=>false});
 assert.equal(r2.count,null);assert.equal(r2.known,false);assert.match(r2.why,/asleep/)});
