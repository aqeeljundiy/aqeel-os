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
// 12 Nov 2026: the poll test failed once in a full parallel run on Linux. Its ports were random picks in 39000-40500, inside Linux's
// ephemeral range, so another test's listen(0) could hold the "sleeping" inner port (the proxy then reached that server instead of
// answering 503); and the proxy had 4 s to come up, under load not always enough. Now the OS hands out two free ports, the proxy counts as
// up when it prints that it listens, and the stand-in Chrome when its listen() calls back: waits on real conditions, no fixed sleeps.
const freePorts=()=>new Promise((res,rej)=>{const a=createServer(),b=createServer();a.once('error',rej);b.once('error',rej);
 a.listen(0,'127.0.0.1',()=>b.listen(0,'127.0.0.1',()=>{const p=[a.address().port,b.address().port];a.close(()=>b.close(()=>res(p)))}))});
const listen=(srv,port)=>new Promise((res,rej)=>srv.once('error',rej).listen(port,'127.0.0.1',()=>res(srv)));
async function startProxy(t,dir,name){const [outer,inner]=await freePorts();writeFileSync(path.join(dir,'ports'),`${name} ${outer} ${inner}\n`);
 const p=spawn(process.execPath,[PROXY,dir],{stdio:['ignore','pipe','ignore']});t.after(()=>p.kill());let out='';
 await new Promise((res,rej)=>{const to=setTimeout(()=>rej(Error('the wake proxy did not listen within 60 s: '+out)),60000);
  p.stdout.on('data',c=>{out+=c;if(out.includes(' '+name+': '+outer+' -> '+inner)){clearTimeout(to);res()}});p.once('exit',c=>{clearTimeout(to);rej(Error('the wake proxy ended ('+c+'): '+out))})});
 return {outer,inner}}

test('ports file',()=>{const m=parsePorts('a1 9602 19602\nbad line\nb2 9603 9603\n# x\n');assert.deepEqual([...m.keys()],['a1']);assert.equal(m.get('a1').inner,19602)});

test('a sleeping Chrome is woken on the first connection, then traffic passes and marks the agent active',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'aq-wake-')),{outer,inner}=await startProxy(t,dir,'zz');
 // the "root script": starts Chrome (a stand-in on the inner port) when the wake file appears
 let chrome=null;const starter=setInterval(()=>{if(!chrome&&existsSync(path.join(dir,'zz.wake'))){chrome=createServer((q,r)=>r.end(JSON.stringify({Browser:'stand-in',host:q.headers.host}))).listen(inner,'127.0.0.1')}},100);
 t.after(()=>{clearInterval(starter);chrome?.close()});
 const r=await fetch(`http://127.0.0.1:${outer}/json/version`,{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
 assert.equal(r.Browser,'stand-in');assert.equal(r.host,'127.0.0.1:'+outer,'Chrome sees the outer port, so the ws addresses it hands out go through the proxy');
 assert.ok(existsSync(path.join(dir,'zz.active')));
 // awake: passes straight through
 const r2=await fetch(`http://127.0.0.1:${outer}/json/list`,{signal:AbortSignal.timeout(3000)}).then(r=>r.json());assert.equal(r2.Browser,'stand-in')});

test('a housekeeping poll never wakes a sleeping Chrome and never counts as use; real traffic still does',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'aq-wake-')),{outer,inner}=await startProxy(t,dir,'pp');
 const r=await fetch(`http://127.0.0.1:${outer}/json/list`,{headers:{'x-aqeel-poll':'1'},signal:AbortSignal.timeout(5000)});
 assert.equal(r.status,503,'asleep: answered at once');
 assert.ok(!existsSync(path.join(dir,'pp.wake')),'no wake asked');assert.ok(!existsSync(path.join(dir,'pp.active')),'no use marked');
 const chrome=await listen(createServer((q,s)=>s.end('{"ok":1}')),inner);t.after(()=>chrome.close());
 const r2=await fetch(`http://127.0.0.1:${outer}/json/list`,{headers:{'x-aqeel-poll':'1'},signal:AbortSignal.timeout(5000)});
 assert.equal(r2.status,200);assert.ok(!existsSync(path.join(dir,'pp.active')),'awake: passed through, still not use');
 await fetch(`http://127.0.0.1:${outer}/json/list`,{signal:AbortSignal.timeout(5000)});assert.ok(existsSync(path.join(dir,'pp.active')),'a real client marks use')});
