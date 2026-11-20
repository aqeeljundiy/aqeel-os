// The engine's emergency stop is never silent (app/estop-watch.mjs, 21 Nov 2026). Run: node --test scripts/estop-watch.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createEstopWatch,estopText} from '../app/estop-watch.mjs';
test('while the stop is on: one Needs-you item at once, one Telegram message after two minutes per stop; lifted: the item goes',async()=>{
 const H=await mkdtemp(path.join(tmpdir(),'es-'));let t=Date.parse('2026-11-20T12:15:42Z');const ev=[],gone=[],sent=[];
 const w=createEstopWatch({HERMES_HOME:H,bottlenecks:{event:async(...a)=>ev.push(a),resolve:async k=>gone.push(k)},send:async x=>sent.push(x),now:()=>t,log:()=>{},tz:()=>'Asia/Jakarta'});
 assert.equal(await w.tick(),null);assert.equal(ev.length,0);
 await writeFile(path.join(H,'ESTOP'),JSON.stringify({engaged_at:'2026-11-20T12:15:42+00:00',reason:null}));
 await w.tick();assert.equal(ev.at(-1)[0],'estop');assert.match(ev.at(-1)[2],/since 19:15/);assert.equal(sent.length,0,'not yet: it may be lifted at once');
 t+=3*60e3;await w.tick();await w.tick();assert.equal(sent.length,1,'once per stop');assert.match(sent[0],/Every agent on this server is paused/);
 await rm(path.join(H,'ESTOP'));await w.tick();assert.deepEqual(gone,['estop']);
 assert.match(estopText({engaged_at:'2026-11-20T12:15:42Z',reason:'deploy'},Date.parse('2026-11-20T12:45:42Z'),'Asia/Jakarta').text,/since 19:15 \(30 min\), reason: deploy/)});
