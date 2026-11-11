// Pools in the priority list (owner, 12 Nov 2026: "I have 4 Claude Max: I want to group those, and the priority to be the one
// that has the most session left on the 5-hour one first, then the weekly").
// The saved list stays flat ({key, model} entries, as backup-models.mjs reads it). On top of it, entries of the same kind
// with the same model form one group (a pool) at the place of its first member, unless a person took an entry out (solo).
// Inside a pool there is no order: an agent gets the member with the most room. Everything here is pure, so it is tested
// (scripts/account-pools.test.mjs); accounts.mjs gives it the readings and makes the moves.
export const SPREAD=10;   // points of room one agent already on a member costs it in the ranking, so agents spread out
export const HYST=15;     // points a member must be better by to pull an agent that is between chats

// which accounts pool together: every Claude subscription is one kind; another provider has one sign-in, so it is its own kind
export const kindOf=key=>String(key).startsWith('claude:')?'claude':String(key);
export const entryId=e=>e.key+'|'+(e.model||'');
export const poolable=e=>kindOf(e.key)!==e.key;

// flat list → groups in the person's order: {id, kind, model, pool, alone, members:[entry]}. A pool needs two members.
export function groupEntries(priority,solo=[]){const out=[],by=new Map(),alone=new Set(solo||[]);
 for(const e of priority||[]){const kind=kindOf(e.key),model=e.model||'';
  if(!poolable(e)||alone.has(entryId(e))){out.push({id:entryId(e),kind,model,pool:false,alone:poolable(e),members:[e]});continue}
  let g=by.get(kind+'|'+model);if(!g){g={id:'pool:'+kind+'|'+model,kind,model,pool:true,alone:false,members:[]};by.set(kind+'|'+model,g);out.push(g)}g.members.push(e)}
 for(const g of out)if(g.pool&&g.members.length<2){g.pool=false;g.id=entryId(g.members[0])}
 return out}
export const flatten=groups=>groups.flatMap(g=>g.members);
// the saved shape: pool members next to each other (the first entry stays first), solo ids only for entries that exist
export function normalise(priority,solo=[]){const pr=flatten(groupEntries(priority,solo)),ids=new Set(pr.filter(poolable).map(entryId));
 return {priority:pr,solo:[...new Set(solo||[])].filter(id=>ids.has(id))}}

/* A member's reading: {key, used, sess, week, agents, held}
   used: percent used by the limit that counts (accounts.mjs usageOf), null = unknown
   sess / week: percent used of the 5-hour and the weekly window, null when not reported
   agents: how many agents are on it now; held: its provider is in an outage */
const known=m=>m.used!==null&&m.used!==undefined;
// no room: past the number by the limit that counts, or its week is (the floor: a fresh session never hides a used-up week)
export const past=(m,lim,floor=lim)=>!!m.held||known(m)&&(m.used>=lim||(m.week??0)>=floor);
const roomOf=m=>100-(m.sess??m.used);
// members that can take an agent, best first: most 5-hour room (less SPREAD per agent already there), then most weekly room,
// then fewer agents, then list order; members with unknown usage come after every known one.
// self: the asking agent's own member (it does not count against itself); skip: a member to leave out
export function rankMembers(members,{lim,floor=lim,spread=SPREAD,self=null,skip=null}={}){
 return (members||[]).map((m,i)=>({m,i,others:Math.max(0,(m.agents||0)-(m.key===self?1:0))})).filter(x=>x.m.key!==skip&&!past(x.m,lim,floor))
  .map(x=>({key:x.m.key,member:x.m,i:x.i,others:x.others,unknown:!known(x.m),score:known(x.m)?roomOf(x.m)-spread*x.others:null,weekFree:100-(x.m.week??x.m.used??0)}))
  .sort((a,b)=>a.unknown-b.unknown||(a.unknown?0:b.score-a.score||b.weekFree-a.weekFree)||a.others-b.others||a.i-b.i)}
export const nextPick=(members,o)=>rankMembers(members,o)[0]?.key||null;

/* What one agent should do now. Returns {cands:[{entry, kind, why}]}: try them in order, stop at the first that works.
   groups: groupEntries(); at: index of the agent's group (-1: not in the list); cur: its entry key
   state(entry) → that entry's reading for this agent; curState: the reading of the entry it is on
   th: "Switch at N% used"; backAt: 100 − "Go back when it has N% free"; on: switching is on; back: going back up is on
   mayGoUp / mayRebalance: false for an agent a person placed by hand or that moved less than 30 minutes ago
   upConfirmed(groupId|null) → true once the same higher group had room two checks in a row (called once when going up is allowed)
   idle: the agent is between chats (nothing running, quiet for a while), so a move costs no prompt cache
   kinds: up (back to a higher entry), pool (its member is past the number: another member), down (the pool or entry is
   used up: the next entry with room), rebalance (between chats, another member is at least HYST points better) */
export function planMove({groups,at,cur,state,curState,th,backAt,on=true,back=true,mayGoUp=true,mayRebalance=true,upConfirmed=()=>true,idle=false,hyst=HYST,spread=SPREAD}){
 const mem=g=>g.members.map(e=>({...state(e),entry:e})),cands=[],g=at>=0?groups[at]:null;let upAt=-1;
 if(at>0&&back&&mayGoUp){let hit=null;
  for(let i=0;i<at&&!hit;i++){const r=rankMembers(mem(groups[i]),{lim:backAt,floor:th,spread}).filter(x=>!x.unknown);if(r.length)hit={i,r}}
  if(upConfirmed(hit?groups[hit.i].id:null)&&hit){upAt=hit.i;for(const x of hit.r)cands.push({entry:x.member.entry,kind:'up',why:'Back to a higher entry: it has '+(100-backAt)+'% free again'})}}
 const isPast=on&&known(curState)&&(curState.used>=th||!!g?.pool&&(curState.week??0)>=th);
 if(isPast){const said=curState.used>=th?curState.used:curState.week;
  if(g?.pool)for(const x of rankMembers(mem(g),{lim:th,spread,self:cur,skip:cur}))cands.push({entry:x.member.entry,kind:'pool',why:`Reached ${said}%: the account in its group with the most room`});
  groups.forEach((o,i)=>{if(i===at||i===upAt)return;for(const x of rankMembers(mem(o),{lim:th,spread}).filter(x=>!x.unknown))cands.push({entry:x.member.entry,kind:'down',why:`Reached ${said}%`+(g?.pool?', and so did the rest of its group':'')})})}
 else if(on&&g?.pool&&idle&&mayRebalance&&known(curState)){const r=rankMembers(mem(g),{lim:th,spread,self:cur}),mine=r.find(x=>x.key===cur),best=r.find(x=>x.key!==cur&&!x.unknown);
  if(mine&&best&&best.score-mine.score>=hyst)cands.push({entry:best.member.entry,kind:'rebalance',why:`Between chats: ${Math.round(best.score-mine.score)} points more room in its group`})}
 return {cands}}

// moves in the last 24 hours from DATA/model-moves.jsonl lines ({at, profile, to, why}); see: which agents this person may see
export function moves24(lines,{now=Date.now(),see=()=>true}={}){let auto=0,hand=0;
 for(const l of lines||[]){if(!l)continue;let e;try{e=JSON.parse(l)}catch{continue}const t=Date.parse(e.at)||e.t||0;if(!(t>now-864e5&&t<=now)||!see(e.profile))continue;if(e.why==='Chosen by hand')hand++;else auto++}
 return {auto,hand}}
