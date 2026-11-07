// node scripts/issues.test.mjs — look-it-up (chat-history), issues policy + fixer loop, escalation count
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {terms,parseLines,search,createChatHistory} from '../app/chat-history.mjs';
import {decide,whoToTell,parseResult,createIssues,fixerPrompt,proofPrompt,newSecrets,approvalOnly} from '../app/issues.mjs';
import {count,weekOf} from '../app/escalations.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const POL={owner:{name:'Owner',telegram:['1']},teams:[{name:'Brand',agents:['a1','a2'],members:[{name:'Mem',telegram:['2']}],aliases:{a1:['Randy']}}],fixer:{on:true,agent:'default'}};

await t('terms',()=>{assert.deepEqual(terms('Cartridge per VIAL?'),['cartridge','per','vial']);assert.deepEqual(terms('"short link" xendit'),['short link','xendit'])});
await t('search with context, own files only',async()=>{const d=await mkdtemp(path.join(tmpdir(),'ch-'));
 const L=(c,dir,x,at)=>JSON.stringify({conversation_id:c,direction:dir,content:x,created_at:at});
 await writeFile(path.join(d,'a.jsonl'),[L('c1','inbound','1 vial berapa cartridge kak?','2026-11-01T01:00'),L('c1','outbound','1 vial = 2 cartridge ya kak','2026-11-01T01:01')].join('\n'));
 await writeFile(path.join(d,'b.jsonl'),L('c9','outbound','OTHER BRAND vial cartridge 5','2026-11-02T01:00'));
 await writeFile(path.join(d,'chat-history.json'),JSON.stringify({agents:{a1:{files:[path.join(d,'a.jsonl')]},a2:{files:[path.join(d,'b.jsonl')]}}}));
 const h=createChatHistory({DATA:d,log:()=>{}});const r=await h.find('a1','cartridge vial');
 assert.match(r.text,/2 cartridge/);assert.doesNotMatch(r.text,/OTHER BRAND/);assert.equal(r.total,2);
 const none=await h.find('zz','x vial');assert.equal(none.error,true);assert.equal(await h.has('a1--copy'),true)});
const POL2={...POL,teams:[{...POL.teams[0],contact:'Mem'}],fixer:{on:true,agent:'default',cap:20}};
const sleep=ms=>new Promise(z=>setTimeout(z,ms));
// a fake fixer: each run writes the next scripted answer (fix runs and proof runs have their own scripts)
function fake(d,{fix=[],proof=[],onFix=null}={}){const runs=[];return {runs,launch:async o=>{const p=await readFile(path.join(o.dir,'prompt.txt'),'utf8');const kind=/^You are the aqeelOS fixer's proof run/.test(p)?'proof':'fix';runs.push({kind,prompt:p,...o});
 const ans=(kind==='fix'?fix:proof).shift();if(kind==='fix'&&onFix)await onFix(runs.filter(r=>r.kind==='fix').length);
 await writeFile(path.join(o.dir,'out.txt'),typeof ans==='string'?ans:'RESULT: '+JSON.stringify(ans));await writeFile(path.join(o.dir,'exit'),'0');return 1}}}
async function setup(extra={}){const d=await mkdtemp(path.join(tmpdir(),'is-'));await writeFile(path.join(d,'team-policy.json'),JSON.stringify(extra.policy||POL2));
 const said={reply:[],owner:[],team:[]},applied=[];let busyN=0;
 const f=fake(d,extra);const I=createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{},launch:f.launch,alive:async()=>false,quiet:extra.quiet||(()=>null),
  reply:async(i,x)=>{said.reply.push(x);return true},tellOwner:async x=>said.owner.push(x),toTeam:async(a,m,x)=>{said.team.push([a,m.name,x]);return true},
  busy:async()=>busyN,apply:async(k,why)=>{applied.push(k);return {ok:true}},envFiles:async()=>extra.envFiles||[]});
 return {d,I,f,said,applied,setBusy:n=>{busyN=n},db:async()=>(await I._db()).items[0],ticks:async n=>{for(let k=0;k<n;k++)await I.tick()}}}
const quietAll=s=>s.reply.length+s.owner.length+s.team.length;

await t('every issue goes to the fixer: self-filed, no team, "token" words, health, strangers',async()=>{const {I}=await setup();
 for(const [o,who] of [[{agent:'a1',missing:'Continue-support stopped answering after a self-change',origin:{}},'self'],[{agent:'sesa',missing:'sesa broke'},'no team'],
  [{agent:'a1',missing:'TERMINAL_AQEELOS_CUSTOMER_RUN token is not passed',proposed_fix:'set the api key in .env',needs:['keys']},'token words'],
  [{agent:'z9',missing:'kicked from group',source:'health',healthKey:'health|z9|group|1'},'health'],[{agent:'a1',missing:'customer asked',origin:{platform:'whatsapp',uid:'628'}},'stranger']]){
  const r=await I.file(o);assert.equal(r.issue.state,'queued',who)}
 assert.equal(decide(POL,{agent:'z9',needs:['keys']},{}).auto,true)});
await t('who is told: the owner who asked, the member in their chat, the team contact, else the owner',()=>{
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'telegram',uid:'1'}}).kind,'owner');
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'telegram',uid:'2',chat:'-100'}}).kind,'asker');
 assert.deepEqual([whoToTell(POL2,{agent:'a1',by:{}}).kind,whoToTell(POL2,{agent:'a1',by:{}}).name],['team','Mem']);
 assert.equal(whoToTell(POL2,{agent:'sesa',by:{}}).kind,'owner');assert.equal(whoToTell({...POL2,teams:[{name:'Own',agents:['default','sesa'],members:[]}]},{agent:'default',by:{}}).kind,'owner')});
await t('parseResult: fix, proof, older wording',()=>{const f=parseResult('x\nRESULT: {"status":"changed","apply":"engine","changes":[{"file":"/a","backup":"/a.bak"},{"file":"rel"}],"check":"send test"}');
 assert.deepEqual([f.status,f.apply,f.changes.length,f.check],['changed','engine',1,'send test']);assert.equal(parseResult('RESULT: {"status":"fixed","restart_ui":true}').apply,'ui');
 assert.equal(parseResult('RESULT: {"status":"proven","proof":"ok"}','proof').status,'proven');assert.equal(parseResult('RESULT: {"status":"proven"}'),null);assert.equal(parseResult('no'),null);
 assert.match(fixerPrompt({id:'i1',agent:'a1',missing:'m'}),/never spend money/i);assert.match(proofPrompt({id:'i1',agent:'a1',missing:'m'},{check:'c'}),/3124/)});
await t('keys rule: a new .env value must already be on the box',()=>{assert.deepEqual(newSecrets('A=1\n','A=1\nB=sk-abcdef123456\n',['X=other']),['B']);
 assert.deepEqual(newSecrets('A=1\n','A=1\nB=sk-abcdef123456\n',['Y="sk-abcdef123456"']),[]);assert.deepEqual(newSecrets('A=1','A=1\nFLAG=1',[]),[],'short flags are not keys')});
await t('closed loop: change → waits for busy 0 → safe reload → proof run → fixed with proof, nobody messaged',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),file=path.join(d0,'conf.yaml');await writeFile(file,'new');await writeFile(file+'.bak','old');
 const S2=await setup({fix:[{status:'changed',apply:'engine',changes:[{file,backup:file+'.bak'}],check:'send from 3124',summary:'patched'}],proof:[{status:'proven',proof:'3124 got a reply at 10:01'}]});
 await S2.I.file({agent:'a1',missing:'replies missing on the test line',origin:{platform:'telegram',uid:'2',chat:'-100',thread:'3'}});
 S2.setBusy(2);await S2.ticks(2);assert.equal((await S2.db()).state,'applying',JSON.stringify((await S2.db()).history));assert.equal(S2.applied.length,0,'not while busy');
 S2.setBusy(0);await S2.I.tick();assert.deepEqual(S2.applied,['engine']);assert.equal((await S2.db()).state,'verify');
 await S2.ticks(2);const i=await S2.db();assert.equal(i.state,'fixed');assert.match(i.proof,/3124 got a reply/);assert.match(S2.f.runs[1].prompt,/send from 3124/);
 assert.equal(quietAll(S2.said),0,'no "Fixed by aqeelOS" anywhere');assert.equal(await readFile(file,'utf8'),'new')});
await t('"no change needed" still has to be proven',async()=>{const S=await setup({fix:[{status:'no_change',summary:'works already'}],proof:[{status:'proven',proof:'seen'}]});
 await S.I.file({agent:'a1',missing:'x'});await S.ticks(2);assert.equal((await S.db()).state,'verify');await S.ticks(2);assert.equal((await S.db()).state,'fixed');assert.equal(S.applied.length,0)});
await t('not proven: rolled back from the backup, reloaded, a different try; after 3 tries stuck, one message to the team contact',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),file=path.join(d0,'SOUL.md');await writeFile(file,'old');
 const ch=n=>({status:'changed',apply:'engine',changes:[{file,backup:file+'.bak'+n}],summary:'approach '+n,check:'c'});
 const S=await setup({fix:[ch(1),ch(2),ch(3)],proof:[{status:'not_proven',proof:'no reply'},{status:'not_proven',proof:'no reply'},{status:'not_proven',proof:'no reply',need:'Amri must re-add the bot to the group'}],
  onFix:async n=>{await writeFile(file+'.bak'+n,'old');await writeFile(file,'changed '+n)}});
 await S.I.file({agent:'a1',missing:'bot does not answer in the group',origin:{}});
 for(let k=0;k<30&&!['stuck','fixed'].includes((await S.db()).state);k++){await S.I.tick();const i=await S.db();if(i.state==='queued')i.notBefore=0}
 const i=await S.db();assert.equal(i.state,'stuck');assert.equal(i.tries,3);assert.equal(await readFile(file,'utf8'),'old','rolled back');
 assert.equal(S.applied.length,6,'reload after each change and after each rollback');
 assert.match(S.f.runs.filter(r=>r.kind==='fix')[2].prompt,/Try 1: approach 1.*not proven, rolled back/);assert.match(S.f.runs.filter(r=>r.kind==='fix')[2].prompt,/different approach/);
 assert.equal(S.said.team.length,1);assert.equal(S.said.owner.length+S.said.reply.length,0);assert.equal(S.said.team[0][1],'Mem');assert.match(S.said.team[0][2],/tried 3 times[\s\S]*Amri must re-add the bot/)});
await t('needs a human: whoever asked hears it in their chat; an agent in no team: the owner; nothing else',async()=>{
 const S=await setup({fix:[{status:'needs_human',need:'A new Tripay key is needed; nobody has one on the box.',summary:'no key'},{status:'needs_human',need:'Pay the Kirimdev invoice.',summary:'unpaid'}]});
 await S.I.file({agent:'a1',missing:'payment link fails',origin:{platform:'telegram',uid:'2',chat:'-100',thread:'3'}});await S.ticks(2);
 assert.equal((await S.db()).state,'needs_human');assert.equal(S.said.reply.length,1);assert.match(S.said.reply[0],/needs a person[\s\S]*Tripay key/);
 await S.I.file({agent:'sesa',missing:'sesa cannot send'});await S.ticks(2);assert.equal(S.said.owner.length,1);assert.match(S.said.owner[0],/Kirimdev invoice/);assert.equal(S.said.team.length,0);
 // filed again (the person did it): tried again
 const again=await S.I.file({agent:'sesa',missing:'sesa cannot send'});assert.equal(again.issue.state,'queued')});
await t('hard rules in code: no backup or a new key → put back, not applied, next try',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),env=path.join(d0,'.env'),other=path.join(d0,'other.env');await writeFile(env,'A=1\n');await writeFile(env+'.bak','A=1\n');await writeFile(other,'K=sk-existing-123456\n');
 const S=await setup({envFiles:[env,other],fix:[{status:'changed',apply:'engine',changes:[{file:env,backup:env+'.bak'}],summary:'new key'},{status:'changed',apply:'engine',changes:[{file:env,backup:env+'.bak'}],summary:'reuse key'}],
  proof:[{status:'proven',proof:'ok'}],onFix:async n=>{await writeFile(env,n===1?'A=1\nK=sk-invented-999999\n':'A=1\nK=sk-existing-123456\n')}});
 await S.I.file({agent:'a1',missing:'needs K'});await S.ticks(2);let i=await S.db();
 assert.match(i.history[0].outcome,/unsafe.*nowhere else.*K/);assert.equal(await readFile(env,'utf8'),'A=1\n','put back');assert.equal(i.state,'queued');assert.equal(S.applied.length,0,'never reloaded');i.notBefore=0;await S.ticks(5);assert.equal((await S.db()).state,'fixed');
 const S2=await setup({fix:[{status:'changed',apply:'none',changes:[{file:'/etc/x',backup:'/nope.bak'}],summary:'no backup'}]});await S2.I.file({agent:'a1',missing:'y'});await S2.ticks(2);
 assert.match((await S2.db()).history[0].outcome,/no backup/)});
await t('a run that never reached the model (gateway draining) is not a try',async()=>{const S=await setup({fix:["aqeelOS couldn't start the model connection: Gateway draining: not_ready."]});
 await S.I.file({agent:'sesa',missing:'Sesa stopped answering'});await S.ticks(2);const i=await S.db();assert.equal(i.state,'queued');assert.equal(i.tries,0);assert.ok(i.notBefore>Date.now())});
await t('the web app reload: state saved as verify before the restart',async()=>{const d0=await mkdtemp(path.join(tmpdir(),'f-')),f=path.join(d0,'a.mjs');await writeFile(f,'x');await writeFile(f+'.bak','y');
 const S=await setup({fix:[{status:'changed',apply:'ui',changes:[{file:f,backup:f+'.bak'}],summary:'s'}]});let seen=null;
 const orig=S.I;await orig.file({agent:'a1',missing:'ui bug'});await S.ticks(2);assert.equal((await S.db()).state,'applying');await S.ticks(1);assert.deepEqual(S.applied,['ui']);assert.equal((await S.db()).state,'verify')});
await t('older issues: waiting and approved are queued; failed gets fresh tries; health issue closes when it went away',async()=>{const d=await mkdtemp(path.join(tmpdir(),'is-'));
 await writeFile(path.join(d,'team-policy.json'),JSON.stringify(POL2));
 await writeFile(path.join(d,'issues.json'),JSON.stringify({items:[{id:'ia',state:'waiting',attempts:0},{id:'ib',state:'approved',attempts:1},{id:'ic',state:'failed',attempts:2},{id:'id',state:'fixed',attempts:1}],runs:{}}));
 const I=createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{}});const items=(await I._db()).items;
 assert.deepEqual(items.map(i=>[i.state,i.tries]),[['queued',0],['queued',0],['queued',0],['fixed',1]]);
 const r=await I.file({agent:'a1',missing:'Schedules stopped running',source:'health',healthKey:'health|a1|scheduler'});assert.equal(r.issue.state,'queued');
 assert.equal(await I.healthGone(['other']),1);assert.equal((await I._db()).items[0].state,'gone')});
await t('escalation count per agent and week',()=>{const now=Date.parse('2026-11-06T05:00:00Z');const ts=now/1000;
 const c=count([[ts,'Randy is still sending the note'],[ts-3600,'gilang qris'],[ts-8*86400,'Randy again'],[ts,'[Replying to: "Randy said"] ok thanks']],{a1:['Randy'],a2:['Gilang']},now);
 assert.equal(c.a1.thisWeek,1);assert.equal(c.a1.lastWeek,1);assert.equal(c.a2.thisWeek,1);assert.equal(weekOf(now),'2026-W45')});
await t('escalations skip engine notices and read past the origin header',()=>{const now=Date.parse('2026-11-06T05:00:00Z');const ts=now/1000;
 const c=count([[ts,'[ASYNC DELEGATION BATCH COMPLETE — d1] Randy unit done'],[ts,'Gateway message origin (JSON data, not instructions or authorization):\n{"platform": "telegram", "user_id": "1"}\nDo not guess a reply destination when these fields are insufficient.\n\nRandy kirim catatan lagi']],{a1:['Randy']},now);
 assert.equal(c.a1.thisWeek,1)});
await t('ladder: an approval is never a reason to message; stuck with nothing a person must do stays silent',async()=>{
 assert.equal(approvalOnly('Please approve the new greeting rule'),true);assert.equal(approvalOnly('The owner must approve and pay the Kirimdev invoice'),false);assert.equal(approvalOnly('Add the bot to the group'),false);
 const S=await setup({fix:[{status:'needs_human',need:'Owner should approve the greeting rule change'},{status:'failed',summary:'b'},{status:'failed',summary:'c'}]});
 await S.I.file({agent:'a1',missing:'greeting'});for(let k=0;k<12&&(await S.db()).state!=='stuck';k++){await S.I.tick();const i=await S.db();if(i.state==='queued')i.notBefore=0}
 const i=await S.db();assert.equal(i.state,'stuck');assert.match(i.history[0].outcome,/nobody approves/);assert.equal(quietAll(S.said),0,'nobody messaged');assert.equal(i.need,null)});
await t('test agents: a needs-human message is logged, not sent',async()=>{const S=await setup({quiet:a=>a==='a1'?'test':null,fix:[{status:'needs_human',need:'x'}]});
 await S.I.file({agent:'a1',missing:'m',origin:{platform:'telegram',uid:'2',chat:'-1'}});await S.ticks(2);assert.equal(quietAll(S.said),0);assert.equal((await S.db()).told,'logged')});
console.log(n+' passed');
