// Claude replies stream into the open chat (14 Nov 2026): the Claude plugin opts in to the engine's streaming dispatch, the chat shows
// each assistant.delta as it comes, and when the turn ends Chat.settle() puts the engine's checked final text in place of what
// streamed after the last tool step. node --test scripts/chat-stream.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/chat.js',import.meta.url),'utf8');
const m=src.match(/\n settle\(ai,c\)\{[\s\S]*?\},\n onEvent\(/);
const Chat=new Function(`return {${m[0].trim().replace(/,\s*onEvent\($/,'')}}`)();
const plugin=readFileSync(new URL('../engine/claude-subscription-directsdk-experimental/__init__.py',import.meta.url),'utf8');

// the chat's own handling, replayed on one turn: deltas append, a tool step marks where the next step's text starts
function run(events){const ai={text:'',steps:[]};for(const e of events){
 if(e.type==='assistant.delta'){const d=e.delta||'';if(d){ai.text+=d;ai.streamed=true}}
 else if(e.type==='assistant.commentary'){if(!e.already_streamed&&e.text)ai.text+=(ai.text?'\n\n':'')+e.text}
 else if(e.type==='tool.started'){ai.steps.push({});ai.segAt=ai.text.length}
 else if(e.type==='assistant.completed'){const c=e.content;if(c)ai.text=Chat.settle(ai,c)}}return ai.text}
const D=t=>({type:'assistant.delta',delta:t}),T={type:'tool.started'},F=c=>({type:'assistant.completed',content:c});

test('the Claude plugin opts in to streaming before it registers',()=>{
 const i=plugin.indexOf('profile.supports_streaming = True'),r=plugin.indexOf('register_provider(profile)');
 assert.ok(i>0&&r>i,'supports_streaming is set on the profile before register_provider')});

test('the chat shows deltas as they come, marks tool steps, and settles the end through settle()',()=>{
 assert.match(src,/case 'assistant\.delta':\{const d=e\.delta\|\|e\.text\|\|'';if\(d\)\{ai\.text\+=d;ai\.streamed=true\}break\}/);
 assert.match(src,/callId:e\.tool_call_id\|\|e\.call_id\|\|''\}\);ai\.segAt=ai\.text\.length;break;/);
 assert.match(src,/case 'assistant\.completed':\{[^\n]*if\(c\)ai\.text=this\.settle\(ai,c\)\}/);
 assert.match(src,/<div class="text md \$\{s\.running&&last\?'streaming':''\}">/,'the running reply is drawn while it streams')});

test('a one-step reply ends exactly as the engine\'s final text',()=>{
 assert.equal(run([D('Hel'),D('lo **there**'),F('Hello **there**')]),'Hello **there**');
 assert.equal(run([D('Hi\n'),F('Hi')]),'Hi\n','streamed text equal to the final one stays as streamed')});

test('steps before the last tool stay, the last step is not doubled',()=>{
 const t=run([D('Let me check.'),T,D('\n\nIt is 12.'),F('It is 12.')]);
 assert.equal(t,'Let me check.\n\nIt is 12.');
 assert.equal(t.split('It is 12.').length,2,'no duplicate')});

test('a final text the reply checks changed replaces what streamed in the last step',()=>{
 // aqeelos-live holds a traceback back from the owner's chat and says so
 const note='(A script error was held back from this chat; it is in my health list and I am fixing it.)';
 const t=run([D('Looking.'),T,D('\n\nTraceback (most recent call last):\n  File "x.py", line 1\nKeyError: 1\n\nDone.'),F('Done.\n\n'+note)]);
 assert.equal(t,'Looking.\n\nDone.\n\n'+note);assert.doesNotMatch(t,/Traceback/);
 // a one-step reply whose final text dropped part of what streamed
 assert.equal(run([D('Traceback (most recent call last):\nKeyError: 1\n\nDone.'),F('Done.')]),'Done.')});

test('no text after the last tool: the final text that repeats the step before is not added again',()=>{
 assert.equal(run([D('All set, the file is saved.'),T,F('All set, the file is saved.')]),'All set, the file is saved.');
 assert.equal(run([D('Saving.'),T,F('Saved it.')]),'Saving.\n\nSaved it.')});

test('without deltas (a provider that does not stream) the old rule holds: the longer text wins',()=>{
 assert.equal(run([{type:'assistant.commentary',text:'Checking the sheet now.'},T,F('Yes.')]),'Checking the sheet now.');
 assert.equal(run([{type:'assistant.commentary',text:'One sec.'},T,F('Here is the full answer.')]),'Here is the full answer.');
 assert.equal(run([F('Only the end.')]),'Only the end.')});
