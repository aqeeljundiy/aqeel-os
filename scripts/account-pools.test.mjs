// Pools in the priority list (app/account-pools.mjs): grouping and migration, ranking, the weekly floor, unknown usage,
// hysteresis, spread, a used-up pool going to the next entry, going back, and the 24-hour move count.
import test from 'node:test';import assert from 'node:assert/strict';
import {groupEntries,planGroups,flatten,normalise,rankMembers,nextPick,planMove,moves24,entryId,HYST,SPREAD} from '../app/account-pools.mjs';

const E=(key,model='')=>({key,model});
const M=(key,sess,week,agents=0,x={})=>({key,used:sess===null?null:Math.max(sess,week),sess,week,agents,...x});
const LIST=[E('claude:main'),E('claude:two'),E('p:openai-codex'),E('claude:three'),E('claude:four'),E('p:antigravity')];
// one agent's plan over LIST with these readings
const plan=(readings,cur,o={})=>{const groups=planGroups(groupEntries(o.priority||LIST,o.solo,o.group)),by=Object.fromEntries(readings.map(m=>[m.key,m]));
 const state=e=>by[e.key]||{key:e.key,used:null,sess:null,week:null,agents:0};
 return planMove({groups,at:groups.findIndex(g=>g.members.some(e=>e.key===cur)),cur,state,curState:state({key:cur}),th:95,backAt:75,...o}).cands};
const keys=c=>c.map(x=>x.entry.key);

test('migration: a fixed list becomes pools, the first entry stays first, the order between entries stays',()=>{
 const g=groupEntries(LIST);
 assert.deepEqual(g.map(x=>[x.pool,x.members.map(e=>e.key)]),[[true,['claude:main','claude:two','claude:three','claude:four']],[false,['p:openai-codex']],[false,['p:antigravity']]]);
 assert.equal(flatten(g)[0].key,LIST[0].key);
 // ChatGPT first stays first; the Claude pool sits where its first member was
 const g2=groupEntries([E('p:openai-codex'),E('claude:two'),E('p:antigravity'),E('claude:main')]);
 assert.deepEqual(g2.map(x=>x.members.map(e=>e.key)),[['p:openai-codex'],['claude:two','claude:main'],['p:antigravity']]);
 // one Claude account is a group of one, not a pool; one provider is one group whatever model its entries set
 assert.equal(groupEntries([E('claude:main'),E('p:x')])[0].pool,false);
 assert.deepEqual(groupEntries([E('claude:main'),E('claude:two'),E('claude:main','opus'),E('claude:two','opus')]).map(x=>[x.id,x.members.length]),[['g:claude',4]]);
 // normalising twice changes nothing, and nothing is lost
 const n=normalise(LIST,[]);assert.deepEqual(normalise(n.priority,n.solo),n);assert.equal(n.priority.length,LIST.length)});

test('an entry taken out of the pool is its own entry, and goes back in',()=>{
 const g=groupEntries(LIST,[entryId(E('claude:three'))]);
 assert.deepEqual(g.map(x=>x.members.map(e=>e.key)),[['claude:main','claude:two','claude:four'],['p:openai-codex'],['claude:three'],['p:antigravity']]);
 assert.equal(g[2].alone,true);assert.equal(g[1].alone,false);
 assert.deepEqual(normalise(LIST,['claude:gone|','claude:three|']).solo,['claude:three|']);
 assert.equal(groupEntries(LIST,[])[0].members.length,4)});

test('ranking: most 5-hour room first, the week breaks a tie',()=>{
 assert.deepEqual(rankMembers([M('a',60,10),M('b',20,80),M('c',40,5)],{lim:95}).map(x=>x.key),['b','c','a']);
 assert.equal(nextPick([M('a',0,70),M('b',0,30),M('c',0,50)],{lim:95}),'b')});

test('floor: a member whose week is at the number is never picked, however fresh its session',()=>{
 assert.equal(nextPick([M('a',0,95),M('b',80,40)],{lim:95}),'b');
 assert.equal(nextPick([M('a',0,96),M('b',97,10)],{lim:95}),null);
 // also when only the session counts (used = session): the week still blocks
 assert.equal(nextPick([{key:'a',used:0,sess:0,week:97,agents:0},{key:'b',used:50,sess:50,week:10,agents:0}],{lim:95}),'b');
 assert.equal(nextPick([M('a',0,0,0,{held:true}),M('b',90,90)],{lim:95}),'b')});

test('unknown usage ranks after every known member with room, and is the last resort',()=>{
 assert.deepEqual(rankMembers([M('u',null,null),M('a',90,90),M('b',10,10)],{lim:95}).map(x=>x.key),['b','a','u']);
 assert.equal(nextPick([M('u',null,null),M('a',99,99)],{lim:95}),'u')});

test('spread: agents already on a member count against it, so a batch does not land on one account',()=>{
 const mem=[M('a',0,0),M('b',0,0),M('c',0,0),M('d',0,0)],got=[];
 for(let i=0;i<8;i++){const k=nextPick(mem,{lim:95});got.push(k);mem.find(m=>m.key===k).agents++}
 assert.deepEqual(got,['a','b','c','d','a','b','c','d']);
 // a member with a little less room but nobody on it wins over a crowded one
 assert.equal(nextPick([M('a',10,0,2),M('b',10+SPREAD,0,0)],{lim:95}),'b')});

test('a running agent stays: a better member does not pull it while it is in a chat',()=>{
 assert.deepEqual(plan([M('claude:main',60,10,1),M('claude:two',0,0),M('claude:three',0,0),M('claude:four',0,0)],'claude:main',{idle:false}),[])});

test('hysteresis: between chats only a member at least 15 points better pulls an agent; two near the same level do not trade',()=>{
 const near=[M('claude:main',50,10,1),M('claude:two',50-(HYST-1),10),M('claude:three',99,99),M('claude:four',99,99)];
 assert.deepEqual(plan(near,'claude:main',{idle:true}),[]);
 const far=[M('claude:main',50,10,1),M('claude:two',50-HYST,10),M('claude:three',99,99),M('claude:four',99,99)];
 const c=plan(far,'claude:main',{idle:true});assert.deepEqual(keys(c),['claude:two']);assert.equal(c[0].kind,'rebalance');
 // after that move the other side is not 15 points better: it stays (no trading back)
 const after=[M('claude:main',50,10,0),M('claude:two',50-HYST,10,1),M('claude:three',99,99),M('claude:four',99,99)];
 assert.deepEqual(plan(after,'claude:two',{idle:true}),[]);
 // an agent placed by hand, one that just moved, or switching turned off: no rebalance
 assert.deepEqual(plan(far,'claude:main',{idle:true,mayRebalance:false}),[]);assert.deepEqual(plan(far,'claude:main',{idle:true,on:false}),[])});

test('its member crosses the number: the agent moves inside the pool first, to the member with the most room',()=>{
 const c=plan([M('claude:main',96,40,2),M('claude:two',70,20),M('claude:three',30,60),M('claude:four',30,20,3),M('p:openai-codex',20,20)],'claude:main');
 assert.equal(c[0].kind,'pool');assert.equal(c[0].entry.key,'claude:three');assert.match(c[0].why,/Reached 96%/);
 // the next entry is only a fallback after the pool's members
 assert.deepEqual(keys(c).slice(0,3).sort(),['claude:four','claude:three','claude:two']);assert.equal(c[3].kind,'down');
 // the week at the number moves it too, even with a fresh session
 assert.equal(plan([{key:'claude:main',used:10,sess:10,week:96,agents:1},M('claude:two',70,20),M('claude:three',99,99),M('claude:four',99,99)],'claude:main')[0].entry.key,'claude:two')});

test('every member past the number: the agent moves to the next entry in the list',()=>{
 const full=[M('claude:main',96,40,1),M('claude:two',97,20),M('claude:three',10,99),M('claude:four',100,100),M('p:openai-codex',20,20),M('p:antigravity',0,0)];
 const c=plan(full,'claude:main');assert.deepEqual(keys(c),['p:openai-codex','p:antigravity']);assert.equal(c[0].kind,'down');
 // nothing anywhere: no move at all
 assert.deepEqual(plan(full.map(m=>({...m,used:99,sess:99,week:99})),'claude:main'),[]);
 // unknown usage is never a reason to move
 assert.deepEqual(plan([M('claude:main',null,null,1),M('claude:two',0,0)],'claude:main',{idle:true}),[])});

test('go back: from a lower entry to the pool once any member has the free share again, to its best member',()=>{
 const r=[M('claude:main',90,40),M('claude:two',80,20),M('claude:three',99,99),M('claude:four',60,20),M('p:openai-codex',30,30,1)];
 const c=plan(r,'p:openai-codex');assert.equal(c[0].kind,'up');assert.equal(c[0].entry.key,'claude:four');
 // no member has 25% free: it stays
 assert.deepEqual(plan(r.map(m=>m.key==='claude:four'?M('claude:four',80,20):m),'p:openai-codex'),[]);
 // not before two checks in a row, not when going back is off, not for an agent placed by hand
 assert.deepEqual(plan(r,'p:openai-codex',{upConfirmed:()=>false}),[]);assert.deepEqual(plan(r,'p:openai-codex',{back:false}),[]);assert.deepEqual(plan(r,'p:openai-codex',{mayGoUp:false}),[]);
 // a member with a used-up week does not bring agents back, whatever its session says
 assert.deepEqual(plan([M('claude:main',0,96),M('claude:two',99,99),M('claude:three',99,99),M('claude:four',99,99),M('p:openai-codex',30,30,1)],'p:openai-codex'),[]);
 let asked;plan(r,'p:openai-codex',{upConfirmed:id=>{asked=id;return true}});assert.equal(asked,'g:claude')});

test('nothing moves by itself at deploy time: agents on different members with room all stay',()=>{
 const r=[M('claude:main',70,40,5),M('claude:two',10,20,1),M('claude:three',0,0),M('claude:four',0,0)];
 for(const k of ['claude:main','claude:two'])assert.deepEqual(plan(r,k,{idle:false}),[])});

test('moves in the last 24 hours are counted from the log, by hand apart',()=>{const now=Date.parse('2026-11-12T12:00:00Z');
 const l=[{at:'2026-11-12T11:00:00Z',profile:'a',to:'claude:two',why:'Reached 96%'},{at:'2026-11-12T01:00:00Z',profile:'b',to:'p:x',why:'Chosen by hand'},{at:'2026-11-11T11:00:00Z',profile:'a',to:'claude:main',why:'old'},{at:'2026-11-12T10:00:00Z',profile:'secret',to:'claude:main',why:'x'}].map(x=>JSON.stringify(x));
 assert.deepEqual(moves24([...l,'','not json'],{now}),{auto:2,hand:1});assert.deepEqual(moves24(l,{now,see:p=>p!=='secret'}),{auto:1,hand:1})});

/* ---------- every provider is a group, with one setting: Most room first or In my order ---------- */
test('every provider is a group, also a group of one; Most room first is the default where usage can be read',()=>{
 const g=groupEntries(LIST,[],{readable:k=>k!=='p:antigravity'});
 assert.deepEqual(g.map(x=>[x.id,x.mode,x.canRoom,x.pool,x.members.length]),[['g:claude','room',true,true,4],['g:p:openai-codex','room',true,false,1],['g:p:antigravity','order',false,false,1]]);
 // the person's choice per provider; a provider whose usage cannot be read is In my order whatever was saved
 const h=groupEntries(LIST,[],{modes:{claude:'order','p:antigravity':'room'},readable:k=>k!=='p:antigravity'});
 assert.deepEqual(h.map(x=>[x.mode,x.pool]),[['order',false],['room',false],['order',false]])});

test('In my order: the members are used top to bottom, like entries of their own (the old behaviour)',()=>{
 const group={modes:{claude:'order'}};
 assert.deepEqual(planGroups(groupEntries(LIST,[],group)).map(x=>[x.pool,x.members.map(e=>e.key)]),[[false,['claude:main']],[false,['claude:two']],[false,['claude:three']],[false,['claude:four']],[false,['p:openai-codex']],[false,['p:antigravity']]]);
 const r=[M('claude:main',96,40,1),M('claude:two',70,20,3),M('claude:three',10,10),M('claude:four',0,0)];
 // past the number: the next member down with room, not the one with the most room
 const c=plan(r,'claude:main',{group});assert.equal(c[0].kind,'down');assert.deepEqual(keys(c),['claude:two','claude:three','claude:four']);
 // between chats nothing pulls it to a member with more room
 assert.deepEqual(plan([M('claude:main',60,10),M('claude:two',70,20,1),M('claude:three',0,0),M('claude:four',0,0)],'claude:two',{group,idle:true,back:false}),[]);
 // and it goes back up to a higher member once that has the free share
 assert.equal(plan([M('claude:main',10,10),M('claude:two',70,20,1)],'claude:two',{group})[0].kind,'up')});

test('same model only: inside a pool an agent gets only members that can answer with its model, else it goes to the next group',()=>{
 const list=[E('claude:main'),E('claude:two','claude-opus'),E('claude:three','claude-haiku'),E('p:openai-codex')];
 const r=[M('claude:main',96,40,1),M('claude:two',10,10),M('claude:three',0,0),M('p:openai-codex',20,20)];
 // the agent is on Opus: the Haiku-only member is skipped although it has the most room
 const serves=model=>e=>!e.model||e.model===model;
 let c=plan(r,'claude:main',{priority:list,serves:serves('claude-opus')});assert.deepEqual(c.map(x=>[x.entry.key,x.kind]),[['claude:two','pool'],['p:openai-codex','down']]);
 // no member has its model: straight to the next group
 c=plan(r,'claude:main',{priority:list,serves:serves('claude-sonnet')});assert.deepEqual(c.map(x=>[x.entry.key,x.kind]),[['p:openai-codex','down']]);
 // between chats a member on another model does not pull it either
 assert.deepEqual(plan([M('claude:main',60,40,1),M('claude:two',55,10),M('claude:three',0,0)],'claude:main',{priority:list,idle:true,serves:serves('claude-opus')}),[])});
