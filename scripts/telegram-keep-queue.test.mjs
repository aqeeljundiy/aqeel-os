// Owner, 18 Nov 2026: two "redo" messages sent to Donna on Telegram during the nightly restart were never answered: the engine's
// cold boot threw away what Telegram had queued. Every agent with Telegram keeps that queue, unless someone chose otherwise.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {keepQueueKeys} from '../app/accounts.mjs';
const K='platforms.telegram.extra.drop_pending_on_cold_boot';
test('an agent on Telegram that never chose gets the queue kept',()=>{
 assert.deepEqual(keepQueueKeys({platforms:{telegram:{enabled:true}}}),[K]);
 assert.deepEqual(keepQueueKeys({platforms:{telegram:{enabled:true,extra:{webhook_host:''}}}}),[K])});
test('a choice already made stays, either way; no Telegram or no settings means nothing to set',()=>{
 assert.deepEqual(keepQueueKeys({platforms:{telegram:{extra:{drop_pending_on_cold_boot:true}}}}),[]);
 assert.deepEqual(keepQueueKeys({platforms:{telegram:{extra:{drop_pending_on_cold_boot:false}}}}),[]);
 assert.deepEqual(keepQueueKeys({platforms:{whatsapp:{enabled:true}}}),[]);
 assert.deepEqual(keepQueueKeys(null),[]);assert.deepEqual(keepQueueKeys({platforms:{telegram:null}}),[])});
test('an agent on Telegram only through its bot token in .env (the support agents) gets it too; an empty token does not count',()=>{
 assert.deepEqual(keepQueueKeys({model:{default:'x'}},'A=1\nTELEGRAM_BOT_TOKEN=123:abc\n'),[K]);
 assert.deepEqual(keepQueueKeys({platforms:{telegram:null}},'TELEGRAM_BOT_TOKEN=123:abc'),[K]);
 assert.deepEqual(keepQueueKeys({model:{default:'x'}},'TELEGRAM_BOT_TOKEN=\n'),[]);
 assert.deepEqual(keepQueueKeys({platforms:{telegram:{extra:{drop_pending_on_cold_boot:true}}}},'TELEGRAM_BOT_TOKEN=1:a'),[]);
 assert.deepEqual(keepQueueKeys(null,'TELEGRAM_BOT_TOKEN=1:a'),[],'settings that could not be read: nothing is written')});
test('the health pass applies it to every agent, the main one included (not only new-agent setup)',async()=>{
 const s=await readFile(new URL('../app/server.mjs',import.meta.url),'utf8'),a=await readFile(new URL('../app/accounts.mjs',import.meta.url),'utf8');
 assert.match(s,/if\(!copy\)\{[^\n]*await accountHooks\.keepQueue\?\.\(a\)\.catch\(\(\)=>\{\}\)\}/);
 assert.match(a,/accountHooks\.keepQueue=async name=>\{const env=await readFile\(path\.join\(homeOf\(name\),'\.env'\)/);
 assert.match(a,/for\(const k of keepQueueKeys\(await readConfig\(name\),env\)\)await setKey\(name,k,'false'\)\}/)});
