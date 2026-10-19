import test from 'node:test';import assert from 'node:assert/strict';import {parseResponse,validatePrompt} from './server.mjs';
test('extracts Codex response and detects provider failure',()=>{assert.equal(parseResponse('codex','{"type":"item.completed","item":{"type":"agent_message","text":"Connected"}}').text,'Connected');assert.equal(parseResponse('codex','{"type":"turn.failed","error":{"message":"quota"}}').error,'quota')});
test('Claude errors remain failures even with successful process exit',()=>{assert.equal(parseResponse('claude','{"result":"Login required","is_error":true}').failed,true)});
test('rejects empty or oversized prompts',()=>{assert.throws(()=>validatePrompt(' '));assert.throws(()=>validatePrompt('x'.repeat(12001)));assert.equal(validatePrompt(' hello '),'hello')});
// the tool servers the AIs start (browser, desktop, app, aqeelOS) must at least parse, or the AI only sees "Connection closed"
test('every .mjs file parses',async()=>{const {readdirSync}=await import('node:fs');const {execFileSync}=await import('node:child_process');
 for(const f of readdirSync('.').filter(f=>f.endsWith('.mjs')))assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',f],{stdio:'pipe'}),f)});
test('the browser tool server answers tools/list',async()=>{const {spawnSync}=await import('node:child_process');
 const r=spawnSync(process.execPath,['browser-mcp.mjs'],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n',encoding:'utf8',timeout:5000});assert.match(r.stdout,/browser_open/)});
