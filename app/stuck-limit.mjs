// A sign-in that answers "rate limit" on every run for hours is account trouble too (AU-10, 20 Nov 2026). The route order and the
// auto-switch treat a rate limit as "wait, it passes" and never move the agent, which is right for a short one. On Elkiya the Fixer
// sat on a sign-in that answered "try again in about 570 s" on every run from 19 Nov 19:29 WIB for over 12 hours (16 runs, none got
// through) while 11 agents on another sign-in ran fine. Read from the engine's failed-turn log (aqeelos-dropped.jsonl, written by the
// engine fix aqeelos:turn-retry-once): an agent with RUNS or more rate-limited turns that never recovered, spread over SPAN or more,
// within WINDOW, and not one that recovered, is stuck; accounts.mjs then moves it to the signed-in account with the most room.
export const RUNS=4,SPAN=2*3600e3,WINDOW=4*3600e3;
// the log names the main agent "main" (its session key) or "default"
const nameOf=a=>a==='main'||!a?'default':String(a);
// sinceOf(agent): when it last moved (ms); turns before that were on the old sign-in and do not count
export function stuckAgents(text,now=Date.now(),sinceOf=()=>0){const by=new Map();
 for(const l of String(text||'').split('\n')){if(!l.trim())continue;let j;try{j=JSON.parse(l)}catch{continue}
  const t=Number(j.t)*1000,a=nameOf(j.agent);if(!(t>=now-WINDOW&&t<=now&&t>(sinceOf(a)||0)))continue;const x=by.get(a)||{hit:[],ok:0};
  if(j.recovered||j.reason!=='rate_limit')x.ok+=j.recovered?1:0;else x.hit.push(t);by.set(a,x)}
 const out=[];for(const [a,x] of by){if(x.ok||x.hit.length<RUNS)continue;if(Math.max(...x.hit)-Math.min(...x.hit)>=SPAN)out.push(a)}
 return out}
