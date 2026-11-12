// 12 Nov 2026: a key rotation left the posting guard's file (<workspace>/.tools/posting-guard.json) with an old signature. After the grace time aqeelOS
// refused it, the guard refused every post and the agent posted nothing for hours. Now every file that holds a signature is made again with the key in
// use (app/relay-heal.mjs, app/relay-keys.mjs, posting-limits.mjs ensure), a refused signature is told apart from "over the limit", and a refusal that
// repeats is reported once. Run: node --test scripts/relay-heal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sigOf,createRelayKeys,rotateRelay,reissue,signedIn,healText,guardConf} from '../app/relay-keys.mjs';
import {createRelayHeal} from '../app/relay-heal.mjs';
import {createPostingLimits} from '../app/posting-limits.mjs';
import {gateBody} from '../app/run-gates.mjs';
import {fallbackScript} from '../app/event-hooks.mjs';

const UI='u'.repeat(64),PORT=4400,RULES={on:true,tz:'Asia/Jakarta',perDay:20,perHour:3,gapMin:10,perRun:2,quietFrom:0,quietTo:0};
const walk=async d=>{const out=[];for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[])){const p=path.join(d,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p)}return out};

// one temp box: the app's data, the engine's home with a profile per agent, and the agents' workspaces
async function box(){const T=await mkdtemp(path.join(tmpdir(),'rh-')),D=path.join(T,'data'),H=path.join(T,'.hermes'),W=path.join(T,'workspaces');
 for(const a of ['shop','cafe','quiet']){await mkdir(path.join(H,'profiles',a,'scripts'),{recursive:true});await mkdir(path.join(W,a,'.tools'),{recursive:true})}
 await mkdir(D,{recursive:true});await mkdir(path.join(H,'scripts'),{recursive:true});return {T,D,H,W}}
const limits=(x,keys,{events=[],solved=[],logs=[],t=()=>Date.parse('2026-11-12T10:00:00+07:00')}={})=>{
 return createPostingLimits({DATA:x.D,WORK:x.W,HERMES_HOME:x.H,PORT,sig:a=>keys.sign('relay:',a),signAll:keys.sign,setKey:async()=>({ok:true}),readConfig:async()=>({}),pick:()=>null,look:async()=>'',
  event:async(...a)=>events.push(a),solved:async(...a)=>solved.push(a),telegram:async()=>true,log:m=>logs.push(m),now:t,retryMs:0})};

// every kind of file that held a signature on 12 Nov 2026, written the way the app and its scripts write them
async function seed(x,keys){const S=(l,a)=>keys.sign(l,a),logs=[];const pl=limits(x,keys,{logs});
 for(const a of ['shop','cafe']){await writeFile(path.join(x.W,a,'.tools','posting_guard.py'),'# the guard\n');
  await writeFile(path.join(x.W,a,'.tools','posting-guard.json'),guardConf({base:'http://127.0.0.1:'+PORT,agent:a,sig:S('relay:',a)}))}   // what posting-guard-install.py writes
 await writeFile(path.join(x.W,'quiet','.tools','posting-guard.json'),guardConf({base:'http://127.0.0.1:'+PORT,agent:'quiet',sig:S('relay:','quiet')}));   // limits are off, a file is still there
 await pl.set('shop',{rules:RULES});await pl.set('cafe',{rules:RULES});    // writes aqeelos-posting-gate.sh
 for(const a of ['shop','cafe']){const sp=path.join(x.H,'profiles',a,'scripts');
  await writeFile(path.join(sp,'aqeelos-gate-j1.sh'),gateBody({port:PORT,agent:a,jobId:'j1',sig:S('relay:',a),original:null}),{mode:0o700});          // the run gate
  await writeFile(path.join(sp,'aqeelos-hook-h1.sh'),fallbackScript({agent:a,id:'h-1',port:PORT,sig:S('relay:',a)}),{mode:0o700});                    // the event hook's fallback
  await writeFile(path.join(sp,'aqeelos-check-j1.sh'),'#!/bin/bash\n# no signature in a check\nexit 0\n',{mode:0o700});
  await writeFile(path.join(x.W,a,'.tools','sheet'),'U="http://127.0.0.1:'+PORT+'/google-files/'+a+'/'+S('google-files:',a)+'"\n');                    // the Google files helper
  await writeFile(path.join(x.H,'profiles',a,'config.yaml'),['mcp_servers:','  aqeelos-notify:','    url: http://127.0.0.1:'+PORT+'/mcp/notify/'+a+'/'+S('relay:',a),'  aqeelos-self:','    url: http://127.0.0.1:'+PORT+'/mcp/self/'+a+'/'+S('self-runs:',a),
   '  aqeelos-code:','    url: http://127.0.0.1:'+PORT+'/mcp/code/'+a+'/'+S('code-bridge:',a),'other: keep',''].join('\n'))}
 return {pl,logs}}
const KINDS=f=>/posting-guard\.json$/.test(f)?'guard file':/aqeelos-posting-gate\.sh$/.test(f)?'posting gate':/aqeelos-gate-/.test(f)?'run gate':/aqeelos-hook-/.test(f)?'event hook':/\.tools[\\/]sheet$/.test(f)?'google helper':/config\.yaml$/.test(f)?'engine settings':'other';

test('a key rotation leaves no stale signature in any file an agent runs: every kind is re-issued, nothing is printed',async()=>{
 const x=await box(),t0=Date.parse('2026-11-13T00:00:00Z');let now=t0;
 const k1=createRelayKeys(x.D,UI,()=>now);await seed(x,k1);
 const before=await walk(x.T),oldSigs=new Set();for(const f of before)for(const s of signedIn(await readFile(f,'utf8').catch(()=>'')))oldSigs.add(s.sig);assert.ok(oldSigs.size>=8,'the seed holds signatures: '+oldSigs.size);
 // rotate, then the app starts: reissue (once, old key) and the posting limits' ensure (the guard file and the sweep)
 rotateRelay(x.D,UI,{graceMinutes:30,now:t0});now=t0+60e3;const k2=createRelayKeys(x.D,UI,()=>now);assert.equal(k2.old,UI);
 const logs=[];const heal=createRelayHeal({HERMES_HOME:x.H,WORK:x.W,sign:(l,a)=>k2.sign(l,a),log:m=>logs.push(m)});
 const re=await reissue({HERMES_HOME:x.H,agents:['default','shop','cafe','quiet'],cur:k2.cur,old:k2.old,log:m=>logs.push(m)});assert.ok(re.length>=6);k2.done();
 const pl=limits(x,k2,{logs});await pl.ensure();
 // after the grace time: the old signatures are refused; every signature in every file must be one the app accepts, and the current one
 now=t0+31*60e3;const k3=createRelayKeys(x.D,UI,()=>now);assert.equal(k3.ok(sigOf(UI,'relay:','shop'),'relay:','shop'),false,'the old signature is refused after the grace time');
 const seen={};let n=0;for(const f of await walk(x.T)){const t=await readFile(f,'utf8').catch(()=>'');for(const s of signedIn(t)){n++;seen[KINDS(f)]=(seen[KINDS(f)]||0)+1;
   assert.equal(k3.ok(s.sig,s.label,s.agent),true,KINDS(f)+' '+path.basename(f)+' holds a signature aqeelOS refuses');assert.equal(s.sig,k3.sign(s.label,s.agent),'and it is the current one');assert.equal(oldSigs.has(s.sig),false)}}
 for(const k of ['guard file','posting gate','run gate','event hook','google helper','engine settings'])assert.ok(seen[k],'a '+k+' was checked: '+JSON.stringify(seen));assert.ok(n>=12,'signatures checked: '+n);
 assert.equal(JSON.parse(await readFile(path.join(x.W,'shop','.tools','posting-guard.json'),'utf8')).sig,k3.sign('relay:','shop'));
 assert.match(await readFile(path.join(x.H,'profiles','shop','config.yaml'),'utf8'),/other: keep/,'the rest of a file is untouched');
 for(const l of logs)for(const s of [...oldSigs,k3.sign('relay:','shop'),k3.sign('relay:','cafe')])assert.equal(l.includes(s),false,'a signature in a log line: '+l)});

test('the sweep alone makes a file a rotation missed right, without the old key (the guard file, run gates, hooks, helpers)',async()=>{
 const x=await box(),t0=Date.parse('2026-11-13T00:00:00Z');let now=t0;const k1=createRelayKeys(x.D,UI,()=>now);await seed(x,k1);
 rotateRelay(x.D,UI,{graceMinutes:30,now:t0});now=t0+3*3600e3;const k2=createRelayKeys(x.D,UI,()=>now);   // three hours later, nobody re-issued anything
 assert.equal(k2.old,UI);const r=await createRelayHeal({HERMES_HOME:x.H,WORK:x.W,sign:(l,a)=>k2.sign(l,a)}).sweep();
 assert.ok(r.changed.length>=9,'changed: '+r.changed.length);assert.deepEqual(r.failed,[]);
 for(const f of r.changed)for(const s of signedIn(await readFile(f,'utf8')))assert.equal(s.sig,k2.sign(s.label,s.agent));
 assert.equal((await createRelayHeal({HERMES_HOME:x.H,WORK:x.W,sign:(l,a)=>k2.sign(l,a)}).sweep()).changed.length,0,'a second sweep finds nothing');
 const g=JSON.parse(await readFile(path.join(x.W,'quiet','.tools','posting-guard.json'),'utf8'));assert.equal(g.sig,k2.sign('relay:','quiet'),'also for an agent whose limits are off')});

test('the posting limits make the guard file for an agent with limits on (missing, or old), leave an agent without an installed guard alone, and clear its Health item',async()=>{
 const x=await box(),keys=createRelayKeys(x.D,UI),events=[],solved=[];const pl=limits(x,keys,{events,solved});
 await pl.set('shop',{rules:RULES});assert.equal(await stat(path.join(x.W,'shop','.tools','posting-guard.json')).catch(()=>null),null,'no guard installed there: nothing is invented');
 await writeFile(path.join(x.W,'shop','.tools','posting_guard.py'),'# guard\n');await pl.ensure();
 assert.deepEqual(JSON.parse(await readFile(path.join(x.W,'shop','.tools','posting-guard.json'),'utf8')),{base:'http://127.0.0.1:'+PORT,agent:'shop',sig:keys.sign('relay:','shop')});
 await writeFile(path.join(x.W,'shop','.tools','posting-guard.json'),guardConf({base:'http://127.0.0.1:'+PORT,agent:'shop',sig:'o'.repeat(32)}));
 assert.equal(await pl.staleKey('shop'),'written','a refused signature makes the file again at once');assert.deepEqual(events,[],'healed: no Health item');
 assert.equal(JSON.parse(await readFile(path.join(x.W,'shop','.tools','posting-guard.json'),'utf8')).sig,keys.sign('relay:','shop'))});

test('a refused signature the app cannot repair is ONE Health item, not one per run; an agent without limits is ignored',async()=>{
 const x=await box(),keys=createRelayKeys(x.D,UI),events=[],solved=[];let t=Date.parse('2026-11-12T10:00:00+07:00');const pl=limits(x,keys,{events,solved,t:()=>t});
 await pl.set('cafe',{rules:RULES});   // limits on, but no guard in its workspace (an own config elsewhere): the app cannot make the file
 assert.equal(await pl.staleKey('cafe'),'raised');assert.equal(events.length,1);assert.equal(events[0][3].topic,'posting-guard-key');assert.match(events[0][1],/posting guard's key is out of date/);
 for(let i=0;i<5;i++){t+=61e3;await pl.staleKey('cafe')}assert.equal(events.length,1,'the same hour: still one');
 t+=7*3600e3;await pl.staleKey('cafe');assert.equal(events.length,2,'after 6 hours it may say so again');
 assert.equal(await pl.staleKey('quiet'),'ignored','no limits, no item');
 await writeFile(path.join(x.W,'cafe','.tools','posting_guard.py'),'# guard\n');await pl.ensure();assert.equal(solved.length,1,'the item goes away once the file is right');assert.equal(solved[0][1],'posting-guard-key')});

test('a refusal that repeats is reported once: the same reason within the hour says "already reported at <time>"; a new reason, an hour later, or room again reports anew',async()=>{
 const x=await box(),keys=createRelayKeys(x.D,UI);let t=Date.parse('2026-11-12T10:00:00+07:00');const pl=limits(x,keys,{t:()=>t});await pl.set('shop',{rules:RULES});
 const a=await pl.guard('shop','comment');assert.equal(a.allow,true);
 const r1=await pl.guard('shop','comment');assert.equal(r1.allow,false);assert.doesNotMatch(r1.reason,/Already reported/,'the first refusal is plain: this one is to be reported');
 t+=60e3;const r2=await pl.guard('shop','comment');assert.match(r2.reason,/Already reported at 10:00; do not report this again\.$/);
 t+=60e3;assert.match((await pl.allowNow('shop','comment')).reason,/Already reported at 10:00/,'the gate answer for a script says the same');
 assert.doesNotMatch((await pl.guard('shop','dm')).reason||'',/Already/,'another kind has its own memory');
 // an hour later, while it is still refused (a gap of 4 hours): reported again, and the new time is remembered
 await pl.set('cafe',{rules:{...RULES,gapMin:240}});assert.equal((await pl.guard('cafe','comment')).allow,true);t+=60e3;assert.doesNotMatch((await pl.guard('cafe','comment')).reason,/Already reported/);
 t+=60e3;assert.match((await pl.guard('cafe','comment')).reason,/Already reported at 10:0\d/);t+=3600e3;assert.doesNotMatch((await pl.guard('cafe','comment')).reason,/Already reported/,'an hour later it is reported again');
 t+=60e3;assert.match((await pl.guard('cafe','comment')).reason,/Already reported at 11:0/,'and the new time is remembered');
 // room again: the ticket is taken, the memory is cleared, the next refusal is new
 t+=3*3600e3;const b=await pl.guard('shop','comment');assert.equal(b.allow,true);await pl.mark('shop',b.ticket,'cancel');t+=60e3;
 const c=await pl.guard('shop','comment');assert.equal(c.allow,true,'room again');await pl.record('shop',{ticket:c.ticket,kind:'comment',ref:'chat',text:'x'});
 const d=await pl.guard('shop','comment');assert.equal(d.allow,false);assert.doesNotMatch(d.reason,/Already reported/,'cleared when the kind could post')});

test('healText: only a signature made with another key changes, other text and other labels are left alone',()=>{
 const k=(l,a)=>sigOf('k'.repeat(40),l,a),old=sigOf('o'.repeat(40),'relay:','shop');
 const text='a http://127.0.0.1:4400/posting-check/shop/'+old+' b /run-gate/shop/j-1/'+old+' c /mcp/notify/shop/'+k('relay:','shop')+' d /ordinary/path/'+old;
 const h=healText(text,k);assert.equal(h.n,2);assert.ok(h.text.includes('/posting-check/shop/'+k('relay:','shop')));assert.ok(h.text.includes('/run-gate/shop/j-1/'+k('relay:','shop')));assert.ok(h.text.includes('/ordinary/path/'+old));
 assert.equal(healText(h.text,k).n,0);assert.equal(healText('{"base": "http://x", "agent": "ct", "sig": "'+old+'"}\n',k).text,'{"base": "http://x", "agent": "ct", "sig": "'+k('relay:','ct')+'"}\n')});
