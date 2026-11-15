// A live run says what it is doing right now and for how long (owner, 15 Nov 2026: "in Claude Code you could visually see you're
// doing something ... Code looks too static"). Before, a run on aqeelOS models showed only "Working…" and "Starting aqeelOS models…".
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const stub=new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>'':stub,apply:()=>stub,construct:()=>stub});
globalThis.document??=stub;globalThis.window??=stub;
const {nowDoing,elapsed}=await import('./agent-ui.js');
const v={provider:'aqeelos',model:'aqeelos::openai-codex::gpt-6.1-sol',state:'running'},t=Date.now();

test('the line names what the run is doing, in plain words',()=>{
 assert.equal(nowDoing(v,[],t),'Starting gpt-6.1-sol');
 assert.equal(nowDoing(v,[{type:'file',status:'running',paths:[String.raw`C:\p\index.html`,'src/app.css'],time:t}],t),'Editing index.html, app.css');
 assert.equal(nowDoing(v,[{type:'command',status:'running',command:'npm  run\n build',time:t}],t),'Running npm run build');
 assert.equal(nowDoing(v,[{type:'tool',status:'running',name:'project_write',time:t}],t),'Using project_write');
 assert.equal(nowDoing(v,[{type:'thinking',time:t}],t),'Thinking');
 assert.equal(nowDoing(v,[{type:'message',time:t}],t),'Writing');
 assert.equal(nowDoing({...v,state:'waiting'},[],t),'Waiting for your approval')});
test('a quiet run says it is waiting for the model, and a finished step does not count as running',()=>{
 assert.equal(nowDoing(v,[{type:'message',time:t-9000}],t),'Waiting for gpt-6.1-sol');
 assert.equal(nowDoing(v,[{type:'file',status:'completed',paths:['a.html'],time:t-20000}],t),'Waiting for gpt-6.1-sol');
 assert.equal(nowDoing({...v,actualModel:'gemini-4-argon-medium'},[{type:'tool',status:'completed',name:'x',time:t-9000}],t),'Waiting for gemini-4-argon-medium')});
test('the clock reads in seconds, then minutes',()=>{assert.equal(elapsed(5400),'5 s');assert.equal(elapsed(59999),'59 s');assert.equal(elapsed(125000),'2 min 05 s');assert.equal(elapsed(-5),'0 s')});
test('the panel carries the line, ticks every second, and the run says when it started',async()=>{
 const ui=await readFile(new URL('./agent-ui.js',import.meta.url),'utf8'),css=await readFile(new URL('./studio.css',import.meta.url),'utf8'),run=await readFile(new URL('./agent.mjs',import.meta.url),'utf8');
 assert.match(ui,/setInterval\(\(\)=>paintNow\(run\),1000\)/);assert.match(ui,/clearInterval\(clock\)/);assert.match(run,/startedAt:this\.startedAt/);
 assert.match(css,/\.live-spin\{/);assert.match(css,/prefers-reduced-motion:reduce\)\{\.live-spin/)});
