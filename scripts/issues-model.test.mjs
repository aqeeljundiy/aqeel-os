// The fixer on any signed-in model (app/issues.mjs providerOf, 20 Nov 2026). Run: node --test scripts/issues-model.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {providerOf,fixerModel} from '../app/issues.mjs';
test('a fixer model may name its provider; a plain name runs on the fixer agent’s own provider',()=>{
 assert.deepEqual(providerOf('openai-codex::gpt-6.2-sol'),{provider:'openai-codex',model:'gpt-6.2-sol'});
 assert.deepEqual(providerOf('antigravity-subscription::gemini-3.8-flash-high'),{provider:'antigravity-subscription',model:'gemini-3.8-flash-high'});
 assert.deepEqual(providerOf('claude-sonnet-5-5[1m]'),{provider:'',model:'claude-sonnet-5-5[1m]'});assert.deepEqual(providerOf('ollama:qwen3:8b'),{provider:'',model:'ollama:qwen3:8b'});
 assert.equal(fixerModel({fixer:{models:{sort:'antigravity-subscription::gemini-3.8-flash-high'}}},'sort',1).model,'antigravity-subscription::gemini-3.8-flash-high','the policy keeps the provider with the model')});
