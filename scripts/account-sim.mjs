// A day of account use, replayed (scripts/account-calm.test.mjs): 4 Claude accounts in one "Most room first" group, one other provider below
// them, 11 agents, a usage reading every 5 minutes for 24 hours. Not a test file: the test and the before/after count both run it.
// The model: every agent has its own working hours and weight; what it uses lands on the account it is on; a 5-hour window resets on
// each account's own clock; the week only grows; a reading is what was true one check ago (Anthropic's numbers are minutes old), ±1.
// step({profile, cur, groups, at, state, curState, idle, now, th, backAt}) → the entry key to move to, or null. It is called once per agent
// per check, in order, and sees the agents-per-account count as it is after the moves made earlier in the same check.
import {groupEntries,planGroups} from '../app/account-pools.mjs';
export const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296};
export const ACCOUNTS=['claude:main','claude:a2','claude:a3','claude:a4'],OTHER='p:openai-codex';
export function simulate(step,{seed=1,ticks=288,every=5*60e3,start=Date.parse('2026-11-11T00:00:00'),th=90,backAt=80,load=1,agents=11,week0=[55,35,20,10]}={}){
 const R=rng(seed),list=[...ACCOUNTS,OTHER].map(key=>({key,model:''})),groups=planGroups(groupEntries(list));
 const names=Array.from({length:agents},(_,i)=>'agent'+(i+1));
 // weight: points of a 5-hour window one check of work costs; three heavy agents; from/len: the hours it works
 const ag=names.map((n,i)=>({name:n,on:ACCOUNTS[i%4],w:(i<3?1.6:0.5)*load,from:(i*2)%24,len:8+(i*5)%9}));
 const acc=Object.fromEntries(ACCOUNTS.map((k,i)=>[k,{sess:0,week:week0[i],reset:(i*75+60)*60e3}]));acc[OTHER]={sess:0,week:0,reset:0};
 let seen=JSON.parse(JSON.stringify(acc));const moves=[],stuck={};let fullTicks=0;
 const read=k=>{const a=seen[k],j=()=>Math.round(R()*2-1),sess=Math.min(100,Math.max(0,Math.round(a.sess)+j())),week=Math.min(100,Math.max(0,Math.round(a.week)+j()));
  return {key:k,sess,week,used:Math.max(sess,week)>=99?100:Math.max(sess,week)}};
 for(let t=0;t<ticks;t++){const now=start+t*every,hour=(t*every/3600e3)%24,readings=Object.fromEntries(Object.keys(acc).map(k=>[k,read(k)]));
  const working=a=>{const h=(hour-a.from+24)%24;return h<a.len&&R()<0.7};const busy=Object.fromEntries(ag.map(a=>[a.name,working(a)]));
  const onIt=new Map();for(const a of ag)onIt.set(a.on,(onIt.get(a.on)||0)+1);
  for(const a of ag){const state=e=>({...readings[e.key],agents:onIt.get(e.key)||0,held:false});
   const to=step({profile:a.name,cur:a.on,groups,at:groups.findIndex(g=>g.members.some(e=>e.key===a.on)),state,curState:state({key:a.on}),idle:!busy[a.name],now,th,backAt});
   if(to&&to!==a.on){moves.push({t,now,profile:a.name,from:a.on,to});onIt.set(a.on,onIt.get(a.on)-1);onIt.set(to,(onIt.get(to)||0)+1);a.on=to}}
  // what was true at this check is what the next check reads; then the work of these 5 minutes lands
  seen=JSON.parse(JSON.stringify(acc));
  for(const a of ag){if(!busy[a.name]||a.on===OTHER)continue;const x=acc[a.on];
   // a used-up account refuses: the work does not happen (counted when another account had room: calm must not mean left on a dead account)
   if(x.sess>=100||x.week>=100){if(ACCOUNTS.some(k=>seen[k].sess<th-20&&seen[k].week<th)){fullTicks++;stuck[a.name]=(stuck[a.name]||0)+1}continue}
   x.sess=Math.min(100,x.sess+a.w);x.week=Math.min(100,x.week+a.w/12)}
  for(const k of ACCOUNTS){const x=acc[k];if((t*every+x.reset)%(5*3600e3)<every)x.sess=0}}
 const per={};for(const m of moves)per[m.profile]=(per[m.profile]||0)+1;
 return {moves,count:moves.length,perAgent:per,maxPerAgent:Math.max(0,...Object.values(per)),fullTicks,stuck,where:Object.fromEntries(ag.map(a=>[a.name,a.on]))}}
