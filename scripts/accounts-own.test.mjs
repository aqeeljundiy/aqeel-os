// The owner's own logins are never a question (7 Nov 2026, owner: "approve my own Notion login" was noise).
// app/connected-accounts.mjs: a login only the main agent holds, one an admin started from Connections, or a Google
// account connected in the app is registered at once and its old item leaves; another agent's login is asked about in
// plain words, with the login named so Keep it and Disconnect act directly. Run: node --test scripts/accounts-own.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createConnectedAccounts} from '../app/connected-accounts.mjs';

async function setup({origins={}}={}){const root=await mkdtemp(path.join(tmpdir(),'ca-own-')),H=path.join(root,'.hermes'),DATA=path.join(root,'data'),W=path.join(root,'workspaces');
 for(const d of [path.join(H,'logs'),path.join(H,'mcp-tokens'),path.join(H,'profiles','sales','logs'),path.join(H,'profiles','sales','mcp-tokens'),W])await mkdir(d,{recursive:true});
 const cfg={default:{mcp_servers:{}},sales:{mcp_servers:{}}},bells=[],solved=[];
 const mk=()=>createConnectedAccounts({DATA,HERMES_HOME:H,WORK:W,listAgents:async()=>['default','sales'],readConfig:async a=>structuredClone(cfg[a]),setKey:async()=>({ok:true}),dash:async()=>({ok:true,status:200,j:{}}),
  active:true,STEP:20,nameOf:a=>a==='default'?'Dora AI':a==='sales'?'Sales':a,whyOf:{app:async(a,n)=>origins[a+'|'+n]||null,accountOf:async()=>null,learnAccount:async()=>null},
  bell:async(t,d,o)=>bells.push({t,d,o}),solve:async id=>solved.push(id)});
 // an app signed in as the person (OAuth), on one agent
 const notion=async(a,name)=>{cfg[a].mcp_servers[name]={url:'https://mcp.notion.com/mcp',auth:'oauth'};const d=a==='default'?path.join(H,'mcp-tokens'):path.join(H,'profiles',a,'mcp-tokens');
  await writeFile(path.join(d,name+'.json'),JSON.stringify({access_token:'t',refresh_token:'r',hermes_issuer:'https://mcp.notion.com'}))};
 let ca=mk();
 const done=async()=>{await new Promise(r=>setTimeout(r,200));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50}).catch(()=>{})};
 return {root,H,DATA,cfg,bells,solved,notion,get ca(){return ca},restart:()=>{ca=mk();return ca},done}}

test('the main agent\'s own Notion sign-in is registered as the owner\'s, never asked about',async()=>{const t=await setup();try{
 await t.ca.scan();await t.notion('default','notion-abel');await t.ca.scan();
 const x=(await t.ca._db()).accounts['mcp:notion-abel'];assert.equal(x.registered,true);assert.match(x.registeredBy,/own sign-in: the main agent/);assert.deepEqual(t.bells,[])}finally{await t.done()}});

test('another agent\'s sign-in as the owner is asked about in plain words, naming the login',async()=>{const t=await setup();try{
 await t.ca.scan();await t.notion('sales','notion-x');await t.ca.scan();
 assert.equal((await t.ca._db()).accounts['mcp:notion-x'].registered,false);assert.equal(t.bells.length,1);const b=t.bells[0];
 assert.equal(b.t,'Sales signed in to Notion as you');assert.match(b.d,/It can now read and change things in Notion as you\.$/);
 assert.deepEqual(b.o.data.account,'mcp:notion-x');assert.equal(b.o.topic,'accounts|mcp:notion-x');
 await t.ca.scan();assert.equal(t.bells.length,1,'asked once');
 await t.ca.approve('mcp:notion-x','Abel');assert.ok(t.solved.includes('mcp:notion-x'),'Keep it takes the item away')}finally{await t.done()}});

test('a sign-in an admin started from Connections is his, even on another agent; a member\'s is still asked',async()=>{
 let t=await setup({origins:{'sales|notion-x':{by:'person',admin:true}}});try{await t.ca.scan();await t.notion('sales','notion-x');await t.ca.scan();
  assert.equal((await t.ca._db()).accounts['mcp:notion-x'].registered,true);assert.deepEqual(t.bells,[])}finally{await t.done()}
 t=await setup({origins:{'sales|notion-x':{by:'person',admin:false}}});try{await t.ca.scan();await t.notion('sales','notion-x');await t.ca.scan();
  assert.equal(t.bells.length,1)}finally{await t.done()}});

test('a Google account connected in the app is his on any agent',async()=>{const t=await setup();try{await t.ca.scan();
 await writeFile(path.join(t.H,'profiles','sales','google_token_shop.json'),JSON.stringify({token:'t',refresh_token:'r',account:'shop@x.test',aqeelos_connected:1}));await t.ca.scan();
 assert.equal((await t.ca._db()).accounts['google:shop@x.test'].registered,true);assert.deepEqual(t.bells,[])}finally{await t.done()}});

test('on the next start, an owner\'s login asked about before this rule is approved and every old item leaves',async()=>{const t=await setup();try{
 await t.ca.scan();await t.notion('default','notion-polar');await t.ca.scan();await new Promise(r=>setTimeout(r,100));
 // as before the rule: written down as not registered and already told
 const f=path.join(t.DATA,'connected-accounts.json');const j=JSON.parse(await readFile(f,'utf8'));j.accounts['mcp:notion-polar'].registered=false;j.accounts['mcp:notion-polar'].registeredBy='';j.told['mcp:notion-polar']=1;await writeFile(f,JSON.stringify(j));
 t.solved.length=0;const ca=t.restart();await ca.scan();
 assert.equal((await ca._db()).accounts['mcp:notion-polar'].registered,true);assert.ok(t.solved.includes('mcp:notion-polar'));assert.ok(t.solved.includes(null),'with nothing left to ask, the old items go too');assert.deepEqual(t.bells,[])}finally{await t.done()}});
