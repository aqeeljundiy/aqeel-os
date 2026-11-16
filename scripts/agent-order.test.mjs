// An agent's own model order (owner, 16 Nov 2026: "the agent could choose its own priority"), through the Models page's own calls
// (app/accounts.mjs): saved per agent from the main order's entries, some switched off; every switch reads it (orderOf); a main entry it
// does not list yet comes last; back to the main order with order: null.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';

const HOME=await mkdtemp(path.join(tmpdir(),'acco-'));
process.env.HOME=HOME;process.env.USERPROFILE=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN=path.join(HOME,'no-claude');process.env.HERMES_API='http://127.0.0.1:9';
for(const a of ['shop','desk'])await mkdir(path.join(process.env.HERMES_HOME,'profiles',a),{recursive:true}).then(()=>writeFile(path.join(process.env.HERMES_HOME,'profiles',a,'config.yaml'),'model: {}\n'));
const DATA=path.join(HOME,'data');await mkdir(DATA,{recursive:true});
const MAIN=[{key:'claude:main',model:''},{key:'claude:two',model:''},{key:'p:antigravity-subscription',model:''},{key:'p:openai-codex',model:''}];
await writeFile(path.join(DATA,'accounts.json'),JSON.stringify({accounts:[{id:'two',label:'Two',dir:path.join(HOME,'two')}],assign:{},auto:{on:false,threshold:95},events:[],priority:MAIN}));
const {createAccounts}=await import('../app/accounts.mjs');const api=createAccounts(DATA);
const call=async(method,p,body,see=()=>true)=>{let out;await api({method,url:p},{},p.split('?')[0],(res,status,j)=>{out={status,j}},async()=>JSON.stringify(body||{}),see);return out};
const keys=l=>l.map(e=>e.key);

test('an agent gets its own order: its entries in its order, the switched-off ones left out, the rest of the main order after',async()=>{
 const r=await call('PUT','/ui/accounts/order',{agent:'shop',order:[{key:'p:openai-codex',model:''},{key:'claude:main',model:'',off:true},{key:'claude:two',model:''}]});
 assert.equal(r.status,200);assert.deepEqual(keys(r.j.effective),['p:openai-codex','claude:two','p:antigravity-subscription'],'Antigravity, not listed yet, comes last as a last resort');
 const d=JSON.parse(await readFile(path.join(DATA,'accounts.json'),'utf8'));assert.deepEqual(d.priority,MAIN,'the main order is untouched');
 assert.deepEqual(keys(api.backup.orderOf(d,'shop')),['p:openai-codex','claude:two','p:antigravity-subscription'],'every switch reads the same order');
 assert.deepEqual(keys(api.backup.orderOf(d,'desk')),keys(MAIN),'an agent without its own order follows the main one');
 const g=await call('GET','/ui/accounts');assert.ok(g.j.orders.shop);assert.equal(g.j.orders.desk,undefined)});
test('only real agents, only entries of the main order, and at least one switched on',async()=>{
 assert.equal((await call('PUT','/ui/accounts/order',{agent:'nobody',order:[{key:'claude:main'}]})).status,400);
 assert.equal((await call('PUT','/ui/accounts/order',{agent:'shop',order:[{key:'claude:main',off:true},{key:'claude:two',off:true}]})).status,400);
 const r=await call('PUT','/ui/accounts/order',{agent:'desk',order:[{key:'p:made-up',model:''},{key:'claude:two',model:''},{key:'claude:two',model:''}]});
 assert.equal(r.status,200);assert.deepEqual(keys(r.j.order),['claude:two'],'unknown entries and doubles are dropped');
 assert.equal((await call('PUT','/ui/accounts/order',{agent:'shop',order:[{key:'claude:main'}]},a=>a!=='shop')).status,400,'an agent the person may not see')});
test('back to the main order',async()=>{const r=await call('PUT','/ui/accounts/order',{agent:'shop',order:null});assert.equal(r.status,200);
 assert.deepEqual(keys(r.j.effective),keys(MAIN));assert.equal(JSON.parse(await readFile(path.join(DATA,'accounts.json'),'utf8')).orders.shop,undefined)});
test('the fallback list, auto-switch, pools and move-off read the agent\'s order',async()=>{
 const a=await readFile(new URL('../app/accounts.mjs',import.meta.url),'utf8'),b=await readFile(new URL('../app/backup-models.mjs',import.meta.url),'utf8');
 assert.match(b,/backupList\(\{priority:acc\.orderOf\?acc\.orderOf\(d,profile\):d\.priority\|\|\[\]/);
 assert.match(a,/const pe=ord\.find\(/);assert.match(a,/planGroups\(groupsFor\(d,profile,prov\)\)/);assert.match(a,/orderOf\(d,profile\)\.find\(x=>x\.key===r\.keys\[0\]\)/);assert.match(a,/for\(const e of orderOf\(d,profile\)\)\{if\(e\.key===key\)continue;/)});
