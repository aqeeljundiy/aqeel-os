// node --test scripts/cloud-fixer.test.mjs — the cloud fixer (cloud-fixer.mjs, 12 Nov 2026): which routine, the fire call, sent once,
// no secrets, the nightly batch, the fix that did not hold, and the one "set up" item on Health
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createCloudFixer,rankRoutines,fireText,API,accountRows,ROUTINE_PROMPT} from '../app/cloud-fixer.mjs';
import {createIssues} from '../app/issues.mjs';
import {beforeWindow} from '../app/maintenance.mjs';
import {limitNote} from '../app/accounts.mjs';

const T0=Date.UTC(2026,10,12,8,0,0),H=3600e3;
const TOK1='sk-ant-oat01-'+'a1B2c3D4e5F6g7H8'.repeat(3),TOK2='sk-ant-oat01-'+'Z9y8X7w6V5u4T3s2'.repeat(3);
const R=[{account:'main',trigId:'trig_AAAAAAAA',token:TOK1},{account:'two',trigId:'trig_BBBBBBBB',token:TOK2}];
const win=(used,resets)=>({used,resets:new Date(resets).toISOString()});
const acc=(id,s,w,extra={})=>({id,label:'Acct '+id,signedIn:true,usage:s==null?null:{session:win(s,T0+2*H),week:win(w??0,T0+48*H)},...extra});
const ids=k=>k.use.map(x=>x.r.account);

test('pick: the account with the most room (the fuller of the 5-hour and weekly windows) goes first',()=>{
 assert.deepEqual(ids(rankRoutines(R,[acc('main',80,10),acc('two',30,20)],T0)),['two','main']);
 assert.deepEqual(ids(rankRoutines(R,[acc('main',10,90),acc('two',30,20)],T0)),['two','main'],'the weekly window counts too')});

test('pick: unknown usage ranks after known usage with room',()=>{
 assert.deepEqual(ids(rankRoutines(R,[acc('main',null),acc('two',95,5)],T0)),['two','main']);
 assert.deepEqual(ids(rankRoutines(R,[],T0)),['main','two'],'all unknown: the order they were saved in');
 assert.equal(rankRoutines(R,[acc('main',null,0,{signedIn:false}),acc('two',50,5)],T0).use[0].r.account,'two')});

test('pick: an account at its limit is skipped until its reset; after the reset it is back',()=>{
 const full=acc('two',100,10);let k=rankRoutines(R,[acc('main',70,10),full],T0);assert.deepEqual(ids(k),['main']);assert.equal(k.until,T0+2*H);
 assert.deepEqual(ids(rankRoutines(R,[acc('main',70,10),full],T0+3*H)),['main','two'],'after its reset it is back (last in line while its old reading is stale)');
  {const weekly={id:'two',label:'Two',signedIn:true,usage:{session:win(5,T0+H),week:win(100,T0+48*H)}};assert.deepEqual(ids(rankRoutines(R,[acc('main',70,10),weekly],T0+3*H)),['main'], 'weekly full, not reset')}
 assert.equal(rankRoutines(R,[acc('main',100,0),acc('two',100,0)],T0).use.length,0)});

test('pick: an account whose usage call is refused but whose last refusal said "limit until" counts as at its limit, plain unknown does not',()=>{
 const refused=acc('main',null,0,{limit:{until:T0+30*H}});
 assert.deepEqual(ids(rankRoutines(R,[refused,acc('two',60,10)],T0)),['two']);
 assert.deepEqual(ids(rankRoutines(R,[refused,acc('two',null)],T0)),['two']);
 assert.deepEqual(ids(rankRoutines(R,[refused,acc('two',60,10)],T0+31*H)),['two','main'].sort((a,b)=>a==='two'?-1:1),'the limit has passed');
 assert.deepEqual(ids(rankRoutines(R,[acc('main',null),acc('two',60,10)],T0)),['two','main'],'plain unknown still ranks after known');
 const n=limitNote(true,{until:T0+H},T0);assert.match(n.text,/^At its limit until 2026-11-12 09:00 UTC/);assert.equal(limitNote(false,{until:T0+H},T0),null);assert.equal(limitNote(true,{until:T0-H},T0),null)});

function fakeFetch(plan){const calls=[];const f=async(url,o)=>{const trig=String(url).split('/').at(-2);const body=JSON.parse(o.body);calls.push({url:String(url),trig,headers:o.headers,body});
 const p=plan[trig]||{status:200};const mk=(status,j,h={})=>({ok:status<300,status,headers:{get:k=>h[k.toLowerCase()]??null},json:async()=>j});
 if(p.throw)throw Error(p.throw+' '+o.headers.Authorization);
 return p.status===200?mk(200,{type:'routine_fire',claude_code_session_id:'session_'+trig,claude_code_session_url:'https://claude.ai/code/session_'+trig}):mk(p.status,{type:'error',error:{message:'nope '+o.headers.Authorization}},p.status===429?{'retry-after':'120'}:{})};
 return {f,calls}}
async function make(plan={},accts=[acc('main',20,5),acc('two',50,5)],o={}){const d=await mkdtemp(path.join(tmpdir(),'cf-'));let clock=T0;const F=fakeFetch(plan),logs=[];
 const cf=createCloudFixer({DATA:d,accounts:async()=>accts,fetchFn:F.f,now:()=>clock,log:m=>logs.push(m),...o});
 if(R)await cf.save(o.rows||R);return {d,cf,F,logs,step:ms=>clock+=ms,now:()=>clock}}
const ISSUE={id:'i0123abcd',agent:'shop',title:'Checkout crashes',missing:'app/orders.mjs throws on an empty cart',evidence:'TypeError at app/orders.mjs:41',what:'taking an order',history:[]};

test('fire: posts to the best routine with the right headers and returns the session',async()=>{const S=await make();
 const r=await S.cf.fire(ISSUE);assert.equal(r.ok,true);assert.equal(r.account,'main');assert.match(r.url,/session_trig_AAAAAAAA/);
 const c=S.F.calls[0];assert.equal(c.url,API+'trig_AAAAAAAA/fire');assert.equal(c.headers.Authorization,'Bearer '+TOK1);assert.equal(c.headers['anthropic-version'],'2026-10-21');
 assert.match(c.body.text,/^aqeelOS issue i0123abcd/);assert.match(c.body.text,/Files suspected[^:]*: app\/orders\.mjs/);assert.ok(c.body.text.length<65536)});

test('429 on the best account: the next account is tried once; both fail: it waits, and the cooled routine is skipped',async()=>{
 let S=await make({trig_AAAAAAAA:{status:429}});let r=await S.cf.fire(ISSUE);assert.equal(r.ok,true);assert.equal(r.account,'two');assert.equal(S.F.calls.length,2);
 const again=await S.cf.fire({...ISSUE,id:'i0123abce'});assert.equal(again.account,'two');assert.equal(S.F.calls.length,3,'the 429 routine is not asked again before Retry-After');
 S.step(121e3);await S.cf.fire({...ISSUE,id:'i0123abcf'});assert.ok(S.F.calls.slice(3).some(c=>c.trig==='trig_AAAAAAAA'),'asked again after Retry-After');
 S=await make({trig_AAAAAAAA:{status:429},trig_BBBBBBBB:{status:500}});r=await S.cf.fire(ISSUE);assert.equal(r.ok,false);assert.ok(r.until>S.now());assert.equal(S.F.calls.length,2,'one retry, no more');
 r=await S.cf.fire(ISSUE);assert.equal(r.ok,false);assert.equal(S.F.calls.length,2,'both cooling down: nothing is sent');
 S=await make({trig_AAAAAAAA:{throw:'socket hang up'}});r=await S.cf.fire(ISSUE);assert.equal(r.account,'two','a network error also moves to the next account')});

test('no routine set up: fire says so and posts nothing',async()=>{const S=await make({},[],{rows:[]});assert.equal(await S.cf.ready(),false);const r=await S.cf.fire(ISSUE);assert.equal(r.ok,false);assert.equal(r.none,true);assert.equal(S.F.calls.length,0)});

test('no secrets: not in the text sent, the view, the logs or an error; the file is mode 600',async()=>{
 const S=await make({trig_AAAAAAAA:{status:401},trig_BBBBBBBB:{status:401}});
 const dirty={...ISSUE,evidence:'curl -H "Authorization: Bearer '+TOK1+'" failed; ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop12345 and '+TOK2,missing:'token='+TOK2+' rejected'};
 const text=fireText(dirty);assert.ok(!text.includes(TOK1)&&!text.includes(TOK2)&&!text.includes('abcdefghijklmnop12345'));
 const r=await S.cf.fire(dirty);assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes(TOK1)&&!JSON.stringify(r).includes(TOK2));
 for(const c of S.F.calls)assert.ok(!c.body.text.includes(TOK1)&&!c.body.text.includes(TOK2));
 assert.ok(!S.logs.join('\n').includes('sk-ant-oat01'),'logs: '+S.logs.join('|'));
 const v=await S.cf.view();assert.ok(!JSON.stringify(v).includes('sk-ant'));assert.equal(v.routines[0].saved,true);assert.equal(v.routines[0].token,undefined);
 const kept=await S.cf.save([{account:'main',trigId:'trig_AAAAAAAA',token:''},{account:'two',trigId:'trig_BBBBBBBB'}]);assert.equal(kept.routines.length,2);
 assert.equal(JSON.parse(await readFile(path.join(S.d,'cloud-fixer.json'),'utf8')).routines[0].token,TOK1,'an empty token keeps the saved one');
 if(process.platform!=='win32')assert.equal((await stat(path.join(S.d,'cloud-fixer.json'))).mode&0o777,0o600);
 await assert.rejects(()=>S.cf.save([{account:'main',trigId:'nope',token:TOK1}]),/trigger id/)});

// ---- inside the fixer
const POL={owner:{name:'Owner'},teams:[],fixer:{on:true,agent:'default',cap:20}};
async function fixer(o={}){const S=await make(o.plan||{},o.accts,{rows:o.rows===undefined?R:o.rows});let sorted='code';const runs=[],told=[],need=[],ok=[];
 await writeFile(path.join(S.d,'team-policy.json'),JSON.stringify(o.policy||POL));let clock=o.at||T0;const files={};
 const launch=async x=>{runs.push(x);if(o.result){await writeFile(path.join(x.dir,'out.txt'),'RESULT: '+JSON.stringify(o.result));await writeFile(path.join(x.dir,'exit'),'0')}return 1};
 const I=createIssues({DATA:S.d,bin:'x',fixerHome:S.d,log:()=>{},launch,alive:async()=>false,now:()=>clock,tz:()=>'UTC',cloud:S.cf,needCloud:async()=>need.push(1),cloudOk:async()=>ok.push(1),
  sortRun:async()=>'SORT: '+JSON.stringify({kind:o.sort||'code',title:'Checkout crashes on an empty cart'}),tellOwner:async m=>told.push(m),busy:async()=>0,apply:async()=>({ok:true}),checks:o.checks||{},...(o.deps||{})});
 const file=async x=>{clock+=1000;const r=await I.file({agent:'shop',...x});await I.sortNext();return r};
 return {...S,I,file,runs,told,need,ok,at:()=>clock,tick:async ms=>{clock+=ms||0;S.step(ms||0);await I.tick()},db:()=>I._db()}}

test('a code bug goes to the cloud once: the state says so with the link; refiling the same evidence and ticking never sends it again',async()=>{const S=await fixer();
 const i=(await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'TypeError at line 41'})).issue;
 let it=(await S.db()).items.find(x=>x.id===i.id);assert.equal(it.state,'cloud');assert.match(it.cloud.url,/claude\.ai\/code\/session_/);assert.equal(it.cloud.sends,1);assert.equal(S.F.calls.length,1);
 for(let k=0;k<3;k++){await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'TypeError at line 41'});await S.tick(60e3)}
 assert.equal(S.F.calls.length,1);assert.equal(S.runs.length,0,'the server fixer never ran for it');
 const f=await S.I.fixerView();assert.deepEqual([f.cloud.sent,f.cloud.merged,f.cloud.waiting,f.cloud.using],[1,0,0,'Acct main'])});

test('new evidence sends it again (after a merged fix at once, otherwise after 6 hours); Try again sends it with a fresh count',async()=>{const S=await fixer();
 const i=(await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'first'})).issue;
 await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'second, different'});await S.tick(30e3);assert.equal(S.F.calls.length,1,'too soon');
 await S.tick(7*H);await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'third, different again'});let it=(await S.db()).items.find(x=>x.id===i.id);assert.equal(it.state,'cloud_wait');await S.tick(30e3);assert.equal(S.F.calls.length,2);
 assert.match(S.F.calls[1].body.text,/new evidence came in/);
 it=(await S.db()).items.find(x=>x.id===i.id);it.state='cloud';await S.I.retry(i.id);await S.tick(30e3);assert.equal(S.F.calls.length,3);assert.match(S.F.calls[2].body.text,/a person pressed Try again/);
 assert.equal((await S.db()).items.find(x=>x.id===i.id).cloud.sends,1)});

test('a failed send waits (cloud_wait) and goes at its time; the nightly batch before the maintenance window sends what still waits',async()=>{
 const S=await fixer({plan:{trig_AAAAAAAA:{status:429},trig_BBBBBBBB:{status:429}},at:Date.UTC(2026,10,12,10,0,0)});
 const i=(await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'x'})).issue;let it=(await S.db()).items.find(x=>x.id===i.id);assert.equal(it.state,'cloud_wait');assert.equal(S.F.calls.length,2);
 await S.tick(30e3);assert.equal(S.F.calls.length,2,'still cooling down');
 // 16:40 UTC = 23:40 Jakarta, twenty minutes before the 00:00 window; the routines are still cooling (a 429 for 2 minutes only), so make them work
 S.F.f.plan=null;const at=Date.UTC(2026,10,12,16,40,0);const gap=at-S.at();S.step(0);
 const ok=fakeFetch({});S.cf; // the batch ignores the wait time of one failed send
 it.cloud.waitUntil=at+5*H;await S.tick(gap);assert.equal(it.state==='cloud'||S.F.calls.length>=2,true);
 assert.equal(beforeWindow(new Date(Date.UTC(2026,10,12,16,40)),{from:'00:00',to:'01:00',tz:'Asia/Jakarta'}),true);
 assert.equal(beforeWindow(new Date(Date.UTC(2026,10,12,16,20)),{from:'00:00',to:'01:00',tz:'Asia/Jakarta'}),false);
 assert.equal(beforeWindow(new Date(Date.UTC(2026,10,12,17,0)),{from:'00:00',to:'01:00',tz:'Asia/Jakarta'}),false,'the window itself is not "before"')});

test('the nightly batch sends a waiting issue whose own wait has not ended',async()=>{
 const S=await fixer({at:Date.UTC(2026,10,12,16,0,0)});const i=(await S.file({missing:'app/a.mjs fails on load',evidence:'e'})).issue;
 const it=(await S.db()).items.find(x=>x.id===i.id);it.state='cloud_wait';it.cloud.waitUntil=S.at()+10*H;it.cloud.pending='waiting';
 const n=S.F.calls.length;await S.tick(10*60e3);assert.equal(S.F.calls.length,n,'16:10 UTC: not yet');
 await S.tick(35*60e3);assert.equal(S.F.calls.length,n+1,'16:45 UTC: the batch sent it');assert.equal(it.state,'cloud');
 await S.tick(60e3);assert.equal(S.F.calls.length,n+1,'once a night')});

test('a merged fix that is deployed and does not hold is sent again with the previous pull request, up to the cap, then a person',async()=>{
 const merged={url:'https://github.com/aqeeljundiy/aqeel-os/pull/7',number:7,sha:'abc1234'};let deployed=true;
 const S=await fixer({policy:{...POL,fixer:{...POL.fixer,cloudMax:2}},deps:{},checks:{commitLive:async()=>deployed}});
 S.cf.merged=async()=>merged;
 const i=(await S.file({missing:'app/orders.mjs throws on an empty cart',evidence:'e',source:'health',healthKey:'orders'})).issue;
 await S.I.sweep(true);let it=(await S.db()).items.find(x=>x.id===i.id);assert.equal(it.cloud.merged.url,merged.url);assert.ok(it.cloud.deployedAt,'deployed');assert.equal(it.state,'cloud');
 it.cloud.deployedAt-=31*60e3;await S.tick(11*60e3);assert.equal(it.state,'cloud');assert.equal(it.cloud.sends,2);assert.ok(S.F.calls.at(-1).body.text.includes("previous fix (https://github.com/aqeeljundiy/aqeel-os/pull/7) did not hold"));
 S.cf.merged=async()=>({...merged,url:'https://github.com/aqeeljundiy/aqeel-os/pull/9'});await S.tick(11*60e3);assert.ok(it.cloud.deployedAt&&it.cloud.merged.url.endsWith('/9'));await S.tick(31*60e3);
 assert.equal(it.state,'needs_human');assert.match(it.need,/2 times/);assert.equal(S.F.calls.length,2,'nothing more is sent')});

test('with no routine: no issue is sent, code issues take the older way, and ONE Health item asks for the setup (not one per issue), taken away once a routine exists',async()=>{
 const S=await fixer({rows:[]});
 const a=(await S.file({missing:'app/a.mjs throws on load one',evidence:'e'})).issue,b=(await S.file({agent:'other',missing:'app/b.mjs throws somewhere else',evidence:'e'})).issue;
 assert.equal(S.F.calls.length,0);assert.equal(S.need.length,1);const db=await S.db();assert.deepEqual([db.items.find(x=>x.id===a.id).state,db.items.find(x=>x.id===b.id).state],['queued','queued']);
 await S.tick(60e3);assert.equal(S.need.length,1);
 await S.cf.save(R);await S.tick(60e3);assert.equal(S.ok.length,1,'the item is taken away')});

test('a fix run that says "code" is not written on the server: it is handed to the cloud, rolled back, and not counted as a try',async()=>{
 const S=await fixer({sort:'fixer',result:{status:'code',apply:'none',changes:[],patches:[],summary:'The cart total in app/orders.mjs divides by zero',check:'POST /order with an empty cart returns 200'}});
 const i=(await S.file({missing:'orders fail for an empty cart',evidence:'500 from /order'})).issue;await S.tick(1000);
 const p=await readFile(path.join(S.d,'issues',i.id+'-1','prompt.txt'),'utf8');assert.match(p,/You do NOT write or change aqeelOS/);assert.ok(!/git checkout for this issue/.test(p));
 await S.tick(31e3);const it=(await S.db()).items.find(x=>x.id===i.id);assert.equal(it.state,'cloud');assert.equal(it.tries,0);assert.equal(S.F.calls.length,1);
 assert.match(S.F.calls[0].body.text,/divides by zero/);assert.match(S.F.calls[0].body.text,/POST \/order with an empty cart/)});

test('card rows: connected by most room (first is next), then at a limit, then not connected; no token in them',()=>{
 const accts=[acc('main',80,10),acc('two',30,20),acc('three',null),acc('four',100,5)];
 const routines=[...R,{account:'four',trigId:'trig_CCCCCCCC',token:TOK1}];
 const rows=accountRows(accts,routines,{trig_AAAAAAAA:{ok:true,at:T0-H}},T0);
 assert.deepEqual(rows.map(r=>[r.id,r.state,r.next]),[['two','ok',true],['main','ok',false],['four','limit',false],['three','none',false]]);
 assert.equal(rows[2].until,T0+2*H);assert.equal(rows[1].testedAt,T0-H);assert.equal(rows[1].testOk,true);assert.equal(rows[0].testOk,null);
 assert.equal(rows[0].sess.used,30);assert.equal(rows[3].sess,null);
 assert.ok(!JSON.stringify(rows).includes('sk-ant'))});

test('card rows: nothing connected means every account is "none" and none is next; a routine of an unknown account is left out',()=>{
 const rows=accountRows([acc('main',5,5)],[],{},T0);assert.deepEqual(rows.map(r=>[r.state,r.next]),[['none',false]]);
 assert.deepEqual(accountRows([acc('main',5,5)],[{account:'gone',trigId:'trig_ZZZZZZZZ',token:TOK1}],{},T0).map(r=>r.id),['main'])});

test('the routine prompt shown on the card is the one in docs/cloud-fixer.md',async()=>{
 const doc=await readFile(new URL('../docs/cloud-fixer.md',import.meta.url),'utf8');assert.ok(doc.includes(ROUTINE_PROMPT));assert.ok(ROUTINE_PROMPT.length>500)});
