import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKirimdev} from '../app/kirimdev.mjs';
test('outbound failure persists exact payload and stable key across restart',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'outbox-')); const at=Date.now();
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{a:{phoneNumberId:'111',mode:'test',testers:[{phone:'628123'}]}}}));
 await writeFile(path.join(DATA,'kirimdev-state.json'),JSON.stringify({recent:{'a|628123':at}}));
 let fail=true;const requests=[];const opts={DATA,WORK:DATA,apiKey:async()=> 'fake',wait:async()=>{},log:()=>{},fetchImpl:async(u,o)=>{requests.push(o);if(fail)throw Error('connection lost');return {ok:true,json:async()=>({data:{id:'receipt',status:'pending'}})}}};
 const k=createKirimdev(opts);await assert.rejects(k.reply('a','628123','hello'));
 const disk=JSON.parse(await readFile(path.join(DATA,'kirimdev-state.json')));assert.equal(Object.values(disk.outbox).length,1);
 fail=false;const restarted=createKirimdev(opts);await restarted._tick();
 assert.equal(requests.length,2);assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);assert.equal(requests[0].body,requests[1].body);
 assert.equal(Object.values((await restarted._state()).outbox)[0].receipt.id,'receipt');
 await restarted._tick();assert.equal(requests[2].method,'GET');
});
test('partial multipart restart replays accepted-but-uncommitted part with same key, never first part',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'outbox-crash-'));const stateFile=path.join(DATA,'kirimdev-state.json');
 await writeFile(path.join(DATA,'kirimdev.json'),JSON.stringify({lines:{a:{phoneNumberId:'111',mode:'test',testers:[{phone:'628123'}]}}}));
 await writeFile(stateFile,JSON.stringify({recent:{'a|628123':Date.now()}}));
 const accepted=new Map(),requests=[];let crashSnapshot;
 const opts={DATA,WORK:DATA,apiKey:async()=> 'fake',wait:async()=>{},log:()=>{},fetchImpl:async(u,o)=>{
  if(o.method==='GET')return {ok:true,json:async()=>({data:{id:u.split('/').pop(),status:'delivered'}})};
  const key=o.headers['idempotency-key'];requests.push(key);
  if(!accepted.has(key))accepted.set(key,{id:'msg_'+accepted.size,status:'queued'});
  if(requests.length===2){crashSnapshot=await readFile(stateFile);throw Error('crash after acceptance')}
  return {ok:true,json:async()=>({data:accepted.get(key)})};
 }};
 await assert.rejects(createKirimdev(opts).reply('a','628123','one\n---\ntwo\n---\nthree'));
 assert.equal(Object.keys(JSON.parse(crashSnapshot).outbox).length,3);
 // Restore the exact pre-response disk image, as a killed process would leave it.
 await writeFile(stateFile,crashSnapshot);const k=createKirimdev(opts);await k._tick();
 assert.equal(accepted.size,3);assert.equal(requests.length,4);assert.equal(requests[1],requests[2]);assert.notEqual(requests[0],requests[2]);
 assert.equal(Object.values((await k._state()).outbox).filter(o=>o.receipt?.id).length,3);
});
