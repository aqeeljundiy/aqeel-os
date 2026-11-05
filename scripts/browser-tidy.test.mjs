// Tests for app/browser-tidy.mjs. Run: node --test scripts/browser-tidy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {plan,createBrowserTidy,IDLE} from '../app/browser-tidy.mjs';

test('closes every page but one empty tab, and opens one when there is none',()=>{
 assert.deepEqual(plan([{id:'a',type:'page',url:'https://x'},{id:'b',type:'page',url:'about:blank'},{id:'w',type:'service_worker'}]),{open:false,close:['a']});
 assert.deepEqual(plan([{id:'a',type:'page',url:'https://x'},{id:'c',type:'page',url:'https://y'}]),{open:true,close:['a','c']});
 assert.deepEqual(plan([{id:'b',type:'page',url:'about:blank'}]),{open:false,close:[]});
 assert.deepEqual(plan([]),{open:false,close:[]})});

test('only an agent idle for 3 hours is tidied; unknown activity or a busy agent is left alone',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bt-'));const ports=path.join(dir,'ports');
 await writeFile(ports,'sesa 42 9602\nbusy-one 43 9603\nrecent 44 9604\nunknown 45 9605\n');
 const t=1e13,last={sesa:t-IDLE-1,'busy-one':t-IDLE-1,recent:t-60e3,unknown:null};const calls=[];
 const fetchImpl=async(url,o)=>{calls.push((o?.method||'GET')+' '+url);const ok=j=>({ok:true,json:async()=>j});
  if(url.endsWith('/json/list'))return ok([{id:'p1',type:'page',url:'https://threads.net'},{id:'p2',type:'page',url:'https://x'}]);return ok({})};
 const tidy=createBrowserTidy({portsFile:ports,now:()=>t,fetchImpl,log:()=>{},busy:async a=>a==='busy-one',lastActive:async a=>last[a]});
 assert.equal(await tidy.tick(),2);
 assert.deepEqual(calls,['GET http://127.0.0.1:9602/json/list','PUT http://127.0.0.1:9602/json/new?about:blank','GET http://127.0.0.1:9602/json/close/p1','GET http://127.0.0.1:9602/json/close/p2'])});
