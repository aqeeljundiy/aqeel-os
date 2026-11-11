// Background work follows changes (app/reconcile.mjs): a task whose inputs did not move is skipped, a real change runs it at
// once, its own writes do not start it again, a failure is tried again later, a safety sweep runs everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const T=mkdtempSync(path.join(tmpdir(),'rec-'));process.env.HERMES_HOME=path.join(T,'home');
const {statSig,treeSig,jobsSig,createReconciler,createLoops,createAgentGate,ledgerSig}=await import('../app/reconcile.mjs');
const home=path.join(T,'home');
const mk=a=>{const h=a==='default'?home:path.join(home,'profiles',a);mkdirSync(path.join(h,'cron'),{recursive:true});writeFileSync(path.join(h,'config.yaml'),'model: {}\n');return h};
const later=(f,s=5)=>{const t=new Date(Date.now()+s*1000);utimesSync(f,t,t)};   // a write the stat can tell apart
const homeOf=a=>a==='default'?home:path.join(home,'profiles',a);
const names=['default','sela','pixel'];for(const a of names)mk(a);
const make=(o={})=>{let t=1e12;const clock={t,adv:ms=>{clock.t+=ms}};const log=[];
 const r=createReconciler({now:()=>clock.t,sleep:async()=>{},gap:0,homes:async()=>names,homeOf,log:m=>log.push(m),setTimer:()=>({unref(){}}),setTick:()=>({unref(){}}),...o});return {r,clock,log}};

test('statSig: the same until a file is written, "-" for a missing one',async()=>{const f=path.join(homeOf('sela'),'config.yaml'),a=await statSig([f,path.join(T,'nope')]);
 assert.equal(await statSig([f,path.join(T,'nope')]),a);assert.match(a,/\|-$/);writeFileSync(f,'model: {x: 1}\n');later(f);assert.notEqual(await statSig([f,path.join(T,'nope')]),a)});

test('treeSig sees a skill added or a SKILL.md rewritten, not the folder left alone',async()=>{const d=path.join(homeOf('pixel'),'skills');mkdirSync(path.join(d,'cat','one'),{recursive:true});writeFileSync(path.join(d,'cat','one','SKILL.md'),'a');
 const a=await treeSig(d,3);assert.equal(await treeSig(d,3),a);mkdirSync(path.join(d,'cat','two'));assert.notEqual(await treeSig(d,2),await treeSig(path.join(T,'x'),2));
 assert.notEqual(await treeSig(d,3),a,'a new skill');const b=await treeSig(d,3);later(path.join(d,'cat','one','SKILL.md'));assert.notEqual(await treeSig(d,3),b,'a skill file rewritten')});

test('jobsSig ignores last-run bookkeeping, sees a changed schedule or prompt',async()=>{const h=homeOf('sela'),f=path.join(h,'cron','jobs.json');
 const jobs=(o={})=>JSON.stringify({jobs:[{id:'j1',name:'recap',schedule:'*/30 * * * *',enabled:true,prompt:'run it',last_run_at:'1',...o}]});
 writeFileSync(f,jobs());const a=await jobsSig(h);writeFileSync(f,jobs({last_run_at:'2',next_run_at:'3'}));later(f,10);assert.equal(await jobsSig(h),a,'a run was recorded: same');
 writeFileSync(f,jobs({schedule:'*/5 * * * *'}));later(f,20);assert.notEqual(await jobsSig(h),a,'the schedule changed')});

test('ledgerSig moves when the engine writes its run ledger',async()=>{const hs=names.map(homeOf),a=await ledgerSig(hs);assert.equal(await ledgerSig(hs),a);
 const db=path.join(homeOf('sela'),'cron','executions.db-wal');writeFileSync(db,'x');assert.notEqual(await ledgerSig(hs),a)});

test('a task runs at start, then is skipped while nothing it reads moved',async()=>{const {r}=make();let n=0;r.add('t',{run:async()=>{n++},reads:['cfg']});
 await r.pass();assert.equal(n,1,'at start');await r.pass();await r.pass();assert.equal(n,1,'nothing changed: not run');
 const row=r.stats().find(x=>x.name==='t');assert.equal(row.runs,1);assert.ok(row.skipped>=2,'counted as skipped, not work')});

test('a real change runs it on the next pass, and only the tasks that read it',async()=>{const {r}=make();let a=0,b=0;
 r.add('cfg-task',{run:async()=>{a++},reads:['cfg']});r.add('jobs-task',{run:async()=>{b++},reads:['jobs']});await r.pass();
 const f=path.join(homeOf('pixel'),'config.yaml');writeFileSync(f,'model: {y: 2}\n');later(f,30);await r.pass();
 assert.equal(a,2,'settings changed: runs');assert.equal(b,1,'jobs did not: skipped')});

test('its own writes do not start it again (fingerprint taken after the work)',async()=>{const {r}=make();const f=path.join(homeOf('sela'),'config.yaml');let n=0,s=40;
 r.add('writer',{run:async()=>{n++;writeFileSync(f,'model: {z: '+n+'}\n');later(f,s++)},reads:['cfg']});await r.pass();await r.pass();await r.pass();assert.equal(n,1)});

test('trigger runs one task or all at once, without any file moving',async()=>{const {r}=make();let a=0,b=0;r.add('a',{run:async()=>{a++}});r.add('b',{run:async()=>{b++}});await r.pass();
 r.trigger('a');await r.pass();assert.deepEqual([a,b],[2,1]);r.trigger();await r.pass();assert.deepEqual([a,b],[3,2])});

test('a new agent changes the fingerprint and runs the tasks',async()=>{const list=['default','sela'];const {r}=make({homes:async()=>list});let n=0;r.add('t',{run:async()=>{n++}});await r.pass();await r.pass();assert.equal(n,1);
 mk('newbie');list.push('newbie');await r.pass();assert.equal(n,2)});

test('a failed run is tried again after 10 minutes, not every minute',async()=>{const {r,clock,log}=make();let n=0,fail=true;r.add('t',{run:async()=>{n++;if(fail)throw Error('boom')}});
 await r.pass();assert.equal(n,1);clock.adv(60e3);await r.pass();assert.equal(n,1,'not yet');fail=false;clock.adv(10*60e3);await r.pass();assert.equal(n,2,'retried');
 assert.ok(log.some(m=>/boom/.test(m)));assert.equal(r.stats()[0].errors,1);clock.adv(60e3);await r.pass();assert.equal(n,2,'healthy again')});

test('the safety sweep runs a task even when nothing moved',async()=>{const {r,clock}=make({sweep:4*3600e3});let n=0;r.add('t',{run:async()=>{n++}});await r.pass();clock.adv(3*3600e3);await r.pass();assert.equal(n,1);
 clock.adv(1.1*3600e3);await r.pass();assert.equal(n,2,'after 4 hours');});

test('a task asks to be run by its own interval where it must (every)',async()=>{const {r,clock}=make();let n=0;r.add('t',{run:async()=>{n++},every:3600e3});await r.pass();clock.adv(61*60e3);await r.pass();assert.equal(n,2)});

test('a trigger during a pass is answered by one more pass',async()=>{const {r}=make();let n=0,gate;r.add('t',{run:async()=>{n++;if(n===1)await new Promise(x=>gate=x)}});
 const p=r.pass();await new Promise(x=>setTimeout(x,20));r.trigger('t');const q=r.pass();gate();await Promise.all([p,q]);assert.equal(n,2)});

test('agent gate: an agent whose inputs did not change is skipped, a changed or failed one is not',async()=>{const g=createAgentGate({homeOf,reads:['cfg']});const ns=['sela','pixel'];
 await g.prepare(ns);assert.equal(g.skip('sela'),false,'never done');await g.commit('sela');await g.prepare(ns);assert.equal(g.skip('sela'),true,'unchanged');assert.equal(g.skip('pixel'),false,'never committed (it failed)');
 const f=path.join(homeOf('sela'),'config.yaml');writeFileSync(f,'model: {w: 3}\n');later(f,50);await g.prepare(ns);assert.equal(g.skip('sela'),false,'changed');
 await g.commit('sela');await g.prepare(ns,{force:true});assert.equal(g.skip('sela'),false,'a forced pass does everything')});

test('loops.track counts work, skips, errors and passes the result through',async()=>{const l=createLoops();const a=l.track('a',async()=>5),b=l.track('b',async()=>({skipped:true})),c=l.track('c',async()=>{throw Error('x')});
 assert.equal(await a(),5);await b();await assert.rejects(c());const s=Object.fromEntries(l.stats().map(x=>[x.name,x]));assert.deepEqual([s.a.runs,s.a.skipped],[1,0]);assert.deepEqual([s.b.runs,s.b.skipped],[0,1]);assert.equal(s.c.errors,1)});

test('the skills copy runs once, then only when a skill folder or the policy moves',async()=>{
 const {createAgentDefaults}=await import('../app/agent-defaults.mjs');const DATA=path.join(T,'data');mkdirSync(DATA,{recursive:true});
 let gave=0;const notes=[];const d=createAgentDefaults({DATA,giveSkills:async()=>{gave++;return 0},note:(n,o)=>notes.push(o.ran===false?'skip':'run'),isTest:async()=>false});
 mkdirSync(path.join(home,'skills','cat','one'),{recursive:true});writeFileSync(path.join(home,'skills','cat','one','SKILL.md'),'x');
 await d.tick();assert.equal(gave>0,true);const g1=gave;await d.tick();await d.tick();assert.equal(gave,g1,'nothing moved: no copy');assert.deepEqual(notes.slice(1),['skip','skip']);
 mkdirSync(path.join(home,'skills','cat','two'));writeFileSync(path.join(home,'skills','cat','two','SKILL.md'),'y');await d.tick();assert.ok(gave>g1,'a skill added: copied at once');
 const g2=gave;await d.tick({force:true});assert.ok(gave>g2,'forced (the sweep)')});
