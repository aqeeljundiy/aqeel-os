// Account pools stay calm (12 Nov 2026: 229 moves in a day on the live box, 9 to 18 an hour): the numeric cases from the audit, the pin
// and the day's ceiling kept per agent, one check at a time, and a replayed day of usage for 4 accounts and 11 agents.
import test from 'node:test';import assert from 'node:assert/strict';
import {groupEntries,planGroups,planMove,stepAgent,pinState,afterMove,pinFromEvents,upGate,movesToday,dayKey,singleFlight,SETTLE,DAY_MAX,HYST} from '../app/account-pools.mjs';
import {simulate} from './account-sim.mjs';

const E=key=>({key,model:''}),LIST=[E('claude:main'),E('claude:a2'),E('claude:a3'),E('p:openai-codex')];
const M=(key,sess,week,agents=0)=>({key,used:sess===null?null:Math.max(sess,week),sess,week,agents});
const args=(readings,cur,o={})=>{const groups=planGroups(groupEntries(LIST)),by=Object.fromEntries(readings.map(m=>[m.key,m]));
 const state=e=>by[e.key]||{key:e.key,used:null,sess:null,week:null,agents:0};
 return {groups,at:groups.findIndex(g=>g.members.some(e=>e.key===cur)),cur,state,curState:state({key:cur}),th:95,backAt:80,idle:true,...o}};
const T0=Date.parse('2026-11-12T10:00:00');

test('audit case 1: 30% used with five others does not move to an empty account at 62%',()=>{
 assert.deepEqual(planMove(args([M('claude:main',30,10,6),M('claude:a2',62,10,0),M('claude:a3',99,99)],'claude:main')).cands,[])});
test('audit case 2: at the number, a member three points better is not worth a move; a clearly better one is',()=>{
 assert.deepEqual(planMove(args([M('claude:main',96,10,1),M('claude:a2',93,10),M('claude:a3',90,10),M('p:openai-codex',94,0)],'claude:main')).cands,[]);
 const c=planMove(args([M('claude:main',96,10,1),M('claude:a2',93,10),M('claude:a3',96-HYST,10)],'claude:main')).cands;assert.deepEqual(c.map(x=>x.entry.key),['claude:a3']);
 // a used-up account is left for anything under the number
 const u=planMove(args([M('claude:main',100,10,1),M('claude:a2',93,10),M('claude:a3',99,99)],'claude:main'));assert.equal(u.urgent,true);assert.deepEqual(u.cands.map(x=>x.entry.key),['claude:a2'])});
test('audit case 3: an account whose usage is unknown is never where a pool move goes',()=>{
 assert.deepEqual(planMove(args([M('claude:main',96,10,1),M('claude:a2',null,null),M('claude:a3',99,99),M('p:openai-codex',99,99)],'claude:main')).cands,[]);
 assert.deepEqual(planMove(args([M('claude:main',40,10,1),M('claude:a2',null,null)],'claude:main')).cands,[])});
test('between chats: the better member must have the free share, and a batch of idle agents does not all go',()=>{
 // 20 points better but its week is past "go back when it has 20% free": stay
 assert.deepEqual(planMove(args([M('claude:main',94,10,1),M('claude:a2',74,85)],'claude:main')).cands,[]);
 // six idle agents on one account, an empty one 20 points better: they stop going once it is as crowded
 const r=[M('claude:main',85,10,6),M('claude:a2',60,10,0),M('claude:a3',99,99)];let went=0;
 for(let i=0;i<6;i++){if(planMove(args(r,'claude:main')).cands.length){went++;r[0].agents--;r[1].agents++}}
 assert.equal(went,4);
 // an agent whose own account has plenty of room stays, however empty another is (an account whose 5-hour window just reset)
 assert.deepEqual(planMove(args([M('claude:main',60,10,3),M('claude:a2',0,10,0)],'claude:main')).cands,[]);
 // and none of those that went wants to come back
 assert.deepEqual(planMove(args(r,'claude:a2')).cands,[])});

test('after any move the agent is pinned for the settle time: no going up, no change of member, only a used-up account is left',()=>{
 const {pin,moved}=afterMove({now:T0});assert.equal(pin.until,T0+SETTLE);assert.deepEqual(moved,{day:dayKey(T0),n:1});
 const better=[M('claude:main',85,10,1),M('claude:a2',10,10)],at95=[M('claude:main',96,10,1),M('claude:a2',10,10)],full=[M('claude:main',100,10,1),M('claude:a2',10,10)];
 const soon=T0+SETTLE-1,later=T0+SETTLE;
 assert.deepEqual(stepAgent({plan:args(better,'claude:main'),pin,now:soon}).cands,[]);
 assert.deepEqual(stepAgent({plan:args(at95,'claude:main'),pin,now:soon}).cands,[]);
 assert.equal(stepAgent({plan:args(full,'claude:main'),pin,now:soon}).cands[0].entry.key,'claude:a2');
 assert.equal(stepAgent({plan:args(better,'claude:main'),pin,now:later}).cands[0].kind,'rebalance');
 assert.equal(stepAgent({plan:args(at95,'claude:main'),pin,now:later}).cands[0].kind,'pool');
 // going back up waits too
 const up=[M('claude:main',10,10),M('claude:a2',10,10),M('claude:a3',10,10),M('p:openai-codex',20,0,1)];
 assert.deepEqual(stepAgent({plan:args(up,'p:openai-codex'),pin,now:soon}).cands,[]);assert.equal(stepAgent({plan:args(up,'p:openai-codex'),pin,now:later}).cands[0].kind,'up')});

test('placed by hand: it stays (no going up, no change of member) until its account passes the number; not counted',()=>{
 const h=afterMove({hand:true,now:T0,moved:{day:dayKey(T0),n:2}});assert.deepEqual(h.pin,{hand:true,at:T0});assert.equal(h.moved.n,2);
 const week=T0+7*864e5;
 assert.deepEqual(stepAgent({plan:args([M('claude:main',85,10,1),M('claude:a2',10,10)],'claude:main'),pin:h.pin,now:week}).cands,[]);
 assert.equal(stepAgent({plan:args([M('claude:main',96,10,1),M('claude:a2',10,10)],'claude:main'),pin:h.pin,now:week}).cands[0].kind,'pool')});

test('pins are per agent and outlive the events of other agents; an agent with no pin yet gets it from its last event',()=>{
 // 60 moves of other agents later (the event list keeps 50) the pinned agent is still pinned: the pin is its own record
 const pins={a:afterMove({hand:true,now:T0}).pin};let events=[{t:T0,profile:'a',to:'claude:a2',why:'Chosen by hand'}];
 for(let i=0;i<60;i++){events=[{t:T0+i,profile:'b'+i,to:'claude:main',why:'Reached 96%'},...events].slice(0,50)}
 assert.equal(pinFromEvents(events,'a'),null);assert.equal(pinState(pins.a,T0+864e5).free,false);
 assert.deepEqual(pinFromEvents([{t:T0,profile:'a',why:'Chosen by hand'}],'a'),{hand:true,at:T0});
 assert.equal(pinFromEvents([{t:T0,profile:'a',why:'Reached 96%'}],'a').until,T0+SETTLE);
 // what is stored is plain JSON, so it is the same after a restart
 const back=JSON.parse(JSON.stringify(afterMove({now:T0})));assert.equal(pinState(back.pin,T0+60e3).settled,false)});

test('the ceiling: after DAY_MAX automatic moves in a day an agent is not moved again that day, even off a used-up account',()=>{
 let moved=null;for(let i=0;i<DAY_MAX;i++)moved=afterMove({moved,now:T0+i*SETTLE}).moved;assert.equal(moved.n,DAY_MAX);
 const full=args([M('claude:main',100,10,1),M('claude:a2',10,10)],'claude:main');
 assert.deepEqual(stepAgent({plan:full,moved,now:T0+7*3600e3}),{cands:[],capped:true,urgent:false});
 // the next day it counts from nothing; "told" (the one Health item) is kept for the day only
 const next=T0+864e5;assert.equal(movesToday(moved,next),0);assert.equal(stepAgent({plan:full,moved,now:next}).capped,false);
 assert.equal(afterMove({moved:{...moved,told:1},now:T0+8*3600e3}).moved.told,1);assert.equal(afterMove({moved:{...moved,told:1},now:next}).moved.told,undefined)});

test('going back up needs room on two checks minutes apart, not two calls',()=>{const seen=new Map();
 assert.equal(upGate(seen,'a','g:claude',T0),false);assert.equal(upGate(seen,'a','g:claude',T0+2000),false);
 assert.equal(upGate(seen,'a','g:claude',T0+5*60e3),true);
 assert.equal(upGate(seen,'a','g:other',T0+6*60e3),false);assert.equal(upGate(seen,'a',null,T0),false);assert.equal(seen.has('a'),false)});

test('one check at a time: overlapping calls share one run, and exactly one more follows',async()=>{let runs=0,open;const tickOver=()=>new Promise(r=>setImmediate(r));
 const tick=singleFlight(async()=>{runs++;await new Promise(r=>open=r)});
 const a=tick(),b=tick(),c=tick();assert.equal(a,b);assert.equal(b,c);assert.equal(runs,1);
 open();await a;await tickOver();assert.equal(runs,2,'a call during a run asks for exactly one more');
 open();await tickOver();await tickOver();assert.equal(runs,2);
 // a run that throws does not stop the next
 let n=0;const bad=singleFlight(async()=>{if(!n++)throw Error('x')});await assert.rejects(bad());await bad();assert.equal(n,2)});

/* ---------- a day replayed ---------- */
// the same rules accounts.mjs runs (stepAgent, afterMove, upGate), with the pin and count kept per agent
export function calmPolicy(){const pins={},moved={},seen=new Map();
 return ({profile,cur,groups,at,state,curState,idle,now,th,backAt})=>{
  const r=stepAgent({pin:pins[profile],moved:moved[profile],now,plan:{groups,at,cur,state,curState,th,backAt,idle,upConfirmed:id=>upGate(seen,profile,id,now)}});
  const to=r.cands[0]?.entry.key;if(!to)return null;const am=afterMove({moved:moved[profile],now});pins[profile]=am.pin;moved[profile]=am.moved;return to}}

test('a day of usage for 4 accounts and 11 agents: a handful of moves, nobody flaps, nobody is left on a used-up account',()=>{
 for(const seed of [1,2,3,4,5]){const r=simulate(calmPolicy(),{seed});
  assert.ok(r.count<=15,'seed '+seed+': '+r.count+' moves in the day');
  assert.ok(r.maxPerAgent<=3,'seed '+seed+': one agent moved '+r.maxPerAgent+' times');
  // no agent goes A → B → A within an hour and a half
  for(const m of r.moves){const back=r.moves.find(x=>x.profile===m.profile&&x.t>m.t&&x.to===m.from&&x.t-m.t<18);assert.equal(back,undefined,'seed '+seed+': '+m.profile+' went back within 90 minutes')}
  // calm does not mean stuck: an agent on a used-up account while another had room waits a check or two each time, no more
  assert.ok(r.fullTicks<=r.count*2+4,'seed '+seed+': '+r.fullTicks+' checks spent on a used-up account')}});

test('a heavy day (every account near its limit): bounded by the ceiling, never more than DAY_MAX per agent',()=>{
 for(const seed of [1,2,3]){const r=simulate(calmPolicy(),{seed,load:3,week0:[80,70,60,50]});
  assert.ok(r.maxPerAgent<=DAY_MAX,'seed '+seed+': '+r.maxPerAgent);assert.ok(r.count<=11*DAY_MAX,'seed '+seed+': '+r.count+' moves')}});
