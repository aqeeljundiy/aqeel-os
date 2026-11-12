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
//    from hermes-ui-data/agent-limits.json ({"default":{"memory_cap_gb":4,"sleep_minutes":15,"screen_mode":"lean"},"agents":{"<agent>":{…}}});
//    an agent whose screen runs its own AdsPower never sleeps and gets 8 GB unless set. wake(agent) starts a sleeping
//    screen (the viewer uses it). Until the AdsPower state is known (right after an app start) nothing is written: the last written
//    caps stay (13 Nov: a 4 GB cap written too early restarted the 8 GB agent's Chrome for nothing); wake(agent) starts a sleeping
//    screen (the viewer uses it); stopAll(agent) stops everything the agent's user runs.
//  - OPS-13: every minute, the agents mid-reply go to ~/.aqeelos-agent-busy, one per line, so the root script's janitor
//    does not start a missing desktop part again while the agent works. Since OPS-17 also the agents with an engine
//    session running (a schedule, a webhook, a channel reply): the root script restarts nothing of theirs then.
//  - OPS-18 (12 Nov 2026): every file in ~/uploads is readable by the agents (each runs as its own user and reaches the folder
//    through its access list; a file written mode 600 has an empty list mask: two issues on P&P): made so as files appear and
//    for every file already there when aqeelOS starts (the engine's own writer has the same fix in
//    engine/patches/2026-11-11-uploads-readable.patch). What aqeelOS itself left in /tmp (deploy files, test copies, restore
//    scratch) goes after 3 days, checked every 6 hours. The root script (scripts/agent-users.sh) gives each agent's user the
//    folder and stops leftover scratch servers.
// The parts that only decide are exported and tested in scripts/box-ops.test.mjs.
import {writeStore,readStore} from './store.mjs';
import {readFile,writeFile,readdir,stat,lstat,rm,open,rename,chmod,mkdir} from 'node:fs/promises';
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
// everything aqeelOS itself puts in /tmp (deploy scripts, logs and folders, the packed versions, commit lists, engine-update
// simulation, its tests' folders, restore scratch, the graph relay's and the page looks' scratch), nothing an agent or a person
// made. Removed when 3 days old (TMP_DAYS); aq-stage, the deploy checks' test copy, only while no check holds its lock.
export const TMP_DAYS=3;
export const TMP_OWN=/^(aq-deploy-[\w-]+(\.(log|sh))?|box-pack-[\w-]+\.sh|hui-check-[\w-]+\.tgz|(hui|code)-\d[\d-]*\.tgz|aq-commits-[\w-]+|aq-engsim([.-][\w-]+)*|aq-boxops-\w+|aq-users-\w+|aq-bklocal-\w+|aq-restore-\w+|aq-look-\w+|aqeelos-agy-\w+|aqeelos-restore-\d+(\.enc)?|aqeelos-(media-)?\d{4}-\d\d-\d\d-\d\d-\d\d(-[0-9a-f]{4})?(-\d+)?\.tar\.gz\.enc(\.err|\.skipped|\.oerr|\.tcode|\.excl|\.list|\.perr|\.idx)?)$/;
// which of /tmp's entries to remove: {name,mtimeMs}
export function tmpExpired(entries,now=Date.now(),{checking=false,days=TMP_DAYS}={}){
 return entries.filter(e=>(TMP_OWN.test(e.name)||e.name==='aq-stage'&&!checking)&&now-e.mtimeMs>days*864e5).map(e=>e.name)}
// OPS-16: the "My browser" check's workspace folders (~/workspaces/mb-xxxxx) that outlived their agent: older than a day, no profile, no Linux user
export const MB_NAME=/^mb-[0-9a-z]{5}$/;
export const mbLeftovers=(entries,{now=Date.now(),hasProfile=()=>false,hasUser=()=>false}={})=>entries.filter(e=>MB_NAME.test(e.name)&&now-e.mtimeMs>864e5&&!hasProfile(e.name)&&!hasUser(e.name)).map(e=>e.name);
export const REMOVED_DAYS=14;
// a file in ~/uploads that agents cannot read: not readable by its group (that is also the access list's mask) and by others.
// Mode only: the folder itself is closed to everyone but the owner and the agents named in its access list.
export const unreadable=mode=>(mode&0o044)!==0o044;

// the test-agents list without the names gone on this pass and the one before; comments and blank lines stay
export function pruneTests(text,exists,goneBefore=new Set()){const gone=new Set(),out=[];let removed=0;
 for(const l of String(text||'').split('\n')){const n=l.trim();if(!n||n.startsWith('#')){out.push(l);continue}
  if(exists(n)){out.push(l);continue}gone.add(n);if(goneBefore.has(n)){removed++;continue}out.push(l)}
 while(out.length&&out[out.length-1]==='')out.pop();return {text:out.join('\n')+(out.length?'\n':''),gone,removed}}

// one line per agent with its own user: "<agent> <cap MB> <sleep minutes>"
// OPS-19 (12 Nov 2026): sleep after 15 idle minutes (was 30); screen_mode lean (X server + one tiny window manager, the default)
// or desktop (the old XFCE desktop), per install and per agent in hermes-ui-data/agent-limits.json
export const LIMIT_DEFAULTS={memory_cap_gb:4,sleep_minutes:15,screen_mode:'lean'};
// keep(a): its AdsPower runs on the engine's screen (never sleeps, 8 GB). own(a): it has its own AdsPower on a screen of its own user (8 GB;
// it is kept awake by the root script, which sees the AdsPower process). An explicit memory_cap_gb in the file still wins.
export const AWAKE_WHY='stays awake: uses its own AdsPower profile';
// The rule (13 Nov 2026): waking an AdsPower profile is slow and signs its sessions out, so an agent that uses AdsPower is never put to
// sleep by the clock. Its screen defaults to the desktop with no sleep; only an explicit setting for that agent (agents.<name>.sleep_minutes
// or screen_mode in the file) changes either. The install-wide default does not count as explicit. The wake proxy still listens for it.
export function limitRule(a,cfg={},keep=()=>false,own=()=>false){const d={...LIMIT_DEFAULTS,...(cfg?.default||{})},o=cfg?.agents?.[a]||{},k=keep(a),w=own(a),big=k||w;
 const gb=Number(o.memory_cap_gb??(big?Math.max(8,Number(d.memory_cap_gb)||0):d.memory_cap_gb));
 const min=Math.max(0,Math.round((k?0:Number(o.sleep_minutes??(w?0:d.sleep_minutes)))||0)),mode=String(o.screen_mode??(w?'desktop':d.screen_mode))==='desktop'?'desktop':'lean';
 return {gb,min,mode,why:big&&min===0?AWAKE_WHY:''}}
export function limitLines(agents,cfg={},keep=()=>false,own=()=>false){
 return agents.filter(a=>NAME.test(a)).map(a=>{const r=limitRule(a,cfg,keep,own);return a+' '+Math.max(0,Math.round((r.gb||0)*1024))+' '+r.min+' '+r.mode}).join('\n')+(agents.length?'\n':'')}
// agent -> why its screen stays awake, for the Health view
export const awakeReasons=(agents,cfg={},keep=()=>false,own=()=>false)=>Object.fromEntries(agents.filter(a=>NAME.test(a)).map(a=>[a,limitRule(a,cfg,keep,own).why]).filter(([,w])=>w));

// The sleep and wake log (scripts/agent-users.sh writes one JSON line per event to <wake dir>/events.jsonl) as the Health line:
// "Screens: N awake, M asleep; wakes in the last 24 h: X, failed: Y, slowest: Z s". The janitor's file gives awake and asleep.
export function parseEvents(text){const out=[];for(const l of String(text||'').split('\n')){if(!l.trim())continue;try{const j=JSON.parse(l);if(j&&j.agent&&j.event&&Number.isFinite(j.at))out.push(j)}catch{}}return out}
export function screensLine(j,events,now=Date.now()){
 const ag=Object.entries(j?.agents||{});const asleep=ag.filter(([,a])=>a.asleep).length,awake=ag.length-asleep;
 const since=now/1000-86400,w=events.filter(e=>e.event==='wake'&&e.at>=since),failed=w.filter(e=>e.ok===false).length;
 const slow=w.filter(e=>e.ok!==false).reduce((m,e)=>Math.max(m,Number(e.ms)||0),0);
 const always=ag.filter(([,a])=>a.nosleep).map(([n])=>n),old=ag.filter(([,a])=>a.mode==='desktop'&&!a.asleep).length,fb=events.filter(e=>e.event==='fallback'&&e.at>=since).length;
 const text='Screens: '+awake+' awake, '+asleep+' asleep; wakes in the last 24 h: '+w.length+', failed: '+failed+', slowest: '+(Math.round(slow/100)/10)+' s'
  +(always.length?'. Kept always on after failed wakes: '+always.join(', '):'')+(fb?'. Fell back to the old desktop '+fb+' time'+(fb>1?'s':''):'');
 return {text,awake,asleep,wakes:w.length,failed,slowest:slow/1000,always,fallbacks:fb,oldDesktop:old,ok:!failed&&!always.length}}
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// the agents mid-reply, from live reply keys "<agent>|<chat>": one valid name per line
export const busyText=keys=>[...new Set([...keys].map(k=>String(k).split('|')[0]).filter(a=>NAME.test(a)))].sort().map(a=>a+'\n').join('');
export function createBoxOps({HOME,DATA,HERMES_HOME,fileIssue=null,TMP='/tmp',keepOn=()=>false,hasOwnAds=()=>false,keepKnown=()=>true,WAKE='/var/lib/aqeelos/wake',busyKeys=()=>[],engineBusy=async()=>[]}){
 const STATE=path.join(DATA,'box-ops.json'),ISSUES=path.join(HOME,'.aqeelos-agent-issues.jsonl'),JAN=path.join(HOME,'.aqeelos-janitor.json');
 let st=null;const load=async()=>{if(!st)st=await readStore(STATE,{},{replace:true})||{};st.filed||={};return st};
 const save=async()=>{await writeStore(STATE,JSON.stringify(st))};

 // rule 3: each new line is one issue (the same agent and kind again within a day is the same issue)
 async function intake(){await load();const text=await readFile(ISSUES,'utf8').catch(()=>null);if(text==null)return 0;
  const {items,offset}=newLines(text,st.offset||0);st.offset=offset;let n=0;
  for(const x of items){const k=x.agent+':'+x.key;if(st.filed[k]&&Date.now()-st.filed[k]<864e5)continue;st.filed[k]=Date.now();n++;
   const what='Agent '+x.agent+': '+x.what;console.log('box: '+what);
   if(fileIssue)await fileIssue({agent:NAME.test(x.agent)?x.agent:'default',affects:['aqeelos'],source:'health',healthKey:'box:'+k,what:x.title?String(x.title).slice(0,80):'Agent screen given up on',missing:what.slice(0,400),evidence:what.slice(0,1800)}).catch(e=>console.warn('box: could not file '+k+': '+e.message))}
  await save();return n}

 async function janitor(){return processesLine(JSON.parse(await readFile(JAN,'utf8').catch(()=>'null')))}
 // the sleep and wake line for System › Health (OPS-19)
 async function screens(now=Date.now()){const j=JSON.parse(await readFile(JAN,'utf8').catch(()=>'null'));if(!j||!j.agents)return null;
  return {...screensLine(j,parseEvents(await readFile(path.join(WAKE,'events.jsonl'),'utf8').catch(()=>'')),now),awake:await awake().catch(()=>({}))}}
 // each agent's memory: everything its own Linux user runs (ag-<agent>)
 const agentMemory=()=>new Promise(res=>execFile('ps',['-eo','user:32=,rss='],{maxBuffer:8e6},(e,o)=>{const m=new Map();
  for(const l of String(o||'').split('\n')){const x=/^(ag-\S+)\s+(\d+)/.exec(l.trim());if(x)m.set(x[1].slice(3),(m.get(x[1].slice(3))||0)+Number(x[2])*1024)}
  res([...m].map(([agent,bytes])=>({agent,bytes})).sort((a,b)=>b.bytes-a.bytes))}));

 // OPS-18: files in ~/uploads readable by the agents. A file written private (mkstemp: mode 600) has an empty access-list
 // mask, so even a user named on the folder cannot open it. Every file gets read for its group and others (the folder's own
 // mode and list say who comes in). One listing: runs every minute and at start.
 const UP=path.join(HOME,'uploads');
 async function uploadsReadable(){let n=0;for(const name of await readdir(UP).catch(()=>[])){const f=path.join(UP,name),s=await lstat(f).catch(()=>null);
   if(!s?.isFile()||!unreadable(s.mode))continue;try{await chmod(f,(s.mode&0o7777)|0o644);n++}catch(e){console.warn('box: uploads '+name+': '+e.message)}}
  if(n)console.log('box: made '+n+' upload(s) readable for the agents');return n}
 // rule 7
 async function entries(dir,filter=()=>true){const out=[];for(const name of await readdir(dir).catch(()=>[])){if(!filter(name))continue;const s=await lstat(path.join(dir,name)).catch(()=>null);if(s)out.push({name,mtimeMs:s.mtimeMs})}return out}
 async function cutLog(f){const s=await stat(f).catch(()=>null);if(!s||s.size<=LOG_MAX)return false;const h=await open(f,'r+');
  try{const buf=Buffer.alloc(LOG_KEEP);const {bytesRead}=await h.read(buf,0,LOG_KEEP,s.size-LOG_KEEP);await h.truncate(0);await h.write(buf.subarray(0,bytesRead),0,bytesRead,0)}finally{await h.close()}return true}
 // OPS-18: aqeelOS's own scratch in /tmp, after 3 days
 async function pruneTmp(now=Date.now()){const gone=[],checking=!!await stat(path.join(TMP,'aq-check.lock')).catch(()=>null);
  for(const n of tmpExpired(await entries(TMP,n=>TMP_OWN.test(n)||n==='aq-stage'),now,{checking})){await rm(path.join(TMP,n),{recursive:true,force:true}).catch(()=>{});gone.push(n)}
  await load();st.tmpAt=now;await save();if(gone.length)console.log('box: removed '+gone.length+' old scratch item(s) of its own from '+TMP);return gone}
 async function expire(now=Date.now()){const gone=[];const del=async(dir,names)=>{for(const n of names){await rm(path.join(dir,n),{recursive:true,force:true}).catch(()=>{});gone.push(path.join(dir,n))}};
  for(const d of ['fixer-patches','fixer-work','drift'])await del(path.join(DATA,d),expired(await entries(path.join(DATA,d)),now));
  await del(DATA,expired(await entries(DATA,n=>BAK.test(n)),now));
  await del(path.join(HOME,'backups'),expired(await entries(path.join(HOME,'backups')),now));
  for(const n of await pruneTmp(now))gone.push(path.join(TMP,n));
  // broken Python environments (automation-guard.mjs keeps them as <name>.broken-<version>-<date>), one and two levels down
  for(const dir of [HERMES_HOME,...(await entries(HERMES_HOME)).map(e=>path.join(HERMES_HOME,e.name))])await del(dir,expired(await entries(dir,n=>/\.broken-/.test(n)),now));
  let cut=0;for(const e of await entries(path.join(HERMES_HOME,'logs'),n=>/\.log$/.test(n)&&n!=='agent.log'))if(await cutLog(path.join(HERMES_HOME,'logs',e.name)).catch(()=>false))cut++;
  // OPS-16: leftover check workspaces move to ~/workspaces/.removed, which keeps them 14 days
  {const W=path.join(HOME,'workspaces'),R=path.join(W,'.removed');const users=new Set((await readFile(path.join(HOME,'.aqeelos-agent-users'),'utf8').catch(()=>'')).split(String.fromCharCode(10)).map(x=>x.trim()));
   const pw=await readFile('/etc/passwd','utf8').catch(()=>'');const hasUser=n=>users.has(n)||new RegExp('^ag-'+n+':','m').test(pw);
   const profiles=new Set(await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[]));
   const mine=mbLeftovers(await entries(W),{now,hasProfile:n=>profiles.has(n),hasUser});
   if(mine.length)await mkdir(R,{recursive:true});
   for(const n of mine){try{await rename(path.join(W,n),path.join(R,n+(await stat(path.join(R,n)).catch(()=>null)?'-'+now:'')));gone.push(path.join(W,n))}catch(e){console.warn('box: workspace '+n+': '+e.message)}}
   await del(R,expired(await entries(R),now,REMOVED_DAYS))}
  // the test agents list
  await load();const LIST=path.join(HERMES_HOME,'.aqeelos-test-agents'),text=await readFile(LIST,'utf8').catch(()=>null);let removed=0;
  if(text!=null){const have=new Set((await readdir(path.join(HERMES_HOME,'profiles')).catch(()=>[])));
   const r=pruneTests(text,n=>have.has(n),new Set(st.testsGone||[]));st.testsGone=[...r.gone];removed=r.removed;if(r.removed)await writeFile(LIST,r.text)}
  st.expiredAt=now;await save();
  if(gone.length||cut||removed)console.log('box: expired '+gone.length+' old item(s)'+(cut?', cut '+cut+' long log(s)':'')+(removed?', '+removed+' gone test agent(s) off the list':''));
  return {gone,cut,removed}}

 // rule 2: limits for the root script (rewritten only when they change)
 async function writeLimits(){if(!keepKnown())return null;const agents=(await readFile(path.join(HOME,'.aqeelos-agent-users'),'utf8').catch(()=>'')).split('\n').map(x=>x.trim()).filter(Boolean);
  const cfg=JSON.parse(await readFile(path.join(DATA,'agent-limits.json'),'utf8').catch(()=>'{}')||'{}');
  const text=limitLines(agents,cfg,a=>{try{return !!keepOn(a)}catch{return false}},a=>{try{return !!hasOwnAds(a)}catch{return false}}),f=path.join(HOME,'.aqeelos-agent-limits');
  if(text!==await readFile(f,'utf8').catch(()=>null)){await writeFile(f+'.tmp',text);await rename(f+'.tmp',f)}return text}
 async function awake(){const agents=(await readFile(path.join(HOME,'.aqeelos-agent-users'),'utf8').catch(()=>'')).split('\n').map(x=>x.trim()).filter(Boolean);
  const cfg=JSON.parse(await readFile(path.join(DATA,'agent-limits.json'),'utf8').catch(()=>'{}')||'{}');
  return awakeReasons(agents,cfg,a=>{try{return !!keepOn(a)}catch{return false}},a=>{try{return !!hasOwnAds(a)}catch{return false}})}
 const wake=async a=>{if(!NAME.test(a))return false;const f=path.join(WAKE,a+'.wake');await writeFile(f,'').catch(()=>{});return true};
 const stopAll=async a=>{if(!NAME.test(a))return false;await writeFile(path.join(HOME,'.aqeelos-agent-users.stop'),a+'\n',{flag:'a'});return true};
 // rewritten every minute even when unchanged: the root script ignores a file older than 3 minutes
 async function writeBusy(){const f=path.join(HOME,'.aqeelos-agent-busy');const eng=await engineBusy().catch(()=>[]);await writeFile(f+'.tmp',busyText([...busyKeys(),...eng]));await rename(f+'.tmp',f)}
 async function tick(){await uploadsReadable().catch(e=>console.warn('box: uploads',e.message));await writeBusy().catch(e=>console.warn('box: busy',e.message));await writeLimits().catch(e=>console.warn('box: limits',e.message));await intake().catch(e=>console.warn('box: issues',e.message));await load();
  if(!st.expiredAt||Date.now()-st.expiredAt>864e5)await expire().catch(e=>console.warn('box: expire',e.message));
  if(!st.tmpAt||Date.now()-st.tmpAt>6*36e5)await pruneTmp().catch(e=>console.warn('box: tmp',e.message))}
 function start(){uploadsReadable().catch(()=>{});setTimeout(()=>writeLimits().catch(()=>{}),10000).unref?.();setTimeout(()=>tick().catch(()=>{}),30000).unref?.();setInterval(()=>tick().catch(()=>{}),60000).unref?.()}
 return {intake,janitor,screens,agentMemory,expire,pruneTmp,uploadsReadable,tick,start,writeLimits,awake,writeBusy,wake,stopAll}}
