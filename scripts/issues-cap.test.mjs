// Audit H3 (12 Nov 2026): issues.json kept the newest 300 items whatever their state, so an open "Needs you" item fell off after about six
// days and nobody was told. Only ended items are dropped now, oldest first; runs of dropped issues go with them; open issues alone over the
// cap are kept and said once. Also M2: the sorter's start after a filing can be injected (defer), so tests do not race a real timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createIssues,capItems,ENDED,CAP,dayIn} from '../app/issues.mjs';
import {fakeFixerSandbox} from './lib/fake-fixer-sandbox.mjs';

const POL={owner:{name:'Owner'},teams:[],fixer:{on:false}};   // fixer off: filed issues stay 'open', nothing runs
const item=(id,state,at,x={})=>({id,key:'k|'+id,agent:'a',state,missing:'m '+id,created:at,updated:at,count:1,tries:0,history:[],sorted:'fixer',...x});
async function setup(db,x={}){const d=await mkdtemp(path.join(tmpdir(),'cap-'));await writeFile(path.join(d,'team-policy.json'),JSON.stringify(POL));
 if(db)await writeFile(path.join(d,'issues.json'),JSON.stringify({dupLink:1,...db}));
 let clock=x.at||Date.UTC(2026,10,12,8,0,0);const over=[];
 const I=createIssues({sandbox:fakeFixerSandbox(),DATA:d,bin:'x',fixerHome:d,log:()=>{},launch:async()=>1,alive:async()=>false,now:()=>clock,tz:()=>'UTC',onOver:async n=>{over.push(n)},defer:()=>{},...x.opts});
 return {I,d,over,file:async o=>{clock+=1000;return I.file(o)},saved:async()=>JSON.parse(await readFile(path.join(d,'issues.json'),'utf8')),step:ms=>{clock+=ms}}}

test('capItems: under the cap nothing goes; over it only ended items go, oldest first; open ones never',()=>{
 const a=[item('1','fixed',1),item('2','needs_human',2),item('3','closed',3),item('4','queued',4)];
 assert.deepEqual(capItems(a,10).dropped,[]);
 const c=capItems(a,3);assert.deepEqual(c.dropped,['1']);assert.deepEqual(c.items.map(i=>i.id),['2','3','4']);assert.equal(c.over,false);
 const d=capItems(a,1);assert.deepEqual(d.dropped.sort(),['1','3']);assert.deepEqual(d.items.map(i=>i.id),['2','4'],'two open items stay although the cap is one');assert.equal(d.over,true);
 // every state that is not an ended one is kept, also one this code does not know
 for(const s of ['queued','fixing','applying','verify','verifying','rollback','open','stuck','needs_human','stopped','deploy','cloud','cloud_wait','something-new'])
  assert.deepEqual(capItems([item('x',s,1),item('y','fixed',2)],1).items.map(i=>i.id),['x'],s);
 assert.deepEqual(ENDED,['fixed','declined','gone','closed','expired'])});

test('the audit case: 300 ended items and one old needs_human; one more is filed; the needs_human item is still there',async()=>{
 const t0=Date.UTC(2026,10,1),items=[];for(let k=0;k<CAP;k++)items.push(item('e'+k,ENDED[k%ENDED.length],t0+k*1000));
 items.reverse();items.push(item('old','needs_human',t0-864e5,{need:'Give the token'}));   // the oldest of all, at the end of the list
 const S=await setup({items,runs:{}});const r=await S.file({agent:'b',missing:'a brand new problem'});
 const db=await S.saved(),ids=db.items.map(i=>i.id);
 assert.ok(ids.includes('old'),'the open item was dropped');assert.ok(ids.includes(r.issue.id));assert.equal(db.items.length,CAP);
 assert.ok(!ids.includes('e0')&&!ids.includes('e1'),'the two oldest ended items went');assert.ok(ids.includes('e2'));assert.deepEqual(S.over,[])});

test('runs of dropped issues go with them, except today\'s (the daily cap counts those); orphan runs from before go at load',async()=>{
 const t0=Date.UTC(2026,10,1),now=Date.UTC(2026,10,12,8,0,0),today=dayIn(now,'UTC'),items=[];for(let k=0;k<CAP;k++)items.push(item('e'+k,'fixed',t0+k*1000));items.reverse();
 const runs={r1:{issue:'e0',kind:'fix',day:'2026-11-01'},r2:{issue:'e0',kind:'proof',day:today},r3:{issue:'e5',kind:'fix',day:'2026-11-01'},r4:{issue:'gone-long-ago',kind:'fix',day:'2026-11-02'}};
 const S=await setup({items,runs},{at:now});await S.file({agent:'b',missing:'one more'});const db=await S.saved();
 assert.deepEqual(Object.keys(db.runs).sort(),['r2','r3'],'e0 was dropped: its old run goes, today\'s stays; e5 is still listed; the orphan goes')});

test('open issues alone over the cap: none is dropped, and it is said once a day; back under it, the notice is taken back',async()=>{
 const t0=Date.UTC(2026,10,10),items=[];for(let k=0;k<CAP;k++)items.push(item('o'+k,'needs_human',t0+k*1000));
 const S=await setup({items,runs:{}});await S.file({agent:'b',missing:'problem one'});await new Promise(r=>setImmediate(r));
 assert.equal((await S.saved()).items.length,CAP+1);assert.deepEqual(S.over,[CAP+1]);
 await S.file({agent:'b',missing:'second thing entirely different'});await new Promise(r=>setImmediate(r));assert.equal((await S.saved()).items.length,CAP+2);assert.deepEqual(S.over,[CAP+1],'not said again the same day');
 S.step(25*3600e3);await S.file({agent:'c',missing:'third unrelated breakage'});await new Promise(r=>setImmediate(r));assert.equal(S.over.length,2);
 // people close some: the next filing is under the cap again
 const db=await S.saved();for(const i of db.items.slice(0,20))i.state='closed';await writeFile(path.join(S.d,'issues.json'),JSON.stringify(db));
 const S2=await setup(null,{at:Date.UTC(2026,10,14)});await writeFile(path.join(S2.d,'issues.json'),JSON.stringify(db));
 await S2.file({agent:'d',missing:'fourth new report'});await new Promise(r=>setImmediate(r));assert.deepEqual(S2.over,[0]);assert.ok((await S2.saved()).items.length<=CAP)});

test('M2: the sorter is started through defer, so a test (or a caller) decides when it runs',async()=>{
 const started=[],asked=[];let S;
 S=await setup(null,{opts:{defer:f=>started.push(f),sortRun:async o=>{asked.push(o);return 'SORT: {"kind":"fixer","title":"T"}'}}});
 await writeFile(path.join(S.d,'team-policy.json'),JSON.stringify({...POL,fixer:{on:true,agent:'default'}}));
 const S3=await setup(null,{opts:{defer:f=>started.push(f),sortRun:async o=>{asked.push(o);return 'SORT: {"kind":"fixer","title":"T"}'}}});
 await writeFile(path.join(S3.d,'team-policy.json'),JSON.stringify({...POL,fixer:{on:true,agent:'default'}}));
 const r=await S3.file({agent:'a',missing:'needs sorting first'});assert.ok(r.issue.sorting,'it waits for the sorter');
 await new Promise(z=>setTimeout(z,20));assert.equal(asked.length,0,'nothing ran on a timer');assert.equal(started.length,1);
 await started[0]();assert.equal(asked.length,1)});
