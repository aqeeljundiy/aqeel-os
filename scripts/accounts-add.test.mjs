// Tests for Connections › Add › A login (the owner adds a login an agent uses as them; until 7 Nov 2026 only an agent's
// register_account tool could). Run: node --test scripts/accounts-add.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createConnectedAccounts} from '../app/connected-accounts.mjs';

async function setup(){const root=await mkdtemp(path.join(tmpdir(),'ca-add-')),H=path.join(root,'.hermes'),DATA=path.join(root,'data'),W=path.join(root,'workspaces');
 for(const d of [path.join(H,'logs'),path.join(H,'profiles','sales','logs'),W])await mkdir(d,{recursive:true});
 const cfg={default:{mcp_servers:{}},sales:{mcp_servers:{}}};
 const ca=createConnectedAccounts({DATA,HERMES_HOME:H,WORK:W,listAgents:async()=>['default','sales'],readConfig:async a=>structuredClone(cfg[a]),setKey:async()=>({ok:true}),dash:async()=>({ok:true,status:200,j:{}}),bell:async()=>{},active:false,STEP:20});
 // list() starts background checks that may still write into DATA: let them settle, then remove with retries (a run in 3
 // failed with ENOTEMPTY when a late write landed during the removal, 7 Nov 2026)
 const done=async()=>{await ca.list().catch(()=>{});await new Promise(r=>setTimeout(r,200));
  for(let i=0;;i++){try{await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});return}catch(e){if(i>=5||!['ENOTEMPTY','EBUSY','EPERM'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,200))}}};
 return {root,H,ca,done}}

test('the owner registers a Google sign-in aqeelOS sees: registered as the owner\'s, at once',async()=>{const t=await setup();try{
 await t.ca.list({fresh:true});   // the first look takes what is there as known (seed); a login after it is new
 const f=path.join(t.H,'profiles','sales','google_token_shop.json');await writeFile(f,JSON.stringify({token:'t',refresh_token:'r',account:'shop@x.test'}));
 let l=await t.ca.list({fresh:true});assert.equal(l.items.find(x=>x.id==='google:shop@x.test').registered,false);
 const r=await t.ca.register('sales',{kind:'google',label:'Google, shop',where:f,can:['read']},{owner:'Aqeel'});assert.ok(!r.isError,r.text);assert.equal(r.id,'google:shop@x.test');
 l=await t.ca.list();const x=l.items.find(y=>y.id==='google:shop@x.test');assert.equal(x.registered,true);assert.equal(x.registeredBy,'owner: Aqeel');assert.deepEqual(x.can,['read'])}finally{await t.done()}});
test('another login (a file the owner names) is added as the owner\'s',async()=>{const t=await setup();try{
 const f=path.join(t.root,'workspaces','x.session');await writeFile(f,'s');const r=await t.ca.register('default',{kind:'other',label:'Shopee seller, me',where:f},{owner:''});assert.ok(!r.isError,r.text);
 const x=(await t.ca.list()).items.find(y=>y.id===r.id);assert.equal(x.registeredBy,'owner');assert.match(x.label,/Shopee seller, me/,'the owner\'s name for it shows')}finally{await t.done()}});
test('a place where nothing is stored, or a sign-in aqeelOS does not see, is said plainly and nothing is kept',async()=>{const t=await setup();try{
 let r=await t.ca.register('default',{kind:'other',label:'X',where:path.join(t.root,'nope')},{owner:'A'});assert.equal(r.isError,true);assert.match(r.text,/Nothing is stored/);
 r=await t.ca.register('default',{kind:'mcp-oauth',label:'Slack, me',where:''},{owner:'A'});assert.equal(r.isError,true);assert.match(r.text,/Connect it first/);
 assert.equal((await t.ca._db()).pending.length,0);
 r=await t.ca.register('default',{kind:'bogus',label:'X'},{owner:'A'});assert.equal(r.isError,true)}finally{await t.done()}});
