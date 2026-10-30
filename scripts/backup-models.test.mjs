// Tests for backup models' decisions (app/backup-models.mjs). Run: node --test scripts/backup-models.test.mjs
// The log lines are the engine's own, copied from the box on 30 Oct 2026 (Claude dropping on 24 and 29 Oct).
import test from 'node:test';
import assert from 'node:assert/strict';
import {brandOf,names,bestModel,backupList,sameList,listOf,parseLine,note,judge,holdOf,RULES,PLUGIN} from '../app/backup-models.mjs';

const L={
 drop:"2026-10-30 00:16:19,932 WARNING [20261017_092458_cdc67e69] agent.conversation_loop: API call failed (attempt 1/3) error_type=ClaudeAPIError thread=hermes-gateway_135056:127160861832896 provider=claude-subscription-directsdk-experimental base_url=process://claude-subscription-directsdk-experimental model=claude-opus-5-5[1m] summary=Incomplete upstream response (first upstream attempt: status None, capture incomplete, relay failure ConnectionResetError, native retries denied: 0): API Error: Connection dropped (ECONNRESET)",
 last:"2026-10-24 22:19:09,101 WARNING [20261017_092458_cdc67e69] agent.conversation_loop: API call failed (attempt 3/3) error_type=ClaudeAPIError thread=hermes-gateway_1:2 provider=claude-subscription-directsdk-experimental base_url=process://claude-subscription-directsdk-experimental model=claude-opus-5-5[1m] summary=Incomplete upstream response (first upstream attempt: status None, capture incomplete, relay failure BrokenPipeError, native retries denied: 0): API Error: Connection dropped (ECONNRESET)",
 after:"2026-10-24 22:19:11,667 ERROR [20261017_092458_cdc67e69] agent.conversation_loop: API call failed after 3 retries. Incomplete upstream response (first upstream attempt: status None, capture incomplete, relay failure BrokenPipeError, native retries denied: 0): API Error: Connection dropped (ECONNRESET) | provider=claude-subscription-directsdk-experimental model=claude-opus-5-5[1m] msgs=12 tokens=~261,000",
 ok:"2026-10-30 01:07:03,659 INFO [20261017_092458_cdc67e69] agent.conversation_loop: API call #1: model=claude-opus-5-5[1m] provider=claude-subscription-directsdk-experimental in=261394 out=143 total=261537 latency=13.1s cache=258883/261394 (99%) write=1974 id=msg_011CgXXT2hcgztoo6rw2Gagg",
 admission:"2026-10-18 12:17:04,876 ERROR [api_1792325782_a50c14df] agent.conversation_loop: API call failed after 3 retries. HTTP 404: Incomplete upstream response (first upstream attempt: status 404, capture incomplete, native retries denied: 1, upstream said: model: gpt-6.1-sol): API Error: 400 HERMES_MODEL_ADMISSION_CONSUMED | provider=openai-codex model=gpt-6.1-sol",
 format:"2026-10-22 13:11:50,145 ERROR [cron_995f08f40e51_20261022_183004] agent.conversation_loop: API call failed after 3 retries. Antigravity: Your previous response contained an improperly formatted function call | provider=antigravity-subscription model=gemini-4-argon-high",
 limit:"2026-10-29 11:02:00,000 WARNING [x] agent.conversation_loop: API call failed (attempt 3/3) error_type=RateLimitError thread=t provider=openai-codex base_url=https://x model=gpt-6.1-sol summary=HTTP 429: rate limit reached, try again later"};

test('log: a dropped connection, the last try, the "failed after" line and a call that worked',()=>{
 const d=parseLine(L.drop);assert.deepEqual([d.kind,d.provider,d.model,d.sid],['drop',PLUGIN,'claude-opus-5-5[1m]','20261017_092458_cdc67e69']);assert.equal(d.t,Date.parse('2026-10-30T00:16:19.932Z'));
 assert.equal(parseLine(L.last).kind,'fail');assert.equal(parseLine(L.after).kind,'fail');assert.equal(parseLine(L.after).provider,PLUGIN);
 const o=parseLine(L.ok);assert.deepEqual([o.kind,o.provider],['ok',PLUGIN])});
test('log: limits, refusals and the model\'s own mistakes are not an outage',()=>{
 assert.equal(parseLine(L.admission),null);assert.equal(parseLine(L.format),null);assert.equal(parseLine(L.limit),null);
 assert.equal(parseLine('2026-10-30 01:00:00,000 INFO agent.x: something else provider=x'),null);assert.equal(parseLine('no time here API call #1: model=a provider=b'),null)});
test('log: one failed reply per turn (its last try and its "failed after" line)',()=>{const r={};note(r,parseLine(L.last));note(r,parseLine(L.after));assert.equal(r.ev.filter(e=>e.kind==='fail').length,1);
 note(r,{...parseLine(L.after),sid:'other'});assert.equal(r.ev.filter(e=>e.kind==='fail').length,2)});

test('names: Claude, GPT, Gemini; the model decides first',()=>{
 assert.equal(brandOf(PLUGIN,'claude-opus-5-5[1m]'),'Claude');assert.equal(brandOf('openai-codex','gpt-6.1-sol'),'GPT');assert.equal(brandOf('antigravity-subscription','gemini-4-argon-high'),'Gemini');
 assert.equal(brandOf('antigravity-subscription','claude-opus-5-5-medium'),'Claude');assert.equal(names(['Claude','GPT']),'Claude and GPT');assert.equal(names(['Claude','GPT','Gemini','GPT']),'Claude, GPT and Gemini')});
test('best model: the engine lists of 30 Oct',()=>{
 assert.equal(bestModel('openai-codex',['gpt-6.1-sol','gpt-6.1-sol-900k','gpt-6-astra','gpt-6-astra-900k','gpt-6.1-terra','gpt-6-sol','gpt-6-luna']),'gpt-6.1-sol');
 assert.equal(bestModel('antigravity-subscription',['gemini-3.8-flash-high','gemini-3.8-flash-medium','gemini-4-argon-medium','gemini-4-argon-high','gemini-4-argon-low','gemini-3.8-flash-low','claude-opus-5-5-low','claude-opus-5-5-medium']),'gemini-4-argon-high');
 assert.equal(bestModel(PLUGIN,['claude-sonnet-5-5[1m]','claude-sonnet-5[1m]','claude-haiku-5-5[1m]','claude-opus-5-5[1m]','claude-opus-5[1m]']),'claude-opus-5-5[1m]');
 assert.equal(bestModel('x',['tiny-mini']),'tiny-mini');assert.equal(bestModel('x',['gpt-5-mini','gpt-5']),'gpt-5');assert.equal(bestModel('x',[]),'')});

const PRI=[{key:'claude:main',model:''},{key:'p:openai-codex',model:''},{key:'p:antigravity-subscription',model:''}];
const MODELS={[PLUGIN]:['claude-sonnet-5-5[1m]','claude-opus-5-5[1m]'],'openai-codex':['gpt-6.1-sol','gpt-6-luna'],'antigravity-subscription':['gemini-4-argon-medium','gemini-4-argon-high']};
const signed=(...on)=>e=>{const p=e.key.startsWith('claude:')?PLUGIN:e.key.slice(2);return on.includes(p)?{provider:p,models:MODELS[p]}:null};
test('list: the accounts below the current one, each with its best model',()=>{
 assert.deepEqual(backupList({priority:PRI,cur:'claude:main',curProvider:PLUGIN,usable:signed(PLUGIN,'openai-codex','antigravity-subscription')}),[{provider:'openai-codex',model:'gpt-6.1-sol'},{provider:'antigravity-subscription',model:'gemini-4-argon-high'}]);
 // on ChatGPT (moved there): only what is below it
 assert.deepEqual(backupList({priority:PRI,cur:'p:openai-codex',curProvider:'openai-codex',usable:signed(PLUGIN,'openai-codex','antigravity-subscription')}),[{provider:'antigravity-subscription',model:'gemini-4-argon-high'}]);
 // on nothing in the list: every other entry, Claude too
 assert.deepEqual(backupList({priority:PRI.slice(1),cur:'p:nous',curProvider:'nous',usable:signed('openai-codex')}).map(e=>e.provider),['openai-codex'])});
test('list: signed out, rejected, not allowed, the same provider and an outage are left out',()=>{
 assert.deepEqual(backupList({priority:PRI,cur:'claude:main',curProvider:PLUGIN,usable:signed('antigravity-subscription')}).map(e=>e.provider),['antigravity-subscription']);
 assert.deepEqual(backupList({priority:PRI,cur:'claude:main',curProvider:PLUGIN,usable:signed('openai-codex','antigravity-subscription'),held:k=>k==='p:openai-codex'}).map(e=>e.provider),['antigravity-subscription']);
 // the owner's role allows only Gemini's medium model: that one, not the best
 assert.deepEqual(backupList({priority:PRI,cur:'claude:main',curProvider:PLUGIN,usable:signed('openai-codex','antigravity-subscription'),modelOk:(p,m)=>m==='gemini-4-argon-medium'}),[{provider:'antigravity-subscription',model:'gemini-4-argon-medium'}]);
 // the model picked on the Models page wins, while that provider still offers it
 assert.deepEqual(backupList({priority:[PRI[0],{key:'p:openai-codex',model:'gpt-6-luna'}],cur:'claude:main',curProvider:PLUGIN,usable:signed('openai-codex')}),[{provider:'openai-codex',model:'gpt-6-luna'}]);
 assert.deepEqual(backupList({priority:[PRI[0],{key:'p:openai-codex',model:'gpt-5-gone'}],cur:'claude:main',curProvider:PLUGIN,usable:signed('openai-codex')}),[{provider:'openai-codex',model:'gpt-6.1-sol'}]);
 // a second Claude account below is the same provider: never a backup for an agent on Claude
 assert.deepEqual(backupList({priority:[PRI[0],{key:'claude:work',model:''},PRI[1]],cur:'claude:main',curProvider:PLUGIN,usable:signed(PLUGIN,'openai-codex')}).map(e=>e.provider),['openai-codex'])});
test('list: the engine\'s entries compared by provider and model only',()=>{
 assert.ok(sameList([{provider:'a',model:'b',x:1}],[{provider:'a',model:'b'}]));assert.ok(!sameList([{provider:'a',model:'b'}],[]));
 assert.deepEqual(listOf({provider:'a',model:'b'}),[{provider:'a',model:'b'}]);assert.deepEqual(listOf([{provider:'a'},null,{provider:'c',model:'d'}]),[{provider:'c',model:'d'}]);assert.deepEqual(listOf(undefined),[])});

const T0=Date.parse('2026-10-29T07:00:00Z'),min=60e3;
const ev=(kind,at,sid)=>({t:T0+at*min,kind,sid:sid||kind+at});
const recOf=l=>{const r={ev:[],ends:[]};for(const e of l)note(r,e);return r};
test('outage: 3 failed replies within 10 min start it, 2 do not, 3 spread over 30 min do not',()=>{
 assert.equal(judge(recOf([ev('fail',0),ev('fail',4),ev('fail',9)]),T0+9*min),'start');
 assert.equal(judge(recOf([ev('fail',0),ev('fail',4)]),T0+5*min),null);
 assert.equal(judge(recOf([ev('fail',0),ev('fail',12),ev('fail',24)]),T0+24*min),null);
 // or 8 dropped connections within 10 min (each one a slow reply)
 assert.equal(judge(recOf(Array.from({length:8},(_,i)=>ev('drop',i))),T0+8*min),'start');assert.equal(judge(recOf(Array.from({length:7},(_,i)=>ev('drop',i))),T0+8*min),null)});
test('outage: back only after the hold, 2 good answers and 15 clean minutes',()=>{
 const r=recOf([ev('fail',0),ev('fail',1),ev('fail',2)]);Object.assign(r,{on:true,since:T0+2*min});
 // good answers at once: still held (20 min)
 note(r,ev('ok',5));note(r,ev('ok',10));assert.equal(judge(r,T0+12*min),null);
 // after the hold, clean for 15 min with 2 good answers in it
 note(r,ev('ok',15));note(r,ev('ok',20));assert.equal(judge(r,T0+23*min),'end');
 // a failed reply in the last 15 min keeps it held
 const r2=recOf([ev('fail',0),ev('fail',1),ev('fail',2)]);Object.assign(r2,{on:true,since:T0+2*min});note(r2,ev('ok',15));note(r2,ev('fail',18));note(r2,ev('ok',20));note(r2,ev('ok',25));assert.equal(judge(r2,T0+26*min),null);assert.equal(judge(r2,T0+34*min),'end');
 // one dropped connection is fine, two are not
 const r3=recOf([]);Object.assign(r3,{on:true,since:T0});note(r3,ev('ok',15));note(r3,ev('ok',20));note(r3,ev('drop',21));assert.equal(judge(r3,T0+25*min),'end');note(r3,ev('drop',22));assert.equal(judge(r3,T0+25*min),null);
 // good answers from before the switch do not count
 const r4=recOf([ev('ok',0),ev('ok',1)]);Object.assign(r4,{on:true,since:T0+2*min});assert.equal(judge(r4,T0+25*min),null)});
test('outage: a second one within 2 hours holds twice as long, never more than 3 times',()=>{
 assert.equal(holdOf({since:T0,ends:[]}),RULES.hold);assert.equal(holdOf({since:T0,ends:[T0-30*min]}),2*RULES.hold);assert.equal(holdOf({since:T0,ends:[T0-30*min,T0-60*min,T0-90*min]}),3*RULES.hold);assert.equal(holdOf({since:T0,ends:[T0-3*3600e3]}),RULES.hold);
 const r=recOf([]);Object.assign(r,{on:true,since:T0,ends:[T0-20*min]});note(r,ev('ok',30));note(r,ev('ok',35));assert.equal(judge(r,T0+36*min),null);assert.equal(judge(r,T0+41*min),'end')});
test('outage: failed replies from before the last one ended do not start a new one',()=>{const r=recOf([ev('fail',0),ev('fail',1),ev('fail',2)]);r.ends=[T0+3*min];assert.equal(judge(r,T0+5*min),null);note(r,ev('fail',4));note(r,ev('fail',5));note(r,ev('fail',6));assert.equal(judge(r,T0+6*min),'start')});
test('records keep 2 hours of events',()=>{const r={};note(r,ev('drop',0));note(r,ev('drop',200));assert.equal(r.ev.length,1)});
