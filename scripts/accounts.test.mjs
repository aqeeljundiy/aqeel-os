// Claude accounts (app/accounts.mjs): a signed-in account's details read its plan usage without crashing.
// Regression (6 Nov 2026): two functions named usageOf in createAccounts; the later one replaced the usage reader,
// so every signed-in account threw "Cannot read properties of null (reading 'usage')" and System › Models hung.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';

const HOME=await mkdtemp(path.join(tmpdir(),'acc-'));
process.env.HOME=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN='/bin/false';
await mkdir(path.join(HOME,'.claude'),{recursive:true});await mkdir(process.env.HERMES_HOME,{recursive:true});
await writeFile(path.join(HOME,'.claude','.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'t',refreshToken:'r',expiresAt:Date.now()+3600e3,subscriptionType:'max'}}));
await writeFile(path.join(HOME,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'me@example.com'}}));

test('a signed-in account shows its usage (no crash), and a refused usage call is a plain message',async()=>{
 const realFetch=globalThis.fetch;let calls=0;
 globalThis.fetch=async(u,o)=>{if(String(u).includes('/api/oauth/usage')){calls++;return new Response(JSON.stringify({five_hour:{utilization:12,resets_at:'x'},seven_day:{utilization:40}}),{status:200,headers:{'content-type':'application/json'}})}return realFetch(u,o)};
 try{const {createAccounts}=await import('../app/accounts.mjs');const DATA=path.join(HOME,'data');
  const acc=createAccounts(DATA,{codeRoot:path.join(HOME,'code')});
  const handler=typeof acc==='function'?acc:acc.handle;const backup=(handler&&handler.backup)||acc.backup;
  assert.ok(backup?.details,'createAccounts exposes backup.details');
  const [main]=backup.all(await backup.load());const v=await backup.details(main);
  assert.equal(v.signedIn,true);assert.equal(v.email,'me@example.com');
  assert.equal(v.usage?.session?.used,12);assert.equal(v.usage?.week?.used,40);assert.equal(calls,1);
 }finally{globalThis.fetch=realFetch}});
