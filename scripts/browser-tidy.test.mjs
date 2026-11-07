// Tests for app/browser-tidy.mjs. Run: node --test scripts/browser-tidy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {plan,planExcess,createBrowserTidy,IDLE,QUIET,MAX_TABS,BUSY_MAX,BUSY_KEEP} from '../app/browser-tidy.mjs';

test('closes every page but one empty tab, and opens one when there is none',()=>{
 assert.deepEqual(plan([{id:'a',type:'page',url:'https://x'},{id:'b',type:'page',url:'about:blank'},{id:'w',type:'service_worker'}]),{open:false,close:['a']});
 assert.deepEqual(plan([{id:'a',type:'page',url:'https://x'},{id:'c',type:'page',url:'https://y'}]),{open:true,close:['a','c']});
 assert.deepEqual(plan([{id:'b',type:'page',url:'about:blank'}]),{open:false,close:[]});
 assert.deepEqual(plan([]),{open:false,close:[]})});

test('only an agent idle for 3 hours is fully tidied; unknown activity or a busy agent is left alone',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bt-'));const ports=path.join(dir,'ports');
 await writeFile(ports,'sesa 42 9602\nbusy-one 43 9603\nrecent 44 9604\nunknown 45 9605\n');
 const t=1e13,last={sesa:t-IDLE-1,'busy-one':t-IDLE-1,recent:t-60e3,unknown:null};const calls=[];
 const fetchImpl=async(url,o)=>{calls.push((o?.method||'GET')+' '+url);const ok=j=>({ok:true,json:async()=>j});
  if(url.endsWith('/json/list'))return ok([{id:'p1',type:'page',url:'https://threads.net'},{id:'p2',type:'page',url:'https://x'}]);return ok({})};
 const tidy=createBrowserTidy({portsFile:ports,now:()=>t,fetchImpl,log:()=>{},busy:async a=>a==='busy-one',lastActive:async a=>last[a]});
 assert.equal(await tidy.tick(),2);
 assert.deepEqual(calls,['GET http://127.0.0.1:9602/json/list','PUT http://127.0.0.1:9602/json/new?about:blank','GET http://127.0.0.1:9602/json/close/p1','GET http://127.0.0.1:9602/json/close/p2',
  // an agent at work is only checked for extra tabs (two different pages: nothing closed)
  'GET http://127.0.0.1:9604/json/list'])});

test('extra tabs: repeats of one page and more than MAX_TABS go, the most recent stay',()=>{
 const pg=(id,url)=>({id,type:'page',url});
 // 7 Nov 2026: 44 copies of /activity, 22 of /messages and so on in continue-threads' Chrome
 const l=[pg('a1','https://www.threads.com/activity'),pg('m1','https://www.threads.com/messages'),pg('a2','https://www.threads.com/activity?x=1'),pg('a3','https://www.threads.com/activity/'),pg('m2','https://www.threads.com/messages#t'),{id:'w',type:'service_worker',url:'https://www.threads.com/sw.js'}];
 assert.deepEqual(planExcess(l).close,['a2','a3','m2']);
 const many=Array.from({length:12},(_,i)=>pg('p'+i,'https://x/'+i));
 assert.deepEqual(planExcess(many).close,many.slice(MAX_TABS).map(t=>t.id));
 assert.deepEqual(planExcess([pg('only','https://x')]).close,[]);assert.deepEqual(planExcess([]).close,[])});

test('an agent at work keeps its newest tabs untouched and at most BUSY_MAX',()=>{
 const pg=(id,url)=>({id,type:'page',url});
 const l=[...Array.from({length:BUSY_KEEP},(_,i)=>pg('n'+i,'https://www.threads.com/activity')),...Array.from({length:30},(_,i)=>pg('o'+i,'https://x/'+i))];
 const c=planExcess(l,{max:BUSY_MAX,keepNewest:BUSY_KEEP}).close;
 assert.ok(!c.some(id=>id.startsWith('n')),'the newest are never closed');
 assert.equal(l.length-c.length,BUSY_MAX)});

test('an agent quiet for 10 minutes but not 3 hours loses only its extra tabs; one at work keeps its newest',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bt-'));const ports=path.join(dir,'ports');
 await writeFile(ports,'continue-threads 40 9600\nworking 41 9601\n');
 const t=1e13,last={'continue-threads':t-QUIET-1,working:t-60e3};const calls=[];
 const fetchImpl=async(url,o)=>{calls.push((o?.method||'GET')+' '+url);const ok=j=>({ok:true,json:async()=>j});
  if(url.endsWith('/json/list'))return ok([{id:'a1',type:'page',url:'https://www.threads.com/activity'},{id:'a2',type:'page',url:'https://www.threads.com/activity'},{id:'s',type:'page',url:'https://www.threads.com/search'}]);return ok({})};
 const logs=[];const tidy=createBrowserTidy({portsFile:ports,now:()=>t,fetchImpl,log:m=>logs.push(m),lastActive:async a=>last[a]});
 assert.equal(await tidy.tick(),1);
 assert.deepEqual(calls,['GET http://127.0.0.1:9600/json/list','GET http://127.0.0.1:9600/json/close/a2','GET http://127.0.0.1:9601/json/list']);
 assert.match(logs[0],/closed 1 extra tab\(s\) of continue-threads .*2 left/)});
