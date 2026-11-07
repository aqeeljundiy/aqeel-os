// Tests for "run myself" (app/self-runs.mjs). Run: node --test scripts/self-runs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createSelfRuns,judge,safeLock,fp,normId,DEFAULT_CAP} from '../app/self-runs.mjs';

const OWNER={settings:{},trusted:[{platform:'telegram',uid:'1000000001',name:'AJ'},{platform:'whatsapp',uid:'6281234',name:'Sela'}],sessionUser:id=>id==='api_1'?{name:'Abel',ok:true}:id==='api_2'?{name:'Guest',ok:false}:null};
const ok={ok:true,by:{kind:'api_server',who:'Abel'}};

async function make(o={}){const DATA=await mkdtemp(path.join(tmpdir(),'sr-'));let t=Date.UTC(2026,10,5,3,0);const told=[],notes=[],launched=[],exits={},gone=new Set();
 const s=createSelfRuns({DATA,now:()=>t,nameOf:a=>a,launch:async r=>{if(o.cannot)throw Error('no engine');launched.push(r);return {pid:1000+launched.length}},
  alive:async r=>!gone.has(r.id),kill:async r=>{exits[r.id]={code:143}},readExit:async r=>exits[r.id]||null,readOut:async()=>'done, wrote test.txt',
  notify:async(r,ans)=>{notes.push([r.id,r.state,ans])},tellOwner:async x=>{told.push(x)},bell:async()=>{}});
 return {s,DATA,told,notes,launched,exits,gone,tick:ms=>{t+=ms},set:v=>{t=v},now:()=>t}}

test('judge: aqeelOS chat of an editor, own schedules and trusted people pass; everything else is refused',()=>{
 const c=(...x)=>x.map((s,i)=>({id:'s'+i,...s}));
 assert.equal(judge(c({source:'api_server',id:'api_1'}).map(x=>({...x,id:'api_1'})),OWNER).ok,true);
 assert.match(judge([{id:'api_2',source:'api_server'}],OWNER).why,/may not edit/);
 assert.match(judge([{id:'api_9',source:'api_server'}],OWNER).why,/no known owner/);
 assert.equal(judge(c({source:'cron',title:'Daily'}),OWNER).ok,true);
 assert.equal(judge(c({source:'telegram',user_id:'1000000001',chat_id:'-100',thread_id:'3'}),OWNER).by.who,'AJ');
 assert.match(judge(c({source:'telegram',user_id:'999'}),OWNER).why,/not on the list/);
 // WhatsApp: only trusted people, whatever form the id is in
 assert.equal(judge(c({source:'whatsapp',user_id:'+6281234@s.whatsapp.net'}),OWNER).ok,true);
 assert.match(judge(c({source:'whatsapp',user_id:'6289999@s.whatsapp.net'}),OWNER).why,/not on the list/);
 assert.match(judge(c({source:'webhook',user_id:'webhook:kirim'}),OWNER).why,/webhook/);
 for(const src of ['oneshot','cli','tool','unknown',''])assert.equal(judge(c({source:src}),OWNER).ok,false,src);
 // a helper is judged by the chat that started it; anything inside a run_self run is refused
 assert.equal(judge(c({source:'subagent'},{source:'cron'}),OWNER).ok,true);
 assert.equal(judge(c({source:'subagent'},{source:'webhook'}),OWNER).ok,false);
 assert.match(judge(c({source:'run_self'}),OWNER).why,/cannot start another/);
 assert.match(judge(c({source:'subagent'},{source:'tool'}),OWNER).why,/cannot start another/);
 assert.match(judge(c({source:'subagent'},{source:'run_self'},{source:'cron'}),OWNER).why,/cannot start another/);
 assert.equal(judge([],OWNER).ok,false);
 // switches
 assert.match(judge(c({source:'cron'}),{...OWNER,settings:{cron:false}}).why,/switched off/);
 assert.match(judge([{id:'api_1',source:'api_server'}],{...OWNER,settings:{chat:false}}).why,/switched off/)});

test('fp and normId match the same call however it is written',()=>{assert.equal(fp({b:1,a:'x',c:null}),fp({a:'x',b:'1'}));assert.notEqual(fp({a:'x'}),fp({a:'y'}));
 assert.equal(normId('whatsapp','+6281:4@lid'),'6281');assert.equal(normId('telegram',' 15 '),'15')});

test('a run starts, finishes, and the agent and the chat hear the result',async()=>{const {s,notes,exits,launched}=await make();
 const r=await s.start({agent:'cove-threads',args:{prompt:'write test.txt',reason:'test',timeout_minutes:99},origin:ok});
 assert.equal(r.state,'running');assert.equal(r.minutes,25);assert.equal(launched[0].agent,'cove-threads');
 assert.equal((await readFile(path.join(launched[0].dir,'prompt.txt'),'utf8')),'write test.txt');
 exits[r.id]={code:0};await s.check();const st=await s.status('cove-threads',r.id);
 assert.equal(st.state,'ok');assert.match(st.answer,/test\.txt/);assert.deepEqual(notes[0].slice(0,2),[r.id,'ok']);
 assert.equal(await s.status('other-agent',r.id),null,'another agent cannot see it')});

test('refused: not trusted, switched off, no prompt or reason; 2 at once at most',async()=>{const {s}=await make();
 await assert.rejects(s.start({agent:'a',args:{prompt:'x',reason:'y'},origin:{ok:false,why:'Only trusted people'}}),/trusted/);
 await assert.rejects(s.start({agent:'a',args:{reason:'y'},origin:ok}),/prompt/);
 await assert.rejects(s.start({agent:'a',args:{prompt:'x'},origin:ok}),/why/);
 await s.start({agent:'a',args:{prompt:'1',reason:'r'},origin:ok});await s.start({agent:'a',args:{prompt:'2',reason:'r'},origin:ok});
 await assert.rejects(s.start({agent:'a',args:{prompt:'3',reason:'r'},origin:ok}),/2 runs going/);
 await s.start({agent:'b',args:{prompt:'1',reason:'r'},origin:ok});
 await s.setSettings('c',{on:false},'owner');await assert.rejects(s.start({agent:'c',args:{prompt:'1',reason:'r'},origin:ok}),/switched off/);
 const ov=await s.overview(['a','c']);assert.equal(ov.refused.length,5);assert.equal(ov.agents[0].running.length,2)});

test('3 failed runs in a row pause the agent and tell the owner once; resume starts again; ok resets the count',async()=>{const {s,exits,told}=await make();
 const run=async code=>{const r=await s.start({agent:'a',args:{prompt:'p',reason:'r',timeout_minutes:1},origin:ok});exits[r.id]={code};await s.check();return r};
 await run(1);await run(0);await run(1);await run(124);assert.equal(told.length,0);await run(1);
 assert.equal(told.length,1);assert.match(told[0],/paused/);
 await assert.rejects(run(0),/paused after 3 failed/);
 await s.resume('a','owner');await run(0);assert.equal((await s.mine('a')).paused,null)});

test('a stopped run or a restart does not count as a failure',async()=>{const {s,gone,told}=await make();
 for(let i=0;i<3;i++){const r=await s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok});await s.stop(r.id,'owner');await s.check();assert.equal((await s.status('a',r.id)).state,'stopped')}
 const r=await s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok});gone.add(r.id);await s.check();assert.equal((await s.status('a',r.id)).state,'interrupted');assert.equal(told.length,0)});

test('a run over its time is stopped and counts as timed out',async()=>{const {s,tick}=await make();
 const r=await s.start({agent:'a',args:{prompt:'p',reason:'r',timeout_minutes:1},origin:ok});tick(60e3+91e3);await s.check();await s.check();assert.equal((await s.status('a',r.id)).state,'timeout')});

test('the daily cap pauses until tomorrow, tells the owner, and a higher cap lifts it',async()=>{const {s,exits,told,tick}=await make();
 await s.setSettings('a',{cap:3},'owner');for(let i=0;i<3;i++){const r=await s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok});exits[r.id]={code:0};await s.check()}
 assert.equal(told.length,1);assert.match(told[0],/limit of 3/);await assert.rejects(s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok}),/limit of 3/);
 await s.setSettings('a',{cap:5},'owner');assert.ok(await s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok}));
 await s.setSettings('b',{cap:1},'owner');const r=await s.start({agent:'b',args:{prompt:'p',reason:'r'},origin:ok});exits[r.id]={code:0};await s.check();
 await assert.rejects(s.start({agent:'b',args:{prompt:'p',reason:'r'},origin:ok}),/limit/);tick(864e5);assert.ok(await s.start({agent:'b',args:{prompt:'p',reason:'r'},origin:ok}));
 assert.equal((await s.settings('z')).cap,DEFAULT_CAP);await assert.rejects(s.setSettings('a',{cap:0},'o'),/1 to 500/)});

test('a lock run waits, then runs; a lock never taken fails',async()=>{const {s,exits}=await make();
 const r=await s.start({agent:'a',args:{prompt:'p',reason:'r',lock:'.tools/browser.lock'},origin:ok,lockPath:'/ws/.tools/browser.lock'});assert.equal(r.state,'waiting');
 exits[r.id]={started:Date.now()};await s.check();assert.equal((await s.status('a',r.id)).state,'running');exits[r.id]={started:1,code:0};await s.check();assert.equal((await s.status('a',r.id)).state,'ok');
 const q=await s.start({agent:'a',args:{prompt:'p',reason:'r',lock:'x.lock'},origin:ok,lockPath:'/ws/x.lock'});exits[q.id]={code:75};await s.check();const st=await s.status('a',q.id);assert.equal(st.state,'failed');assert.match(st.error,/lock stayed taken/)});

test('a run that cannot start is failed, not left running',async()=>{const {s}=await make({cannot:true});await assert.rejects(s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok}),/could not be started/);assert.equal((await s.mine('a')).runs[0].state,'failed')});

test('trusted people: a code sent from a chat adds that person once; codes expire; remove works',async()=>{const {s,tick}=await make();
 const c=await s.newCode({name:'Abel',by:'owner'});assert.match(c.code,/^TRUST-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
 assert.equal(await s.codeSeen({code:c.code,platform:'webhook',uid:'x'}),null,'never from a webhook');
 const d=await s.newCode({name:'',by:'owner'});const t=await s.codeSeen({code:d.code,platform:'whatsapp',uid:'+6281:2@s.whatsapp.net',name:'Ajeng',agent:'sela'});
 assert.deepEqual([t.uid,t.name],['6281','Ajeng']);assert.equal(await s.codeSeen({code:d.code,platform:'telegram',uid:'5'}),null,'used once');
 const e=await s.newCode({name:'Late',by:'owner'});tick(16*60e3);await s.check();assert.equal(await s.codeSeen({code:e.code,platform:'telegram',uid:'7'}),null,'expired');
 assert.equal(await s.hasTrusted('whatsapp'),true);assert.equal(await s.untrust(t.id,'owner'),true);assert.equal(await s.hasTrusted('whatsapp'),false)});

test('daily summary: once a day after 8, problems first, nothing when nothing ran',async()=>{const {s,exits,told,set}=await make();
 set(Date.UTC(2026,10,5,3));for(const code of [0,1,1,1]){const r=await s.start({agent:'a',args:{prompt:'p',reason:'r'},origin:ok});exits[r.id]={code};await s.check()}
 told.length=0;set(Date.UTC(2026,10,6,7));assert.equal(await s.summary(8),null);set(Date.UTC(2026,10,6,9));const txt=await s.summary(8);
 assert.match(txt,/Needs a look:\n- a: paused/);assert.match(txt,/a: 4 runs, 1 ok, 3 failed/);assert.equal(await s.summary(8),null,'once a day');
 const f=await make();f.set(Date.UTC(2026,10,6,9));assert.equal(await f.s.summary(8),null)});

test('safeLock: only a plain file inside the workspace',async()=>{const ws=await mkdtemp(path.join(tmpdir(),'ws-'));await mkdir(path.join(ws,'.tools'));await writeFile(path.join(ws,'.tools','b.lock'),'');
 const out=await mkdtemp(path.join(tmpdir(),'out-'));await symlink(out,path.join(ws,'link'));await symlink(path.join(out,'f'),path.join(ws,'.tools','s.lock'));
 assert.ok((await safeLock(ws,'.tools/b.lock')).endsWith('/.tools/b.lock'));assert.ok(await safeLock(ws,'new.lock'));assert.equal(await safeLock(ws,''),null);
 for(const p of ['../x.lock','/etc/passwd','link/x.lock','.tools/s.lock','.tools','nope/x.lock','.'])await assert.rejects(safeLock(ws,p),/workspace|plain file|folder/,p)});

test('placement: kept off WhatsApp and webhooks by naming every other tool server; back when allowed; a person\'s own list is respected',async()=>{const {placement}=await import('../app/self-runs-box.mjs');
 const servers=['aqeelos-notify','n8n','aqeelos-self'];
 assert.deepEqual(placement({pf:'whatsapp',cur:['hermes-whatsapp','web'],servers,hide:true,managed:false}),{want:['hermes-whatsapp','web','aqeelos-notify','n8n'],managed:true});
 assert.deepEqual(placement({pf:'webhook',cur:undefined,servers,hide:true,managed:false}),{want:['hermes-webhook','aqeelos-notify','n8n'],managed:true});
 // in step: a new server joins the list; nothing to do when it already matches
 assert.deepEqual(placement({pf:'webhook',cur:['hermes-webhook','aqeelos-notify'],servers,hide:true,managed:true}).want,['hermes-webhook','aqeelos-notify','n8n']);
 assert.equal(placement({pf:'webhook',cur:['hermes-webhook','aqeelos-notify','n8n'],servers,hide:true,managed:true}).want,null);
 // allowed again (a trusted person on WhatsApp): the list aqeelOS wrote goes, the person's own tools stay
 assert.deepEqual(placement({pf:'whatsapp',cur:['hermes-whatsapp','web','aqeelos-notify','n8n'],servers,hide:false,managed:true}),{want:['hermes-whatsapp','web'],managed:false});
 // a list a person chose: only aqeelos-self is taken out (and put back), nothing else changes
 assert.deepEqual(placement({pf:'whatsapp',cur:['hermes-whatsapp','n8n','aqeelos-self'],servers,hide:true,managed:false}),{want:['hermes-whatsapp','n8n'],managed:false});
 assert.deepEqual(placement({pf:'whatsapp',cur:['hermes-whatsapp','n8n'],servers,hide:false,managed:false}).want,['hermes-whatsapp','n8n','aqeelos-self']);
 assert.equal(placement({pf:'whatsapp',cur:['hermes-whatsapp','n8n'],servers:['n8n'],hide:false,managed:false}).want,null,'no aqeelos-self on the agent: nothing added');
 assert.equal(placement({pf:'whatsapp',cur:['hermes-whatsapp'],servers,hide:false,managed:false}).want,null)});

test('each run gets its own temp folder, so runs side by side never share (and close) one ssh connection',async()=>{const {createSelfRunsBox}=await import('../app/self-runs-box.mjs');
 const DATA=await mkdtemp(path.join(tmpdir(),'srb-')),bin=path.join(DATA,'fake-bin');await writeFile(bin,'#!/bin/sh\necho "TMP=$TMPDIR"\n',{mode:0o755});
 const box=createSelfRunsBox({HERMES_HOME:DATA,DATA,python:async()=>null,bin});const dirs=[];
 for(const id of ['runA','runB']){const dir=path.join(DATA,'self-runs',id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'prompt.txt'),'x');await box.launch({id,agent:'a',dir,minutes:1});dirs.push(dir)}
 for(const dir of dirs){let e=null;for(let i=0;i<50&&e===null;i++){e=await readFile(path.join(dir,'exit'),'utf8').catch(()=>null);if(e===null)await new Promise(r=>setTimeout(r,100))}
  assert.equal(e,'0');assert.equal((await readFile(path.join(dir,'out.txt'),'utf8')).trim(),'TMP='+path.join(dir,'tmp'))}});
