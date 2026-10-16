import test from 'node:test';import assert from 'node:assert/strict';import {parseResponse,validatePrompt} from './server.mjs';
test('extracts Codex response and detects provider failure',()=>{assert.equal(parseResponse('codex','{"type":"item.completed","item":{"type":"agent_message","text":"Connected"}}').text,'Connected');assert.equal(parseResponse('codex','{"type":"turn.failed","error":{"message":"quota"}}').error,'quota')});
test('Claude errors remain failures even with successful process exit',()=>{assert.equal(parseResponse('claude','{"result":"Login required","is_error":true}').failed,true)});
test('rejects empty or oversized prompts',()=>{assert.throws(()=>validatePrompt(' '));assert.throws(()=>validatePrompt('x'.repeat(12001)));assert.equal(validatePrompt(' hello '),'hello')});
