// Tests for the Efficiency view's data side (app/efficiency-view.mjs). Run: node --test scripts/efficiency-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {summarize,flags,gateOf,readAccounts,createEfficiencyView,classOf,weigh,reuse,size,kindOf} from '../app/efficiency-view.mjs';

const NOW=Date.parse('2026-11-11T10:00:00Z'),T=NOW/1000;
const row=(o={})=>({id:'x'+Math.random(),source:'telegram',title:'',model:'claude-sonnet-5-5',started:T-100,last:T-100,calls:1,input:0,output:0,cacheRead:0,cacheWrite:0,cost:0,continued:false,...o});

test('weights: input 1, cache write 1.25, cache read 0.1, output 5, times the model price class',()=>{
 assert.equal(weigh(row({input:100,cacheWrite:100,cacheRead:1000,output:10})),100+125+100+50);
 assert.equal(weigh(row({model:'claude-haiku-5-5',input:400})),100);assert.equal(weigh(row({model:'claude-opus-5-5[1m]',input:10})),50);
 assert.equal(classOf('gemini-4-flash'),.25);assert.equal(classOf(''),1);
 assert.equal(reuse({input:100,cacheRead:800,cacheWrite:100}),80);assert.equal(reuse({input:0,cacheRead:0,cacheWrite:0}),null);
 assert.equal(size(row({input:1000,cacheRead:299000,cacheWrite:0,calls:2})),150000);
 assert.deepEqual(['cron','subagent','tool','oneshot','whatsapp','api_server'].map(kindOf),['schedule','subagent','fixer','oneshot','chat','chat'])});

test('shares add to 100% per window; 24 h only counts recent activity; schedules are named and grouped; continued chats are counted',()=>{
 const rows=[row({source:'cron',id:'cron_abc123_20261111_0900',title:'[X] Daily · Nov 11 09:00',input:1000,output:100,last:T-3600}),
  row({source:'cron',id:'cron_abc123_20261110_0900',title:'x',input:1000,output:100,last:T-90000}),
  row({source:'telegram',input:3000,cacheRead:30000,last:T-60,continued:true}),row({source:'tool',input:500,last:T-7200}),row({source:'subagent',input:500,last:T-86400*8})];
 const s=summarize([{agent:'sales',name:'Sales',rows}],{jobs:{sales:{abc123:'Daily report'}},now:NOW});
 assert.equal(s.d7.total.runs,4);assert.equal(s.h24.total.runs,3);assert.equal(s.d7.folded,1);
 for(const w of [s.h24,s.d7])assert.ok(Math.abs(w.agents.reduce((a,x)=>a+x.share,0)-1)<1e-9);
 const kinds=s.d7.agents[0].kinds;const sch=kinds.filter(k=>k.kind==='schedule');assert.equal(sch.length,1);assert.equal(sch[0].label,'Daily report');assert.equal(sch[0].runs,2);
 assert.deepEqual(kinds.map(k=>k.kind).sort(),['chat','fixer','schedule']);
 assert.equal(s.d7.agents[0].reuse,Math.round(30000/(1000+1000+3000+500+30000)*100))});

test('flags: chat over 200k per message, schedule that finds nothing, low cache reuse, an account at 100% with others open',()=>{
 const quiet=Array.from({length:8},(_,i)=>row({source:'cron',id:'cron_aa11_'+i,title:'Poll',input:2000,output:i<7?20:900,last:T-i*100}));
 const lowCache=Array.from({length:3},()=>row({source:'whatsapp',title:'Orders',input:400000,cacheRead:100000,calls:5}));
 const longChat=row({source:'telegram',title:'Planning',input:10000,cacheRead:2000000,calls:9,last:T-10});
 const s=summarize([{agent:'a',name:'Ana',rows:[...quiet,...lowCache]},{agent:'b',name:'Bo',rows:[longChat]}],{now:NOW});
 const accounts=[{id:'main',name:'Main account',dead:false,windows:[{label:'weekly limit',used:100,resets:'2026-11-14T00:00:00Z'}]},{id:'b',name:'Second',dead:false,windows:[{label:'weekly limit',used:40,resets:null}]},{id:'c',name:'Old',dead:true,windows:[]}];
 const f=flags(s,{accounts,now:NOW}).map(x=>x.kind+':'+x.text);
 assert.ok(f.some(x=>/^big:.*Planning.*223k/.test(x)),f.join('\n'));assert.ok(f.some(x=>/^quiet:.*“Poll”.*7 of them/.test(x)));
 assert.ok(f.some(x=>/^cache:.*chats reuse only 20%/.test(x)));assert.ok(f.some(x=>/^account:.*Main account.*100%.*another account still takes/.test(x)));
 // a full account is fine when none is open, or when its window already reset
 assert.ok(!flags(s,{accounts:[accounts[0]],now:NOW}).some(x=>x.kind==='account'));
 assert.ok(!flags(s,{accounts:[{...accounts[0],windows:[{label:'weekly limit',used:100,resets:'2026-11-10T00:00:00Z'}]},accounts[1]],now:NOW}).some(x=>x.kind==='account'));
 // with run-gates.json the skips are shown instead, as good news
 const gates={'a/aa11':{skips:30,runs:8}};const g=flags(s,{gates,accounts:[],now:NOW});
 assert.ok(!g.some(x=>x.kind==='quiet'));assert.ok(g.some(x=>x.kind==='skips'&&x.level==='note'&&/30 of 38/.test(x.text)));
 assert.deepEqual(gateOf({jobs:{'Poll':{skipped:2,ran:3}}},'a','zz','Poll'),{skips:2,runs:3});assert.equal(gateOf(null,'a','b','c'),null)});

test('claude-usage.json: windows read as they are kept, a missing file is no accounts',async()=>{
 const d=await mkdtemp(path.join(tmpdir(),'eff-'));const f=path.join(d,'claude-usage.json');
 await writeFile(f,JSON.stringify({main:{usage:{session:{used:12,resets:null},week:{used:100,resets:'x'},opus:null,sonnet:null},dead:false},b:{dead:true}}));
 const a=await readAccounts(f,id=>id==='main'?'Main account':id);assert.equal(a[0].name,'Main account');assert.deepEqual(a[0].windows.map(w=>w.label+w.used),['5-hour limit12','weekly limit100']);assert.deepEqual(a[1].windows,[]);
 assert.deepEqual(await readAccounts(path.join(d,'none.json')),[])});

// a real state.db in a temp file, read by the same query the server uses (when a Python with sqlite3 exists here)
const py=['python3','python'].find(p=>{const r=spawnSync(p,['-c','import sqlite3'],{encoding:'utf8'});return r.status===0});
async function makeHome(){const root=await mkdtemp(path.join(tmpdir(),'eff-'));const H=path.join(root,'.hermes'),DATA=path.join(root,'data');await mkdir(DATA,{recursive:true});
 const mk=async(dir,rows)=>{await mkdir(dir,{recursive:true});const db=new DatabaseSync(path.join(dir,'state.db'));
  db.exec('create table sessions(id text primary key,source text,title text,model text,started_at real,last_activity_at real,api_call_count integer,input_tokens integer,output_tokens integer,cache_read_tokens integer,cache_write_tokens integer,estimated_cost_usd real,parent_session_id text)');
  const ins=db.prepare('insert into sessions values(?,?,?,?,?,?,?,?,?,?,?,?,?)');for(const r of rows)ins.run(...r);db.close()};
 const t=Date.now()/1000;
 await mk(H,[['cron_ab12_1','cron','Nightly · Nov 11 01:00','claude-haiku-5-5',t-500,t-400,1,100,10,900,0,0.01,null],['s1','telegram','Hello','claude-sonnet-5-5',t-300,t-200,4,1000,400,4000,500,0.2,null],['old','telegram','Ancient','claude-sonnet-5-5',t-90*86400,t-90*86400,1,1,1,1,1,1,null]]);
 await mk(path.join(H,'profiles','rory'),[['sub1','subagent','Research','claude-opus-5-5',t-100,t-50,3,500,200,0,0,0.5,'s1'],['s2','whatsapp','Customer','claude-sonnet-5-5',t-100000,t-90000,2,100,50,100,0,0.02,'s0']]);
 await mkdir(path.join(H,'profiles','.deleted'),{recursive:true});await mkdir(path.join(H,'cron'),{recursive:true});
 await writeFile(path.join(H,'cron','jobs.json'),JSON.stringify({jobs:[{id:'ab12',name:'[Ops] Nightly check'}]}));
 await writeFile(path.join(DATA,'claude-usage.json'),JSON.stringify({main:{usage:{session:null,week:{used:100,resets:null}}},b:{usage:{week:{used:10,resets:null}}}}));
 return {H,DATA}}

test('reads each agent\'s state.db read only, names schedules from jobs.json, caches a minute, never throws',{skip:!py},async()=>{
 const {H,DATA}=await makeHome();const now=()=>Date.now();
 const E=createEfficiencyView({HERMES_HOME:H,DATA,python:async()=>py,nameOf:a=>a==='default'?'Main':a[0].toUpperCase()+a.slice(1),accountLabels:async()=>({main:'Main account',b:'Backup'}),now,savings:async()=>({state:'on',folds:7})});
 const v=await E.view();assert.equal(v.error,undefined);
 assert.deepEqual(v.d7.agents.map(a=>a.name).sort(),['Main','Rory']);assert.equal(v.d7.total.runs,4,'the 90-day-old chat is left out');assert.equal(v.h24.total.runs,3);
 const main=v.d7.agents.find(a=>a.name==='Main');assert.ok(main.kinds.some(k=>k.kind==='schedule'&&k.label==='Nightly check'));
 assert.equal(v.proxyFolds,7);assert.equal(v.gates,false);assert.deepEqual(v.accounts.map(a=>a.name),['Main account','Backup']);
 assert.ok(v.flags.some(f=>f.kind==='account'&&/Main account/.test(f.text)));
 assert.equal(await E.view(),v,'the same answer inside a minute');
 const none=createEfficiencyView({HERMES_HOME:path.join(H,'nowhere'),DATA,python:async()=>py});const e=await none.view();assert.deepEqual(e.d7.agents,[]);
 const nopy=createEfficiencyView({HERMES_HOME:H,DATA,python:async()=>{throw new Error('x')}});assert.ok((await nopy.view()).error)});

test('a database that cannot be read is named, the rest still count; the last answer is served while it is read again',async()=>{
 const {H,DATA}=await makeHome();let calls=0;const clock={n:NOW};
 const readRows=async(p,db)=>{calls++;if(db.includes('rory'))return null;return [['s','telegram','C','m',T-5,T-5,1,10,1,0,0,0,0]]};
 const E=createEfficiencyView({HERMES_HOME:H,DATA,python:async()=>'py',readRows,now:()=>clock.n,nameOf:a=>a});
 const v=await E.view();assert.deepEqual(v.failed,['rory']);assert.equal(v.d7.agents.length,1);const n=calls;
 clock.n+=61e3;const v2=await E.view();assert.equal(v2,v,'old answer at once');let v3=v;for(let i=0;i<1500&&v3===v;i++){await new Promise(r=>setTimeout(r,20));v3=await E.view()}/* the read behind finishes when it finishes: wait for it (up to 30 s on a busy box; 12 Nov 2026: 2 s was a guess) */
 assert.ok(calls>n,'read again behind');assert.notEqual(v3,v)});
