// Pools through the Models page's own calls (app/accounts.mjs): an old fixed list is answered as groups without being
// rewritten, saving keeps pool members together, and an entry taken out of its pool stays out.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';

const HOME=await mkdtemp(path.join(tmpdir(),'accp-'));
process.env.HOME=HOME;process.env.USERPROFILE=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN=path.join(HOME,'no-claude');process.env.HERMES_API='http://127.0.0.1:9';
await mkdir(process.env.HERMES_HOME,{recursive:true});const DATA=path.join(HOME,'data');await mkdir(DATA,{recursive:true});
const OLD=[{key:'claude:main',model:''},{key:'p:openai-codex',model:''},{key:'claude:two',model:''},{key:'claude:three',model:''}];
await writeFile(path.join(DATA,'accounts.json'),JSON.stringify({accounts:[{id:'two',label:'Two',dir:path.join(HOME,'two')},{id:'three',label:'Three',dir:path.join(HOME,'three')}],assign:{},auto:{on:true,threshold:95},events:[],priority:OLD}));
const now=Date.now();await writeFile(path.join(DATA,'model-moves.jsonl'),[{at:new Date(now-3600e3).toISOString(),profile:'default',to:'claude:two',why:'Reached 96%'},{at:new Date(now-2*864e5).toISOString(),profile:'default',to:'claude:main',why:'old'}].map(x=>JSON.stringify(x)).join('\n')+'\n');
const {createAccounts}=await import('../app/accounts.mjs');const api=createAccounts(DATA);
const call=async(method,p,body)=>{let out;await api({method,url:p},{},p.split('?')[0],(res,status,j)=>{out={status,j}},async()=>JSON.stringify(body||{}));return out};

test('an old fixed list is shown as groups, the first entry first, and the saved list is left alone',async()=>{
 const r=await call('GET','/ui/accounts');assert.equal(r.status,200);
 assert.deepEqual(r.j.groups.map(g=>[g.pool,g.members.map(e=>e.key)]),[[true,['claude:main','claude:two','claude:three']],[false,['p:openai-codex']]]);
 assert.deepEqual(r.j.moves24,{auto:1,hand:0});assert.deepEqual(r.j.solo,[]);
 assert.deepEqual(JSON.parse(await readFile(path.join(DATA,'accounts.json'),'utf8')).priority,OLD)});

test('saving keeps pool members together; an entry taken out stays out until it is put back',async()=>{
 let r=await call('PUT','/ui/accounts/priority',{priority:OLD,solo:['claude:three|','claude:nobody|']});
 assert.deepEqual(r.j.priority.map(e=>e.key),['claude:main','claude:two','p:openai-codex','claude:three']);assert.deepEqual(r.j.solo,['claude:three|']);
 r=await call('GET','/ui/accounts');assert.deepEqual(r.j.groups.map(g=>[g.pool,g.alone,g.members.length]),[[true,false,2],[false,false,1],[false,true,1]]);
 // a save that says nothing about solo (the ⋯ menu's Add to priority) keeps it
 r=await call('PUT','/ui/accounts/priority',{priority:[...r.j.priority].reverse()});assert.deepEqual(r.j.solo,['claude:three|']);
 assert.deepEqual(r.j.priority.map(e=>e.key),['claude:three','p:openai-codex','claude:two','claude:main']);
 r=await call('PUT','/ui/accounts/priority',{priority:r.j.priority,solo:[]});assert.deepEqual(r.j.priority.map(e=>e.key),['claude:three','claude:two','claude:main','p:openai-codex']);
 const saved=JSON.parse(await readFile(path.join(DATA,'accounts.json'),'utf8'));assert.deepEqual(saved.solo,[]);assert.equal(saved.priority.length,4)});
