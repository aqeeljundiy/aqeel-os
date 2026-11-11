// Groups in the priority list (owner, 12 Nov 2026: "I have 4 Claude Max: I want to group those, and the priority to be the one
// that has the most session left on the 5-hour one first, then the weekly").
// The saved list stays flat ({key, model} entries, as backup-models.mjs reads it). On top of it, the entries of one provider
// form one group at the place of its first member, unless a person took an entry out (solo).
// A group set to "Most room first" is a pool: no order inside, an agent gets the member with the most room. Everything here is pure, so it is tested
// (scripts/account-pools.test.mjs); accounts.mjs gives it the readings and makes the moves.
export const SPREAD=10;   // points of room one agent already on a member costs it in the ranking, so agents spread out
export const HYST=15;     // points a member must be better by to pull an agent that is between chats

// which accounts belong together: every Claude subscription is one provider; another provider is its own
export const kindOf=key=>String(key).startsWith('claude:')?'claude':String(key);
export const entryId=e=>e.key+'|'+(e.model||'');

// flat list → groups in the person's order, one per provider (owner, 12 Nov 2026: "the same option for every provider"):
// {id, kind, mode, canRoom, pool, alone, members:[entry]}. A group of one is fine. An entry a person took out (solo) is a
// group of its own, where it stands.
// mode: 'room' (Most room first: no order inside, an agent gets the member with the most room) or 'order' (In my order: the
// members are used top to bottom, each like an entry of its own). modes: the person's choice per kind; readable(kind): usage
// can be read for that provider, else only 'order' is possible. pool: 'room' with two or more members.
export function groupEntries(priority,solo=[],{modes={},readable=()=>true}={}){const out=[],by=new Map(),alone=new Set(solo||[]);
 for(const e of priority||[]){const kind=kindOf(e.key);
  if(alone.has(entryId(e))){out.push({id:entryId(e),kind,mode:'order',canRoom:false,pool:false,alone:true,members:[e]});continue}
  let g=by.get(kind);if(!g){const canRoom=!!readable(kind);g={id:'g:'+kind,kind,mode:canRoom&&modes?.[kind]!=='order'?'room':'order',canRoom,pool:false,alone:false,members:[]};by.set(kind,g);out.push(g)}g.members.push(e)}
 for(const g of out)g.pool=g.mode==='room'&&g.members.length>1;
 return out}
// what planMove walks: a group used in the person's order is each member on its own, top to bottom (the old behaviour)
export const planGroups=groups=>groups.flatMap(g=>g.pool?[g]:g.members.map(e=>({...g,id:g.members.length>1?entryId(e):g.id,pool:false,members:[e]})));
export const flatten=groups=>groups.flatMap(g=>g.members);
// the saved shape: pool members next to each other (the first entry stays first), solo ids only for entries that exist
export function normalise(priority,solo=[]){const pr=flatten(groupEntries(priority,solo)),ids=new Set(pr.map(entryId));
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
   serves(entry) → that member can answer with the model the agent is set to: inside a pool only such members are picked
   (two accounts are interchangeable only on the same model); when none is left, the agent goes on to the next group
   kinds: up (back to a higher entry), pool (its member is past the number: another member), down (the pool or entry is
   used up: the next entry with room), rebalance (between chats, its own member is within HYST of the number and another has at least HYST points more real room) */
export function planMove({groups,at,cur,state,curState,th,backAt,on=true,back=true,mayGoUp=true,mayRebalance=true,upConfirmed=()=>true,idle=false,serves=()=>true,hyst=HYST,spread=SPREAD}){
 const mem=g=>g.members.map(e=>({...state(e),entry:e})),cands=[],g=at>=0?groups[at]:null;let upAt=-1;
 const same=g=>mem(g).filter(m=>m.key===cur||serves(m.entry));   // its own pool: the members on the agent's model
 if(at>0&&back&&mayGoUp){let hit=null;
  for(let i=0;i<at&&!hit;i++){// room for one more: the free share must still be there after counting the agents already on it (a batch does not all go back to one account)
   const r=rankMembers(mem(groups[i]),{lim:backAt,floor:th,spread}).filter(x=>!x.unknown&&x.score>=100-backAt);if(r.length)hit={i,r}}
  if(upConfirmed(hit?groups[hit.i].id:null)&&hit){upAt=hit.i;for(const x of hit.r)cands.push({entry:x.member.entry,kind:'up',why:'Back to a higher entry: it has '+(100-backAt)+'% free again'})}}
 const isPast=on&&known(curState)&&(curState.used>=th||!!g?.pool&&(curState.week??0)>=th);
 // urgent: its account is used up (it would refuse), so the settle time does not hold the agent there
 const urgent=isPast&&Math.max(curState.used,g?.pool?curState.week??0:0)>=FULL;
 if(isPast){const said=curState.used>=th?curState.used:curState.week;
  // where it goes must be worth the move (12 Nov 2026: on 96% an agent moved to a 93% member, and back): clearly more room
  // than where it is, by the limit that counts. Only a used-up account takes anything under the number. Unknown usage is never a target.
  const lim=urgent?th:Math.min(th,said-hyst+1);
  if(g?.pool)for(const x of rankMembers(same(g),{lim,floor:th,spread,self:cur,skip:cur}).filter(x=>!x.unknown))cands.push({entry:x.member.entry,kind:'pool',why:`Reached ${said}%: the account in its group with the most room`});
  groups.forEach((o,i)=>{if(i===at||i===upAt)return;for(const x of rankMembers(mem(o),{lim,floor:th,spread}).filter(x=>!x.unknown))cands.push({entry:x.member.entry,kind:'down',why:`Reached ${said}%`+(g?.pool?', and so did the rest of its group':'')})})}
 else if(on&&g?.pool&&idle&&mayRebalance&&known(curState)){const all=same(g),mine=all.find(m=>m.key===cur);
  // between chats: REAL room decides (12 Nov 2026: the ranking's spread points alone moved agents from a 30% account to a 62% one, 229
  // moves in a day). The other member must have the free share, and be HYST points of real room better after counting the agents
  // it has more than this one (so a batch of idle agents does not all land on it and then come back).
  // And only an agent whose own account is getting close to the number (within HYST of it) moves at all: one with plenty of room has
  // nothing to gain, and "more room over there" is always true of an account whose 5-hour window has just reset (the replayed day in
  // scripts/account-calm.test.mjs: every agent chased each reset, 60 moves a day, with nobody near a limit).
  if(mine&&known(mine)&&Math.max(mine.used,mine.week??0)>=th-hyst){const mineOthers=Math.max(0,(mine.agents||0)-1);
   const best=all.filter(m=>m.key!==cur&&known(m)&&!past(m,backAt,th)).map(m=>({m,score:roomOf(m)-spread*(m.agents||0),gain:roomOf(m)-roomOf(mine)-spread*Math.max(0,(m.agents||0)-mineOthers)}))
    .filter(x=>x.gain>=hyst).sort((a,b)=>b.score-a.score||(a.m.week??0)-(b.m.week??0))[0];
   if(best)cands.push({entry:best.m.entry,kind:'rebalance',why:`Between chats: ${Math.round(roomOf(best.m)-roomOf(mine))} points more room in its group`})}}
 return {cands,urgent}}

/* Calm by construction (12 Nov 2026: 9 to 18 moves an hour all day). What one agent may do in one check, with what is remembered
   about it in accounts.json: pin {at, until} after any move (SETTLE), {hand:true} when a person placed it (it stays until its
   account passes the number), and moved {day, n} (automatic moves today).
   - an agent on its settle time or placed by hand does not go up and does not change member between chats
   - during the settle time it leaves only an account that is used up (urgent)
   - DAY_MAX automatic moves per agent per day, then none (capped: the caller files one Health item) */
export const SETTLE=60*60e3,DAY_MAX=8,FULL=99;
export const dayKey=(now=Date.now())=>{const d=new Date(now);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
export const pinState=(pin,now=Date.now())=>{const hand=!!pin?.hand,settled=!pin||hand||now>=(pin.until||0);return {hand,settled,free:!hand&&settled}};
export const movesToday=(moved,now=Date.now())=>moved?.day===dayKey(now)?moved.n||0:0;
// the pin and the count after a move (by hand: no count, and the agent stays where the person put it)
export function afterMove({moved,hand=false,now=Date.now(),settle=SETTLE}={}){
 return hand?{pin:{hand:true,at:now},moved:moved||null}:{pin:{at:now,until:now+settle},moved:{day:dayKey(now),n:movesToday(moved,now)+1,...(moved?.day===dayKey(now)&&moved.told?{told:moved.told}:{})}}}
// the pin of an agent that has none yet, from the old event list (how it was kept before): its last move
export const pinFromEvents=(events,profile,settle=SETTLE)=>{const e=(events||[]).find(x=>x.profile===profile);return !e?null:e.why==='Chosen by hand'?{hand:true,at:e.t||0}:{at:e.t||0,until:(e.t||0)+settle}};
// one agent, one check: planMove under the pin and the daily ceiling. plan: planMove's arguments without mayGoUp/mayRebalance.
export function stepAgent({plan,pin=null,moved=null,now=Date.now(),max=DAY_MAX}){const ps=pinState(pin,now);
 if(movesToday(moved,now)>=max)return {cands:[],capped:true,urgent:false};
 const r=planMove({...plan,mayGoUp:ps.free,mayRebalance:ps.free,idle:!!plan.idle&&ps.free});
 return {cands:r.urgent||ps.settled?r.cands:r.cands.filter(c=>c.kind!=='pool'&&c.kind!=='down'),capped:false,urgent:r.urgent}}
// one run at a time: a call during a run gets that run's promise and asks for exactly one more after it
export function singleFlight(fn){let running=null,again=false;
 const go=()=>{if(running){again=true;return running}
  running=(async()=>{try{return await fn()}finally{running=null;if(again){again=false;Promise.resolve().then(go).catch(()=>{})}}})();return running};
 return go}
// "the same higher group had room on two checks at least `gap` apart": by time, not by calls (two saves in a row are not two checks)
export function upGate(seen,profile,id,now=Date.now(),gap=4*60e3){if(!id){seen.delete(profile);return false}const u=seen.get(profile);
 if(u?.k!==id){seen.set(profile,{k:id,t:now});return false}return now-u.t>=gap}

// moves in the last 24 hours from DATA/model-moves.jsonl lines ({at, profile, to, why}); see: which agents this person may see
export function moves24(lines,{now=Date.now(),see=()=>true}={}){let auto=0,hand=0;
 for(const l of lines||[]){if(!l)continue;let e;try{e=JSON.parse(l)}catch{continue}const t=Date.parse(e.at)||e.t||0;if(!(t>now-864e5&&t<=now)||!see(e.profile))continue;if(e.why==='Chosen by hand')hand++;else auto++}
 return {auto,hand}}
