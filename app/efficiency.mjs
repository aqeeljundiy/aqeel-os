// Efficiency (System › Health, 11 Nov 2026, owner: "make sure my usage is efficient"): where the model use goes, per agent and
// per kind of work, for the last 24 hours and 7 days, and plain flags for what drifts back. Read only: each agent's
// state.db `sessions` table (chats, schedules, subagents, fixer runs), DATA/claude-usage.json (Claude windows, written by
// accounts.mjs) and DATA/run-gates.json (how often a schedule's pre-check skipped a run; optional). The answer is kept a
// minute and read again behind, so the page never waits on a database.
import {readFile,readdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

// one agent's rows from the last argv[2] days, newest activity first:
// [id, source, title, model, started, last activity, api calls, input, output, cache read, cache write, cost, continued]
const PY=`import sqlite3,sys,json,time
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True,timeout=5)
since=time.time()-float(sys.argv[2])*86400
cols=[r[1] for r in c.execute('pragma table_info(sessions)')]
g=lambda n,d='0':n if n in cols else d
last='coalesce(%s,started_at,0)'%g('last_activity_at','started_at')
cont='(case when parent_session_id is not null and coalesce(source,"")<>"subagent" then 1 else 0 end)' if 'parent_session_id' in cols else '0'
q="select id,coalesce(source,''),coalesce(title,''),coalesce(model,''),coalesce(started_at,0),%s,coalesce(%s,0),coalesce(input_tokens,0),coalesce(output_tokens,0),coalesce(cache_read_tokens,0),coalesce(cache_write_tokens,0),coalesce(%s,0),%s from sessions where %s>=? order by 6 desc limit 40000"%(last,g('api_call_count'),g('estimated_cost_usd'),cont,last)
print(json.dumps([list(r) for r in c.execute(q,(since,))]))`;

// what a token costs by type, and a model's price class (a small one about a quarter of the usual, the biggest about five times)
export const WEIGHTS={input:1,cacheWrite:1.25,cacheRead:0.1,output:5};
export const BIG_CHAT=200000, LOW_CACHE=60;
export const classOf=m=>{const s=String(m||'').toLowerCase();return /haiku|mini|flash|nano|lite/.test(s)?.25:/opus|ultra/.test(s)?5:1};
export const weigh=r=>(r.input*WEIGHTS.input+r.cacheWrite*WEIGHTS.cacheWrite+r.cacheRead*WEIGHTS.cacheRead+r.output*WEIGHTS.output)*classOf(r.model);
export const reuse=o=>{const d=o.input+o.cacheRead+o.cacheWrite;return d?Math.round(o.cacheRead/d*100):null};
export const kindOf=s=>s==='cron'?'schedule':s==='subagent'?'subagent':s==='tool'?'fixer':s==='oneshot'?'oneshot':'chat';
export const KIND_LABEL={chat:'Chats',schedule:'Schedules',subagent:'Subagents',fixer:'Fixer runs',oneshot:'One-off runs'};
const rowOf=a=>({id:String(a[0]),source:a[1]||'',title:a[2],model:a[3],started:a[4],last:a[5],calls:a[6],input:a[7],output:a[8],cacheRead:a[9],cacheWrite:a[10],cost:a[11],continued:!!a[12]});
const total=r=>r.input+r.output+r.cacheRead+r.cacheWrite;
// how big a chat is: what each message sends the model (read tokens per call), not the sum over its whole life
export const size=r=>Math.round((r.input+r.cacheRead+r.cacheWrite)/Math.max(r.calls||0,1));
const blank=()=>({runs:0,input:0,output:0,cacheRead:0,cacheWrite:0,weight:0,cost:0});
const addTo=(o,r)=>{o.runs++;o.input+=r.input;o.output+=r.output;o.cacheRead+=r.cacheRead;o.cacheWrite+=r.cacheWrite;o.weight+=weigh(r);o.cost+=r.cost||0};
const cleanTitle=t=>String(t||'').replace(/\s·\s[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2}$/,'').replace(/^\s*\[[^\]]*\]\s*/,'').trim();
const jobIdOf=r=>(/^cron_([0-9a-f]+)_/.exec(r.id)||[])[1]||null;

// agents: [{agent, name, rows}]; jobs: {agent: {jobId: name}}. A schedule's run is "quiet" when it wrote 200 tokens or fewer.
export function summarize(agents,{jobs={},now=Date.now()}={}){const t=now/1000,W={h24:t-86400,d7:t-7*86400},out={},big=[];
 const jobName=(a,r)=>{const id=jobIdOf(r);return (id&&jobs[a]?.[id])||cleanTitle(r.title)||(id?'Schedule '+id.slice(0,6):'Schedule')};
 for(const [k,since] of Object.entries(W)){const ag=new Map(),all=blank();let folded=0;
  for(const {agent,name,rows} of agents){for(const r of rows){if(!(r.last>=since))continue;const kind=kindOf(r.source);
   const A=ag.get(agent)||{agent,name,...blank(),kinds:new Map(),folded:0};ag.set(agent,A);addTo(A,r);addTo(all,r);if(r.continued){A.folded++;folded++}
   const key=kind==='schedule'?'schedule|'+(jobIdOf(r)||jobName(agent,r)):kind;
   const K=A.kinds.get(key)||{kind,label:kind==='schedule'?jobName(agent,r):KIND_LABEL[kind],jobId:jobIdOf(r),...blank(),quiet:0};A.kinds.set(key,K);addTo(K,r);
   if(kind==='schedule'&&r.output<=200)K.quiet++;
   if(k==='d7'&&kind==='chat')big.push({agent,name,title:cleanTitle(r.title)||'Untitled chat',context:size(r),tokens:total(r),weight:weigh(r),source:r.source,at:r.last,model:r.model,calls:r.calls})}}
  out[k]={total:{runs:all.runs,weight:all.weight,cost:all.cost,reuse:reuse(all)},folded,agents:[...ag.values()].map(A=>({agent:A.agent,name:A.name,runs:A.runs,weight:A.weight,share:all.weight?A.weight/all.weight:0,reuse:reuse(A),cost:A.cost,folded:A.folded,
   kinds:[...A.kinds.values()].map(K=>({kind:K.kind,label:K.label,jobId:K.jobId,runs:K.runs,weight:K.weight,share:all.weight?K.weight/all.weight:0,reuse:reuse(K),quiet:K.quiet,tokens:K.input+K.output+K.cacheRead+K.cacheWrite})).sort((a,b)=>b.weight-a.weight)})).sort((a,b)=>b.weight-a.weight)}}
 big.sort((a,b)=>b.weight-a.weight);return {h24:out.h24,d7:out.d7,biggest:big.slice(0,8),bigCount:big.filter(b=>b.context>BIG_CHAT).length,bigList:big.filter(b=>b.context>BIG_CHAT).sort((a,b)=>b.context-a.context).slice(0,8)}}

// run-gates.json: how often a schedule's check skipped the run. Accepts {"<agent>/<job id or name>": {skips, runs}}, or the same
// under "jobs" or "schedules"; skips are runs that never reached the model.
export function gateOf(gates,agent,jobId,label){const m=gates&&(gates.jobs||gates.schedules||gates);if(!m||typeof m!=='object')return null;
 const v=[agent+'/'+jobId,agent+'/'+label,jobId,label].map(k=>k&&m[k]).find(x=>x&&typeof x==='object');if(!v)return null;
 return {skips:Number(v.skips??v.skipped)||0,runs:Number(v.runs??v.ran)||0}}

// plain sentences for what needs a look. level: 'warn' for use going to waste, 'note' for good news
export function flags(sum,{gates=null,accounts=[],now=Date.now()}={}){const f=[],d7=sum.d7;
 for(const b of sum.bigList||[])f.push({level:'warn',kind:'big',agent:b.agent,text:`${b.name}: the chat “${b.title}” has grown to about ${Math.round(b.context/1000)}k tokens. Every message in a long chat sends all of it again, so a new chat is cheaper.`});
 for(const A of d7.agents)for(const K of A.kinds){
  if(K.kind==='schedule'){const g=gateOf(gates,A.agent,K.jobId,K.label);
   if(g&&g.skips+g.runs>=5&&g.skips/(g.skips+g.runs)>=.5)f.push({level:'note',kind:'skips',agent:A.agent,text:`${A.name}: “${K.label}” found nothing to do in ${g.skips} of ${g.skips+g.runs} checks and was skipped before using the model. That is working.`});
   else if(!g&&K.runs>=6&&K.quiet/K.runs>=.7)f.push({level:'warn',kind:'quiet',agent:A.agent,text:`${A.name}: “${K.label}” ran ${K.runs} times this week and ${K.quiet} of them wrote almost nothing, so it mostly finds nothing to do. A check before it starts would save that model use.`})}
  if(K.reuse!=null&&K.reuse<LOW_CACHE&&K.tokens>=300000&&K.kind!=='subagent')f.push({level:'warn',kind:'cache',agent:A.agent,text:`${A.name}: ${K.kind==='schedule'?'“'+K.label+'” reuses':K.label.toLowerCase()+' reuse'} only ${K.reuse}% of what they read (under ${LOW_CACHE}%), so more of it is paid at full price.`})}
 const live=accounts.filter(a=>!a.dead&&a.windows.length),isFull=a=>a.windows.some(w=>w.used>=100&&!(w.resets&&Date.parse(w.resets)<now)),full=live.filter(isFull);
 for(const a of full){const others=live.filter(x=>!full.includes(x));const w=a.windows.find(w=>w.used>=100);
  if(others.length)f.push({level:'warn',kind:'account',text:`The Claude account ${a.name} is at 100% of its ${w.label} while ${others.length===1?'another account still takes':others.length+' other accounts still take'} work. Check that its agents moved to the others.`})}
 return f}

// DATA/claude-usage.json → [{id,name,dead,windows:[{label,used,resets}]}]
export async function readAccounts(file,nameOf=id=>id){let j;try{j=JSON.parse(await readFile(file,'utf8'))}catch{return []}
 const L={session:'5-hour limit',week:'weekly limit',opus:'weekly Opus limit',sonnet:'weekly Sonnet limit'};
 return Object.entries(j||{}).map(([id,v])=>{const u=v?.usage||{};return {id,name:nameOf(id),dead:!!v?.dead,windows:Object.entries(L).filter(([k])=>u[k]).map(([k,label])=>({label,used:u[k].used||0,resets:u[k].resets||null}))}})}

export function createEfficiency({HERMES_HOME,DATA,python,nameOf=a=>a,accountLabels=async()=>({}),readRows=null,savings=async()=>null,now=()=>Date.now(),timeout=25000}){
 let cache={at:0,v:null},flight=null;
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const run=readRows?async(py,db)=>(await readRows(py,db))?.map(rowOf)||null:((py,db)=>new Promise(res=>execFile(py,['-c',PY,db,'7'],{timeout,maxBuffer:6e7},(e,o)=>{try{res(e?null:JSON.parse(o).map(rowOf))}catch{res(null)}})));
 async function homes(){const out=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!d.name.startsWith('.'))out.push(d.name);return out}
 async function jobsOf(a){try{const j=JSON.parse(await readFile(path.join(home(a),'cron','jobs.json'),'utf8'));return Object.fromEntries((Array.isArray(j)?j:j.jobs||[]).map(x=>[x.id,cleanTitle(x.name)||x.id]))}catch{return {}}}
 async function build(){const py=await python().catch(()=>null);if(!py)return {error:'The engine’s Python was not found.',at:now()};
  const list=[],jobs={},failed=[];
  await Promise.all((await homes()).map(async a=>{const db=path.join(home(a),'state.db');if(!await stat(db).catch(()=>null))return;
   const rows=await run(py,db);if(!rows){failed.push(nameOf(a));return}
   // copies of an agent (default--whatsapp-2) are the same agent to a person
   const id=String(a).split('--')[0];const e=list.find(x=>x.agent===id);if(e)e.rows.push(...rows);else list.push({agent:id,name:nameOf(id),rows});
   Object.assign(jobs[id]??={},await jobsOf(a))}));
  const sum=summarize(list,{jobs,now:now()});
  let gates=null;try{gates=JSON.parse(await readFile(path.join(DATA,'run-gates.json'),'utf8'))}catch{}
  const labels=await accountLabels().catch(()=>({}));
  const accounts=await readAccounts(path.join(DATA,'claude-usage.json'),id=>labels[id]||(id==='main'?'Main account':id));
  const sv=await savings().catch(()=>null);
  if(gates)for(const w of [sum.h24,sum.d7])for(const A of w.agents)for(const K of A.kinds)if(K.kind==='schedule')K.gate=gateOf(gates,A.agent,K.jobId,K.label);
  return {at:now(),failed,...sum,proxyFolds:sv&&sv.state==='on'?sv.folds:null,gates:!!gates,flags:flags(sum,{gates,accounts,now:now()}),accounts:accounts.filter(a=>!a.dead&&a.windows.length).map(a=>({name:a.name,windows:a.windows}))}}
 // the last answer at once, read again behind once it is a minute old; only the very first read waits
 async function view({fresh=false}={}){
  if(cache.v&&now()-cache.at<60e3&&!fresh)return cache.v;
  if(!flight)flight=build().then(v=>{cache={at:now(),v}}).catch(e=>{console.warn('efficiency:',e.message)}).finally(()=>{flight=null});
  if(cache.v&&!fresh)return cache.v;await flight;return cache.v||{error:'Could not read the agents’ records.',at:now()}}
 return {view}}
