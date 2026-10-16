// Usage per person and per agent, added up from Hermes' chats (each chat knows its agent, model and tokens;
// aqeelOS knows who started it). Used by System › Usage and by per-person daily limits.
export function createUsage(DASH,TOKEN){
 const cache=new Map();   // agent → {t, list}
 async function chats(agent,since){
  const hit=cache.get(agent);if(hit&&Date.now()-hit.t<60000&&hit.since<=since)return hit.list.filter(s=>(s.started_at||0)>=since);
  const list=[];for(let off=0;off<5000;off+=100){
   const r=await fetch(`${DASH}/api/sessions?limit=100&offset=${off}&profile=${encodeURIComponent(agent)}`,{headers:{'x-hermes-session-token':TOKEN}}).then(r=>r.json()).catch(()=>null);
   const page=r?.sessions||[];list.push(...page);if(page.length<100||page.some(s=>(s.started_at||0)<since))break}
  cache.set(agent,{t:Date.now(),since,list});return list.filter(s=>(s.started_at||0)>=since)}
 const add=(o,s)=>{o.chats++;o.messages+=s.message_count||0;o.input+=s.input_tokens||0;o.output+=s.output_tokens||0;o.cache+=(s.cache_read_tokens||0)+(s.cache_write_tokens||0);o.cost+=Number(s.estimated_cost_usd||s.actual_cost_usd||0)};
 const blank=()=>({chats:0,messages:0,input:0,output:0,cache:0,cost:0});
 // ownerOf(sessionId) → person id
 async function breakdown(agents,days,ownerOf){const since=Date.now()/1000-days*86400;const byPerson={},byAgent={},byModel={};
  for(const a of agents)for(const s of await chats(a,since)){const p=ownerOf(s.id);add(byPerson[p]||=blank(),s);add(byAgent[a]||=blank(),s);add(byModel[s.model||'unknown']||=blank(),s)}
  return {days,byPerson,byAgent,byModel}}
 // tokens a person used since midnight (server time), across all agents
 async function today(agents,uid,ownerOf){const d=new Date();d.setHours(0,0,0,0);const since=d.getTime()/1000;let t=0,m=0;
  for(const a of agents)for(const s of await chats(a,since))if(ownerOf(s.id)===uid){t+=(s.input_tokens||0)+(s.output_tokens||0);m+=Math.ceil((s.message_count||0)/2)}
  return {tokens:t,messages:m}}
 return {breakdown,today,forget:()=>cache.clear()};
}
