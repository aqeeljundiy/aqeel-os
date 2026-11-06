// "Did the team have to go to the main agent?" (6 Nov 2026): per agent and week, how often a team member (team policy,
// DATA/team-policy.json) messaged the main agent about that agent instead of the agent itself handling it. Read from
// the main agent's chats (read only); a message counts for an agent when it names the agent or one of its aliases
// (policy teams[].aliases: {"<agent>": ["Randy", ...]}). Shown on System › Health so it can be watched going to zero.
import {execFile} from 'node:child_process';
import path from 'node:path';

const Q=`import sqlite3,sys,json,time
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
since=time.time()-float(sys.argv[2])*86400; ids=set(json.loads(sys.argv[3]))
out=[]
for ts,content,uid,src in c.execute("select m.timestamp,m.content,s.user_id,s.source from messages m join sessions s on s.id=m.session_id where m.role='user' and m.timestamp>? and coalesce(m.content,'')<>'' and s.source in ('telegram','whatsapp','slack','discord','signal')",(since,)):
  if str(uid) in ids or any(('['+i+']') in (content or '')[:40] for i in ids): out.append([ts,(content or '')[:1500]])
print(json.dumps(out))`;
// msgs: [[ts, text]]; aliases: {agent: [words]}; returns {agent: {weeks: {"2026-W45": n}, thisWeek, lastWeek}}
export function weekOf(ms){const d=new Date(ms);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()+3-(d.getUTCDay()+6)%7);const y=d.getUTCFullYear(),w1=new Date(Date.UTC(y,0,4));
 return y+'-W'+String(1+Math.round(((d-w1)/864e5-3+(w1.getUTCDay()+6)%7)/7)).padStart(2,'0')}
export function count(msgs,aliases,now=Date.now()){const out={},tw=weekOf(now),lw=weekOf(now-7*864e5);
 const res=Object.entries(aliases).map(([a,ws])=>[a,new RegExp('\\b('+[...new Set([a,...ws])].map(w=>String(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')\\b','i')]);
 for(const [a] of res)out[a]={weeks:{},thisWeek:0,lastWeek:0,examples:[]};
 for(const [ts,text] of msgs){const t=String(text).replace(/^\[Replying to:[\s\S]*?"\]\s*/,'');for(const [a,re] of res)if(re.test(t)){const w=weekOf(ts*1000),o=out[a];o.weeks[w]=(o.weeks[w]||0)+1;if(w===tw)o.thisWeek++;if(w===lw)o.lastWeek++;if(w===tw&&o.examples.length<3)o.examples.push(t.slice(0,140))}}
 return out}
export function createEscalations({HERMES_HOME,python,policy,mainAgent='default'}){let cache={at:0,v:null};
 async function view(){if(Date.now()-cache.at<5*60e3&&cache.v)return cache.v;const pol=await policy();const ids=[],aliases={};
  for(const t of pol.teams||[]){for(const m of t.members||[])ids.push(...[].concat(m.telegram||[],m.whatsapp||[]).map(String));for(const a of t.agents||[])aliases[a]=[].concat(t.aliases?.[a]||[])}
  if(!ids.length||!Object.keys(aliases).length)return {agents:{},note:'No team members in the team policy yet.'};
  const p=await python().catch(()=>null);if(!p)return {agents:{}};
  const db=mainAgent==='default'?path.join(HERMES_HOME,'state.db'):path.join(HERMES_HOME,'profiles',mainAgent,'state.db');
  const msgs=await new Promise(res=>execFile(p,['-c',Q,db,'35',JSON.stringify(ids)],{timeout:30000,maxBuffer:2e7},(e,o)=>{try{res(e?[]:JSON.parse(o))}catch{res([])}}));
  const v={agents:count(msgs,aliases),week:weekOf(Date.now())};cache={at:Date.now(),v};return v}
 return {view}}
