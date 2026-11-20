// Usage across every AI provider, from the engine's usage ledger (aqeelos-live writes one line per AI call to
// <HERMES_HOME>/usage-ledger/<UTC day>.jsonl; owner, 20 Nov 2026: "tracking the usage is really important across any LLM").
// Five ways to look at the same calls: per agent, per person, per model, per provider and account, per schedule, and for one
// agent what its tokens are spent on (the anatomy of its requests: instructions, tool list, chat history, tool results,
// the newest message). A provider that reports no usage (Google's agy) is estimated in the engine and marked.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {homeOf} from './agentops.mjs';

const PROVIDER_NAME={'claude-subscription-directsdk-experimental':'Claude plan',anthropic:'Anthropic API','openai-codex':'ChatGPT plan','openai-api':'OpenAI API',
 'antigravity-subscription':'Google AI plan',gemini:'Gemini API',openrouter:'OpenRouter',xai:'xAI (Grok)',deepseek:'DeepSeek',nous:'Nous Portal'};
export const providerName=p=>PROVIDER_NAME[p]||(p?String(p).replace(/^custom:/,'').replace(/-/g,' '):'Unknown');
export const PARTS=['sys','tools','hist','toolres','last'];

const blank=()=>({calls:0,errors:0,read:0,cached:0,written:0,est:0,an:{sys:0,tools:0,hist:0,toolres:0,last:0}});
function add(t,l){if(l.err){t.errors=(t.errors||0)+1;return}   // a failed call (engine api_request_error): counted, no tokens
 t.calls++;t.read+=(l.in||0)+(l.cw||0);t.cached+=l.cr||0;t.written+=l.out||0;if(l.est)t.est++;for(const k of PARTS)t.an[k]+=l.an?.[k]||0}
const tokensOf=t=>t.read+t.cached+t.written;

// one call's schedule: a scheduled run's name (its session title), a chat, or background work (titles, compression)
export function placeOf(l,info){if(l.aux)return {key:'aux',name:'Background work ('+l.aux+')',kind:'aux'};
 const s=info?.(l.a,l.s)||{};if(l.p==='cron'||s.source==='cron'){const nm=String(s.title||'').replace(/\s·\s[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}$/,'').trim()||'A scheduled run';return {key:'cron:'+nm,name:nm,kind:'schedule'}}
 return {key:'chat:'+(l.p||'chat'),name:l.p&&l.p!=='api_server'?'Chats on '+l.p:'Chats in aqeelOS',kind:'chat'}}

// the pure part (tested): lines → the five views. info(agent,session) → {source,title,owner}; acctOf(line) → account label
export function aggregate(lines,{info=()=>null,acctOf=()=>'',agentName=a=>a,personName=p=>p}={}){
 const by={agent:{},person:{},model:{},provider:{},schedule:{}},total=blank(),days={};
 const put=(m,k,name,extra={})=>{const t=m[k]||={...blank(),name,...extra};return t};
 for(const l of lines){if(!l||!l.a)continue;add(total,l);const day=new Date((l.t||0)*1000).toISOString().slice(0,10);add(days[day]||=blank(),l);
  const s=info(l.a,l.s)||{},pl=placeOf(l,info),owner=pl.kind==='chat'?s.owner||'':'_work',acct=acctOf(l)||'';   // schedules and background work are the agent's own work, not a person's
  add(put(by.agent,l.a,agentName(l.a)),l);
  add(put(by.person,owner||'_unknown',owner==='_work'?'Scheduled and background work':owner?personName(owner):'Not linked to a person'),l);
  add(put(by.model,l.m||'unknown',l.m||'unknown',{provider:providerName(l.pv)}),l);
  add(put(by.provider,(l.pv||'')+'#'+acct,providerName(l.pv)+(acct?' · '+acct:''),{provider:providerName(l.pv),account:acct}),l);
  add(put(by.schedule,l.a+'|'+pl.key,pl.name,{agent:l.a,agentName:agentName(l.a),kind:pl.kind}),l)}
 const list=m=>Object.entries(m).map(([k,v])=>({key:k,...v,tokens:tokensOf(v)})).sort((a,b)=>b.tokens-a.tokens);
 return {total:{...total,tokens:tokensOf(total)},days:Object.entries(days).sort().map(([d,v])=>({day:d,...v,tokens:tokensOf(v)})),
  agent:list(by.agent),person:list(by.person),model:list(by.model),provider:list(by.provider),schedule:list(by.schedule)}}

export function createLedger({HERMES_HOME,users=null,agentName=a=>a,accounts=null,log=m=>console.log(m)}){
 // a scheduled or tool run is the agent's own work; a chat is the person's who started it
 const U=()=>typeof users==='function'?users():users;   // passed as a getter: the server creates its users after this
 const ownerOf=(id,x)=>x&&/^(cron|tool)$/.test(x.source)?'':U()?.ownerOf?.(id)||'',personName=id=>U()?.people?.().find(x=>x.id===id)?.name||id;
 const DIR=path.join(HERMES_HOME,'usage-ledger');
 async function lines(days){const since=Date.now()/1000-days*86400,first=new Date(since*1000).toISOString().slice(0,10),out=[];
  const files=(await readdir(DIR).catch(()=>[])).filter(f=>/^\d{4}-\d\d-\d\d\.jsonl$/.test(f)&&f.slice(0,10)>=first).sort();
  for(const f of files)for(const r of (await readFile(path.join(DIR,f),'utf8').catch(()=>'')).split('\n')){if(r[0]!=='{')continue;try{const l=JSON.parse(r);if(l.t>=since)out.push(l)}catch{}}
  return out}
 // session titles and sources from each agent's own state.db (read only), cached for a minute
 let sq=null;const sess=new Map(),seenAt=new Map();
 async function sessionsOf(a){if(Date.now()-(seenAt.get(a)||0)<60e3)return;seenAt.set(a,Date.now());
  try{sq||=(await import('node:sqlite')).DatabaseSync;const db=new sq(path.join(homeOf(a),'state.db'),{readOnly:true});
   try{for(const r of db.prepare("select id,source,title from sessions where started_at>strftime('%s','now')-91*86400").all())sess.set(a+'|'+r.id,{source:r.source,title:r.title})}finally{db.close()}}catch(e){log('ledger: sessions of '+a+': '+e.message)}}
 // which account: the one the provider plugin reported, else the agent's assigned Claude account or chosen pool account
 async function acctLookup(){const map={};try{const d=await accounts?.load?.();for(const a of accounts?.all?.(d)||[])map['claude:'+a.id]=a.label;map._assign=d?.assign||{}}catch{}return map}
 async function report({days=7,agent=''}={}){days=Math.min(91,Math.max(1,+days||7));let ls=await lines(days);if(agent)ls=ls.filter(l=>l.a===agent||String(l.a).startsWith(agent+'--'));
  for(const a of new Set(ls.map(l=>l.a)))await sessionsOf(a);const acc=await acctLookup();
  const info=(a,s)=>{const x=sess.get(a+'|'+s);return x?{...x,owner:ownerOf(s,x)||''}:{owner:ownerOf(s,null)||''}};
  const acctOf=l=>l.acct?(l.pv==='antigravity-subscription'?(l.acct==='main'?'first account':l.acct):l.acct):/claude-subscription/.test(l.pv||'')?(acc['claude:'+(acc._assign?.[l.a]||'main')]||''):'';
  return {days,agent:agent||null,budgets:await budgetStatus(HERMES_HOME).catch(()=>[]),...aggregate(ls,{info,acctOf,agentName,personName}),estimatedNote:'Google AI plan calls are estimated from the size of each request and answer: its tool reports no token counts.'}}
 return {report,lines,home:HERMES_HOME}}

// the route (admins: every agent and person), wired in server.mjs with one line: GET /ui/usage/ledger?days=7[&agent=…]
const body=req=>new Promise(r=>{let t='';req.on('data',d=>{t+=d;if(t.length>2048)req.destroy()});req.on('end',()=>r(t));req.on('error',()=>r(''))});
export async function ledgerRoute(ledger,req,res,p,url,{admin,send}){
 // PUT /ui/usage/budget {agent, tokens}: an agent's daily budget (0 takes it away)
 if(p==='/ui/usage/budget'&&req.method==='PUT'){if(!admin)return send(res,403,{error:'Only admins set budgets.'}),true;let b={};try{b=JSON.parse(await body(req))}catch{}
  const a=String(b.agent||'');if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(a))return send(res,400,{error:'Unknown agent.'}),true;
  try{const r=await setBudget(ledger.home,a,b.tokens);return send(res,200,{ok:true,budget:r.agents[a]||0}),true}catch(e){return send(res,409,{error:e.message}),true}}
 if(p!=='/ui/usage/ledger')return false;
 if(!admin)return send(res,403,{error:'Only admins see usage for every agent and person.'}),true;
 try{return send(res,200,await ledger.report({days:url.searchParams.get('days'),agent:String(url.searchParams.get('agent')||'')})),true}catch(e){return send(res,500,{error:e.message}),true}}

// ---- daily budgets per agent (owner, 20 Nov 2026): tokens a day, from the same ledger. Health warns at 80% and at 100%
// (design-guard.mjs lists them with the other cost items); nothing is ever stopped. Kept in usage-ledger/budgets.json.
const budgetFile=H=>path.join(H,'usage-ledger','budgets.json');
export async function readBudgets(H){try{const j=JSON.parse(await readFile(budgetFile(H),'utf8'));return j&&typeof j.agents==='object'?j:{agents:{}}}catch{return {agents:{}}}}
export async function setBudget(H,agent,tokens){const {writeStore}=await import('./store.mjs');const {mkdir}=await import('node:fs/promises');const b=await readBudgets(H);
 const n=Math.round(+tokens||0);if(n>0)b.agents[agent]=n;else delete b.agents[agent];await mkdir(path.dirname(budgetFile(H)),{recursive:true});await writeStore(budgetFile(H),JSON.stringify(b,null,1));return b}
// what each agent with a budget used since local midnight: [{agent, used, budget, pct}]
export async function budgetStatus(H){const b=await readBudgets(H),names=Object.keys(b.agents);if(!names.length)return [];
 const mid=new Date();mid.setHours(0,0,0,0);const since=mid.getTime()/1000,used={};
 for(const day of new Set([new Date(since*1000).toISOString().slice(0,10),new Date().toISOString().slice(0,10)]))
  for(const r of (await readFile(path.join(H,'usage-ledger',day+'.jsonl'),'utf8').catch(()=>'')).split('\n')){if(r[0]!=='{')continue;let l;try{l=JSON.parse(r)}catch{continue}
   if(l.t<since)continue;const a=String(l.a).split('--')[0];if(b.agents[a])used[a]=(used[a]||0)+(l.in||0)+(l.cr||0)+(l.cw||0)+(l.out||0)}
 return names.map(a=>({agent:a,used:used[a]||0,budget:b.agents[a],pct:Math.round((used[a]||0)/b.agents[a]*100)}))}

// per model, for one agent: calls that worked and calls that failed in the last `days` (the pickers warn about a model that keeps
// failing that agent's work, model-catalog.mjs; the model trials in accounts.mjs move an agent back off one)
// a failed call the model is to blame for (tool calls it got wrong, a request too long for it, a model it does not know) as against
// one the provider or the line is (quota, rate limits, sign-in, billing, overload, timeouts, network: the account auto-switch and
// the provider holds handle those). Only model faults count against a model in the pickers and the model trials.
const NOT_MODEL=/quota|rate.?limit|usage.?limit|too many requests|overload|capacity|timed? ?out|timeout|connect|network|socket|ECONN|EPIPE|unavailable|temporar|billing|credit|payment|sign.?in|log.?in|auth|token expired|forbidden|503|502|529/i;
export const modelFault=l=>!!l?.err&&![401,402,403,408,409,425,429,500,502,503,504,520,522,524,529].includes(Number(l.code))&&!l.retry&&!NOT_MODEL.test(String(l.err)+' '+String(l.msg||''));
// _p95: the size (tokens read) of this agent's larger requests, so a picker can say a model's context is too small for it
export async function modelStats(H,agent,{days=7,since=0}={}){const from=Math.max(since/1000||0,Date.now()/1000-days*86400),out={},sizes=[];
 for(let i=Math.ceil(days);i>=0;i--){const day=new Date(Date.now()-i*864e5).toISOString().slice(0,10);
  for(const r of (await readFile(path.join(H,'usage-ledger',day+'.jsonl'),'utf8').catch(()=>'')).split('\n')){if(r[0]!=='{')continue;let l;try{l=JSON.parse(r)}catch{continue}
   if(l.t<from||String(l.a).split('--')[0]!==agent)continue;const k=l.pv+'|'+l.m,x=out[k]||={calls:0,errors:0,outages:0,last:''};if(l.err){if(modelFault(l)){x.errors++;x.last=String(l.msg||l.err).slice(0,160)}else x.outages++}else{x.calls++;sizes.push((l.in||0)+(l.cr||0)+(l.cw||0))}}}
 sizes.sort((a,b)=>a-b);Object.defineProperty(out,'_p95',{value:sizes.length?sizes[Math.min(sizes.length-1,Math.floor(sizes.length*.95))]:0});
 return out}
