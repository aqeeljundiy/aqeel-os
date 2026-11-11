// node scripts/issues.test.mjs — look-it-up (chat-history), issues policy + fixer loop, escalation count
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {terms,parseLines,search,createChatHistory} from '../app/chat-history.mjs';
import {decide,whoToTell,parseResult,createIssues,fixerPrompt,proofPrompt,newSecrets,approvalOnly,testerSendOnly,noPersonNeeded,similar,urgentFor} from '../app/issues.mjs';
import {count,weekOf} from '../app/escalations.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const POL={owner:{name:'Owner',telegram:['1']},teams:[{name:'Brand',agents:['a1','a2'],members:[{name:'Mem',telegram:['2']}],aliases:{a1:['Rory']}}],fixer:{on:true,agent:'default'}};

await t('urgentAgents policy',()=>{const P={fixer:{urgentAgents:['u1']}};assert.equal(urgentFor(P,{agent:'u1'}),true);assert.equal(urgentFor(P,{agent:'x',affects:['u1']}),true);assert.equal(urgentFor(P,{agent:'x',affects:['y']}),false);assert.equal(urgentFor({},{agent:'u1'}),false)});
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
  engineOk:extra.engineOk,busy:async()=>busyN,apply:async(k,why)=>{applied.push(k);return {ok:true}},envFiles:async()=>extra.envFiles||[],codeRoots:extra.codeRoots||[],onFixed:async i=>(extra.fixedOut||[]).push(i),checks:extra.checks||{}});
 return {d,I,f,said,applied,setBusy:n=>{busyN=n},db:async()=>(await I._db()).items[0],ticks:async n=>{for(let k=0;k<n;k++)await I.tick()}}}
const quietAll=s=>s.reply.length+s.owner.length+s.team.length;

await t('every issue goes to the fixer: self-filed, no team, "token" words, health, strangers',async()=>{const {I}=await setup();
 for(const [o,who] of [[{agent:'a1',missing:'Continue-support stopped answering after a self-change',origin:{}},'self'],[{agent:'sela',missing:'sela broke'},'no team'],
  [{agent:'a1',missing:'TERMINAL_AQEELOS_CUSTOMER_RUN token is not passed',proposed_fix:'set the api key in .env',needs:['keys']},'token words'],
  [{agent:'z9',missing:'kicked from group',source:'health',healthKey:'health|z9|group|1'},'health'],[{agent:'a1',missing:'customer asked',origin:{platform:'whatsapp',uid:'628'}},'stranger']]){
  const r=await I.file(o);assert.equal(r.issue.state,'queued',who)}
 assert.equal(decide(POL,{agent:'z9',needs:['keys']},{}).auto,true)});
await t('who is told: the owner who asked, the member in their chat, the team contact, else the owner',()=>{
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'telegram',uid:'1'}}).kind,'owner');
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'telegram',uid:'2',chat:'-100'}}).kind,'asker');
 assert.deepEqual([whoToTell(POL2,{agent:'a1',by:{}}).kind,whoToTell(POL2,{agent:'a1',by:{}}).name],['team','Mem']);
 // a chat in aqeelOS itself: the person who asked hears it there (11 Nov 2026, i7d96eb8c went to the owner instead of Fakhri)
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'api_server',uid:'api',chat:'api_1794370454_294eabeb'}}).kind,'asker');
 assert.equal(whoToTell(POL2,{agent:'a1',by:{platform:'api_server',uid:'api'}}).kind,'team');
 assert.equal(whoToTell(POL2,{agent:'sela',by:{}}).kind,'owner');assert.equal(whoToTell({...POL2,teams:[{name:'Own',agents:['default','sela'],members:[]}]},{agent:'default',by:{}}).kind,'owner')});
await t('parseResult: fix, proof, older wording',()=>{const f=parseResult('x\nRESULT: {"status":"changed","apply":"engine","changes":[{"file":"/a","backup":"/a.bak"},{"file":"rel"}],"check":"send test"}');
 assert.deepEqual([f.status,f.apply,f.changes.length,f.check],['changed','engine',1,'send test']);assert.equal(parseResult('RESULT: {"status":"fixed","restart_ui":true}').apply,'ui');
 assert.equal(parseResult('RESULT: {"status":"proven","proof":"ok"}','proof').status,'proven');assert.equal(parseResult('RESULT: {"status":"proven"}'),null);assert.equal(parseResult('no'),null);
 assert.match(fixerPrompt({id:'i1',agent:'a1',missing:'m'}),/never spend money/i);assert.match(proofPrompt({id:'i1',agent:'a1',missing:'m'},{check:'c'}),/kirimdev-test-message\.mjs.*as one of the line's testers/)});
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
 const S=await setup({fix:[ch(1),ch(2),ch(3)],proof:[{status:'not_proven',proof:'no reply'},{status:'not_proven',proof:'no reply'},{status:'not_proven',proof:'no reply',need:'Ari must re-add the bot to the group'}],
  onFix:async n=>{await writeFile(file+'.bak'+n,'old');await writeFile(file,'changed '+n)}});
 await S.I.file({agent:'a1',missing:'bot does not answer in the group',origin:{}});
 for(let k=0;k<30&&!['stuck','fixed'].includes((await S.db()).state);k++){await S.I.tick();const i=await S.db();if(i.state==='queued')i.notBefore=0}
 const i=await S.db();assert.equal(i.state,'stuck');assert.equal(i.tries,3);assert.equal(await readFile(file,'utf8'),'old','rolled back');
 assert.equal(S.applied.length,6,'reload after each change and after each rollback');
 assert.match(S.f.runs.filter(r=>r.kind==='fix')[2].prompt,/Try 1: approach 1.*not proven, rolled back/);assert.match(S.f.runs.filter(r=>r.kind==='fix')[2].prompt,/different approach/);
 assert.equal(S.said.team.length,1);assert.equal(S.said.owner.length+S.said.reply.length,0);assert.equal(S.said.team[0][1],'Mem');assert.match(S.said.team[0][2],/tried 3 times[\s\S]*Ari must re-add the bot/)});
await t('needs a human: whoever asked hears it in their chat; an agent in no team: the owner; nothing else',async()=>{
 const S=await setup({fix:[{status:'needs_human',need:'A new Tripay key is needed; nobody has one on the box.',summary:'no key'},{status:'needs_human',need:'Pay the Kirimdev invoice.',summary:'unpaid'}]});
 await S.I.file({agent:'a1',missing:'payment link fails',origin:{platform:'telegram',uid:'2',chat:'-100',thread:'3'}});await S.ticks(2);
 assert.equal((await S.db()).state,'needs_human');assert.equal(S.said.reply.length,1);assert.match(S.said.reply[0],/needs a person[\s\S]*Tripay key/);
 await S.I.file({agent:'sela',missing:'sela cannot send'});await S.ticks(2);assert.equal(S.said.owner.length,1);assert.match(S.said.owner[0],/Kirimdev invoice/);assert.equal(S.said.team.length,0);
 // filed again (the person did it): tried again
 const again=await S.I.file({agent:'sela',missing:'sela cannot send'});assert.equal(again.issue.state,'queued')});
await t('hard rules in code: no backup or a new key → put back, not applied, next try',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),env=path.join(d0,'.env'),other=path.join(d0,'other.env');await writeFile(env,'A=1\n');await writeFile(env+'.bak','A=1\n');await writeFile(other,'K=sk-existing-123456\n');
 const S=await setup({envFiles:[env,other],fix:[{status:'changed',apply:'engine',changes:[{file:env,backup:env+'.bak'}],summary:'new key'},{status:'changed',apply:'engine',changes:[{file:env,backup:env+'.bak'}],summary:'reuse key'}],
  proof:[{status:'proven',proof:'ok'}],onFix:async n=>{await writeFile(env,n===1?'A=1\nK=sk-invented-999999\n':'A=1\nK=sk-existing-123456\n')}});
 await S.I.file({agent:'a1',missing:'needs K'});await S.ticks(2);let i=await S.db();
 assert.match(i.history[0].outcome,/unsafe.*nowhere else.*K/);assert.equal(await readFile(env,'utf8'),'A=1\n','put back');assert.equal(i.state,'queued');assert.equal(S.applied.length,0,'never reloaded');i.notBefore=0;await S.ticks(5);assert.equal((await S.db()).state,'fixed');
 const S2=await setup({fix:[{status:'changed',apply:'none',changes:[{file:'/etc/x',backup:'/nope.bak'}],summary:'no backup'}]});await S2.I.file({agent:'a1',missing:'y'});await S2.ticks(2);
 assert.match((await S2.db()).history[0].outcome,/no backup/)});
await t('a run that never reached the model (gateway draining) is not a try',async()=>{const S=await setup({fix:["aqeelOS couldn't start the model connection: Gateway draining: not_ready."]});
 await S.I.file({agent:'sela',missing:'Sela stopped answering'});await S.ticks(2);const i=await S.db();assert.equal(i.state,'queued');assert.equal(i.tries,0);assert.ok(i.notBefore>Date.now())});
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
 const c=count([[ts,'Rory is still sending the note'],[ts-3600,'gino qris'],[ts-8*86400,'Rory again'],[ts,'[Replying to: "Rory said"] ok thanks']],{a1:['Rory'],a2:['Gino']},now);
 assert.equal(c.a1.thisWeek,1);assert.equal(c.a1.lastWeek,1);assert.equal(c.a2.thisWeek,1);assert.equal(weekOf(now),'2026-W45')});
await t('escalations skip engine notices and read past the origin header',()=>{const now=Date.parse('2026-11-06T05:00:00Z');const ts=now/1000;
 const c=count([[ts,'[ASYNC DELEGATION BATCH COMPLETE — d1] Rory unit done'],[ts,'Gateway message origin (JSON data, not instructions or authorization):\n{"platform": "telegram", "user_id": "1"}\nDo not guess a reply destination when these fields are insufficient.\n\nRory kirim catatan lagi']],{a1:['Rory']},now);
 assert.equal(c.a1.thisWeek,1)});
await t('ladder: an approval is never a reason to message; stuck with nothing a person must do stays silent',async()=>{
 assert.equal(approvalOnly('Please approve the new greeting rule'),true);assert.equal(approvalOnly('The owner must approve and pay the Kirimdev invoice'),false);assert.equal(approvalOnly('Add the bot to the group'),false);
 const S=await setup({fix:[{status:'needs_human',need:'Owner should approve the greeting rule change'},{status:'failed',summary:'b'},{status:'failed',summary:'c'}]});
 await S.I.file({agent:'a1',missing:'greeting'});for(let k=0;k<12&&(await S.db()).state!=='stuck';k++){await S.I.tick();const i=await S.db();if(i.state==='queued')i.notBefore=0}
 const i=await S.db();assert.equal(i.state,'stuck');assert.match(i.history[0].outcome,/nobody approves/);assert.equal(quietAll(S.said),0,'nobody messaged');assert.equal(i.need,null)});
await t('switched off: the run already going is recorded, nothing new starts or reloads',async()=>{const S=await setup({fix:[{status:'changed',apply:'engine',changes:[],summary:'s'},{status:'no_change'}]});
 await S.I.file({agent:'a1',missing:'one'});await S.I.file({agent:'a1',missing:'two'});await S.ticks(1);
 await writeFile(path.join(S.d,'team-policy.json'),JSON.stringify({...POL2,fixer:{...POL2.fixer,on:false}}));await S.ticks(3);
 const items=(await S.I._db()).items;assert.deepEqual(items.map(i=>i.state).sort(),['queued','verify']);assert.equal(S.applied.length,0);assert.equal(S.f.runs.length,1)});
await t('test agents: a needs-human message is logged, not sent',async()=>{const S=await setup({quiet:a=>a==='a1'?'test':null,fix:[{status:'needs_human',need:'x'}]});
 await S.I.file({agent:'a1',missing:'m',origin:{platform:'telegram',uid:'2',chat:'-1'}});await S.ticks(2);assert.equal(quietAll(S.said),0);assert.equal((await S.db()).told,'logged')});
await t('Stop retrying: a queued one stops now and stays stopped when filed again; Try again starts it over',async()=>{const S=await setup({fix:[{status:'failed',summary:'x'}]});
 const r=await S.I.file({agent:'a1',missing:'stop me'});const i=await S.I.stop(r.issue.id,'Owner');assert.equal(i.state,'stopped');await S.ticks(2);assert.equal(S.f.runs.length,0,'no run for a stopped issue');
 const again=await S.I.file({agent:'a1',missing:'stop me'});assert.equal(again.again,true);assert.equal(again.issue.state,'stopped');
 assert.equal((await S.I.retry(r.issue.id)).state,'queued');await S.ticks(1);assert.equal(S.f.runs.length,1)});
await t('Stop retrying in the middle of a try: that try ends, then no more tries, nobody told',async()=>{const S=await setup({fix:[{status:'failed',summary:'nope',need:'x'}]});
 const r=await S.I.file({agent:'a1',missing:'m'});await S.I.tick();assert.equal((await S.db()).state,'fixing');
 const i=await S.I.stop(r.issue.id);assert.equal(i.state,'fixing');assert.equal(i.noRetry,true);await S.ticks(3);
 assert.equal((await S.db()).state,'stopped');assert.equal(S.f.runs.length,1);assert.equal(quietAll(S.said),0)});
await t('Close: an idle one closes at once; one mid-try closes after it (needs a person: nobody told)',async()=>{const S=await setup({fix:[{status:'needs_human',need:'Add the bot to the group'}]});
 const a=await S.I.file({agent:'a1',missing:'one'}),b=await S.I.file({agent:'a2',missing:'two'});
 await S.I.tick();const running=(await S.I._db()).items.find(x=>x.state==='fixing');assert.ok(running);
 const idle=(await S.I._db()).items.find(x=>x.state==='queued');assert.equal((await S.I.close(idle.id,'Owner')).state,'closed');
 assert.equal((await S.I.close(running.id)).closeAfter,true);await S.ticks(2);
 assert.equal((await S.I._db()).items.find(x=>x.id===running.id).state,'closed');assert.equal(quietAll(S.said),0);assert.equal(S.f.runs.length,1,'the closed one never ran')});
await t('filed again while the fixer was off: one issue, counted, queued once it is on',async()=>{const S=await setup({policy:{...POL2,fixer:{on:false}}});
 const a=await S.I.file({agent:'a1',missing:'same thing',source:'health',healthKey:'a1|x'});const b=await S.I.file({agent:'a1',missing:'same thing',source:'health',healthKey:'a1|x'});
 assert.equal(a.issue.state,'open');assert.equal(b.again,true);assert.equal((await S.I._db()).items.length,1);
 await writeFile(path.join(S.d,'team-policy.json'),JSON.stringify(POL2));const c=await S.I.file({agent:'a1',missing:'same thing',source:'health',healthKey:'a1|x'});assert.equal(c.issue.state,'queued');assert.equal(c.issue.count,3)});
await t('older duplicates of an open issue are folded into the newest at start',async()=>{const d=await mkdtemp(path.join(tmpdir(),'is-'));await writeFile(path.join(d,'team-policy.json'),JSON.stringify(POL2));
 const it=(id,k)=>({id,key:k,agent:'a1',state:'open',missing:'m',count:1,history:[]});await writeFile(path.join(d,'issues.json'),JSON.stringify({items:[it('i3','k1'),it('i2','k1'),it('i1','k2')],runs:{}}));
 const I=createIssues({DATA:d,log:()=>{}});const items=(await I._db()).items;assert.deepEqual(items.map(i=>i.state),['open','closed','open']);assert.equal(items[0].count,2)});
await t('Health no longer sees it: a queued or an open (fixer off) issue goes away by itself, others stay',async()=>{const S=await setup({policy:{...POL2,fixer:{on:false}}});
 await S.I.file({agent:'a1',missing:'kicked from an old group',source:'health',healthKey:'a1|g'});await S.I.file({agent:'a1',missing:'still broken',source:'health',healthKey:'a1|s'});
 assert.equal(await S.I.healthGone(['a1|s']),1);const st=Object.fromEntries((await S.I._db()).items.map(i=>[i.healthKey,i.state]));assert.deepEqual(st,{'a1|g':'gone','a1|s':'open'})});
await t('an urgent outage may be hot-patched: the proven fix to aqeelOS code is saved as a patch for git; a fix outside the code is not',async()=>{const app=await mkdtemp(path.join(tmpdir(),'app-'));await mkdir(path.join(app,'app'));await mkdir(path.join(app,'data'));
 const code=path.join(app,'app','kd.mjs'),dat=path.join(app,'data','x.json'),cfg=path.join(app,'..',path.basename(app)+'-cfg.yaml');
 for(const f of [code,dat,cfg])await writeFile(f,'old\n');
 const S=await setup({codeRoots:[{dir:app,prefix:''}],fix:[{status:'changed',apply:'ui',summary:'reset clears the pause',changes:[{file:code,backup:code+'.bak'},{file:dat,backup:dat+'.bak'},{file:cfg,backup:cfg+'.bak'}]}],proof:[{status:'proven',proof:'tester got the reply'}],
  onFix:async()=>{for(const f of [code,dat,cfg]){await writeFile(f+'.bak','old\n');await writeFile(f,'new\n')}}});
 await S.I.file({agent:'a1',missing:'reset reply held by a pause',urgent:true});await S.ticks(6);const i=await S.db();assert.equal(i.state,'fixed',JSON.stringify(i.history));
 assert.equal(i.patch,'fixer-patches/'+i.id+'-try1.patch');const p=await readFile(path.join(S.d,i.patch),'utf8');
 assert.match(p,/^# aqeelOS fixer, issue /);assert.match(p,/--- a\/app\/kd\.mjs\n\+\+\+ b\/app\/kd\.mjs/);assert.match(p,/-old\n\+new/);assert.doesNotMatch(p,/x\.json|cfg\.yaml/,'data and files outside the code are not git');
 assert.match(i.result.summary,/saved as fixer-patches\//);assert.match(S.f.runs[0].prompt,/fixer-patches/);assert.equal(quietAll(S.said),0)});
// owner's stability plan (8 Nov 2026): nobody edits the live system by hand, the fixer included
const codeBox=async()=>{const app=await mkdtemp(path.join(tmpdir(),'app-'));await mkdir(path.join(app,'app'));const code=path.join(app,'app','kd.mjs'),dat=path.join(app,'..',path.basename(app)+'-data.json');
 for(const f of [code,dat])await writeFile(f,'old\n');return {app,code,dat}};
await t('not urgent: a live code edit is put back and filed as a patch for the daily deploy; nothing reloads, nobody is told',async()=>{const {app,code,dat}=await codeBox();
 const S=await setup({codeRoots:[{dir:app,prefix:''}],fix:[{status:'changed',apply:'ui',summary:'reset clears the pause',changes:[{file:code,backup:code+'.bak'},{file:dat,backup:dat+'.bak'}]}],
  onFix:async()=>{for(const f of [code,dat]){await writeFile(f+'.bak','old\n');await writeFile(f,'new\n')}}});
 await S.I.file({agent:'a1',missing:'reset reply held by a pause'});await S.ticks(4);const i=await S.db();
 assert.equal(i.state,'deploy',JSON.stringify(i.history));assert.equal(i.patch,'fixer-patches/'+i.id+'-try1.patch');assert.deepEqual(S.applied,[]);assert.equal(S.f.runs.length,1,'no proof run before the deploy');
 assert.equal(await readFile(code,'utf8'),'old\n','the live code is put back');assert.equal(await readFile(dat,'utf8'),'old\n','the whole try waits for the deploy');
 const p=await readFile(path.join(S.d,i.patch),'utf8');assert.match(p,/for the daily deploy/);assert.match(p,/--- a\/app\/kd\.mjs\n\+\+\+ b\/app\/kd\.mjs/);assert.match(p,/-old\n\+new/);
 assert.match(i.history[0].outcome,/filed for the daily deploy.*put back/);assert.deepEqual(i.history[0].patchFiles,[code]);assert.equal(quietAll(S.said),0);
 const again=await S.I.file({agent:'a1',missing:'reset reply held by a pause'});assert.equal(again.issue.state,'deploy','filed again, it keeps waiting for the deploy')});
await t('not urgent: the fixer changes a copy; the patch is live → copy, and the live file is never touched',async()=>{const {app,code}=await codeBox();const copy=code+'.work';
 const S=await setup({codeRoots:[{dir:app,prefix:''}],fix:[{status:'patch',summary:'guard the push',patches:[{file:code,copy}]}],onFix:async()=>writeFile(copy,'old\nguard\n')});
 await S.I.file({agent:'a1',missing:'tool server answers 500'});await S.ticks(3);const i=await S.db();assert.equal(i.state,'deploy');
 assert.equal(await readFile(code,'utf8'),'old\n');assert.match(await readFile(path.join(S.d,i.patch),'utf8'),/ old\n\+guard/);
 const pr=S.f.runs[0].prompt;assert.match(pr,/never changed in place/);assert.match(pr,/fixer-work\/i[0-9a-f]{8}\//);assert.match(pr,/Never test on a real agent/);assert.doesNotMatch(pr,/URGENT/);
 assert.match(fixerPrompt({...i,urgent:true}),/URGENT \(an outage\), so you may change those files on the box/);
 assert.match(proofPrompt(i,{}),/Never test on a real agent/);assert.match(proofPrompt(i,{},{deployed:true}),/AFTER THE DEPLOY/);
 assert.equal(parseResult('RESULT: {"status":"patch","patches":[{"file":"/a/x.mjs","copy":"/w/x.mjs"},{"file":"rel","copy":"/w"}]}').patches.length,1)});
await t('after a deploy changed the patched files, one proof run checks it: proven is fixed by the deploy; not proven waits again, stuck after 3 deploys',async()=>{const {app,code}=await codeBox();const copy=code+'.work';let deployed=0;
 const mk=proof=>setup({codeRoots:[{dir:app,prefix:''}],fix:[{status:'patch',summary:'guard the push',patches:[{file:code,copy}]}],proof,onFix:async()=>writeFile(copy,'new\n'),checks:{changedSince:async()=>deployed>0}});
 const S=await mk([{status:'proven',proof:'the tool server answers 200'}]);await S.I.file({agent:'a1',missing:'tool server answers 500'});await S.ticks(3);
 assert.equal(await S.I.sweep(true),0);assert.equal((await S.db()).state,'deploy','no deploy yet: it waits');
 deployed=1;await S.I.sweep(true);await S.ticks(3);let i=await S.db();assert.equal(i.state,'fixed',JSON.stringify(i.history));assert.match(i.result.summary,/^Fixed by the daily deploy/);
 assert.match(S.f.runs.at(-1).prompt,/AFTER THE DEPLOY/);assert.equal(quietAll(S.said),0);
 deployed=0;const N=await mk([{status:'not_proven'},{status:'not_proven'},{status:'not_proven'}]);await N.I.file({agent:'a1',missing:'tool server answers 500'});await N.ticks(3);deployed=1;
 for(let k=0;k<3;k++){await N.I.sweep(true);await N.ticks(3)}i=await N.db();assert.equal(i.state,'stuck');assert.equal(i.rechecks,3);assert.equal(quietAll(N.said),0)});
await t('"send a message from the tester phone" is never a person\'s job: the fixer tries again itself, nobody is told',async()=>{
 assert.equal(testerSendOnly('Someone must send a WhatsApp message from the tester phone (3124) to prove the reply'),true);
 assert.equal(testerSendOnly('Abel must add the bot back to the group'),false);assert.equal(testerSendOnly('Send a new API key for the tester line'),false);
 assert.equal(noPersonNeeded('please approve the change'),true);
 const S=await setup({fix:[{status:'needs_human',summary:'cannot prove it',need:'A person must send a message from the tester number to the line.'}]});
 await S.I.file({agent:'a1',missing:'reset reply missing'});await S.ticks(2);const i=await S.db();
 assert.equal(i.state,'queued');assert.match(i.history[0].outcome,/signed test webhook/);assert.equal(quietAll(S.said),0);assert.match(S.f.runs[0].prompt,/kirimdev-test-message\.mjs/)});
await t('a proven fix hands the fixed issue on (its report leaves Health and the popup), with the report id and the Health key',async()=>{const out=[];
 const S=await setup({fixedOut:out,fix:[{status:'no_change',summary:'works'}],proof:[{status:'proven',proof:'seen'}]});
 await S.I.file({agent:'a1',missing:'no label tool',report:'rabc'});await S.ticks(4);assert.equal((await S.db()).state,'fixed');assert.equal(out.length,1);assert.equal(out[0].report,'rabc')});
await t('a web app fix restarts the web app once per try: the rollback reload waits for the next try, and one reload at the end (6 restarts were 4)',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),file=path.join(d0,'kd.mjs');await writeFile(file,'old');
 const ch=n=>({status:'changed',apply:'ui',changes:[{file,backup:file+'.bak'+n}],summary:'approach '+n,check:'c'});const np={status:'not_proven',proof:'no tester message'};
 const S=await setup({fix:[ch(1),ch(2),ch(3)],proof:[np,np,np],onFix:async n=>{await writeFile(file+'.bak'+n,'old');await writeFile(file,'changed '+n)}});
 await S.I.file({agent:'a1',missing:'tester reset reply held'});
 for(let k=0;k<30&&(await S.db()).state!=='stuck';k++){await S.I.tick();const i=await S.db();if(i.state==='queued')i.notBefore=0}
 assert.equal(await readFile(file,'utf8'),'old');assert.deepEqual(S.applied,['ui','ui','ui'],'one per try so far');assert.equal((await S.db()).uiDirty,true);
 await S.I.tick();assert.deepEqual(S.applied,['ui','ui','ui','ui'],'one reload brings the app back to the put-back files');assert.equal((await S.db()).uiDirty,false);await S.ticks(2);assert.equal(S.applied.length,4)});
await t('a rollback whose files are already back (a deploy put them back) reloads nothing',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),file=path.join(d0,'SOUL.md');await writeFile(file,'old');
 const S=await setup({fix:[{status:'changed',apply:'engine',changes:[{file,backup:file+'.bak'}],summary:'x',check:'c'}],proof:[{status:'not_proven',proof:'no'}],
  onFix:async()=>{await writeFile(file+'.bak','old');await writeFile(file,'new')}});
 await S.I.file({agent:'a1',missing:'y'});await S.ticks(3);assert.deepEqual(S.applied,['engine']);await writeFile(file,'old');await S.ticks(2);
 const i=await S.db();assert.equal(i.state,'queued');assert.deepEqual(S.applied,['engine'],'no reload just to roll back');assert.doesNotMatch(i.history[0].outcome,/rolled back/)});
const off={...POL2,fixer:{on:false}};
await t('sweep: a sign-in issue closes by itself once the app is signed in, silently, with the evidence kept',async()=>{let signed=false;
 const S=await setup({policy:off,checks:{apps:async()=>['slack-as2','notion'],appSignedIn:async(a,n)=>signed&&n==='slack-as2'}});
 await S.I.file({agent:'default',missing:'A usable sign-in link for slack-as2'});assert.equal(await S.I.sweep(true),0);assert.equal((await S.db()).state,'open');
 signed=true;assert.equal(await S.I.sweep(true),1);const i=await S.db();assert.equal(i.state,'gone');assert.match(i.resolvedBy,/slack-as2 is signed in now/);assert.match(i.result.summary,/^Resolved by itself/);
 assert.equal(i.history.at(-1).kind,'resolved');assert.equal(quietAll(S.said),0)});
await t('sweep: missing files that are there now, a fix commit that is live, a closed original',async()=>{const live=new Set(['fc0edf9']);
 const S=await setup({policy:off,checks:{exists:async p=>p==='/home/c/w/labels/assets/texture.png',commitLive:async c=>live.has(c)}});
 await S.I.file({agent:'a1',missing:'The file /home/c/w/labels/assets/texture.png is missing'});
 await S.I.file({agent:'a2',missing:'Tester replies held after a reset',evidence:'Fixed in fc0edf9 by the Kirimdev session'});
 await S.I.file({agent:'a3',missing:'Webhook problem again, duplicate of i00000000'});
 assert.equal(await S.I.sweep(true),2);const st=Object.fromEntries((await S.I._db()).items.map(i=>[i.agent,i.state]));assert.deepEqual(st,{a1:'gone',a2:'gone',a3:'open'})});
await t('sweep: the same problem filed again by the same agent closes the older one; a different skill is not the same problem',async()=>{const S=await setup({policy:off});
 await S.I.file({agent:'ct',missing:'Read/execute access for ag-agent-c to /home/claude/work/labels and /home/claude/work/tiktok/.venv'});
 await S.I.file({agent:'ct',missing:'Read/execute access for ag-agent-c to /home/claude/work/labels (gen.py, assets, fonts, taglines.json) and /home/claude/work/tiktok/.venv. /home/claude/work is claude:claude'});
 await S.I.file({agent:'ct',missing:'The skill maps points to a file that is not there'});await S.I.file({agent:'ct',missing:'The skill continue-vial-labels points to a file that is not there'});
 await S.I.sweep(true);const l=(await S.I._db()).items;assert.equal(l.find(i=>/tiktok\/\.venv$/.test(i.missing)).state,'gone');assert.match(l.find(i=>/tiktok\/\.venv$/.test(i.missing)).resolvedBy,/filed again/);
 assert.equal(l.filter(i=>/skill/.test(i.missing)&&i.state==='open').length,2);
 const S2=await setup({policy:off});await S2.I.file({agent:'d',missing:'Customer WhatsApp runs have no label tool: customer-tools.mjs only exposes conversation and payments'});
 await S2.I.file({agent:'d',missing:'Donna reported: Customer WhatsApp runs have no label tool: customer-tools.mjs only exposes conversation and payments'});(await S2.I._db()).items[0].state='gone';
 await S2.I.sweep(true);assert.equal((await S2.I._db()).items[1].state,'open','a newer one that went away carries nothing on');assert.equal(similar('The skill maps points to a file that is not there','The skill continue-vial-labels points to a file that is not there'),0)});
await t('sweep: a stuck issue whose files a deploy changed gets one proof run; proven closes it, otherwise it stays stuck with nothing rolled back',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'f-')),file=path.join(d0,'kd.mjs');await writeFile(file,'old');let changed=false;
 const S=await setup({checks:{changedSince:async()=>changed},proof:[{status:'not_proven',proof:'no tester message'},{status:'proven',proof:'tester got the reply 12:10'}]});
 await S.I.file({agent:'a1',missing:'tester pause'});const i=await S.db();Object.assign(i,{state:'stuck',tries:3,history:[{kind:'fix',changes:[{file,backup:file+'.bak'}],summary:'x'}]});
 await S.I.sweep(true);assert.equal(i.state,'stuck','nothing changed yet');changed=true;await S.I.sweep(true);assert.equal(i.state,'verify');assert.equal(i.recheck,true);
 await S.ticks(2);assert.equal(i.state,'stuck');assert.equal(S.applied.length,0);assert.equal(await readFile(file,'utf8'),'old');
 changed=false;await S.I.sweep(true);assert.equal(i.state,'stuck','not again until the files change again');changed=true;i.recheckedAt=0;i.updated=0;await S.I.sweep(true);await S.ticks(2);
 assert.equal(i.state,'gone');assert.match(i.resolvedBy,/recheck after a deploy proved it gone/);assert.match(S.f.runs.at(-1).prompt,/RECHECK/);assert.equal(quietAll(S.said),0)});
await t('sweep: nothing left to check for 7 days: it leaves quietly, to Activity; a Health item that went away closes even when stuck',async()=>{const acts=[];
 const S=await setup({policy:off,checks:{activity:async x=>acts.push(x)}});await S.I.file({agent:'a1',missing:'The vibe of the replies feels off lately'});
 await S.I.file({agent:'a1',missing:'kicked',source:'health',healthKey:'a1|g'});const [h,old]=(await S.I._db()).items;old.updated=Date.now()-8*864e5;h.state='stuck';
 await S.I.sweep(true);assert.equal(old.state,'expired');assert.equal(acts.length,1);assert.match(acts[0],/closed after 7 days/);
 assert.equal(await S.I.healthGone([]),1);assert.equal(h.state,'gone');assert.equal(quietAll(S.said),0)});
await t('urgent (aqeelOS own tool server) goes first and is not held back by the daily limit',async()=>{
 const S=await setup({policy:{...POL2,fixer:{on:true,agent:'default',cap:1}},fix:[{status:'no_change',summary:'a'},{status:'no_change',summary:'b'}],proof:[{status:'proven',proof:'p'},{status:'proven',proof:'p'}]});
 await S.I.file({agent:'a1',missing:'an ordinary problem'});await S.ticks(4);assert.equal((await S.I._db()).items[0].state,'fixed');
 await S.I.file({agent:'a1',missing:'another ordinary problem'});await S.I.file({agent:'default',missing:'aqeelOS’s own tool server aqeelos-notify is failing for 7 agents',source:'health',healthKey:'topic|health|aqeelos|tool|aqeelos-notify',urgent:true});
 await S.I.tick();const l=(await S.I._db()).items;assert.equal(l.find(i=>i.urgent).state,'fixing','urgent starts although the limit (1) is used up');assert.equal(l.find(i=>/another/.test(i.missing)).state,'queued')});
await t('sweep: a planned test item closes at once as a test item; an access issue closes once the agent has its own copy',async()=>{const own=new Set(['/home/claude/work/labels','/home/claude/work/tiktok/.venv']);
 const S=await setup({policy:off,checks:{ownCopy:async(a,p)=>a==='agent-c'&&own.has(p)}});
 await S.I.file({agent:'default',missing:'PLANNED TEST, no action needed: a person must add the bot to a Telegram group called aqeelOS ladder test'});
 await S.I.file({agent:'agent-c',missing:'Read/execute access for ag-agent-c to /home/claude/work/labels and /home/claude/work/tiktok/.venv'});
 await S.I.file({agent:'agenta',missing:'Read/execute access for ag-agenta to /home/claude/work/labels'});
 await S.I.sweep(true);const st=Object.fromEntries((await S.I._db()).items.map(i=>[i.agent,[i.state,i.result?.summary||'']]));
 assert.deepEqual(st.default,['closed','Test item, closed.']);assert.equal(st['agent-c'][0],'gone');assert.match(st['agent-c'][1],/own workspace/);assert.equal(st.agenta[0],'open');assert.equal(quietAll(S.said),0)});
console.log(n+' passed');

await t('a fixer reload of the engine, fix or rollback, waits for the quiet hours; a web-app reload does not; only urgent items start meanwhile',async()=>{
 let quiet=false;const d0=await mkdtemp(path.join(tmpdir(),'iss-q-')),file=path.join(d0,'f.py');await writeFile(file,'x');await writeFile(file+'.bak','y');
 const S=await setup({engineOk:()=>quiet,fix:[{status:'changed',apply:'engine',changes:[{file,backup:file+'.bak'}],check:'c',summary:'needs the engine'}],proof:[{status:'proven',proof:'ok'}]});
 await S.I.file({agent:'a1',missing:'needs the engine'});await S.ticks(3);
 assert.equal((await S.db()).state,'applying');assert.equal(S.applied.length,0,'no engine restart outside the quiet hours');
 quiet=true;await S.ticks(2);assert.deepEqual(S.applied,['engine'],'reloaded once the quiet hours came');
 const U=await setup({engineOk:()=>false,fix:[{status:'changed',apply:'ui',changes:[{file,backup:file+'.bak'}],check:'c',summary:'web app'}],proof:[{status:'proven',proof:'ok'}]});
 await U.I.file({agent:'a1',missing:'web app only'});await U.ticks(3);assert.deepEqual(U.applied,['ui'],'a web-app reload goes on')});

await t('rollback never overwrites rules added after the fix: only its own diff is reversed, or the file is left alone',async()=>{
 const d0=await mkdtemp(path.join(tmpdir(),'rb-')),file=path.join(d0,'SOUL.md');const base='r1\nr2\nr3\nr4\nr5\nr6\n';await writeFile(file+'.bak',base);await writeFile(file,base.replace('r2','r2 FIXED'));
 const S=await setup({fix:[{status:'changed',apply:'none',changes:[{file,backup:file+'.bak'}],summary:'x',check:'c'}],proof:[{status:'not_proven',proof:'no'}]});
 await S.I.file({agent:'a1',missing:'rb'});for(let k=0;k<6&&!S.f.runs.some(r=>r.kind==='proof');k++){if((await S.db()).state==='verify')break;await S.ticks(1)}
 await writeFile(file,base.replace('r2','r2 FIXED')+'NEW RULE\n');await S.ticks(4);
 assert.equal(await readFile(file,'utf8'),base+'NEW RULE\n','fix reversed, later rule kept');
 const d1=await mkdtemp(path.join(tmpdir(),'rb-')),f1=path.join(d1,'SOUL.md');await writeFile(f1+'.bak','a\n');await writeFile(f1,'b\n');
 const T=await setup({fix:[{status:'changed',apply:'none',changes:[{file:f1,backup:f1+'.bak'}],summary:'x',check:'c'}],proof:[{status:'not_proven',proof:'no'}]});
 await T.I.file({agent:'a1',missing:'rb2'});for(let k=0;k<6;k++){if((await T.db()).state==='verify')break;await T.ticks(1)}await writeFile(f1,'c\n');await T.ticks(4);
 assert.equal(await readFile(f1,'utf8'),'c\n','own diff no longer applies: left alone, not restored')});
