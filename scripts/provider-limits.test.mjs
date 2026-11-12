// "The AI provider is not available" is inconclusive (app/provider-limits.mjs and where it is used). Run: node --test scripts/provider-limits.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {providerUnavailable,resetOf,retryAt,nextClock,createLimitState} from '../app/provider-limits.mjs';
import {createIssues,runCaps,runCounts,capHit,runUnavailable,RUN_CAPS} from '../app/issues.mjs';
import {fakeFixerSandbox} from './lib/fake-fixer-sandbox.mjs';
import {createAgentVersions} from '../app/agent-versions.mjs';
import {exhaustion,entryReset} from '../app/accounts.mjs';
import {providerPause,summary} from './live-test.mjs';

const T=Date.UTC(2026,10,11,17,10);   // 11 Nov 2026 17:10 UTC

test('the real strings from both servers are "provider unavailable"',()=>{
 for(const s of [
  "You've hit your session limit · resets 6pm (UTC)",
  "I couldn't reach any of my models just now (Claude and GPT). Please send it again in a minute.\n\nsession_id: local-a2a4",
  "I couldn't reach any of my models just now (Claude, Gemini and GPT). Please send it again in a minute.",
  "⚠️ I couldn't connect to the AI model service, so this message wasn't processed.",
  "Antigravity: Individual quota reached. Please upgrade your subscription to in",
  "HTTP 429: Incomplete upstream response (first upstream attempt: status 429, capture incomplete, native retries denied: 0, upstream said: upstream rate-limited 1 consecutive request(s) to api.anthr",
  "credential pool: marking device_code DEAD (status=401, reason=token_revoked) — permanently failed, will NOT re-enter rotation until re-auth",
  "Fallback skip: openai-codex/gpt-6.1-sol credential pool is exhausted (every entry in cooldown)",
  "Auxiliary title_generation: auth error on auto and all fallbacks exhausted (fallback_chain + main agent model).",
  "Profile default: claude-sonnet-5-5[1m] via claude-subscription refused for billing/credits — using fallback gemini",
  "it did not answer (1): rate limit. Please try again later.): You've hit your session limit"])
  assert.ok(providerUnavailable(s,{now:T}),s.slice(0,60))});

test('ordinary answers and reports about rate limits are not it (strict)',()=>{
 for(const s of ['OK','answered without OK: LT1A2B3C Red','the agent stopped (1)','Not found','']) assert.equal(providerUnavailable(s),null,s);
 // a fixer's result that is ABOUT rate limits is a real result: only the provider's own wording counts there
 assert.equal(providerUnavailable('The fix handles an HTTP 429 from the provider by waiting; rate limit retry added',{strict:true}),null);
 assert.equal(providerUnavailable("I couldn't reach any of my models just now",{strict:true}).kind,'unreachable')});

test('the reset time is read from the text: clock with zone, retry-after, retry in',()=>{
 assert.equal(new Date(resetOf("You've hit your session limit · resets 6pm (UTC)",T)).toISOString(),'2026-11-11T18:00:00.000Z');
 assert.equal(new Date(resetOf('resets 10pm (UTC)',T)).toISOString(),'2026-11-11T22:00:00.000Z');
 assert.equal(new Date(resetOf('resets 6pm (UTC)',Date.UTC(2026,10,11,19,0))).toISOString(),'2026-11-12T18:00:00.000Z','the next 6pm, tomorrow if it has passed');
 assert.equal(new Date(resetOf('resets 6:30 PM (Asia/Jakarta)',T)).toISOString(),'2026-11-12T11:30:00.000Z');
 assert.equal(resetOf('Retry-After: 120',T),T+120e3);assert.equal(resetOf('please try again in 5 minutes',T),T+300e3);assert.equal(resetOf('no time here',T),null);
 assert.equal(nextClock(0,0,'UTC',T),Date.UTC(2026,10,12,0,0))});

test('retryAt: after the reset (a minute later), never more than 3 hours away, else 30 minutes',()=>{
 const i=providerUnavailable("hit your session limit · resets 6pm (UTC)",{now:T});assert.equal(retryAt(i,{now:T}),Date.UTC(2026,10,11,18,1));
 assert.equal(retryAt({resetAt:T+10*3600e3},{now:T}),T+3*3600e3);assert.equal(retryAt({resetAt:null},{now:T}),T+30*60e3);assert.equal(retryAt(null,{now:T,fallback:5e3}),T+5e3)});

test('the shared hold: set by a limit text, ends at the reset, survives a restart',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'pl-'));let t=T;const s=createLimitState({DATA,now:()=>t});
 assert.equal(s.hold(),null);assert.equal(s.note('all fine'),null);assert.ok(s.note("hit your session limit · resets 6pm (UTC)"));assert.equal(s.until(),Date.UTC(2026,10,11,18,1));
 await new Promise(r=>setTimeout(r,50));assert.equal(createLimitState({DATA,now:()=>t}).until(),Date.UTC(2026,10,11,18,1));
 t=Date.UTC(2026,10,11,18,2);assert.equal(s.hold(),null);await rm(DATA,{recursive:true,force:true})});

// ---- the fixer ----
async function fixer(o={}){const DATA=await mkdtemp(path.join(tmpdir(),'plf-'));let t=T;const told=[],started=[];const limits=createLimitState({now:()=>t});
 await writeFile(path.join(DATA,'team-policy.json'),JSON.stringify({teams:[],owner:{name:'Owner'},fixer:{on:true,agent:'default',...(o.fixer||{})}}));
 const fx=createIssues({sandbox:fakeFixerSandbox(),DATA,home:DATA,bin:'x',fixerHome:DATA,now:()=>t,limits,tellOwner:async x=>{told.push(x)},ready:async()=>true,log:()=>{},tz:()=>'UTC',
  launch:async({dir})=>{started.push(dir);return 999999},alive:async()=>false,checks:o.checks||{}});
 return {fx,DATA,told,started,limits,tick:ms=>{t+=ms},now:()=>t}}
const finish=async(DATA,run,out,exit=0)=>{const d=path.join(DATA,'issues',run);await mkdir(d,{recursive:true});await writeFile(path.join(d,'out.txt'),out);await writeFile(path.join(d,'exit'),String(exit))};

test('a proof run that only says the provider is down is inconclusive: no failed proof, no try used, held until the reset',async()=>{
 const {fx,DATA,started,limits}=await fixer();
 const {issue}=await fx.file({agent:'a',missing:'The agent cannot reply to X',evidence:'e'});const db=await fx._db();const i=db.items[0];i.state='verify';i.tries=1;i.history.push({kind:'fix',status:'changed',changes:[],summary:'s'});
 await fx.tick();assert.equal(started.length,1);const run=i.run;assert.equal(db.runs[run].kind,'proof');
 await finish(DATA,run,"RESULT: {\"status\":\"not_proven\",\"proof\":\"I couldn't reach any of my models just now (Claude and GPT). Please send it again in a minute.\",\"need\":\"\"}\n");
 await fx.tick();
 assert.equal(i.state,'verify','still waiting for its proof');assert.equal(i.tries,1);assert.equal(i.history.filter(h=>h.kind==='proof').length,0,'no proof verdict recorded');
 assert.equal(db.runs[run].inconclusive,true);assert.ok(i.notBefore>T);assert.ok(limits.hold(),'the shared hold is set');
 await fx.tick();assert.equal(started.length,1,'nothing new starts while the provider is held')});

test('a fix run that dies with a session limit is not a try',async()=>{
 const {fx,DATA,started}=await fixer();await fx.file({agent:'a',missing:'Something is broken here and needs work'});const db=await fx._db();const i=db.items[0];
 await fx.tick();assert.equal(i.tries,1);await finish(DATA,i.run,"API call failed ... You've hit your session limit · resets 6pm (UTC)\n",1);await fx.tick();
 assert.equal(i.tries,0);assert.equal(i.state,'queued');assert.equal(i.notBefore,Date.UTC(2026,10,11,18,1));assert.equal(i.history.filter(h=>h.kind==='fix').length,0)});

test('a result that is really about rate limits is a real verdict, not inconclusive',()=>{
 assert.equal(runUnavailable('',{status:'proven',proof:"I couldn't reach any of my models"}),null);
 assert.equal(runUnavailable('',{status:'not_proven',proof:'the retry on HTTP 429 is still missing',summary:'',need:''}),null);
 assert.ok(runUnavailable('',{status:'not_proven',proof:"hit your session limit",summary:'',need:''}));
 assert.ok(runUnavailable('... 429 rate limit. Please try again later.',null))});

test('run caps: per day and in total, from runs that really ran; settings override the defaults',()=>{
 const runs={a:{issue:'i1',kind:'proof',day:'D'},b:{issue:'i1',kind:'proof',day:'D'},c:{issue:'i1',kind:'proof',day:'E'},d:{issue:'i1',kind:'proof',day:'D',inconclusive:true},e:{issue:'i1',kind:'fix',day:'D'},f:{issue:'i2',kind:'proof',day:'D'}};
 assert.deepEqual(runCounts(runs,{id:'i1'},'D'),{proofDay:2,proofTotal:3,fixDay:1,fixTotal:1});
 assert.equal(capHit(runs,{id:'i1'},'proof',{fixer:{maxProofsPerDay:2}},'D'),'day');assert.equal(capHit(runs,{id:'i1'},'proof',{fixer:{maxProofsPerDay:2}},'E'),null);
 assert.equal(capHit(runs,{id:'i1'},'proof',{fixer:{maxProofsTotal:3,maxProofsPerDay:9}},'D'),'total');assert.equal(capHit(runs,{id:'i1'},'fix',{},'D'),null);
 assert.deepEqual(runCaps({}),RUN_CAPS);assert.equal(runCaps({fixer:{maxFixesTotal:'x'}}).fixTotal,RUN_CAPS.fixTotal);
 assert.equal(capHit(runs,{id:'i1',runBase:{proofTotal:3,proofDay:2,day:'D'}},'proof',{fixer:{maxProofsTotal:3}},'D'),null,'Try again starts a fresh count')});

test('an issue at its total cap becomes one needs-a-person item, once; new reports and deploys do not restart it; Try again does',async()=>{
 const changed=[true];const {fx,DATA,told,started,now}=await fixer({fixer:{maxProofsTotal:2,maxProofsPerDay:9},checks:{changedSince:async()=>changed[0]}});
 await fx.file({agent:'a',missing:'The agent cannot reply to X'});const db=await fx._db();const i=db.items[0];
 i.state='stuck';i.history.push({kind:'fix',status:'changed',changes:[{file:'/x',backup:'/y'}],summary:'s'});
 for(const n of [1,2])db.runs['r'+n]={id:'r'+n,issue:i.id,kind:'proof',day:'2026-11-10',done:1};
 await fx.sweep(true);assert.equal(i.state,'needs_human','a deploy changed its files, but it is at the cap');assert.ok(i.capped);assert.equal(started.length,0);assert.equal(told.length,1);
 await fx.sweep(true);await fx.tick();assert.equal(told.length,1,'told once');assert.equal(started.length,0);
 await fx.file({agent:'a',missing:'The agent cannot reply to X'});assert.equal(i.state,'needs_human','a new report does not queue it again');assert.equal(i.tries,0);
 await fx.retry(i.id);assert.equal(i.state,'queued');assert.ok(!i.capped);assert.deepEqual(capHit(db.runs,i,'proof',{fixer:{maxProofsTotal:2}},'2026-11-11'),null)});

test('a stuck issue at the daily cap is not restarted by a deploy today',async()=>{
 const {fx}=await fixer({fixer:{maxProofsPerDay:1},checks:{changedSince:async()=>true}});await fx.file({agent:'a',missing:'Something else is broken'});const db=await fx._db();const i=db.items[0];
 i.state='stuck';i.history.push({kind:'fix',status:'changed',changes:[{file:'/x',backup:'/y'}],summary:'s'});db.runs.r1={id:'r1',issue:i.id,kind:'proof',day:'2026-11-11',done:1};
 await fx.sweep(true);assert.equal(i.state,'stuck');assert.ok(!i.capped)});

// ---- auto-rollback ----
async function versions(o={}){const root=await mkdtemp(path.join(tmpdir(),'plv-'));const H=path.join(root,'hermes'),DATA=path.join(root,'data');await mkdir(path.join(H,'profiles','bot','skills','cat','one'),{recursive:true});
 await writeFile(path.join(H,'profiles','bot','skills','cat','one','SKILL.md'),'v1\n');let t=T;const told=[],filed=[],cfg={stt:{language:'id'}};const limits=createLimitState({now:()=>t});
 const v=createAgentVersions({DATA,HERMES_HOME:H,DASH:'http://127.0.0.1:1',DASH_TOKEN:'x',listAgents:async()=>['default','bot'],nameOf:a=>a==='bot'?'Bot':a,readConfig:async()=>cfg,
  setKey:async(a,k,val)=>{const p=k.split('.');let x=cfg;while(p.length>1)x=x[p.shift()]||={};x[p[0]]=val;return {ok:true}},pick:(x,k)=>k.split('.').reduce((a,b)=>a&&typeof a==='object'?a[b]:undefined,x),
  issues:{file:async x=>{filed.push(x);return {}},forAgent:async()=>[]},ping:o.ping,tellOwner:async x=>{told.push(x)},now:()=>t,live:true,log:()=>{},limits,outageAt:o.outageAt});
 return {v,cfg,told,filed,limits,tick:ms=>{t+=ms},now:()=>t,H}}

test('auto-rollback: "no answer" because the provider is used up undoes nothing, files nothing, asks again after the reset',async()=>{
 const {v,cfg,told,filed,tick,limits}=await versions({ping:async()=>({ok:false,why:"answered without OK: I couldn't reach any of my models just now (Claude and GPT). Please send it again in a minute."})});
 await v.mySetting('bot','stt.language','xx',{by:'Bot'});await v.arm('bot');
 for(let k=0;k<4;k++){tick(5*60e3);await v.watchTick()}
 assert.equal(cfg.stt.language,'xx','the change stays');assert.equal(told.length,0);assert.equal(filed.length,0);const d=await v.load('bot');
 assert.equal(d.watch.fails,0);assert.equal(d.events.filter(e=>e.kind==='rollback').length,0);assert.equal(d.events.filter(e=>e.kind==='unavailable').length,1,'said once');assert.ok(limits.hold())});

test('auto-rollback: the reset time in the answer decides when it asks again; a real failure still rolls back',async()=>{
 let bad="it did not answer (1): You've hit your session limit · resets 6pm (UTC)";
 const {v,cfg,filed,tick,now}=await versions({ping:async()=>({ok:false,why:bad})});
 await v.mySetting('bot','stt.language','xx',{by:'Bot'});await v.arm('bot');tick(4*60e3);await v.watchTick();
 assert.equal((await v.load('bot')).watch.due,Date.UTC(2026,10,11,18,1));
 bad='answered without OK: Traceback boom';tick(Date.UTC(2026,10,11,18,2)-now());await v.watchTick();tick(5*60e3);await v.watchTick();
 assert.equal(cfg.stt.language,'id','a real failure is rolled back');assert.equal(filed.length,1)});

test('false rollbacks of the last 48 hours are found and put back; an unexplained "did not answer" counts only during a provider outage',async()=>{
 let out=false;const {v,cfg,tick,H}=await versions({ping:async()=>({ok:false,why:'it did not answer (1): '}),outageAt:()=>out});
 await v.mySetting('bot','stt.language','xx',{by:'Bot'});const f=path.join(H,'profiles','bot','skills','cat','one','SKILL.md');await v.skillsSnap('bot');await writeFile(f,'v2 graphify\n');await v.skillsSnap('bot',{by:'Bot',why:'edit'});
 await v.arm('bot');tick(4*60e3);await v.watchTick();tick(5*60e3);await v.watchTick();
 assert.equal(cfg.stt.language,'id');assert.equal((await readFile(f,'utf8')).replaceAll(String.fromCharCode(13),''),'v1\n','rolled back, the old way (no reason in the text)');
 assert.deepEqual(await v.falseRollbacks('bot'),[],'no outage proven: not a false rollback');
 out=true;const r=await v.falseRollbacks('bot');assert.equal(r.length,1);assert.equal(r[0].changes.length,2);assert.ok(r[0].changes.every(c=>c.redoable));
 const dry=await v.restoreFalseRollbacks('bot',{apply:false});assert.equal(dry[0].restored.length,0);assert.equal(cfg.stt.language,'id');
 const res=await v.restoreFalseRollbacks('bot');assert.equal(res[0].restored.length,2);assert.equal(cfg.stt.language,'xx');assert.equal((await readFile(f,'utf8')).replaceAll(String.fromCharCode(13),''),'v2 graphify\n');
 assert.equal((await v.restoreFalseRollbacks('bot'))[0].restored.length,0,'once');
 tick(49*3600e3);assert.deepEqual(await v.falseRollbacks('bot'),[],'older than 48 hours is not looked at')});

// ---- the deploy live test ----
test('live test: a reply that is the provider-down message is skipped (no undo of the deploy) with the reset time; a real wrong answer still fails',()=>{
 const p=providerPause("⚠️ I couldn't connect to the AI model service, so this message wasn't processed.",'','LT1A2B',T);assert.equal(p.skipped,true);assert.equal(p.inconclusive,true);
 assert.deepEqual(summary([{name:'agent',...p}]),{ok:true,failed:[]});
 assert.equal(providerPause('','{"error":"You\'ve hit your session limit · resets 6pm (UTC)"}','LT1A2B',T).resetAt,Date.UTC(2026,10,11,18,0));
 assert.equal(providerPause('LT1A2B Red','','LT1A2B',T),null);assert.equal(providerPause('blue banana','','LT1A2B',T),null);assert.equal(providerPause('','','LT1A2B',T),null)});

// ---- account rotation ----
test('every account used up: nobody moves, held until the earliest reset; one used-up account is not that',()=>{
 const pr=[{key:'claude:main'},{key:'claude:two'},{key:'p:openai-codex'}];const u={'claude:main':100,'claude:two':100,'p:openai-codex':99},r={'claude:main':T+3600e3,'claude:two':T+7200e3,'p:openai-codex':null};
 assert.deepEqual(exhaustion(pr,e=>u[e.key],e=>r[e.key]),{all:true,until:T+3600e3});
 assert.equal(exhaustion(pr,e=>({...u,'claude:two':30})[e.key],e=>r[e.key]).all,false);
 assert.equal(exhaustion(pr,e=>({...u,'claude:main':null})[e.key],e=>r[e.key]).all,false,'unknown usage is not "used up"');
 assert.equal(exhaustion(pr,()=>0,()=>null,{held:()=>true}).all,true,'a provider in an outage counts');assert.equal(exhaustion([],()=>100,()=>null).all,false);
 assert.equal(entryReset([{used:100,resets:new Date(T+1e3).toISOString()},{used:44,resets:new Date(T+9e9).toISOString()},{used:100,resets:new Date(T+5e3).toISOString()}]),T+5e3)});
