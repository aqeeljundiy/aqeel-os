// Route order (route-order.mjs, backup-models.mjs, accounts.mjs poolRoom, issues.mjs): a run asked for one model leaves its vendor only in the
// owner's order, and every switch is recorded and visible. The Python side is tests/agent/test_aqeelos_route.py in engine/patches/2026-11-12-route-order.patch.
// The records below are what the engine wrote on Elkiya's runs of 11 Nov 2026 (names made up).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {familyOf,familyName,settingsOf,DEFAULTS,policyFor,samePolicy,parseSwitches,crossed,summarize,onFallback,fallbackText,runRoute,recordFor,appendRecords,readRecords,FILE} from '../app/route-order.mjs';
import {createBackupModels,PLUGIN} from '../app/backup-models.mjs';

const H=3600e3,T0=Date.UTC(2026,10,11,12,0,0);
const rec=(o)=>({at:T0,agent:'default',kind:'chat',asked:'claude-sonnet-5-5[1m]',actual:'gpt-6.1-sol',reason:'billing',step:'explicit',why:"the owner's fallback list, in its order",...o});
const lines=l=>l.map(x=>JSON.stringify(x)).join('\n')+'\n';

test('the vendor family is what a person means by the same model',()=>{
 assert.deepEqual(['claude-opus-5-5[1m]','claude-haiku-5-5','gpt-6.1-sol','gemini-4-argon-high','llama-9'].map(familyOf),['claude','claude','gpt','gemini','llama']);
 assert.equal(familyName('gpt'),'GPT');assert.equal(familyName(''),'another model')});

test("settings: the wait and the hours are the owner's, clamped, with defaults",()=>{
 assert.deepEqual(settingsOf(null),DEFAULTS);assert.deepEqual(settingsOf({route:{waitMinutes:30,fallbackHours:6}}),{waitMinutes:30,fallbackHours:6});
 assert.deepEqual(settingsOf({route:{waitMinutes:-5,fallbackHours:9999}}),{waitMinutes:0,fallbackHours:72});assert.deepEqual(settingsOf({route:{waitMinutes:'x'}}),DEFAULTS)});

test('the policy file says whether another account of the pool has room, and nothing it cannot know',()=>{
 const p=policyFor({sameModelRoom:true,keys:['claude:two']},{waitMinutes:15,now:T0});
 assert.deepEqual(p,{v:1,at:T0,waitMinutes:15,pool:{sameModelRoom:true,keys:['claude:two']}});
 assert.equal(policyFor(null,{now:T0}).pool.sameModelRoom,false);assert.ok(samePolicy(p,policyFor({sameModelRoom:true,keys:['claude:two']},{waitMinutes:15,now:T0+1})))});

test("records: the engine's lines are read, broken ones skipped, a refusal is not a switch",()=>{
 const text=lines([rec({}),{at:T0+1,kind:'fixer',denied:true,asked:'claude-opus-5-5',candidate:'gemini-4-argon-high',reason:'timeout',step:'not-account',why:'x'}])+'not json\n{"no":"at"}\n';
 const r=parseSwitches(text,'default');assert.equal(r.length,2);assert.equal(r[1].denied,true);assert.equal(r[1].actual,undefined);
 assert.deepEqual(r.map(crossed),[true,false]);
 assert.equal(crossed(rec({actual:'claude-opus-5-5'})),false,'the same family on another account is not leaving the model')});

test('summary: per agent and kind, who ran on which vendor, why, and how often a run was held',()=>{
 const all=[rec({}),rec({at:T0+1,reason:'rate_limit'}),rec({at:T0+2,agent:'continue-support',kind:'schedule',actual:'gemini-4-argon-high'}),
  rec({at:T0+3,denied:true,actual:undefined,candidate:'gpt-6.1-sol',reason:'timeout',step:'not-account'}),rec({at:T0-9*864e5})];
 const s=summarize(all.map(r=>({...r})),{now:T0+H,days:7});
 assert.equal(s.total,3);assert.equal(s.refused,1);
 const d=s.rows.find(r=>r.agent==='default'&&r.actual==='gpt');assert.deepEqual([d.kind,d.asked,d.n,d.reasons],['chat','claude',2,{billing:1,rate_limit:1}]);
 assert.equal(s.rows.find(r=>r.agent==='continue-support').actual,'gemini');
 assert.ok(s.rows.some(r=>r.agent==='default'&&!r.actual&&r.refused===1),'a held run is its own row');
 assert.equal(summarize(all,{now:T0+H,days:7,agents:['continue-support']}).total,1)});

test('on a fallback for hours: one streak, gaps of an hour end it, the item is due at the set hours',()=>{
 const stream=(from,n,gap)=>Array.from({length:n},(_,i)=>rec({at:from+i*gap,agent:'shop-support'}));
 const recs=[...stream(T0,9,30*60e3)];   // 12:00 to 16:00, every half hour
 let f=onFallback(recs,{now:T0+4*H+10*60e3,hours:3});assert.equal(f.length,1);assert.deepEqual([f[0].agent,f[0].hours,f[0].n,f[0].due],['shop-support',4,9,true]);
 assert.equal(onFallback(recs,{now:T0+4*H+10*60e3,hours:5})[0].due,false);
 assert.deepEqual(onFallback(recs,{now:T0+6*H}),[],'not on one any more: nothing for two hours');
 // a new streak after a long gap starts again
 const two=[...stream(T0,4,30*60e3),...stream(T0+8*H,2,30*60e3)];f=onFallback(two,{now:T0+8*H+40*60e3,hours:3});assert.equal(f[0].hours,0.5);assert.equal(f[0].due,false);
 const t=fallbackText({agent:'shop-support',hours:4,n:9,reason:'billing',asked:'claude-sonnet-5-5',actual:'gpt-6.1-sol'},'Shop support');
 assert.match(t.text,/Shop support has been answering on GPT instead of Claude for 4 hours/);assert.match(t.detail,/Models › AI accounts/)});

test("a fixer run: asked Claude, ran on GPT, with the engine's reason; a run that stayed has no route",()=>{
 const run={id:'r1',kind:'fix',model:'claude-sonnet-5-5[1m]',at:T0,done:T0+20*60e3,usage:{model:'gpt-6.1-sol',cost:0.07}};
 const w=recordFor([rec({at:T0+5*60e3,kind:'fixer',agent:'default',reason:'billing'}),rec({at:T0+5*60e3,kind:'chat'})],{kind:'fixer',from:run.at,to:run.done});
 assert.equal(w.kind,'fixer');
 assert.deepEqual(runRoute(run,w),{asked:'claude-sonnet-5-5[1m]',actual:'gpt-6.1-sol',reason:'billing',step:'explicit',why:"the owner's fallback list, in its order"});
 assert.equal(runRoute({...run,usage:{model:'claude-sonnet-5-5[1m]'}}),undefined);
 assert.deepEqual(runRoute({...run,model:''},w).asked,'claude-sonnet-5-5[1m]',"no model asked for: the engine's record says what it was");
 assert.equal(runRoute({...run,model:''}),undefined,'nothing known about what was asked: nothing claimed');
 assert.equal(recordFor([rec({at:T0+3*H,kind:'fixer'})],{kind:'fixer',from:run.at,to:run.done}),null)});

test('the Elkiya replay: the nine fixer runs of 11 Nov all show up as ran elsewhere',()=>{
 const asked=['claude-haiku-5-5','claude-sonnet-5-5[1m]','claude-sonnet-5-5[1m]','claude-opus-5-5[1m]','claude-opus-5-5[1m]','claude-sonnet-5-5[1m]','claude-sonnet-5-5[1m]','claude-opus-5-5[1m]','claude-opus-5-5[1m]'];
 const ran=['gpt-6.1-sol','gpt-6.1-sol','gemini-4-argon-high','gemini-4-argon-high','gemini-4-argon-high','gemini-4-argon-high','gemini-4-argon-high','gemini-4-argon-high','gpt-6.1-sol'];
 const n=asked.filter((m,i)=>runRoute({model:m,usage:{model:ran[i]}})).length;assert.equal(n,9);
 assert.equal(runRoute({model:'claude-sonnet-5-5[1m]',usage:{model:'claude-sonnet-5-5[1m]'}}),undefined)});

test('records on disk: appended as read, read back inside the window',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'route-'));const now=Date.now();
 await appendRecords(DATA,[rec({at:now-H}),rec({at:now-30*864e5})]);await appendRecords(DATA,[]);
 const r=await readRecords(DATA,{now,days:7});assert.equal(r.length,1);assert.equal(FILE,'route-switches.jsonl');
 assert.deepEqual(await readRecords(path.join(DATA,'nowhere'),{now}),[]);assert.deepEqual(await readRecords(null),[])});

/* ---------- backup-models.mjs: the policy file, reading the records, the Health item, the move ---------- */
async function harness({room={sameModelRoom:false,keys:[]},policy=null,agents=['default','shop-support']}={}){
 const dir=await mkdtemp(path.join(tmpdir(),'bm-route-')),DATA=path.join(dir,'data'),HERMES_HOME=path.join(dir,'.hermes');await mkdir(DATA,{recursive:true});await mkdir(HERMES_HOME,{recursive:true});
 if(policy)await writeFile(path.join(DATA,'team-policy.json'),JSON.stringify(policy));
 const told=[],moved=[],cfg={};
 const acc={load:async()=>({priority:[{key:'claude:main'},{key:'p:openai-codex'}],assign:{},signedOut:{}}),all:()=>[{id:'main'}],details:async()=>({signedIn:true}),
  options:async()=>({providers:[{slug:PLUGIN,authenticated:true,models:['claude-sonnet-5-5']},{slug:'openai-codex',authenticated:true,models:['gpt-6.1-sol']}]}),
  agentRoute:async()=>({provider:PLUGIN,model:'claude-sonnet-5-5'}),entryOf:async()=>'claude:main',keyStatus:()=>({}),useEntry:async()=>{},
  sameModelRoom:async()=>room,moveToPool:async a=>{moved.push(a);return 'claude:two'}};
 const bm=createBackupModels({DATA,HERMES_HOME,live:true,agents:async()=>agents,acc,readConfig:async()=>({}),setKey:async(p,k,v)=>{cfg[p+'|'+k]=v;return {ok:true}},tell:async(t,o)=>{told.push([t,o])},nameOf:a=>a.toUpperCase()});
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 return {bm,DATA,HERMES_HOME,told,moved,homeOf,write:async(a,recs)=>{await mkdir(path.join(homeOf(a),'logs'),{recursive:true});await appendFile(path.join(homeOf(a),'logs','route-switches.jsonl'),lines(recs))}};
}

test("every sync writes each agent's policy: the pool room and the owner's wait minutes",async()=>{
 const h=await harness({room:{sameModelRoom:true,keys:['claude:two']},policy:{route:{waitMinutes:25}}});await h.bm.sync('test');
 for(const a of ['default','shop-support']){const p=JSON.parse(await readFile(path.join(h.homeOf(a),'aqeelos-route.json'),'utf8'));
  assert.deepEqual([p.v,p.waitMinutes,p.pool],[1,25,{sameModelRoom:true,keys:['claude:two']}]);assert.ok(Math.abs(p.at-Date.now())<30e3)}});

test("the records are read from each agent's log, kept, summed, and shown with the agent's name",async()=>{
 const h=await harness();const now=Date.now();
 await h.write('shop-support',[rec({at:now-2*H,agent:undefined,kind:'schedule'}),rec({at:now-H,agent:undefined,kind:'chat',reason:'rate_limit'})]);
 await h.write('default',[{at:now-H,kind:'fixer',denied:true,asked:'claude-opus-5-5',candidate:'gemini-4-argon-high',reason:'timeout',step:'not-account',why:'it is not a failure of the account'}]);
 await h.bm.tick();const st=await h.bm.status();
 assert.equal(st.routes.total,2);assert.equal(st.routes.refused,1);
 const r=st.routes.rows.find(x=>x.agent==='shop-support'&&x.kind==='schedule');assert.deepEqual([r.name,r.asked,r.actual,r.n],['SHOP-SUPPORT','claude','gpt',1]);
 assert.ok(st.routes.recent.every(x=>x.name));assert.equal(st.routes.waitMinutes,DEFAULTS.waitMinutes);
 // read once: the same lines are not counted again, and they are kept in DATA for Usage and a restart
 await h.bm.tick();assert.equal((await h.bm.status()).routes.total,2);
 assert.equal((await readRecords(h.DATA,{now:Date.now()})).length,3)});

test('Health: one item when an agent has been on another vendor for the set hours, cleared when it is back',async()=>{
 const h=await harness({policy:{route:{fallbackHours:2}}});const now=Date.now();
 const stream=Array.from({length:7},(_,i)=>rec({at:now-3*H+i*30*60e3,agent:undefined}));   // 3 hours ago to now, every half hour
 await h.write('shop-support',stream);await h.bm.tick();
 const items=()=>h.told.filter(([t,o])=>t&&o?.topic==='route|shop-support');assert.equal(items().length,1);assert.match(items()[0][0],/SHOP-SUPPORT has been answering on GPT instead of Claude for 3 hours/);
 await h.bm.tick();assert.equal(items().length,1,'said once');
 // not due below the hours: another agent with a short streak raises nothing
 await h.write('default',[rec({at:now-20*60e3,agent:undefined}),rec({at:now-10*60e3,agent:undefined})]);await h.bm.tick();assert.equal(h.told.filter(([t,o])=>t&&o?.topic==='route|default').length,0);
 // it ends: no switch for over an hour -> the item is resolved
 await h.bm.tick(now+90*60e3);assert.ok(h.told.some(([t,o])=>!t&&o?.resolve==='route|shop-support'))});

test('a refusal "another account of the pool has room" moves that agent now, once in ten minutes',async()=>{
 const h=await harness();const now=Date.now(),denied=()=>({at:now,kind:'chat',denied:true,asked:'claude-sonnet-5-5',candidate:'gpt-6.1-sol',reason:'billing',step:'pool',why:'another account of the same pool has room'});
 await h.write('shop-support',[denied(),denied()]);await h.bm.tick();assert.deepEqual(h.moved,['shop-support']);
 await h.write('shop-support',[denied()]);await h.bm.tick();assert.deepEqual(h.moved,['shop-support']);
 // a refusal for any other reason moves nobody
 await h.write('default',[{...denied(),step:'wait'}]);await h.bm.tick();assert.deepEqual(h.moved,['shop-support'])});

/* ---------- accounts.mjs poolRoom: step (a), the same model on another signed-in account of the pool ---------- */
const HOME=await mkdtemp(path.join(tmpdir(),'accr-'));
process.env.HOME=HOME;process.env.USERPROFILE=HOME;process.env.HERMES_HOME=path.join(HOME,'.hermes');process.env.CLAUDE_BIN=path.join(HOME,'no-claude');process.env.HERMES_API='http://127.0.0.1:9';
await mkdir(process.env.HERMES_HOME,{recursive:true});
await writeFile(path.join(process.env.HERMES_HOME,'config.yaml'),'model:\n  default: claude-sonnet-5-5\n  provider: claude-subscription-directsdk-experimental\n');
const PD=path.join(HOME,'data');await mkdir(PD,{recursive:true});
const base={accounts:[{id:'two',label:'Two',dir:path.join(HOME,'two')},{id:'three',label:'Three',dir:path.join(HOME,'three')}],assign:{},auto:{on:true,threshold:90},events:[],
 priority:[{key:'claude:main',model:''},{key:'claude:two',model:''},{key:'claude:three',model:''},{key:'p:openai-codex',model:''}]};
const use=(s,w)=>({checked:true,signedIn:true,usage:{session:{used:s},week:{used:w}}});
const {createAccounts}=await import('../app/accounts.mjs');
async function room(d,det,profile='default'){await writeFile(path.join(PD,'accounts.json'),JSON.stringify(d));const a=createAccounts(PD);return a.backup.sameModelRoom(profile,await a.backup.load(),det)}

test('pool room: another signed-in member with room, never a signed-out one, never another vendor',async()=>{
 const det={main:use(100,40),two:use(20,30),three:{checked:true,signedIn:false}};
 assert.deepEqual(await room(base,det),{sameModelRoom:true,keys:['claude:two']});
 // the other member is nearly full too: no room, so the explicit list may be used
 assert.deepEqual(await room(base,{...det,two:use(96,10)}),{sameModelRoom:false,keys:[]});
 // its week is used up: no room by the weekly window either
 assert.equal((await room(base,{...det,two:use(10,99)})).sameModelRoom,false);
 // readings that failed are unknown, never a target
 assert.equal((await room(base,{main:use(100,40),two:{checked:false},three:{checked:false}})).sameModelRoom,false);
 // two members with room: the one with the most room comes first
 assert.deepEqual((await room(base,{main:use(100,40),two:use(60,30),three:use(10,30)})).keys,['claude:three','claude:two'])});

test('pool room: only claimed when auto-switch is on and can still move the agent today, and only for a pool',async()=>{
 const det={main:use(100,40),two:use(20,30),three:use(20,30)};
 assert.equal((await room({...base,auto:{on:false,threshold:90}},det)).sameModelRoom,false,'the owner turned moving off: the engine must not wait for a move');
 const day=new Date(),k=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
 assert.equal((await room({...base,moved:{default:{day:k,n:8}}},det)).sameModelRoom,false,'at its daily ceiling');
 assert.equal((await room({...base,priority:[{key:'claude:main',model:''},{key:'p:openai-codex',model:''}]},det)).sameModelRoom,false,'a lone account is no pool')});
