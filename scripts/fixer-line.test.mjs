// node scripts/fixer-line.test.mjs — System › Health redesign (11 Nov 2026): the fixer's line (order, move, skip,
// pause), proof runs while an engine reload waits, duplicates merged when filed, sorting new issues with one short call
// (MODEL-3), and memory per agent (HEALTH-6)
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createIssues,lineOf,parseSort,dayIn,nextDay,fixerModel,sortPrompt} from '../app/issues.mjs';
import {perUser,agentOfUser,dailyMeans,growth,createAgentMemory} from '../app/agent-memory.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const POL={owner:{name:'Owner'},teams:[],fixer:{on:true,agent:'default',cap:20,models:{fix:'m-fix',proof:'m-proof'}}};
function fake(){const runs=[];return {runs,launch:async o=>{const p=await readFile(path.join(o.dir,'prompt.txt'),'utf8');const kind=/proof run/.test(p.split('\n')[0])?'proof':'fix';runs.push({kind,...o});return 1}}}
async function setup(x={}){const d=await mkdtemp(path.join(tmpdir(),'fl-'));await writeFile(path.join(d,'team-policy.json'),JSON.stringify(x.policy||POL));
 let clock=x.at||Date.UTC(2026,10,11,8,0,0);const f=fake(),told=[];
 const I=createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{},launch:f.launch,alive:async()=>true,now:()=>clock,tz:()=>'UTC',engineOk:x.engineOk||(()=>true),sortRun:x.sortRun||null,
  tellOwner:async m=>told.push(m),reply:async()=>false,toTeam:async()=>false,busy:async()=>0,apply:async()=>({ok:true})});
 const file=async o=>{clock+=1000;return I.file(o)};return {I,f,told,file,db:()=>I._db(),step:ms=>{clock+=ms},now:()=>clock}}

await t('the line: proof runs first, then urgent agents, then the oldest; skipped and sorting ones are out',()=>{
 const it=[{id:'a',state:'queued',created:3},{id:'b',state:'queued',created:1},{id:'c',state:'verify',created:9},{id:'d',state:'queued',urgent:true,created:8},{id:'e',state:'queued',created:2,skipUntil:100},{id:'f',state:'queued',created:0,sorting:5},{id:'g',state:'needs_human',created:0}];
 assert.deepEqual(lineOf(it,50).map(i=>i.id),['c','d','b','e','a'].filter(x=>x!=='e'));assert.deepEqual(lineOf(it,200).map(i=>i.id),['c','d','b','e','a'])});

await t('move up and down swaps places; skip leaves the line until the day turns; put back returns it',async()=>{const S=await setup({policy:{...POL,fixer:{...POL.fixer,on:true}}});
 const a=(await S.file({agent:'x',missing:'first problem about the shop'})).issue,b=(await S.file({agent:'y',missing:'second problem about mail'})).issue,c=(await S.file({agent:'z',missing:'third problem about photos'})).issue;
 const order=async()=>(await S.I.fixerView()).line.map(i=>i.id);
 assert.deepEqual(await order(),[a.id,b.id,c.id]);
 await S.I.move(c.id,'up');assert.deepEqual(await order(),[a.id,c.id,b.id]);
 await S.I.move(a.id,'down');assert.deepEqual(await order(),[c.id,a.id,b.id]);
 await S.I.move(c.id,'up');assert.deepEqual(await order(),[c.id,a.id,b.id],'the first one cannot go higher');
 await S.I.skip(a.id);const v=await S.I.fixerView();assert.deepEqual(v.line.map(i=>i.id),[c.id,b.id]);assert.deepEqual(v.skipped.map(i=>i.id),[a.id]);
 assert.equal(v.skipped[0].skipUntil,Date.UTC(2026,10,12),'until the next day starts');
 S.step(17*3600e3);assert.deepEqual(await order(),[c.id,a.id,b.id],'back the next day');
 await S.I.skip(b.id);await S.I.skip(b.id,false);assert.ok((await order()).includes(b.id))});

await t('pause holds the line, resume lets it go on',async()=>{const S=await setup();await S.file({agent:'x',missing:'something broke in the shop'});
 await S.I.pause(true,'Owner');await S.I.tick();assert.equal(S.f.runs.length,0);const v=await S.I.fixerView();assert.equal(v.paused.by,'Owner');
 await S.I.pause(false);await S.I.tick();assert.equal(S.f.runs.length,1)});

await t('while an engine reload waits for the quiet hours, proof runs and urgent fixes go on; other fixes wait',async()=>{const S=await setup({engineOk:()=>false});
 const a=(await S.file({agent:'x',missing:'needs the engine reloaded'})).issue,b=(await S.file({agent:'y',missing:'fixed, needs proving'})).issue,c=(await S.file({agent:'z',missing:'an ordinary problem'})).issue;
 const db=await S.db(),A=db.items.find(i=>i.id===a.id),B=db.items.find(i=>i.id===b.id);A.state='applying';A.applyKind='engine';B.state='verify';B.tries=1;
 await S.I.tick();assert.deepEqual(S.f.runs.map(r=>r.kind),['proof'],'the proof run goes');
 const v=await S.I.fixerView();assert.equal(v.wait.id,a.id);assert.equal(v.wait.quiet,false);assert.equal(v.now.id,b.id);assert.equal(v.now.step,'prove');assert.equal(v.now.model,'m-proof');
 assert.deepEqual(v.line.map(i=>i.id),[c.id],'the ordinary fix waits in line');
 // the proof run ends without an answer: the ordinary fix still waits
 for(const r of Object.values(db.runs))r.done=Date.now();B.state='stuck';await S.I.tick();assert.equal(S.f.runs.length,1)});

await t('the daily limit holds back fixes, never proof runs; the limit resets at the install’s midnight',async()=>{const S=await setup({policy:{...POL,fixer:{...POL.fixer,cap:1}}});
 const a=(await S.file({agent:'x',missing:'problem number one here'})).issue;await S.I.tick();const db=await S.db();for(const r of Object.values(db.runs))r.done=S.now();db.items.find(i=>i.id===a.id).state='stuck';
 const b=(await S.file({agent:'y',missing:'problem number two here'})).issue;await S.I.tick();assert.equal(S.f.runs.length,1,'limit reached');
 const v=await S.I.fixerView();assert.deepEqual([v.cap.used,v.cap.cap,v.cap.resetAt],[1,1,Date.UTC(2026,10,12)]);
 db.items.find(i=>i.id===b.id).state='verify';await S.I.tick();assert.equal(S.f.runs.at(-1).kind,'proof','a proof run still goes')});

await t('the same problem filed again in other words for the same agent joins the open one',async()=>{const S=await setup();
 const a=(await S.file({agent:'x',missing:'The higgsfield connector needs someone to sign in again on this agent'})).issue;
 const r=await S.file({agent:'x',missing:'Higgsfield connector needs someone to sign in again for this agent'});
 assert.equal(r.merged,true);assert.equal(r.issue.id,a.id);assert.equal(r.issue.count,2);assert.equal(r.issue.reports.length,1);
 assert.equal((await S.file({agent:'y',missing:'Something else entirely is broken over here'})).merged,undefined)});

await t('sorting: one short call merges a duplicate across agents, sends person-only work to Needs you, and leaves the rest with the fixer',async()=>{
 let dupOf=null;const asked=[];
 const S=await setup({sortRun:async o=>{asked.push(o);const id=/ISSUE (i[0-9a-f]{8})/.exec(o.prompt)[1],pr=/^Problem: (.*)$/m.exec(o.prompt)[1];
  if(pr.includes('Pepclub'))return 'thinking…\nSORT: '+JSON.stringify({kind:'duplicate',duplicateOf:dupOf,title:'Higgsfield needs a new sign-in'});
  if(pr.includes('invoice'))return 'SORT: '+JSON.stringify({kind:'person',need:'Pay the overdue invoice for the WhatsApp line.',group:'Pay the WhatsApp invoice',title:'The WhatsApp line is unpaid'});
  if(pr.includes('approve'))return 'SORT: '+JSON.stringify({kind:'person',need:'Approve the change.',title:'x'});
  return id?'no idea':''}});
 const a=(await S.file({agent:'donna',missing:'Donna AI: "higgsfield" needs someone to sign in'})).issue;dupOf=a.id;await S.I.sortNext();
 let db=await S.db();assert.equal(db.items.find(i=>i.id===a.id).sorted,'unclear','an unclear answer leaves it with the fixer');assert.equal(db.items.find(i=>i.id===a.id).state,'queued');
 assert.equal(asked[0].model,'m-proof','sorting uses the proof model when none is set for it');assert.equal(asked[0].effort,'low');
 const b=(await S.file({agent:'pepclub',missing:'Pepclub social: "higgsfield" needs someone to sign in'})).issue;
 assert.ok((await S.I.fixerView()).line.every(i=>i.id!==b.id),'not in the line while it is sorted');await S.I.sortNext();db=await S.db();
 const B=db.items.find(i=>i.id===b.id),A=db.items.find(i=>i.id===a.id);assert.equal(B.state,'closed');assert.equal(B.mergedInto,a.id);assert.equal(A.count,2);assert.deepEqual(A.affects,['pepclub']);
 // filed again later: counted on the one it merged into, no second sorting
 const n0=asked.length;const again=await S.file({agent:'pepclub',missing:'Pepclub social: "higgsfield" needs someone to sign in'});assert.equal(again.issue.id,a.id);assert.equal(asked.length,n0);
 const c=(await S.file({agent:'wa',missing:'The WhatsApp invoice is overdue and the line stops tomorrow'})).issue;await S.I.sortNext();db=await S.db();
 const C=db.items.find(i=>i.id===c.id);assert.equal(C.state,'needs_human');assert.equal(C.group,'Pay the WhatsApp invoice');assert.equal(C.title,'The WhatsApp line is unpaid');assert.equal(S.told.length,1);
 const d=(await S.file({agent:'wa',missing:'Someone must approve the new prompt change'})).issue;await S.I.sortNext();db=await S.db();assert.equal(db.items.find(i=>i.id===d.id).state,'queued','an approval is never a person’s job');
 assert.equal((await S.I.list()).spend.sorts.month,asked.length)});

await t('a merge follows a chain: what was merged into an issue moves on when that issue is merged in turn',async()=>{let map={};
 const S=await setup({sortRun:async o=>{const id=/ISSUE (i[0-9a-f]{8})/.exec(o.prompt)[1];return map[id]?'SORT: '+JSON.stringify({kind:'duplicate',duplicateOf:map[id],title:'t'}):'SORT: {"kind":"fixer","title":"t"}'}});
 const a=(await S.file({agent:'a',missing:'alpha sign-in expired'})).issue;await S.I.sortNext();
 const b=(await S.file({agent:'b',missing:'beta sign-in expired'})).issue;await S.I.sortNext();
 const c=(await S.file({agent:'c',missing:'gamma sign-in expired'})).issue;map[c.id]=b.id;await S.I.sortNext();
 // b was not sorted as a duplicate first; now b itself goes into a (as the backfill would do for an older item)
 const db=await S.db();const B=db.items.find(i=>i.id===b.id);B.sorted=undefined;map[b.id]=a.id;await S.I.sortNext();
 const A=db.items.find(i=>i.id===a.id),C=db.items.find(i=>i.id===c.id);
 assert.equal(C.mergedInto,a.id,'c points at the end of the chain');assert.equal(A.count,3);assert.deepEqual(A.affects.sort(),['b','c']);assert.equal(B.count,1);
 // a merge into an item that was merged already lands at the end of the chain
 const d=(await S.file({agent:'d',missing:'delta sign-in expired'})).issue;map[d.id]=b.id;await S.I.sortNext();assert.equal(db.items.find(i=>i.id===d.id).mergedInto,a.id);assert.equal(A.count,4)});

await t('a duplicate that already had tries is not merged but linked, so Needs you can show one card',async()=>{let map={};
 const S=await setup({sortRun:async o=>{const id=/ISSUE (i[0-9a-f]{8})/.exec(o.prompt)[1];return map[id]?'SORT: '+JSON.stringify({kind:'duplicate',duplicateOf:map[id],title:'t2'}):'SORT: {"kind":"fixer","title":"t"}'}});
 const a=(await S.file({agent:'a',missing:'alpha connector needs a sign-in'})).issue;await S.I.sortNext();
 const b=(await S.file({agent:'b',missing:'beta connector needs a sign-in'})).issue;
 const db=await S.db();const A=db.items.find(i=>i.id===a.id),B=db.items.find(i=>i.id===b.id);A.state='needs_human';B.sorting=0;B.state='needs_human';B.tries=1;map[b.id]=a.id;await S.I.sortNext();
 assert.equal(B.state,'needs_human','not merged: it had tries of its own');assert.equal(B.dupOf,a.id);assert.equal(B.title,'t2');
 // sorted again the other way round (a now a duplicate of b): no loop of links is made
 A.tries=1;A.sorted=undefined;map[a.id]=b.id;await S.I.sortNext();assert.equal(A.dupOf,undefined,'no link back');assert.equal(B.dupOf,a.id);
 // an older duplicate sorted before the link existed is sorted once more
 const C=db.items.find(i=>i.id===b.id);delete C.dupOf;C.sorted='duplicate';delete db.dupLink;
 const src=await readFile(new URL('../app/issues.mjs',import.meta.url),'utf8');assert.match(src,/db\.dupLink=1/)});

await t('sorting helpers: the answer line, the prompt, the model, days in the install’s time zone',()=>{
 assert.deepEqual(parseSort('x\nSORT: {"kind":"duplicate","duplicateOf":"i0123abcd","title":" T ","need":"","group":""}'),{kind:'duplicate',duplicateOf:'i0123abcd',title:'T',need:'',group:'',steps:[]});
 assert.equal(parseSort('SORT: {"kind":"maybe"}'),null);assert.equal(parseSort('nothing'),null);assert.equal(parseSort('SORT: {"kind":"fixer","duplicateOf":"../x"}').duplicateOf,null);
 const p=sortPrompt({id:'i1',agent:'Donna',missing:'m'},[{id:'i2',agent:'Sesa',missing:'other'}]);assert.match(p,/ISSUE i1/);assert.match(p,/i2 · Sesa · other/);assert.doesNotMatch(p,/claude|gpt|gemini/i,'no model names');
 assert.deepEqual(fixerModel({fixer:{models:{proof:'p',sort:'s'},effort:{sort:'minimal'}}},'sort'),{model:'s',effort:'minimal'});
 assert.equal(dayIn(Date.UTC(2026,10,11,20),'Asia/Jakarta'),'2026-11-12');assert.equal(nextDay(Date.UTC(2026,10,11,10),'Asia/Jakarta'),Date.UTC(2026,10,11,17));
 assert.equal(nextDay(Date.UTC(2026,10,11,10),'UTC'),Date.UTC(2026,10,12))});

await t('memory per agent: each agent’s user, the main agent with the engine, and a warning only for steady growth',async()=>{
 const m=perUser('  1024 claude\n 2048 ag-shop\n1024 ag-shop\n 99 root\n');assert.deepEqual([...m],[['claude',1048576],['ag-shop',3145728],['root',101376]]);
 const A=['shop','a-very-long-agent-name-that-is-cut-at-32'];assert.equal(agentOfUser('claude',A,'claude'),'default');assert.equal(agentOfUser('ag-shop',A,'claude'),'shop');
 assert.equal(agentOfUser(('ag-'+A[1]).slice(0,32),A,'claude'),A[1]);assert.equal(agentOfUser('root',A,'claude'),null);
 const H=3600e3,pts=(f)=>Array.from({length:5*24},(_,k)=>({t:k*H,b:f(Math.floor(k/24))}));
 const g=growth(pts(d=>(2+d)*1e9));assert.equal(g.days,5);assert.equal(Math.round(g.from/1e9),2);assert.equal(Math.round(g.to/1e9),6);
 assert.equal(growth(pts(()=>3e9)),null,'steady');assert.equal(growth(pts(d=>[2,3,2,3,2][d]*1e9)),null,'up and down');assert.equal(growth(pts(d=>(0.2+d*0.05)*1e9)),null,'small');
 assert.equal(dailyMeans(pts(d=>d*1e9)).length,5);
 const d=await mkdtemp(path.join(tmpdir(),'am-'));let now=Date.UTC(2026,10,11,8),txt='4194304 ag-shop\n1048576 claude\n';
 const M=createAgentMemory({DATA:d,listAgents:async()=>['shop'],ps:async()=>txt,now:()=>now,self:'claude',boxMemory:async()=>({memory:{limit:28e9,used:20e9}})});
 await M.sample();now+=10*60e3;txt='2097152 ag-shop\n1048576 claude\n';await M.sample();const v=await M.view();
 assert.equal(v.agents.shop.now,2097152*1024);assert.equal(v.agents.default.now,1048576*1024);assert.equal(v.limit,28e9);
 const saved=JSON.parse(await readFile(path.join(d,'agent-memory.json'),'utf8'));assert.equal(saved.agents.shop.length,1,'one point an hour');assert.equal(saved.agents.shop[0].b,3*1024**3,'the mean of its samples')});

console.log(n+' passed');
