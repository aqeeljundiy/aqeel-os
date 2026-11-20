// Every account of every provider shows what a Claude card shows (app/model-accounts.mjs, 20 Nov 2026).
// Run: node --test scripts/model-accounts.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';
import {codexWindows,claimsOf,splitSlug} from '../app/model-accounts.mjs';
test('ChatGPT limits: the 5-hour window and the week with their reset times; a reached limit with no full window shows full',()=>{
 const w=codexWindows({rate_limit:{primary_window:{used_percent:27,limit_window_seconds:18000,reset_at:1795194601},secondary_window:{used_percent:12,limit_window_seconds:604800,reset_at:1795552266}}});
 assert.deepEqual(w.map(x=>[x.label,x.used,x.scope]),[['Session (5 h)',27,'account'],['This week',12,'account']]);assert.equal(w[0].resets,new Date(1795194601000).toISOString());
 assert.deepEqual(codexWindows({rate_limit:{limit_reached:true,primary_window:{used_percent:90,limit_window_seconds:18000}}}).map(x=>x.used),[90,100]);assert.deepEqual(codexWindows(null),[])});
test('a sign-in token’s claims are read without its signature; a bad one gives nothing; account keys split',()=>{
 const tok='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/profile':{email:'a@example.com'},'https://api.openai.com/auth':{chatgpt_plan_type:'plus'}})).toString('base64url')+'.y';
 assert.equal(claimsOf(tok)['https://api.openai.com/profile'].email,'a@example.com');assert.deepEqual(claimsOf('nope'),{});
 assert.deepEqual(splitSlug('openai-codex#a1b2'),{base:'openai-codex',acct:'a1b2'});assert.deepEqual(splitSlug('xai'),{base:'xai',acct:''})});
