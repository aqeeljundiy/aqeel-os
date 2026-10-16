import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Remote,isLoopback} from './remote.mjs';
test('pairing needs phone access on, a fresh code, and limits attempts',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cba-remote-'));await mkdir(path.join(root,'data'));try{
 const r=await new Remote(root).init();await assert.rejects(r.pair('123456'),/turned off/);
 await r.setEnabled(true);await assert.rejects(r.pair('123456'),/expired/);
 const code=r.newCode().value;const wrong=code==='000000'?'111111':'000000';await assert.rejects(r.pair(wrong),/not right/);
 const token=await r.pair(code,'Test phone');assert.ok(token.length>30);await assert.rejects(r.pair(code),/expired/,'a code works once');
 const dev=r.device('other=1; cba_device='+token);assert.equal(dev.name,'Test phone');assert.equal(r.device('cba_device=nope'),null);
 const again=await new Remote(root).init();assert.equal(again.device('cba_device='+token).name,'Test phone','devices persist');
 await again.revoke(dev.id);assert.equal(again.device('cba_device='+token),null);
 const c2=again.newCode().value;for(let i=0;i<5;i++)await assert.rejects(again.pair(c2==='999999'?'888888':'999999'));await assert.rejects(again.pair(c2),/Too many|expired/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('loopback detection',()=>{for(const a of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.ok(isLoopback(a));for(const a of ['192.168.1.5','::ffff:10.0.0.2',''])assert.ok(!isLoopback(a))});
