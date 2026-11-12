// What aqeelOS does when it is back after a restart and the engine does not answer (app/resume.mjs, added with the end-to-end test
// scripts/resume-e2e.test.mjs): it asks again after 30 s, 1 minute, 2 minutes (not every tick), says it once on Health after five minutes,
// takes that item away when nothing waits any more, and tells a chat that was given up on what happened. With a fake clock.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {createResume} from '../app/resume.mjs';

const T0=Date.parse('2026-11-11T17:10:00Z'),dir=()=>mkdtempSync(path.join(tmpdir(),'aq-resume-stuck-'));
const chat={agent:'donna',session:'s1',user:'u1',userName:'Aqeel',text:'Post the weekly report',opts:{}};
function app(DATA,c,over={}){const asks=[],events=[],resolved=[],sent=[];
 const health={event:async(...a)=>{events.push(a)},resolve:async t=>{resolved.push(t)}};
 const r=createResume({DATA,actMs:1500,now:()=>c.t,log:()=>{},tz:()=>'Asia/Jakarta',stagger:0,sleep:async()=>{},health,backoff:true,
  ready:async()=>{asks.push(c.t);return c.up},probeChat:async()=>({stored:true,tools:[],lastAt:c.t-10*60e3}),sendChat:async(e,note)=>{sent.push(note);return {ok:true}},...over});
 return {r,asks,events,resolved,sent}}

test('an engine that does not answer is asked again with growing gaps, not on every tick',async()=>{const D=dir(),c={t:T0,up:false};
 app(D,c).r.begin(chat);c.t+=60e3;const a=app(D,c);a.r.boot();
 for(let i=0;i<30;i++){await a.r.run();c.t+=30e3}   // fifteen minutes of 30 s ticks
 const gaps=a.asks.slice(1).map((t,i)=>t-a.asks[i]);
 assert.ok(a.asks.length<=10,'asked '+a.asks.length+' times in 15 minutes, not 30');assert.ok(gaps.every((g,i)=>i===0||g>=gaps[i-1]),'the gaps never shrink: '+gaps.map(g=>g/1000));
 assert.ok(gaps.at(-1)>=120e3);assert.equal(a.sent.length,0)});

test('after five minutes of waiting there is one Health item; it goes when the engine answers and the reply is continued once',async()=>{const D=dir(),c={t:T0,up:false};
 app(D,c).r.begin(chat);c.t+=60e3;const a=app(D,c);a.r.boot();
 await a.r.run();assert.equal(a.events.length,0,'not at once');
 for(let i=0;i<20;i++){c.t+=30e3;await a.r.run()}
 assert.equal(a.events.length,1,'one item, however many tries');assert.equal(a.events[0][0],'resume');assert.equal(a.events[0][3].topic,'resume-waiting');assert.match(a.events[0][1],/1 interrupted thing/);assert.match(a.events[0][2],/engine is not answering/);
 c.up=true;c.t+=130e3;await a.r.run();assert.equal(a.sent.length,1);assert.deepEqual(a.resolved,['resume-waiting']);assert.equal(a.r.pending(),0);
 c.t+=60e3;await a.r.run();assert.equal(a.events.length,1);assert.equal(a.sent.length,1)});

test('a chat that was given up on is told so for a day; one that was continued is not',async()=>{const D=dir(),c={t:T0,up:true};
 const x=app(D,c);x.r.begin(chat);c.t+=60e3;
 const a=app(D,c,{probeChat:async()=>({stored:true,tools:[],lastAt:c.t-10*60e3})});a.r.boot();c.t+=3*3600e3;await a.r.run();   // far older than the limit
 const p=a.r.peekFor('donna','s1');assert.equal(p.user,'u1');assert.match(p.peek.gaveUp,/older than/);assert.equal(p.peek.interrupted,undefined);
 assert.equal(a.r.peekFor('donna','other'),null);c.t+=25*3600e3;assert.equal(a.r.peekFor('donna','s1'),null,'only for a day')});
