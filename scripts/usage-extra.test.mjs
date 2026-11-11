// app/usage-extra.mjs: Antigravity quota read (cloudcode-pa) and Claude usage from reply headers when the usage call is refused (12 Nov 2026).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {agyWindows,createAgyQuota,claudeHeaderUsage} from '../app/usage-extra.mjs';

const MODELS={models:{'gemini-3-flash':{displayName:'Gemini 3 Flash',quotaInfo:{remainingFraction:0.25,resetTime:'2026-11-12T01:00:00Z'}},
 'gemini-2.5-pro':{displayName:'Gemini 2.5 Pro',quotaInfo:{remainingFraction:1,resetTime:'2026-11-12T05:00:00Z'}},
 'claude-opus-5-5-high':{displayName:'Claude Opus 5.5',quotaInfo:{remainingFraction:0,resetTime:'2026-11-12T03:00:00Z'}},
 'gemini-3.1-flash-image':{displayName:'Image',quotaInfo:{remainingFraction:1}},
 tab_flash_lite_preview:{quotaInfo:{remainingFraction:0}},chat_23310:{displayName:'x',isInternal:true,quotaInfo:{remainingFraction:0}},
 'gpt-oss-120b-medium':{displayName:'GPT-OSS',quotaInfo:{remainingFraction:0.5,resetTime:'2026-11-12T02:00:00Z'}}}};

test('agyWindows: one window per model family with the lowest room, internal models left out',()=>{
 const w=agyWindows(MODELS);const by=Object.fromEntries(w.map(x=>[x.label,x]));
 assert.deepEqual(w.map(x=>x.label),['Gemini (Antigravity)','Claude (Antigravity)','Other models (Antigravity)','Images (Antigravity)']);
 assert.equal(by['Gemini (Antigravity)'].used,75);assert.equal(by['Gemini (Antigravity)'].resets,'2026-11-12T01:00:00Z');
 assert.equal(by['Claude (Antigravity)'].used,100);assert.equal(by['Images (Antigravity)'].scope,'image');assert.equal(by['Images (Antigravity)'].resets,null);
 assert.ok(w.every(x=>x.scope!=='account'),'shown only, never moves an agent');assert.deepEqual(agyWindows({}),[])});

async function tokenFile(expiry){const f=path.join(await mkdtemp(path.join(tmpdir(),'agy-')),'t.json');await writeFile(f,JSON.stringify({token:{access_token:'a',refresh_token:'r',expiry}}));return f}

test('Antigravity: reads plan and limits, caches 10 min, backs off after a refusal, no sign-in is said plainly',async()=>{
 let t=1e12,calls=[],mode='ok';const f=await tokenFile(new Date(t+3600e3).toISOString());const fetchImpl=async(u,o)=>{calls.push(u.split(':').pop());assert.equal(o.headers.authorization,'Bearer a');
  if(mode==='429')return new Response('{}',{status:429,headers:{'retry-after':'900'}});
  return new Response(JSON.stringify(u.endsWith('loadCodeAssist')?{cloudaicompanionProject:'p1',paidTier:{name:'Google AI Pro'}}:MODELS),{status:200})};
 const q=createAgyQuota({now:()=>t,fetchImpl,tokenFile:()=>f});
 let r=await q.read();assert.equal(r.signedIn,true);assert.equal(r.plan,'Google AI Pro');assert.equal(r.windows.length,4);assert.deepEqual(calls,['loadCodeAssist','fetchAvailableModels']);
 t+=5*60e3;await q.read();assert.equal(calls.length,2,'cached');
 t+=6*60e3;mode='429';await q.read();await q.idle();assert.equal(calls.length,3,'asked again after 10 min, models only (project kept)');assert.equal(calls[2],'fetchAvailableModels');
 r=await q.read();assert.match(r.error,/not giving out/);assert.equal(r.windows.length,4,'last reading kept');
 t+=11*60e3;await q.read();await q.idle();assert.equal(calls.length,3,'waits its Retry-After (15 min)');
 const none=createAgyQuota({tokenFile:()=>path.join(tmpdir(),'nope-agy-token'),fetchImpl:async()=>{throw new Error('no')}});
 r=await none.read();assert.equal(r.signedIn,false);assert.deepEqual(r.windows,[])});

test('Antigravity: an expired token file is not sent anywhere',async()=>{
 let n=0;const f=await tokenFile('2020-01-01T00:00:00Z');const q=createAgyQuota({tokenFile:()=>f,fetchImpl:async()=>{n++;return new Response('{}')}});
 const r=await q.read();assert.equal(n,0);assert.match(r.error,/renewed/)});

test('Claude header usage: 5 h and 7 day from a 1-token answer, also when that answer is the limit itself',async()=>{
 const hd={'anthropic-ratelimit-unified-5h-utilization':'0.34','anthropic-ratelimit-unified-5h-reset':'1794433200','anthropic-ratelimit-unified-7d-utilization':'0.24','anthropic-ratelimit-unified-7d-reset':'1794632400','anthropic-ratelimit-unified-status':'allowed'};
 for(const status of [200,429]){let seen;const h=await claudeHeaderUsage('tok',{fetchImpl:async(u,o)=>{seen={u,o};return new Response('{}',{status,headers:hd})}});
  assert.equal(h.session.used,34);assert.equal(h.week.used,24);assert.equal(h.week.resets,new Date(1794632400e3).toISOString());assert.equal(h.opus,null);
  assert.match(seen.u,/\/v1\/messages$/);assert.equal(JSON.parse(seen.o.body).max_tokens,1)}
 assert.equal(await claudeHeaderUsage('tok',{fetchImpl:async()=>new Response('{}',{status:500})}),null);
 assert.equal(await claudeHeaderUsage('tok',{fetchImpl:async()=>{throw new Error('x')}}),null)});

import {mkdir,readFile} from 'node:fs/promises';import {deadLogins} from '../app/usage-extra.mjs';
test('deadLogins: a provider whose every pool entry is dead; a missing file is none',async()=>{
 const f=path.join(await mkdtemp(path.join(tmpdir(),'dead-')),'auth.json');
 await writeFile(f,JSON.stringify({credential_pool:{'openai-codex':[{last_status:'dead'}],nous:[{last_status:'ok'},{last_status:'dead'}],x:[]}}));
 assert.deepEqual([...await deadLogins(f)],['openai-codex']);assert.equal((await deadLogins(f+'.none')).size,0)});

test('accounts: a usage call answered 429 shows the numbers from the reply headers, and the real call is not asked again for 10 min',async()=>{
 const HOME=await mkdtemp(path.join(tmpdir(),'acc2-'));process.env.HOME=HOME;process.env.USERPROFILE=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN='/bin/false';
 await mkdir(path.join(HOME,'.claude'),{recursive:true});await mkdir(process.env.HERMES_HOME,{recursive:true});
 await writeFile(path.join(HOME,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'t',refreshToken:'r',expiresAt:Date.now()+3600e3,subscriptionType:'max'}}));
 await writeFile(path.join(HOME,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'me@example.com'}}));
 const real=globalThis.fetch;let usage=0,msgs=0;
 globalThis.fetch=async(u,o)=>{if(String(u).includes('/api/oauth/usage')){usage++;return new Response('{}',{status:429,headers:{'retry-after':'278'}})}
  if(String(u).includes('/v1/messages')){msgs++;return new Response('{}',{status:200,headers:{'anthropic-ratelimit-unified-5h-utilization':'0.34','anthropic-ratelimit-unified-5h-reset':'1794433200','anthropic-ratelimit-unified-7d-utilization':'0.24','anthropic-ratelimit-unified-7d-reset':'1794632400'}})}return real(u,o)};
 try{const {createAccounts}=await import('../app/accounts.mjs');const acc=createAccounts(path.join(HOME,'data'),{codeRoot:path.join(HOME,'code')});
  const backup=acc.backup;const [main]=backup.all(await backup.load());const v=await backup.details(main);
  assert.equal(v.usage?.session?.used,34);assert.equal(v.usage?.week?.used,24);assert.equal(v.usageVia,'headers');assert.ok(!v.usageError);
  const again=await backup.details(main);assert.equal(usage,1);assert.equal(msgs,1,'cached, nothing asked again');
 }finally{globalThis.fetch=real}});
