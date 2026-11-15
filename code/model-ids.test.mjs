// 15 Nov 2026: with the Claude sign-in, Code offered only Haiku 4.5. The engine names that sign-in's models with a context suffix
// (claude-sonnet-5-5[1m]) and Code's id checks had no brackets, so Sonnet, Opus and the rest were dropped from the list and would have been
// refused as a run's model, here and on aqeelOS's engine route. Only that suffix is let in.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {modelIdOk,niceModel} from './models.mjs';
test('the Claude sign-in\'s models pass, with or without the engine provider in front; nothing else with brackets does',()=>{
 for(const id of ['claude-sonnet-5-5[1m]','claude-opus-5-5[1m]','claude-subscription-directsdk-experimental::claude-opus-5-5[1m]','claude-haiku-4-5-20251001','gpt-6.1-sol','antigravity-subscription::gemini-4-argon-medium','x[200k]'])assert.ok(modelIdOk(id),id);
 for(const id of ['a]','x[1m];rm','x[1m][1m]','x[abc]','[1m]','x y','x;y','a'.repeat(81)])assert.equal(modelIdOk(id),false,id)});
test('they read as people say them',()=>{
 assert.equal(niceModel('claude-sonnet-5-5[1m]'),'Sonnet 5.5 1M');assert.equal(niceModel('claude-opus-4-8[1m]'),'Opus 4.8 1M');
 assert.equal(niceModel('claude-haiku-4-5-20251001'),'Haiku 4.5');assert.equal(niceModel('gpt-6.1-sol'),'GPT-6.1 Sol')});
test('every check on the way uses it: the list, a run\'s model, a CLI build, and aqeelOS\'s engine route',async()=>{
 const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8'),api=await readFile(new URL('./workspace-api.mjs',import.meta.url),'utf8'),route=await readFile(new URL('../app/code-device-routes.mjs',import.meta.url),'utf8');
 assert.match(server,/if\(m\.id&&!modelIdOk\(m\.id\)\)return;/);assert.equal((api.match(/modelIdOk\(/g)||[]).length,2);assert.doesNotMatch(server+api,/\{1,80\}\$\/\.test/);
 const re=new RegExp(/if\(!\/(.+?)\/\.test\(provider\+model\)\)/.exec(route)[1]);assert.ok(re.test('claude-subscription-directsdk-experimentalclaude-sonnet-5-5[1m]'));assert.equal(re.test('x[1m];rm'),false)});
