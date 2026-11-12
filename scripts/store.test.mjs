// Audit H4 / M4 / M5 (12 Nov 2026): a state file that cannot be read was taken for empty and saved over. app/store.mjs: only a missing file
// is new; an unreadable, empty or half-written one is left untouched, saves are refused, one notice names it, and it heals when it reads again.
// Writes are atomic, one at a time per file, and keep the version before as .last-good. Then the stores that matter most, one by one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,existsSync,mkdirSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readStore,writeStore,saveStore,updateStore,atomicWrite,storeBad,storeHooks,setStoreHooks,sweepTmp,StoreRefused} from '../app/store.mjs';

const dir=()=>mkdtempSync(path.join(tmpdir(),'store-'));
const bad=[],good=[];setStoreHooks({bad:(f,w)=>bad.push(path.basename(f)),good:f=>good.push(path.basename(f))});
const BROKEN={corrupt:'{"users":[{"id":1}',empty:'',blank:'  \n','half-written':'{"users":[{"id":1},{"id":2,"na','not json':'<html>502</html>'};

test('a missing file is a new store: the default, and it can be saved',async()=>{const f=path.join(dir(),'a.json');
 const d=await readStore(f,{items:[]});assert.deepEqual(d,{items:[]});assert.equal(storeBad(f),null);d.items.push(1);await saveStore(f,d);assert.deepEqual(JSON.parse(readFileSync(f,'utf8')),{items:[1]});
 // the default is never shared between two stores
 const x=await readStore(path.join(dir(),'b.json'),{items:[]}),y=await readStore(path.join(dir(),'c.json'),{items:[]});x.items.push(1);assert.deepEqual(y.items,[])});

for(const [name,text] of Object.entries(BROKEN))test('a '+name+' file: left untouched, saves refused, one notice, the default in memory',async()=>{const f=path.join(dir(),'s-'+name.replace(/\W/g,'')+'.json');writeFileSync(f,text);const n=bad.length;
 const d=await readStore(f,{users:[]});assert.deepEqual(d,{users:[]});assert.ok(storeBad(f));
 await assert.rejects(saveStore(f,{users:[]}),e=>e instanceof StoreRefused&&e.code==='STORE_BAD'&&/nothing is saved over it/.test(e.message));
 await assert.rejects(updateStore(f,{users:[]},x=>{x.users.push(9)}),StoreRefused);
 await readStore(f,{users:[]});assert.equal(readFileSync(f,'utf8'),text,'the bytes are unchanged');assert.equal(bad.length,n+1,'said once');
 assert.deepEqual(readdirSync(path.dirname(f)),[path.basename(f)],'nothing else was written')});

test('with a last good copy, an unreadable file gives that copy to work with (read-only), and heals when the file is repaired',async()=>{const f=path.join(dir(),'users.json');
 await saveStore(f,{users:['ann']});await saveStore(f,{users:['ann','bob']});
 assert.deepEqual(JSON.parse(readFileSync(f+'.last-good','utf8')),{users:['ann']},'the version before the last save');
 writeFileSync(f,'{"users":["ann","bo');   // a hand edit gone wrong
 const d=await readStore(f,{users:[]});assert.deepEqual(d,{users:['ann']});await assert.rejects(saveStore(f,d),StoreRefused);
 assert.equal(readFileSync(f,'utf8'),'{"users":["ann","bo');
 // someone repairs it: the next save goes through, and the notice is taken back
 writeFileSync(f,'{"users":["ann","bob"]}');const g=good.length;await saveStore(f,{users:['ann','bob','cy']});assert.equal(storeBad(f),null);assert.equal(good.length,g+1);
 assert.deepEqual(JSON.parse(readFileSync(f,'utf8')).users,['ann','bob','cy'])});

test('two first readers of one file get the same object (M4), so neither works on a copy the other replaces',async()=>{const f=path.join(dir(),'g.json');writeFileSync(f,'{"jobs":{}}');
 const [a,b]=await Promise.all([readStore(f),readStore(f)]);assert.equal(a,b);
 // the module idiom: let db; load = if(!db) db = await readStore(F)
 let db=null;const load=async()=>{if(!db){db=await readStore(f);db.jobs||={}}return db};
 await Promise.all([(async()=>{(await load()).jobs.x=1})(),(async()=>{(await load()).jobs.y=2})()]);await saveStore(f,db);assert.deepEqual(JSON.parse(readFileSync(f,'utf8')).jobs,{x:1,y:2})});

test('50 saves at once (M5): none rejects, the file always parses, no temp file stays; read-modify-write does not interleave',async()=>{const D=dir(),f=path.join(D,'q.json');
 let parsed=0;const watch=setInterval(()=>{try{JSON.parse(readFileSync(f,'utf8'));parsed++}catch(e){if(e.code!=='ENOENT')parsed=-1e9}},1);
 await Promise.all(Array.from({length:50},(_,i)=>saveStore(f,{i,pad:'x'.repeat(20000)})));clearInterval(watch);assert.ok(parsed>=0,'a reader saw a half-written file');
 assert.equal(JSON.parse(readFileSync(f,'utf8')).i,49,'the last save wins');assert.deepEqual(readdirSync(D).sort(),['q.json','q.json.last-good']);
 const c=path.join(D,'count.json');await Promise.all(Array.from({length:40},()=>updateStore(c,{n:0},d=>{d.n++})));assert.equal(JSON.parse(readFileSync(c,'utf8')).n,40);
 // a change that returns false saves nothing
 const before=readFileSync(c,'utf8');assert.equal(await updateStore(c,{n:0},d=>{d.n=999;return false}),false);assert.equal(readFileSync(c,'utf8'),before)});

test('a write that fails leaves the file as it was and no temp file',async()=>{const D=dir(),f=path.join(D,'w.json');await saveStore(f,{ok:1});
 await assert.rejects(atomicWrite(f,{toString(){throw Error('boom')}}));assert.deepEqual(JSON.parse(readFileSync(f,'utf8')),{ok:1});assert.ok(!readdirSync(D).some(n=>n.endsWith('.tmp')))});

test('state that can be rebuilt (replace): the unreadable file is put aside and the store goes on',async()=>{const D=dir(),f=path.join(D,'box-ops.json');writeFileSync(f,'');
 const d=await readStore(f,{},{replace:true});assert.deepEqual(d,{});assert.equal(storeBad(f),null);await saveStore(f,{filed:{}});assert.ok(readdirSync(D).some(n=>/^box-ops\.json\.corrupt-\d+$/.test(n)))});

test('temp files a killed write left are swept when they are old',async()=>{const D=dir();writeFileSync(path.join(D,'a.json.123.tmp'),'x');writeFileSync(path.join(D,'b.json.tmp'),'x');writeFileSync(path.join(D,'keep.json'),'{}');
 const old=new Date(Date.now()-2*3600e3);utimesSync(path.join(D,'a.json.123.tmp'),old,old);assert.equal(await sweepTmp(D),1);assert.deepEqual(readdirSync(D).sort(),['b.json.tmp','keep.json'])});

/* ---------- the stores themselves: corrupt file in, one writer called, bytes unchanged ---------- */
const HALF='{"x":[1,2';
async function unchanged(file,act,label){writeFileSync(file,HALF);let threw=false;try{await act()}catch{threw=true}
 assert.equal(readFileSync(file,'utf8'),HALF,label+': the unreadable file was saved over');return threw}

test('users.json unreadable at boot: nothing is written (before: defaults were saved over the people list)',async()=>{const D=dir(),{createUsers}=await import('../app/users.mjs');
 const U=createUsers(D,{send:async()=>{}});const f=path.join(D,'users.json');
 await unchanged(f,async()=>{await U.list?.();await U.load?.();await new Promise(r=>setTimeout(r,50))},'users');assert.deepEqual(readdirSync(D),['users.json'])});

test('accounts.json one character short: a label change is refused and the file stays (the audit reproduction)',async()=>{const D=dir(),{createAccounts}=await import('../app/accounts.mjs');
 const f=path.join(D,'accounts.json'),full=JSON.stringify({accounts:[{id:'a2',label:'Second',dir:'/x'}],assign:{bot:'a2'},auto:{on:true,threshold:90},priority:[{key:'claude:a2',model:''}],labels:{'p:x':'Mine'}});
 writeFileSync(f,full.slice(0,-1));const A=createAccounts(D);let status=0;
 const req={method:'PUT',url:'/ui/accounts/label'},send=(res,code)=>{status=code};
 try{await A(req,{},'/ui/accounts/label',send,async()=>JSON.stringify({key:'p:x',label:'Other'}))}catch{status=status||500}
 assert.equal(readFileSync(f,'utf8'),full.slice(0,-1));assert.notEqual(status,200)});

test('issues.json, questions.json, bottlenecks.json, payment callbacks, paid labels: a writer on an unreadable file changes nothing',async()=>{
 {const D=dir();writeFileSync(path.join(D,'team-policy.json'),JSON.stringify({teams:[],fixer:{on:false}}));const {createIssues}=await import('../app/issues.mjs');const I=createIssues({DATA:D,bin:'x',fixerHome:D,log:()=>{},defer:()=>{}});
  assert.equal(await unchanged(path.join(D,'issues.json'),()=>I.file({agent:'a',missing:'something broke'}),'issues'),true,'the filing is refused, not lost in silence')}
 {const D=dir(),{createQuestions}=await import('../app/questions.mjs');const Q=createQuestions({DATA:D,names:a=>a});
  await unchanged(path.join(D,'questions.json'),()=>Q.file({kind:'app',issue:'x'},{question:'Which one?',options:[{label:'A',effect:'a'},{label:'B',effect:'b'}]}),'questions')}
 {const D=dir(),{createBottlenecks}=await import('../app/bottlenecks.mjs');const B=createBottlenecks({DATA:D,listAgents:async()=>[],names:a=>a});
  await unchanged(path.join(D,'bottlenecks.json'),()=>B.event('down','x','y'),'bottlenecks')}
 {const D=dir(),W=dir(),{createPaidLabels}=await import('../app/paid-labels.mjs');mkdirSync(path.join(W,'a','.secrets'),{recursive:true});writeFileSync(path.join(W,'a','.secrets','TRIPAY_API_KEY'),'k');let posts=0;
  const t=Date.parse('2026-11-08T05:00:00Z');writeFileSync(path.join(D,'payments.jsonl'),JSON.stringify({at:new Date(t-60e3).toISOString(),agent:'a',conversation:'c',phone:'62',kind:'qris',total:5,refs:['T1'],orders:[],ok:true})+'\n');
  const P=createPaidLabels({DATA:D,WORK:W,log:()=>{},now:()=>t,fetchImpl:async()=>({ok:true,json:async()=>({success:true,data:{status:'PAID'}})}),orders:async()=>({chatId:1,threadId:1,persona:'S',currency:'Rp'}),post:async()=>{posts++;return 1},label:async()=>({set:true})});
  await unchanged(path.join(D,'paid-labels.json'),()=>P.tick(),'paid labels');await P.tick().catch(()=>{});await P.tick().catch(()=>{});
  assert.equal(posts,0,'an unreadable paid-labels.json must not post paid orders again ('+posts+' posts)')}});
