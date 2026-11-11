// OPS-4/OPS-12: the wake proxy passes an agent's DevTools port through to Chrome's inner port, and when Chrome is not
// there (asleep) asks for a start (<dir>/<agent>.wake) and waits for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parsePorts} from './wake-proxy.mjs';

const PROXY=path.join(path.dirname(fileURLToPath(import.meta.url)),'wake-proxy.mjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('ports file',()=>{const m=parsePorts('a1 9602 19602\nbad line\nb2 9603 9603\n# x\n');assert.deepEqual([...m.keys()],['a1']);assert.equal(m.get('a1').inner,19602)});

test('a sleeping Chrome is woken on the first connection, then traffic passes and marks the agent active',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'aq-wake-')),outer=39000+Math.floor(Math.random()*500),inner=outer+600;
 writeFileSync(path.join(dir,'ports'),`zz ${outer} ${inner}\n`);
 const p=spawn(process.execPath,[PROXY,dir],{stdio:'ignore'});t.after(()=>p.kill());
 for(let i=0;i<40;i++){await wait(100);try{await fetch(`http://127.0.0.1:${outer}/x`,{signal:AbortSignal.timeout(50)})}catch(e){if(!/refused/i.test(String(e.cause?.code||e.cause||e)))break}}
 // the "root script": starts Chrome (a stand-in on the inner port) when the wake file appears
 let chrome=null;const starter=setInterval(()=>{if(!chrome&&existsSync(path.join(dir,'zz.wake'))){chrome=createServer((q,r)=>r.end(JSON.stringify({Browser:'stand-in',host:q.headers.host}))).listen(inner,'127.0.0.1')}},100);
 t.after(()=>{clearInterval(starter);chrome?.close()});
 const r=await fetch(`http://127.0.0.1:${outer}/json/version`,{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
 assert.equal(r.Browser,'stand-in');assert.equal(r.host,'127.0.0.1:'+outer,'Chrome sees the outer port, so the ws addresses it hands out go through the proxy');
 assert.ok(existsSync(path.join(dir,'zz.active')));
 // awake: passes straight through
 const r2=await fetch(`http://127.0.0.1:${outer}/json/list`,{signal:AbortSignal.timeout(3000)}).then(r=>r.json());assert.equal(r2.Browser,'stand-in')});
