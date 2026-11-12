// Agent health (brief items 7 and 15, 5 Nov 2026). One place shows each agent's health (System › Health). Since 7 Nov
// 2026 it messages nobody: a new problem is filed as an issue for the fixer (issues.mjs), see tick() below.
//
// It adds no list of its own: the problems are the items Bottlenecks shows (a schedule that failed, a channel that
// logged out, a sign-in that is due, an agent's report…), grouped per agent. This module adds the checks nobody made
// before, each saved as a Bottlenecks event with the agent's name, so it has a fix button there too and goes away by
// itself once it works again:
//   - stopped: an agent's schedules stopped running (its scheduler's heartbeat, cron/ticker_last_success, is old) or one
//     schedule is long past its time;
//   - group: a Telegram bot was removed from a group it works in (asked from Telegram: getChatMember);
//   - twice: the same script of an agent runs two or more times at once (a loop started again by a keep-alive while
//     the old one still ran, so everything it does happens twice);
//   - skill: one of an agent's skills points to a file that is not there (skill-check.mjs), checked hourly;
//   - dropped: messages to an agent keep failing (the engine notes every failed chat turn in
//     ~/.hermes/logs/aqeelos-dropped.jsonl, see scripts/engine-fixes-patch.mjs aqeelos:turn-retry-once).
// Other features report their own checks with problem()/ok(): Kirimdev a handoff that was not confirmed delivered,
// Threads a comment that is not visible after posting.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,readdir,readlink,open,stat} from 'node:fs/promises';
import {cpus} from 'node:os';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {checkSkills} from './skill-check.mjs';
import {personNeed} from './bottlenecks.mjs';

const H=3600e3,DAY=24*H;
// one skill problem, whichever agent's copy: the skill's own name plus the missing files
export const skillKey=x=>String(x.skill).split('/').slice(-1)[0]+'|'+[...x.missing].sort().join(',');
// a health problem's alert key: the same problem keeps one key while it lasts (a schedule failing again, a channel
// dropping again on a new time is the same problem), so the owner hears about it once until it is fixed
export function alertKey(x){const id=String(x.id||'');
 if(id.startsWith('sched|'))return id.split('|').slice(0,3).join('|');
 if(id.startsWith('channel|'))return id.split('|').slice(0,3).join('|');
 if(id.startsWith('account|'))return id.split('|').slice(0,2).join('|');
 if(id.startsWith('event|'))return x.topic?'topic|'+x.topic:'event|'+x.kind+'|'+x.title;
 return id}
// what counts as an agent breaking: not an expired invite or a help ticket, and not what was already sent to the
// owner by the part that found it (a run an agent started itself, a tool-server fix that failed)
export const alertable=x=>!['invite','ticket','access'].includes(x.kind)&&!x.told&&!x.info;
// what goes into the ladder (agent first, then the fixer): every alertable problem except what only a person can do
// (it waits on the Bottlenecks popup with what to do, 7 Nov 2026) and an agent's system report (report_bottleneck with
// system true is filed as an issue at once, server.mjs). A bot removed from a group still goes in: the fixer checks it
// against the agent's real groups and, when it is real, sends the one message to the right person.
export const forLadder=x=>alertable(x)&&!['system','alerts'].includes(x.kind)&&(x.kind==='group'||!personNeed(x));

// the engine's failed-turn lines → per agent: failed turns in the window, how many were sent again by themselves and
// worked, the most common cause, and the failures in the last hour that nobody recovered
export function dropStats(text,{now=Date.now(),days=7}={}){const since=now-days*DAY,out={};
 for(const l of String(text||'').split('\n')){if(!l.trim())continue;let x;try{x=JSON.parse(l)}catch{continue}const t=Number(x.t)*1000;if(!(t>=since))continue;
  const a=String(x.agent||'default'),s=out[a]||={n:0,recovered:0,failed:0,lastHour:0,reasons:{},last:0};s.n++;if(x.recovered)s.recovered++;else{s.failed++;if(now-t<H)s.lastHour++}
  if(!x.recovered){const r=String(x.reason||'unknown');s.reasons[r]=(s.reasons[r]||0)+1}s.last=Math.max(s.last,t)}
 for(const s of Object.values(out))s.top=Object.entries(s.reasons).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;return out}
export const REASON={rate_limit:'the AI model was busy',upstream_rate_limit:'the AI model was busy',overloaded:'the AI model was busy',server_error:'the AI model did not answer',
 timeout:'the AI model did not answer in time',gateway_connection:'the connection to the AI model broke',empty_response:'the AI model sent an empty answer',
 auth:'the AI account needs signing in again',auth_permanent:'the AI account needs signing in again',billing:'the AI account is out of credit',
 context_overflow:'the chat grew too long',interpreter_shutdown:'the system restarted mid-reply',loop_error:'something went wrong while answering',unknown:'the cause was not recorded'};
export const reasonText=r=>REASON[r]||String(r||'unknown').replace(/_/g,' ');
// three or more failed messages to one agent in an hour that the retry could not save: someone should look
export function dropProblem(agent,s){if(!s||s.lastHour<3)return null;
 return {topic:'health|'+agent+'|dropped',text:'Messages to this agent keep failing',detail:s.lastHour+' failed in the last hour, mostly because '+reasonText(s.top)+'. The people who sent them were told to send them again.'}}
// an agent's scheduler stopped (its heartbeat is over 15 minutes old while the engine runs), or a schedule is over an
// hour past its time
export function scheduleProblems(agent,{ticker,jobs=[]},{now=Date.now(),engineUp=true}={}){const out=[];if(!engineUp)return out;
 if(ticker&&now-ticker*1000>15*60e3)out.push({topic:'health|'+agent+'|scheduler',text:'Schedules stopped running',detail:'The last check for due schedules was '+Math.round((now-ticker*1000)/60e3)+' minutes ago. Restart the agents on Health if it stays like this.'});
 else for(const j of jobs){if(j.enabled===false||j.state&&j.state!=='scheduled'||!j.next_run_at)continue;const due=Date.parse(j.next_run_at);
  if(due&&now-due>H)out.push({topic:'health|'+agent+'|late|'+j.id,text:'A schedule did not run: '+(j.name||String(j.prompt||'').slice(0,60)||'a schedule'),detail:'It was due '+Math.round((now-due)/60e3)+' minutes ago and has not started.'})}
 return out}
// the same long-running script of one agent running more than once. rows: [{pid,ppid,user,args,cwd,age}] (ps). Only
// scripts (sh/py/mjs/js run by bash/sh/python/node) up over 2 minutes; a copy started by another copy (a subshell) is
// the same run. agentOf(row) names the agent or null (not an agent's).
const SCRIPT=/^(?:\S*\/)?(?:bash|sh|python3?(?:\.\d+)?|node)\s+(?:-\S+\s+)*(\S+\.(?:sh|py|mjs|js))(?:\s|$)/;
export function duplicateProcesses(rows,agentOf){const byPid=new Map(rows.map(r=>[String(r.pid),r])),key=r=>{const m=SCRIPT.exec(String(r.args||'').trim());if(!m)return null;
  const f=m[1].startsWith('/')?m[1]:path.join(r.cwd||'?',m[1]);return r.user+'|'+f+'|'+(r.cwd||'')+'|'+String(r.args).trim().split(/\s+/).slice(2).join(' ')};   // same user, script, folder and arguments
 const groups=new Map();for(const r of rows){if(!(Number(r.age)>120))continue;const k=key(r);if(!k)continue;const par=byPid.get(String(r.ppid));if(par&&key(par)===k)continue;
  const a=agentOf(r);if(!a)continue;(groups.get(k)||groups.set(k,{agent:a,script:k.split('|')[1],pids:[]}).get(k)).pids.push(Number(r.pid))}
 return [...groups.values()].filter(g=>g.pids.length>1).map(g=>({agent:g.agent,topic:'health|'+g.agent+'|twice|'+path.basename(g.script),
  text:path.basename(g.script)+' runs '+g.pids.length+' times at once',detail:'Everything it does happens '+g.pids.length+' times. Processes '+g.pids.join(', ')+' ('+g.script+'). Stop all but one (kill the extra process IDs), and make whatever starts it check that it is not running already.'}))}
// Telegram's answer about the bot in a group → a problem when the bot is no longer in it
// 7 Nov 2026: only groups the agent is set up for count (its team group in team-groups.json, or a group id in its
// config.yaml or .env). Groups it merely chatted in once (state.db) are history: a bot gone from those is not a problem
// (Continue - Socials and Longevity - Support Agents were flagged that way, and neither was in the agent's settings).
export function configuredGroups(agent,{teamGroups={},texts=[]}={}){const out=new Set();const g=(teamGroups.groups||teamGroups)[agent];
 if(g?.chatId!=null)out.add(String(g.chatId));
 // comments are examples, not settings (7 Nov 2026: the engine config's commented "allowed_chats: [-1001234567890]")
 for(const t of texts.map(x=>String(x||'').split('\n').filter(l=>!/^\s*#/.test(l)).join('\n')))for(const m of String(t).matchAll(/(?<![\w-])(-100\d{6,}|-\d{9,12})(?!\d)/g))if(!/1234567890$/.test(m[1]))out.add(m[1]);return out}
export function memberProblem(agent,chat,ans){const d=String(ans?.description||'').toLowerCase(),st=ans?.result?.status;
 const gone=ans&&(ans.ok===false&&/kicked|not a member|chat not found|bot was blocked|have no rights|chat_write_forbidden|group chat was upgraded/.test(d)||st==='left'||st==='kicked');
 if(!gone)return null;const name=chat.title||chat.id;
 return {topic:'health|'+agent+'|group|'+chat.id,text:'Removed from the Telegram group '+name,detail:'Telegram says: '+(ans.description||'the bot is '+st)+'. Add the bot to the group again, or remove the group from this agent if it is no longer used.'}}
// which problems to tell the owner now: new ones seen on two checks in a row (a channel that drops for a minute and
// comes back is not news); a problem that went away is forgotten, so it is told again if it comes back
// quiet(x) → 'test' (never told, not even later) | 'hold' (logged instead, see alert-quiet.mjs) | null. A problem that was
// told and then went away is returned in `fixed`, so the owner gets one short "fixed" line; a muted one is not.
export function alertPlan(state,items,now=Date.now(),{quiet=()=>null}={}){const told={...(state.told||{})},seen={...(state.seen||{})},about={...(state.about||{})},muted={...(state.muted||{})},cur=new Set(),send=[],logged=[],fixed=[];
 for(const x of items.filter(alertable)){const q=quiet(x.agent||null);if(q==='test')continue;const k=alertKey(x);if(cur.has(k))continue;cur.add(k);if(told[k])continue;
  if(!seen[k]){seen[k]=now;continue}if(now-seen[k]<3*60e3)continue;told[k]=now;
  if(q){muted[k]=1;logged.push(x)}else{about[k]={agent:x.agent||null,title:String(x.title||'').slice(0,160)};send.push(x)}}
 for(const k of Object.keys(told))if(!cur.has(k)){if(about[k]&&!muted[k])fixed.push({key:k,...about[k]});delete told[k];delete about[k];delete muted[k]}
 for(const k of Object.keys(seen))if(!cur.has(k)||told[k])delete seen[k];
 return {send,logged,fixed,state:{told,seen,...(Object.keys(about).length?{about}:{}),...(Object.keys(muted).length?{muted}:{})}}}
export function fixedText(fixed,{nameOf=a=>a}={}){return 'Fixed by itself: '+fixed.slice(0,8).map(f=>(f.agent?nameOf(f.agent)+': ':'')+f.title).join('; ')+(fixed.length>8?' …and '+(fixed.length-8)+' more':'')}
export function alertText(items,{link,nameOf=a=>a}){const by=new Map();for(const x of items){const a=x.agent?nameOf(x.agent):'aqeelOS';if(!by.has(a))by.set(a,[]);by.get(a).push(x)}
 const lines=[];for(const [a,l] of by)for(const x of l)lines.push('• '+a+': '+String(x.title||'').replace(new RegExp('^'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':? '),'')+(x.text?'. '+String(x.text).slice(0,180):''));
 const head=by.size===1?[...by.keys()][0]+' needs attention':by.size+' agents need attention';
 return head+'\n\n'+lines.slice(0,8).join('\n')+(lines.length>8?'\n…and '+(lines.length-8)+' more':'')+(link?'\n\nOpen Health: '+link:'')}
// the agents' rows for System › Health: every agent, fine or with its problems, plus its failed messages this week
export function overview(agents,items,drops,nameOf=a=>a){const rows=agents.map(a=>({agent:a,name:nameOf(a),problems:[],drops:drops[a]||null}));const idx=new Map(rows.map(r=>[r.agent,r]));
 const sys={agent:null,name:'aqeelOS itself',problems:[],drops:null};
 for(const x of items){if(['invite','ticket','access'].includes(x.kind))continue;const base=x.agent?String(x.agent).split('--')[0]:null;(base&&idx.get(base)||(base?null:sys))?.problems.push(x)}
 for(const r of rows)r.ok=!r.problems.length;const list=[...rows.filter(r=>!r.ok),...rows.filter(r=>r.ok)];if(sys.problems.length)list.unshift({...sys,ok:false});return list}

export function createAgentHealth({postingLine=async()=>null,DATA,HERMES_HOME,bottlenecks,items,listAgents,nameOf,botToken,engineUp,python,tellOwner=null,link,quiet=()=>null,fixFirst=null,fileIssue=null,healthGone=null,customerTools=null,kirimdevAgents=async()=>[],memInfo=readMem,ps=readPs,fetchJson=(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)}).then(r=>r.json())}){
 const FILE=path.join(DATA,'agent-health.json');let st=null;
 const load=async()=>{if(!st){st=await readStore(FILE);st.told||={};st.seen||={};st.groups||={}}return st};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(st,null,1))};
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 // features report their own checks: kind is a word for the icon (handoff, comment, run…), topic names the problem
 // within the agent so ok(agent,topic) can take it away once it works
 async function problem(agent,kind,text,{topic,fix}={}){await bottlenecks.event(kind,String(text).slice(0,200),String(fix||'').slice(0,400),{topic:'health|'+agent+'|'+(topic||kind),agent})}
 async function ok(agent,topic){return bottlenecks.resolve('health|'+agent+'|'+topic)}
 const drops=async()=>dropStats(await readFile(path.join(HERMES_HOME,'logs','aqeelos-dropped.jsonl'),'utf8').catch(()=>''));
 // the Telegram groups an agent worked in over the last 30 days (its chats, read only)
 const GROUPS=`import sqlite3,sys,json,time
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True)
rows=c.execute("select chat_id,max(coalesce(display_name,'')),max(origin_json) from sessions where source='telegram' and chat_type in ('group','supergroup','channel') and coalesce(last_activity_at,started_at)>? group by chat_id",(time.time()-30*86400,)).fetchall()
out=[]
for cid,name,origin in rows:
  title=name
  try: title=json.loads(origin or "{}").get("chat_name") or name
  except Exception: pass
  out.append({"id":cid,"title":title})
print(json.dumps(out))`;
 const groupsOf=async a=>{const p=await python().catch(()=>null);if(!p)return [];return new Promise(res=>execFile(p,['-c',GROUPS,path.join(home(a),'state.db')],{timeout:20000},(e,o)=>{try{res(e?[]:JSON.parse(o))}catch{res([])}}))};
 async function checkGroups(agents){await load();const now=Date.now();if(now-(st.groupsAt||0)<H)return;st.groupsAt=now;const keep=new Set();
  const teamGroups=await readFile(path.join(DATA,'team-groups.json'),'utf8').then(JSON.parse).catch(()=>({}));
  for(const a of agents){const tok=await botToken(a).catch(()=>null);if(!tok)continue;let me;try{me=await fetchJson('https://api.telegram.org/bot'+tok+'/getMe')}catch{continue}if(!me?.ok)continue;
   const texts=await Promise.all(['config.yaml','.env'].map(f=>readFile(path.join(home(a),f),'utf8').catch(()=>'')));const mine=configuredGroups(a,{teamGroups,texts});
   const seen=await groupsOf(a),list=[...seen.filter(g=>mine.has(String(g.id))),...[...mine].filter(id=>!seen.some(g=>String(g.id)===id)).map(id=>({id,title:''}))];
   for(const g of seen)if(!mine.has(String(g.id)))await bottlenecks.resolve('health|'+a+'|group|'+g.id);
   for(const g of list){let ans;try{ans=await fetchJson('https://api.telegram.org/bot'+tok+'/getChatMember?chat_id='+encodeURIComponent(g.id)+'&user_id='+me.result.id)}catch{continue}
    if(!g.title&&ans?.ok){try{const c=await fetchJson('https://api.telegram.org/bot'+tok+'/getChat?chat_id='+encodeURIComponent(g.id));g.title=c?.result?.title||''}catch{}}
    const pr=memberProblem(a,g,ans);if(pr){keep.add(pr.topic);await bottlenecks.event('group',pr.text,pr.detail,{topic:pr.topic,agent:a,data:{bot:me.result.username||'',chat:String(g.id)}})}else if(ans?.ok)await bottlenecks.resolve('health|'+a+'|group|'+g.id)}}
  // a group that is no longer checked (not in the agent's settings) leaves Health and the popup
  for(const t of st.groupTopics||[])if(!keep.has(t))await bottlenecks.resolve(t);st.groupTopics=[...keep]}
 async function checkSchedules(agents){const up=await engineUp().catch(()=>true);
  for(const a of agents){const cron=path.join(home(a),'cron');const ticker=Number((await readFile(path.join(cron,'ticker_last_success'),'utf8').catch(()=>'')).trim())||0;
   let jobs=[];try{const d=JSON.parse(await readFile(path.join(cron,'jobs.json'),'utf8'));jobs=Array.isArray(d)?d:d.jobs||[]}catch{}
   const found=scheduleProblems(a,{ticker,jobs},{engineUp:up}),keep=new Set(found.map(x=>x.topic));
   for(const x of found)await bottlenecks.event('stopped',x.text,x.detail,{topic:x.topic,agent:a});
   // those that work again go away (only this check's own topics)
   for(const t of [a+'|scheduler',...jobs.map(j=>a+'|late|'+j.id)])if(!keep.has('health|'+t))await bottlenecks.resolve('health|'+t)}}
 // the same script of one agent running twice (its own user ag-<agent>, or a folder of its workspace)
 async function checkTwice(agents){const rows=await ps();const known=new Set(agents);const ws=path.join(path.dirname(HERMES_HOME),'workspaces')+'/';
  const agentOf=r=>{const m=/^ag-(.+)$/.exec(r.user||'');if(m&&known.has(m[1]))return m[1];
   for(const where of [String(r.cwd||''),String(r.args||'')]){const w=where.indexOf(ws);if(w>=0){const a=where.slice(w+ws.length).split(/[\/\s]/)[0];if(known.has(a))return a}}return null};
  const found=duplicateProcesses(rows,agentOf),keep=new Set(found.map(x=>x.topic));for(const x of found)await bottlenecks.event('twice',x.text,x.detail,{topic:x.topic,agent:x.agent});
  await load();for(const t of st.twice||[])if(!keep.has(t))await bottlenecks.resolve(t);st.twice=[...keep]}
 // skills pointing to missing files, hourly: one problem per skill and missing files, however many agents have a copy
 // of it (7 Nov 2026: continue-vial-labels showed twice); the first agent that has it tries first, then the fixer
 async function checkSkillFiles(agents){await load();const now=Date.now();if(now-(st.skillsAt||0)<H)return;st.skillsAt=now;const keep=new Set(),realHome=path.dirname(HERMES_HOME);
  const found=new Map();
  for(const a of agents)for(const x of await checkSkills(path.join(home(a),'skills'),{home:realHome}).catch(()=>[])){const k=skillKey(x);
   const f=found.get(k)||{x,agents:[],dirs:[]};f.agents.push(a);f.dirs.push(path.join(home(a),'skills',x.skill));found.set(k,f)}
  for(const [k,f] of found){const topic='health|'+f.agents[0]+'|skill|'+k;keep.add(topic);
   await bottlenecks.event('skill','The skill '+path.basename(f.x.skill)+' points to '+(f.x.missing.length===1?'a file that is':f.x.missing.length+' files that are')+' not there',
    'Missing: '+f.x.missing.slice(0,6).join(', ')+'. An agent fails halfway when it follows this skill. Find the file in a backup, an older copy of the skill or git history and put it back; otherwise change the skill so it no longer needs it. Skill folder'+(f.dirs.length>1?'s':'')+': '+f.dirs.join(', ')+(f.agents.length>1?' (agents '+f.agents.join(', ')+')':'')+'.',{topic,agent:f.agents[0]})}
  for(const t of st.skills||[])if(!keep.has(t))await bottlenecks.resolve(t);st.skills=[...keep]}
 async function checkDrops(agents){const d=await drops();for(const a of agents){const pr=dropProblem(a,d[a]);if(pr)await bottlenecks.event('dropped',pr.text,pr.detail,{topic:pr.topic,agent:a});else await bottlenecks.resolve('health|'+a+'|dropped')}}
 // each check below keeps the topics it found (st.live[name]) so the ones that work again go away
 async function keep(name,found){await load();st.live||={};for(const x of found)await bottlenecks.event(x.kind||name,x.text,x.detail,{topic:x.topic,...(x.agent?{agent:x.agent}:{}),...(x.urgent?{data:{urgent:true}}:{})});
  const now=new Set(found.map(x=>x.topic));for(const t of st.live[name]||[])if(!now.has(t))await bottlenecks.resolve(t);st.live[name]=[...now]}
 // an engine event stays a problem for an hour after the last one, then goes away by itself
 async function checkEngine(){await load();const since=st.engineAt||Date.now()-10*60e3;st.engineAt=Date.now();
  const e=engineEvents(await tail(path.join(HERMES_HOME,'logs','gateway-exit-diag.log'),4e5),await tail(path.join(HERMES_HOME,'logs','errors.log'),1e6),since);
  st.engineSeen||={};for(const x of engineProblems(e))st.engineSeen[x.topic]={...x,at:Date.now()};
  for(const [k,v] of Object.entries(st.engineSeen))if(Date.now()-v.at>H)delete st.engineSeen[k];
  await keep('engine',Object.values(st.engineSeen).map(({at,...x})=>({...x,kind:'engine'})))}
 async function checkTools(agents){const found=[],by={};for(const a of agents){const s2=mcpState(await tail(path.join(home(a),'logs','agent.log')));by[a]=s2;for(const x of mcpProblems(a,s2))found.push({...x,agent:a,kind:'tools'})}
  found.push(...ownServerProblems(by));await keep('tools',found)}
 async function checkCustomer(){if(!customerTools)return;const found=[];for(const a of await kirimdevAgents().catch(()=>[])){
  const listed=await customerTools(a).catch(()=>null),log=f=>tail(path.join(home(a),'logs',f)),now=mcpState(await log('agent.log')),before=now.customer==null?mcpState(await log('agent.log.1')):now,registered=now.customer??before.customer;
  // the line is written once, at engine start: a rotated log has lost it, which says nothing about the tools (9 Nov 2026)
  const pr=customerProblem(a,{listed,registered,logged:now.at!=null});if(pr)found.push({...pr,agent:a,kind:'customer'})}await keep('customer',found)}
 async function checkFailing(agents){const found=[];for(const a of agents){let jobs=[];try{const d=JSON.parse(await readFile(path.join(home(a),'cron','jobs.json'),'utf8'));jobs=Array.isArray(d)?d:d.jobs||[]}catch{}
  for(const x of failingJobs(a,jobs))found.push({...x,agent:a,kind:'stopped'})}await keep('failing',found)}
 async function checkMemory(){await keep('memory',memProblems(await memInfo()).map(x=>({...x,kind:'memory'})))}
 // every 5 minutes on the live app: the checks, then the alert for what is new
 let running=null;
 async function tick(){if(running)return running;running=(async()=>{const agents=(await listAgents()).filter(a=>!a.includes('--'));
  for(const [n,f] of [['schedules',checkSchedules],['messages',checkDrops],['groups',checkGroups],['processes',checkTwice],['skills',checkSkillFiles],['engine',checkEngine],['tools',checkTools],['customer',checkCustomer],['failing',checkFailing],['memory',checkMemory]])await f(agents).catch(e=>console.warn('health check',n,e.message));
  await load();const all=await items();const {send,logged,fixed,state}=alertPlan(st,all,Date.now(),{quiet});st.told=state.told;st.seen=state.seen;st.about=state.about||{};st.muted=state.muted||{};
  if(logged.length)console.log('health: not told (restart hold):',logged.map(x=>alertKey(x)+' '+String(x.title||'').slice(0,80)).join(' | '));
  // 7 Nov 2026 (owner: "agents fix themselves"; "people are messaged only when a fix needs a human"): Health tells
  // nobody. Each new problem (seen on two checks in a row) is filed as an issue for the fixer (issues.mjs), which fixes,
  // reloads and proves it, and messages a person only when it needs one or is stuck. A queued issue whose problem
  // went away by itself is closed. Everything stays visible on System › Health.
  // filed once per problem while it lasts (st.filed), including problems that were already known before this
  // Owner's ladder: a problem in one agent's own work goes to that agent first (fixFirst: a run of its own); only if it
  // is still there 45 minutes later, or the agent cannot run itself, does it go to the fixer.
  st.fixing=undefined;st.ownerTold=undefined;st.filed||={};st.selfTried||={};const curKeys=new Set(),toFile=[],now=Date.now();
  for(const x of all.filter(forLadder)){const k=alertKey(x);if(curKeys.has(k))continue;curKeys.add(k);if(!st.told[k]||st.filed[k]||quiet(x.agent||null)==='test')continue;
   // urgent (aqeelOS's own tool server): no agent can fix aqeelOS's code, so straight to the fixer
   if(fixFirst&&x.agent&&!x.data?.urgent&&!st.selfTried[k]){try{await fixFirst(String(x.agent).split('--')[0],x);st.selfTried[k]=now;console.log('health: '+x.agent+' fixes it itself first: '+k);continue}catch(e){console.log('health: '+x.agent+' cannot fix it itself ('+e.message+')')}}
   if(st.selfTried[k]&&now-st.selfTried[k]<45*60e3)continue;toFile.push(x)}
  for(const m of [st.filed,st.selfTried])for(const k of Object.keys(m))if(!curKeys.has(k)){if(m===st.selfTried&&!st.filed[k])console.log('health: fixed by the agent itself: '+k);delete m[k]}
  for(const x of toFile){const k=alertKey(x);if(!fileIssue){console.log('health: found (no fixer): '+k);continue}
   try{const r=await fileIssue({agent:x.agent?String(x.agent).split('--')[0]:'default',affects:x.agent?[]:['aqeelos'],source:'health',healthKey:k,what:'Health check ('+(x.kind||'problem')+')',
     missing:String(x.title||'A health problem').slice(0,400),urgent:!!x.data?.urgent,evidence:[x.text,x.detail,x.fix].filter(Boolean).join(' · ').slice(0,1800)});
    st.filed[k]=Date.now();console.log('health: filed for the fixer: '+k+' → '+r?.issue?.id+(r?.again?' (already open)':''))}
   catch(e){console.warn('health: could not file '+k+': '+e.message)}}
  if(healthGone)await healthGone([...curKeys]).catch(e=>console.warn('health: closing gone issues',e.message));
  if(fixed.length)console.log('health: went away:',fixed.map(f=>f.key).join(', '));
  await save();return toFile.length})().finally(()=>{running=null});return running}
 // one line per agent that posts in public: today's numbers per kind against its limits, and the actions no record came for (posting-limits.mjs line())
 async function view(){const agents=(await listAgents()).filter(a=>!a.includes('--'));const rows=overview(agents,await items(),await drops(),nameOf);
  await Promise.all(rows.filter(r=>r.agent).map(async r=>{const l=await postingLine(r.agent).catch(()=>null);if(l)r.posting=l}));return {agents:rows,at:Date.now()}}
 return {problem,ok,tick,view,drops}}
// ---- live checks in plain code, no model calls (7 Nov 2026, owner: "save tokens"). Each failure is a Health problem,
// so it goes up the ladder like any other (the agent, then the fixer on the main agent's engine, then a person).
// engine log lines carry a UTC time "YYYY-MM-DD HH:MM:SS,ms"
const logTime=l=>{const m=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(l);return m?Date.parse(m[1]+'T'+m[2]+'Z'):NaN};
// 1. the engine: unclean or failed exits (gateway-exit-diag.log, JSON lines) and a swapped state.db (errors.log) after `since`
export function engineEvents(diag,errors,since){const out={unclean:0,nonzero:0,replaced:0,last:0};
 for(const l of String(diag||'').split('\n')){if(!l.trim())continue;let x;try{x=JSON.parse(l)}catch{continue}const t=Date.parse(x.ts);if(!(t>since))continue;
  if(x.tag==='gateway.previous_unclean_exit'){out.unclean++;out.last=Math.max(out.last,t)}if(x.tag==='gateway.exit_nonzero'){out.nonzero++;out.last=Math.max(out.last,t)}}
 for(const l of String(errors||'').split('\n'))if(/state\.db was replaced/.test(l)){const t=logTime(l);if(t>since){out.replaced++;out.last=Math.max(out.last,t)}}
 return out}
export function engineProblems(e){const out=[];
 if(e.unclean||e.nonzero)out.push({topic:'health|aqeelos|engine-exit',text:'The engine stopped uncleanly',detail:[e.unclean&&e.unclean+' unclean exit(s)',e.nonzero&&e.nonzero+' exit(s) with an error'].filter(Boolean).join(', ')+' since the last check (~/.hermes/logs/gateway-exit-diag.log).'});
 if(e.replaced)out.push({topic:'health|aqeelos|state-db',text:'An agent database (state.db) was replaced under the engine',detail:e.replaced+' "state.db was replaced" line(s) in ~/.hermes/logs/errors.log since the last check. Chats are diverted to sessions/*.jsonl until it is reopened.'});
 return out}
// 2. tool servers: the latest "MCP: registered … (N failed: a (why); b (why))" line of an agent's log, and servers that
// went between working and failing more than twice in the last hour (flapping)
// 7 Nov 2026: aqeelos-notify answered every initialize with HTTP 500 from 13:53 and this check saw nothing: the engine
// cuts its long "registered … (1 failed: …" line short, so the closing bracket the old pattern needed was never there;
// and a server the engine parks while it runs ("parking until a reconnect is requested") was never read at all
export function mcpState(log,now=Date.now()){let last=null;const hist=[],parked=new Map(),okAt=new Map();   // okAt: a server that came back (revived or registered on its own) after the last full list
 for(const l of String(log||'').split('\n')){
  const pk=/MCP server '([\w.@-]+)'[^\n]*?parking until ([^(]*)\(state: \w+ → parked\)(?::\s*(.*))?/.exec(l);
  if(pk){if(!/credentials change|OAuth|no cached tokens|mcp login|sign[ -]?in|authoriz/i.test(pk[2]+' '+(pk[3]||'')))parked.set(pk[1],logTime(l));continue}
  const rv=/MCP server '([\w.@-]+)': revived/.exec(l);if(rv){parked.delete(rv[1]);okAt.set(rv[1],logTime(l));continue}
  const one=/MCP server '([\w.@-]+)' \(\w+\): registered \d+ tool\(s\)/.exec(l);if(one){parked.delete(one[1]);okAt.set(one[1],logTime(l))}
  if(!/MCP: registered \d+ tool\(s\)/.test(l))continue;const t=logTime(l);const f=/\(\d+ failed: (.*)$/.exec(l);for(const [k,pt] of parked)if(pt<=t)parked.delete(k);
  // a server waiting for someone to sign in (OAuth, no tokens yet) is not broken: the sign-in shows on the agent's
  // Connected apps, and no fixer can sign in for a person (7 Nov 2026: Slack and Notion on every agent)
  const failed=f?[...('; '+f[1]).matchAll(/;\s+([\w.@-]+) \(([^;]*)/g)].filter(m=>!/OAuth|no cached tokens|mcp login|sign[ -]?in|authoriz/i.test(m[2])).map(m=>m[1]):[];last={t,failed};if(now-t<H)hist.push(failed)}
 const seen=new Set(hist.flat()),flaps={};for(const sv of seen){let n=0;for(let k=1;k<hist.length;k++)if(hist[k].includes(sv)!==hist[k-1].includes(sv))n++;if(n>2)flaps[sv]=n}
 const cust=[...String(log||'').matchAll(/MCP server 'aqeelos-customer' \(\w+\): registered (\d+) tool\(s\)/g)].pop();
 // 7 Nov 2026: a server that failed in the last full list but revived after it is fine (it read as failing for hours)
 const failed=[...new Set([...(last?.failed||[]).filter(k=>!((okAt.get(k)||0)>=(last?.t||0))),...parked.keys()])];
 return {failed,parked:[...parked.keys()],at:last?.t||null,flaps,customer:cust?Number(cust[1]):null}}
// aqeelOS's own tool servers (aqeelos-notify, aqeelos-code, aqeelos-customer…): their code is aqeelOS's, no agent can fix
// it, and every agent loses those tools at once. Urgent: one problem per server for all agents, straight to the fixer.
export const ownServer=n=>/^aqeelos-/.test(String(n||''));
export function ownServerProblems(byAgent){const by=new Map();for(const [a,st] of Object.entries(byAgent))for(const n of st.failed||[])if(ownServer(n)){if(!by.has(n))by.set(n,[]);by.get(n).push(a)}
 return [...by].map(([n,agents])=>({topic:'health|aqeelos|tool|'+n,agent:'default',kind:'tools',urgent:true,text:'aqeelOS’s own tool server '+n+' is failing for '+agents.length+' agent'+(agents.length>1?'s':''),
  detail:'Agents: '+agents.join(', ')+'. The engine could not connect to '+n+' (or parked it). Its code is aqeelOS’s own (app/ in ~/apps/hermes-ui, served under /mcp/ by the web app; the error is in /tmp/ui.log). Fix it in app/ with apply "ui": the change is saved as a patch for git.'}))}
export function mcpProblems(agent,st){const out=[];
 const failed=st.failed.filter(n=>!ownServer(n));
 if(failed.length)out.push({topic:'health|'+agent+'|mcp-failed',text:'Tool servers do not start: '+failed.join(', '),detail:'The last engine start for this agent could not register '+failed.join(', ')+' (agent.log "MCP: registered … failed"). Its tools from them are missing.'});
 const fl=Object.entries(st.flaps);if(fl.length)out.push({topic:'health|'+agent+'|mcp-flap',text:'Tool servers keep dropping: '+fl.map(([k])=>k).join(', '),detail:fl.map(([k,n])=>k+' changed '+n+' times').join(', ')+' in the last hour.'});
 return out}
// 3. the customer tools of an agent with a Kirimdev line: the local tools/list answers with at least `want` tools, and the
// engine registered the same server
export function customerProblem(agent,{listed,registered,logged},want=6){
 if(listed==null||listed<want)return {topic:'health|'+agent+'|customer-tools',text:'Customer tools do not answer',detail:'tools/list on /mcp/customer/'+agent+' gave '+(listed==null?'no answer':listed+' tool(s)')+', '+want+' expected. Customer chats run with no tools.'};
 if(registered!=null&&registered<want)return {topic:'health|'+agent+'|customer-tools',text:'The engine has too few customer tools',detail:'agent.log: aqeelos-customer registered '+registered+' tool(s), '+want+' expected.'};
 if(registered==null&&logged!==false)return {topic:'health|'+agent+'|customer-tools',text:'The engine did not register the customer tools',detail:'No "aqeelos-customer … registered" line in its agent.log. Customer chats run with no tools.'};
 return null}
// 4. a schedule failing twice or more in a row (jobs.json failure_streak; "late" is scheduleProblems)
export function failingJobs(agent,jobs=[]){return jobs.filter(j=>j.enabled!==false&&Number(j.failure_streak)>=2).map(j=>({topic:'health|'+agent+'|failing|'+j.id,text:'A schedule keeps failing: '+(j.name||String(j.prompt||'').slice(0,60)||j.id),detail:'Failed '+j.failure_streak+' times in a row. Last error: '+String(j.last_error||j.last_failure||'not recorded').slice(0,300)}))}
// 6. memory and load: used share of the box's limit, and the 1-minute load per CPU
export function memProblems({used,max,load1,cpus:n},{memMax=0.9,loadMax=2}={}){const out=[];
 if(max&&used/max>memMax)out.push({topic:'health|aqeelos|memory',text:'The box is almost out of memory',detail:Math.round(used/max*100)+'% in use ('+(used/1e9).toFixed(1)+' of '+(max/1e9).toFixed(1)+' GB).'});
 if(n&&load1/n>loadMax)out.push({topic:'health|aqeelos|load',text:'The box is overloaded',detail:'Load '+load1.toFixed(1)+' on '+n+' CPUs.'});
 return out}
async function tail(f,bytes=1.5e6){let h;try{h=await open(f,'r');const {size}=await h.stat();const n=Math.min(size,bytes);const b=Buffer.alloc(n);await h.read(b,0,n,size-n);return b.toString('utf8')}catch{return ''}finally{await h?.close().catch(()=>{})}}
async function readMem(){const n=async f=>Number((await readFile(f,'utf8').catch(()=>'')).trim())||0;
 const load1=Number((await readFile('/proc/loadavg','utf8').catch(()=>'')).split(' ')[0])||0;const cur=await n('/sys/fs/cgroup/memory.current'),max=await n('/sys/fs/cgroup/memory.max');
 if(cur&&max){const st=await readFile('/sys/fs/cgroup/memory.stat','utf8').catch(()=>'');return {used:Math.max(0,cur-Number((/^inactive_file (\d+)/m.exec(st)||[])[1]||0)),max,load1,cpus:cpus().length}}
 const m=await readFile('/proc/meminfo','utf8').catch(()=>'');const kb=k=>Number((new RegExp('^'+k+':\\s+(\\d+)','m').exec(m)||[])[1]||0)*1024;return {used:kb('MemTotal')-kb('MemAvailable'),max:kb('MemTotal'),load1,cpus:cpus().length}}

// the box's processes with their folder (ps; /proc for the folder when it may be read)
async function readPs(){const out=await new Promise(res=>execFile('ps',['-eo','pid=,ppid=,etimes=,user:40=,args='],{timeout:10000,maxBuffer:8e6},(e,o)=>res(e?'':String(o))));
 const rows=[];for(const l of out.split('\n')){const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(l);if(!m)continue;const r={pid:+m[1],ppid:+m[2],age:+m[3],user:m[4],args:m[5]};
  if(SCRIPT.test(r.args.trim())&&r.age>120)r.cwd=await readlink('/proc/'+r.pid+'/cwd').catch(()=>'');rows.push(r)}return rows}
