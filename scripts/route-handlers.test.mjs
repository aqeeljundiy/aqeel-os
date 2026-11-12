// Audit H12 (12 Nov 2026): six behaviour-breaking edits left the suite green, because the tests that guarded them read source text.
// These run the behaviour: the pause route as a member, an owner and an admin; a payment callback with a real signature waking the payment
// check; the journal step before an engine stop; the one-time duplicate re-sort in issues.mjs. For "restart later, not now" every call site
// of both functions is listed, so changing one of them fails here. (The sixth, the trap in scripts/box-live.sh, belongs to the deploy tests.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {channelsPause,payHook,beforeEngineStop} from '../app/route-handlers.mjs';
import {createPaymentCallbacks} from '../app/payment-callbacks.mjs';
import {createIssues} from '../app/issues.mjs';

/* ---------- 1. /ui/channels/pause ---------- */
// the same rule server.mjs builds: an admin, or the agent's owner
const people={admin:{id:'a',admin:true},owner:{id:'o',own:['shop']},member:{id:'m',own:[]}};
const ownsAgent=(u,a)=>!!u&&(!!u.admin||(u.own||[]).includes(String(a||'default')));
const pause=(u,body,calls=[])=>channelsPause({u,body,ownsAgent,profiles:async()=>['default','shop','other'],setChannelOn:async(ag,pf,on)=>{calls.push([ag,pf,on]);return {ok:true,on}}});

test('pause a channel: a member who does not own the agent is refused (403) and nothing is switched',async()=>{const calls=[];
 const r=await pause(people.member,{agent:'shop',platform:'telegram',on:false},calls);assert.equal(r.status,403);assert.match(r.body.error,/owner/);assert.deepEqual(calls,[]);
 // nobody signed in, another agent's owner, and the default agent for a non-admin: refused too
 assert.equal((await pause(null,{agent:'shop',platform:'telegram'},calls)).status,403);
 assert.equal((await pause(people.owner,{agent:'other',platform:'telegram'},calls)).status,403);
 assert.equal((await pause(people.owner,{platform:'telegram'},calls)).status,403);assert.deepEqual(calls,[])});
test('pause a channel: its owner and an admin may, and the switch gets exactly what was asked',async()=>{const calls=[];
 assert.deepEqual(await pause(people.owner,{agent:'shop',platform:'telegram',on:false},calls),{status:200,body:{ok:true,on:false}});
 assert.equal((await pause(people.admin,{agent:'other',platform:'whatsapp',on:true},calls)).status,200);
 assert.deepEqual(calls,[['shop','telegram',false],['other','whatsapp',true]]);
 // only a real true switches on
 await pause(people.admin,{agent:'shop',platform:'slack',on:'yes'},calls);assert.deepEqual(calls.at(-1),['shop','slack',false])});
test('pause a channel: an unknown agent or channel is a 400, and a failing switch says why',async()=>{const calls=[];
 for(const b of [{agent:'nobody',platform:'telegram'},{agent:'shop',platform:'api_server'},{agent:'shop',platform:'webhook'},{agent:'shop',platform:'../x'},{agent:'shop'}])assert.equal((await pause(people.admin,b,calls)).status,400,JSON.stringify(b));
 assert.deepEqual(calls,[]);
 const r=await channelsPause({u:people.admin,body:{agent:'shop',platform:'telegram'},ownsAgent,profiles:async()=>['shop'],setChannelOn:async()=>{throw Error('the engine said no')}});assert.deepEqual(r,{status:400,body:{error:'the engine said no'}})});

/* ---------- 4. /hooks/pay ---------- */
function payScene(){const T=mkdtempSync(path.join(tmpdir(),'payhook-')),DATA=path.join(T,'data'),WORK=path.join(T,'work');mkdirSync(DATA,{recursive:true});mkdirSync(path.join(WORK,'shop','.secrets'),{recursive:true});
 writeFileSync(path.join(WORK,'shop','.secrets','TRIPAY_PRIVATE_KEY'),'tripay-private');writeFileSync(path.join(WORK,'shop','.secrets','XENDIT_CALLBACK_TOKEN'),'xendit-token');
 const nudged=[];const C=createPaymentCallbacks({DATA,WORK,nudge:async a=>{nudged.push(a)},log:()=>{}});return {C,nudged}}
const tripayCall=(body,key='tripay-private')=>{const raw=Buffer.from(JSON.stringify(body));return {raw,headers:{'x-callback-signature':createHmac('sha256',key).update(raw).digest('hex'),'x-callback-event':'payment_status'}}};

test('a payment callback with a valid signature wakes the payment check for that agent, after the answer',async()=>{const {C,nudged}=payScene(),c=tripayCall({reference:'T1',status:'PAID'});
 const r=await payHook({provider:'tripay',agent:'shop',headers:c.headers,raw:c.raw,receive:(...a)=>C.receive(...a),live:true});
 assert.equal(r.status,200);assert.deepEqual(r.body,{success:true});assert.deepEqual(nudged,[],'not before the provider has its answer');
 assert.equal(typeof r.after,'function');await r.after();assert.deepEqual(nudged,['shop']);
 // Xendit: its token header
 const x=await payHook({provider:'xendit',agent:'shop',headers:{'x-callback-token':'xendit-token'},raw:Buffer.from('{}'),receive:(...a)=>C.receive(...a),live:true});
 assert.equal(x.status,200);await x.after();assert.deepEqual(nudged,['shop','shop'])});
test('a payment callback with a bad signature, for an unknown agent or on the test copy wakes nothing',async()=>{const {C,nudged}=payScene();
 const bad=tripayCall({status:'PAID'},'someone-else');let r=await payHook({provider:'tripay',agent:'shop',headers:bad.headers,raw:bad.raw,receive:(...a)=>C.receive(...a),live:true});
 assert.equal(r.status,401);assert.equal(r.after,null);
 const ok=tripayCall({status:'PAID'});r=await payHook({provider:'tripay',agent:'nobody',headers:ok.headers,raw:ok.raw,receive:(...a)=>C.receive(...a),live:true});assert.notEqual(r.status,200);assert.equal(r.after,null);
 r=await payHook({provider:'tripay',agent:'shop',headers:ok.headers,raw:ok.raw,receive:(...a)=>C.receive(...a),live:false});assert.equal(r.status,200);assert.equal(r.after,null,'the test copy answers and wakes nothing');
 assert.deepEqual(nudged,[]);
 // a receiver that throws is a 500 the provider retries, and a wake-up that throws is caught
 r=await payHook({provider:'tripay',agent:'shop',headers:{},raw:Buffer.from(''),receive:async()=>{throw Error('disk')},live:true,log:()=>{}});assert.equal(r.status,500);
 r=await payHook({provider:'tripay',agent:'shop',headers:{},raw:Buffer.from(''),receive:async()=>({status:200,body:{},after:async()=>{throw Error('x')}}),live:true,log:()=>{}});await r.after()});

/* ---------- 3. before aqeelOS stops the engine ---------- */
test('before an engine stop, what runs now is journaled; a journal that fails does not stop the restart',async()=>{let n=0;
 assert.equal(await beforeEngineStop({syncDelegs:async()=>{n++;return true}}),true);assert.equal(n,1);
 const said=[];assert.equal(await beforeEngineStop({syncDelegs:async()=>{throw Error('ledger locked')},log:m=>said.push(m)}),false);assert.match(said[0],/ledger locked/);
 // and the restart really calls it, before the stop commands: in the function, not in a comment or behind a switch
 const s=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8'),fn=s.slice(s.indexOf('function restartGateway('),s.indexOf('\nconst later=createRestartLater('));
 const lines=fn.split('\n').map(l=>l.replace(/\/\/.*$/,'')),at=lines.findIndex(l=>/^\s*await beforeEngineStop\(\{syncDelegs/.test(l)),stop=lines.findIndex(l=>/stopOwnGatewayCmd\(|gateway stop|kill-session/.test(l));
 assert.ok(at>=0,'restartGateway must await beforeEngineStop({syncDelegs…}) as a statement of its own');assert.ok(stop<0||at<=stop,'before anything is stopped')});

/* ---------- 5. restart later, not now ---------- */
test('every restart call site is known: the ones that wait for the quiet moment stay restartLater, and no new immediate restart appears',()=>{
 const s=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8').split('\n').map(l=>l.replace(/(^|\s)\/\/ .*$/,'')).join('\n');
 const sites=fn=>{const out={};for(const m of s.matchAll(new RegExp('(?<![\\w.])'+fn+'\\(([^,)]{0,40})','g')))out[m[1]]=(out[m[1]]||0)+1;return out};
 // waits for the maintenance moment: changing any of these to restartGateway restarts the engine in the middle of people's chats
 assert.deepEqual(sites('restartLater'),{"'agent defaults'":1,"'new agent defaults'":1,"why":2,"'aqeelos-live plugin for '+(c.length||'a":1,"'billion-context plugin for '+c.length+'":1,"'efficient defaults for '+c.length+' age":1,"'graph search tool for '+r.changed.lengt":1,"'new or changed aqeelOS tools for '+chan":1,"base+' changed its own '+A.key":1,"why+' (asked by '+(NAMES[mn[1].split('--":1,"base+' changed its own '+key":1});
 // restarts at once, each for a reason a person asked for or the engine needs now
 assert.deepEqual(sites('restartGateway'),{"'Slack channel settings updated for '+a":1,"why":6,"a.why":1,"'no gateway was running'":1,"'an engine was started with the wrong ho":1,"'gateway outside its session cannot reac":1,"'engine updated: aqeelOS wording applied":1,"'agents restored from a backup'":1,"(on?'resumed ':'paused '":1,"'WhatsApp linked on '+agent":1,"'reconnect '+pf+' (asked by '+(NAMES[me]":1,"'restored '+m[1]":1,"'restart from the app ('+(u.name||u.id":1,"'Trusted changed for '+ag":1,"pf+' removed from '+ag":1,"'WhatsApp removed from '+ag":1,"'stopping WhatsApp retries on '+ag+' bef":1,"'WhatsApp back on '+ag+' after a cancell":1,"'reconnect '+pf+' (main agent":1})});

/* ---------- 6. the one-time duplicate re-sort ---------- */
test('issues: items marked duplicate before duplicates were linked are sorted again once, and only once',async()=>{const d=mkdtempSync(path.join(tmpdir(),'dup-'));
 writeFileSync(path.join(d,'team-policy.json'),JSON.stringify({teams:[],fixer:{on:false}}));
 const it=(id,x)=>({id,key:'k|'+id,agent:'a',state:'open',missing:'m '+id,created:1,updated:1,count:1,tries:0,history:[],...x});
 writeFileSync(path.join(d,'issues.json'),JSON.stringify({items:[it('i1',{sorted:'duplicate'}),it('i2',{sorted:'duplicate',mergedInto:'i3',state:'closed'}),it('i3',{sorted:'fixer'}),it('i4',{sorted:'duplicate',dupOf:'i3'})],runs:{}}));
 const I=createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{},defer:()=>{}});const db=await I._db(),by=Object.fromEntries(db.items.map(i=>[i.id,i]));
 assert.equal(by.i1.sorted,undefined,'an unlinked duplicate is sorted again');assert.equal(by.i2.sorted,'duplicate');assert.equal(by.i4.sorted,'duplicate');assert.equal(by.i3.sorted,'fixer');assert.equal(db.dupLink,1);
 // done once: a later unlinked duplicate (the sorter's own answer after that) is left alone at the next start
 by.i3.sorted='duplicate';writeFileSync(path.join(d,'issues.json'),JSON.stringify(db));
 const again=await createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{},defer:()=>{}})._db();assert.equal(again.items.find(i=>i.id==='i3').sorted,'duplicate')});
