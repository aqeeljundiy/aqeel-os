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

const blank=()=>({calls:0,read:0,cached:0,written:0,est:0,an:{sys:0,tools:0,hist:0,toolres:0,last:0}});
function add(t,l){t.calls++;t.read+=(l.in||0)+(l.cw||0);t.cached+=l.cr||0;t.written+=l.out||0;if(l.est)t.est++;for(const k of PARTS)t.an[k]+=l.an?.[k]||0}
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
  return {days,agent:agent||null,...aggregate(ls,{info,acctOf,agentName,personName}),estimatedNote:'Google AI plan calls are estimated from the size of each request and answer: its tool reports no token counts.'}}
 return {report,lines}}

// the route (admins: every agent and person), wired in server.mjs with one line: GET /ui/usage/ledger?days=7[&agent=…]
export async function ledgerRoute(ledger,req,res,p,url,{admin,send}){if(p!=='/ui/usage/ledger')return false;
 if(!admin)return send(res,403,{error:'Only admins see usage for every agent and person.'}),true;
 try{return send(res,200,await ledger.report({days:url.searchParams.get('days'),agent:String(url.searchParams.get('agent')||'')})),true}catch(e){return send(res,500,{error:e.message}),true}}
