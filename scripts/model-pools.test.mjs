// Tests for several ChatGPT plans (app/model-pools.mjs, 20 Nov 2026): what aqeelOS reads from the engine's sign-in screen and
// its pool, and what it lets into the terminal command. Run: node --test scripts/model-pools.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {cleanLabel,deviceOf,poolView} from '../app/model-pools.mjs';

test('the engine sign-in screen: its address and code are read; nothing else counts',()=>{
 const t='Signing in to OpenAI Codex...\nTo continue, follow these steps:\n  1. Open this URL in your browser:\n     https://auth.openai.com/codex/device\n  2. Enter this code:\n     SNVT-2ZDTS\nWaiting for sign-in... (press Ctrl+C to cancel)';
 assert.deepEqual(deviceOf(t),{url:'https://auth.openai.com/codex/device',code:'SNVT-2ZDTS'});
 assert.equal(deviceOf('Signing in to OpenAI Codex...\n'),null,'no code yet');assert.equal(deviceOf('https://evil.example/device\nEnter this code:\n ABCD-EFGHI'),null,'only OpenAI’s own address')});

test('a label goes into a terminal command: only plain characters, at most 40',()=>{
 assert.equal(cleanLabel("Aqeel's 2nd plan; rm -rf / $(x)"),'Aqeels 2nd plan rm -rf  x'.replace(/\s+/g,' '));assert.equal(cleanLabel('a'.repeat(60)).length,40);assert.equal(cleanLabel(''),'')});

test('the pool as the card shows it: labels, use and errors, never a token',()=>{
 const v=poolView({credential_pool:{'openai-codex':[{id:'5f9d9a',label:'device_code',priority:0,access_token:'SECRET',refresh_token:'SECRET',request_count:3},{id:'a1b2c3',label:'Work',priority:1,request_count:7,last_status:'exhausted',last_error_code:429}]}});
 assert.deepEqual(v.map(x=>[x.id,x.label,x.requests,x.status,x.error]),[['5f9d9a','ChatGPT',3,null,null],['a1b2c3','Work',7,'exhausted',429]]);
 assert.doesNotMatch(JSON.stringify(v),/SECRET/);assert.deepEqual(poolView({}),[]);assert.deepEqual(poolView(null),[])});
