// The app's side of the operations rules (OPERATIONS.md, 11 Nov 2026):
//  - rule 3 (OPS-3): the root script (scripts/agent-users.sh) gives up on a screen or Chrome after 5 failures in an hour
//    and writes one line to ~/.aqeelos-agent-issues.jsonl; each new line is filed here as one issue for the fixer;
//  - rule 4 (OPS-5): the root script's janitor writes ~/.aqeelos-janitor.json every minute (expected and running screen
//    processes per agent); System shows it in one line, with each agent's memory;
//  - rule 7 (OPS-7): once a day, what is temporary expires after 30 days: fixer patches and work folders, deploy drift
//    saves, the app's *.bak-* copies and dated backup folders, ~/backups, broken Python environments the automations
//    guard set aside, the deploy's scripts and logs in /tmp; long logs in the engine's logs folder are cut to their end;
//    names in the test-agents list whose agent is gone (on two passes in a row) are taken off it.
//  - rule 2 (OPS-2, OPS-4): each agent's memory cap and sleep minutes go to ~/.aqeelos-agent-limits for the root script,
//    from hermes-ui-data/agent-limits.json ({"default":{"memory_cap_gb":4,"sleep_minutes":30},"agents":{"<agent>":{…}}});
//    an agent whose screen runs its own AdsPower never sleeps and gets 8 GB unless set. wake(agent) starts a sleeping
//    screen (the viewer uses it); stopAll(agent) stops everything the agent's user runs.
// The parts that only decide are exported and tested in scripts/box-ops.test.mjs.
import {readFile,writeFile,readdir,stat,lstat,rm,open,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

export const DAYS=30;
export const LOG_MAX=50e6,LOG_KEEP=5e6;

// new lines of the issues file since `offset` (a file cut shorter than the offset was trimmed: read it from the start)
export function newLines(text,offset=0){text=String(text||'');if(offset>text.length)offset=0;const end=text.lastIndexOf('\n')+1;
 if(end<=offset)return {items:[],offset};const items=[];for(const l of text.slice(offset,end).split('\n')){if(!l.trim())continue;try{const j=JSON.parse(l);if(j&&j.agent&&j.key)items.push(j)}catch{}}
 return {items,offset:end}}

// the janitor's file as one line; stale (the root script stopped) after 5 minutes
export function processesLine(j,now=Date.now()){if(!j||typeof j.expected!=='number')return {ok:false,text:'No count of agent processes yet.'};
 const age=now-j.at*1000;if(age>5*60e3)return {ok:false,stale:true,text:'The process count is '+Math.round(age/60e3)+' min old: the agent-users script may have stopped.'};
 const extra=Object.entries(j.agents||{}).filter(([,a])=>a.extra?.length).map(([n,a])=>n+' ('+a.extra.length+')');
 return {ok:j.running<=j.expected&&!extra.length,expected:j.expected,running:j.running,extra,text:j.expected+' expected, '+j.running+' running'+(extra.length?'; extra on '+extra.join(', ')+', removed within a minute':'')}}

// which entries are past their time: {name,mtimeMs}
export const expired=(entries,now=Date.now(),days=DAYS)=>entries.filter(e=>now-e.mtimeMs>days*864e5).map(e=>e.name);
// the app's own copies in its data folder: x.json.bak-…, backup-20261106-…
export const BAK=/(\.bak(-|$)|^backup-\d{8})/;
export const DEPLOY_TMP=/^(aq-deploy-[\w-]+\.(log|sh)|box-pack-[\w-]+\.sh)$/;

// the test-agents list without the names gone on this pass and the one before; comments and blank lines stay
export function pruneTests(text,exists,goneBefore=new Set()){const gone=new Set(),out=[];let removed=0;
 for(const l of String(text||'').split('\n')){const n=l.trim();if(!n||n.startsWith('#')){out.push(l);continue}
  if(exists(n)){out.push(l);continue}gone.add(n);if(goneBefore.has(n)){removed++;continue}out.push(l)}
 while(out.length&&out[out.length-1]==='')out.pop();return {text:out.join('\n')+(out.length?'\n':''),gone,removed}}

// one line per agent with its own user: "<agent> <cap MB> <sleep minutes>"
export const LIMIT_DEFAULTS={memory_cap_gb:4,sleep_minutes:30};
export function limitLines(agents,cfg={},keep=()=>false){const d={...LIMIT_DEFAULTS,...(cfg?.default||{})};
 return agents.filter(a=>NAME.test(a)).map(a=>{const o=cfg?.agents?.[a]||{},k=keep(a);
  const gb=Number(o.memory_cap_gb??(k?Math.max(8,Number(d.memory_cap_gb)||0):d.memory_cap_gb)),min=k?0:Number(o.sleep_minutes??d.sleep_minutes);
  return a+' '+Math.max(0,Math.round((gb||0)*1024))+' '+Math.max(0,Math.round(min||0))}).join('\n')+(agents.length?'\n':'')}
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export function createBoxOps({HOME,DATA,HERMES_HOME,fileIssue=null,TMP='/tmp',keepOn=()=>false,WAKE='/var/lib/aqeelos/wake'}){
 const STATE=path.join(DATA,'box-ops.json'),ISSUES=path.join(HOME,'.aqeelos-agent-issues.jsonl'),JAN=path.join(HOME,'.aqeelos-janitor.json');
 let st=null;const load=async()=>{if(!st)st=JSON.parse(await readFile(STATE,'utf8').catch(()=>'{}'))||{};st.filed||={};return st};
 const save=async()=>{await writeFile(STATE+'.tmp',JSON.stringify(st));await rename(STATE+'.tmp',STATE)};

 // rule 3: each new line is one issue (the same agent and kind again within a day is the same issue)
 async function intake(){await load();const text=await readFile(ISSUES,'utf8').catch(()=>null);if(text==null)return 0;
  const {items,offset}=newLines(text,st.offset||0);st.offset=offset;let n=0;
  for(const x of items){const k=x.agent+':'+x.key;if(st.filed[k]&&Date.now()-st.filed[k]<864e5)continue;st.filed[k]=Date.now();n++;
   const what='Agent '+x.agent+': '+x.what;console.log('box: '+what);
   if(fileIssue)await fileIssue({agent:NAME.test(x.agent)?x.agent:'default',affects:['aqeelos'],source:'health',healthKey:'box:'+k,what:'Agent screen given up on',missing:what.slice(0,400),evidence:what.slice(0,1800)}).catch(e=>console.warn('box: could not file '+k+': '+e.message))}
  await save();return n}

 async function janitor(){return processesLine(JSON.parse(await readFile(JAN,'utf8').catch(()=>'null')))}
 // each agent's memory: everything its own Linux user runs (ag-<agent>)
 const agentMemory=()=>new Promise(res=>execFile('ps',['-eo','user:32=,rss='],{maxBuffer:8e6},(e,o)=>{const m=new Map();
  for(const l of String(o||'').split('\n')){const x=/^(ag-\S+)\s+(\d+)/.exec(l.trim());if(x)m.set(x[1].slice(3),(m.get(x[1].slice(3))||0)+Number(x[2])*1024)}
  res([...m].map(([agent,bytes])=>({agent,bytes})).sort((a,b)=>b.bytes-a.bytes))}));

 // rule 7
 async function entries(dir,filter=()=>true){const out=[];for(const name of await readdir(dir).catch(()=>[])){if(!filter(name))continue;const s=await lstat(path.join(dir,name)).catch(()=>null);if(s)out.push({name,mtimeMs:s.mtimeMs})}return out}
 async function cutLog(f){const s=await stat(f).catch(()=>null);if(!s||s.size<=LOG_MAX)return false;const h=await open(f,'r+');
  try{const buf=Buffer.alloc(LOG_KEEP);const {bytesRead}=await h.read(buf,0,LOG_KEEP,s.size-LOG_KEEP);await h.truncate(0);await h.write(buf.subarray(0,bytesRead),0,bytesRead,0)}finally{await h.close()}return true}
 async function expire(now=Date.now()){const gone=[];const del=async(dir,names)=>{for(const n of names){await rm(path.join(dir,n),{recursive:true,force:true}).catch(()=>{});gone.push(path.join(dir,n))}};
  for(const d of ['fixer-patches','fixer-work','drift'])await del(path.join(DATA,d),expired(await entries(path.join(DATA,d)),now));
  await del(DATA,expired(await entries(DATA,n=>BAK.test(n)),now));
  await del(path.join(HOME,'backups'),expired(await entries(path.join(HOME,'backups')),now));
  await del(TMP,expired(await entries(TMP,n=>DEPLOY_TMP.test(n)),now));
  // broken Python environments (automation-guard.mjs keeps them as <name>.broken-<version>-<date>), one and two levels down
  for(const dir of [HERMES_HOME,...(await entries(HERMES_HOME)).map(e=>path.join(HERMES_HOME,e.name))])await del(dir,expired(await entries(dir,n=>/\.broken-/.test(n)),now));
  let cut=0;for(const e of await entries(path.join(HERMES_HOME,'logs'),n=>/\.log$/.test(n)&&n!=='agent.log'))if(await cutLog(path.join(HERMES_HOME,'logs',e.name)).catch(()=>false))cut++;
  // the test agents list
  await load();const LIST=path.join(HERMES_HOME,'.aqeelos-test-agents'),text=await readFile(LIST,'utf8').catch(()=>null);let removed=0;
  if(text!=null){const have=new Set((await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[])));
   const r=pruneTests(text,n=>have.has(n),new Set(st.testsGone||[]));st.testsGone=[...r.gone];removed=r.removed;if(r.removed)await writeFile(LIST,r.text)}
  st.expiredAt=now;await save();
  if(gone.length||cut||removed)console.log('box: expired '+gone.length+' old item(s)'+(cut?', cut '+cut+' long log(s)':'')+(removed?', '+removed+' gone test agent(s) off the list':''));
  return {gone,cut,removed}}

 // rule 2: limits for the root script (rewritten only when they change)
 async function writeLimits(){const agents=(await readFile(path.join(HOME,'.aqeelos-agent-users'),'utf8').catch(()=>'')).split('\n').map(x=>x.trim()).filter(Boolean);
  const cfg=JSON.parse(await readFile(path.join(DATA,'agent-limits.json'),'utf8').catch(()=>'{}')||'{}');
  const text=limitLines(agents,cfg,a=>{try{return !!keepOn(a)}catch{return false}}),f=path.join(HOME,'.aqeelos-agent-limits');
  if(text!==await readFile(f,'utf8').catch(()=>null)){await writeFile(f+'.tmp',text);await rename(f+'.tmp',f)}return text}
 const wake=async a=>{if(!NAME.test(a))return false;const f=path.join(WAKE,a+'.wake');await writeFile(f,'').catch(()=>{});return true};
 const stopAll=async a=>{if(!NAME.test(a))return false;await writeFile(path.join(HOME,'.aqeelos-agent-users.stop'),a+'\n',{flag:'a'});return true};
 async function tick(){await writeLimits().catch(e=>console.warn('box: limits',e.message));await intake().catch(e=>console.warn('box: issues',e.message));await load();
  if(!st.expiredAt||Date.now()-st.expiredAt>864e5)await expire().catch(e=>console.warn('box: expire',e.message))}
 function start(){setTimeout(()=>writeLimits().catch(()=>{}),10000).unref?.();setTimeout(()=>tick().catch(()=>{}),30000).unref?.();setInterval(()=>tick().catch(()=>{}),60000).unref?.()}
 return {intake,janitor,agentMemory,expire,tick,start,writeLimits,wake,stopAll}}
