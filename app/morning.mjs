// The morning line (8 Nov 2026, owner's stability plan, point 5): once a day at about 07:30 in the install's time zone
// (WIB) the main agent sends the owner one plain line through the alert route: "Yesterday: everything worked." or
// exactly what broke and whether it was fixed by itself. Built in code from data, no model call, nothing else sent.
// Sources, last 24 hours: issues filed (and where each stands now), Health problems still open, the Activity log (a
// tool server that stopped and worked again), deploy results (/tmp/aq-deploy-*.log on the box), the live test after
// each deploy with its automatic undo (DATA/live-test.json, box-live.sh) and automatic rollbacks (an agent that stopped
// answering after changing itself; agent-versions). Test
// agents and planned tests are left out. Sent once a day (DATA/morning.json).
import {readFile,readdir,stat,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {similar} from './issues.mjs';

export const AT={hour:7,minute:30};
const one=t=>String(t??'').replace(/\s+/g,' ').trim();
// a short name for a problem: its first clause, at most 70 characters, cut at a word
export function short(t,n=70){t=one(t).replace(/^(PLANNED TEST[^:]*:\s*)/i,'');t=t.split(/(?<=[a-z0-9)"'])[.;!?](?:\s|$)|\s\((?!aqeelos)/i)[0].trim();
 if(t.length<=n)return t;const c=t.slice(0,n);return c.slice(0,Math.max(c.lastIndexOf(' '),n-12)).replace(/[,:\s]+$/,'')}
const RANK={person:4,open:3,working:2,deploy:1,fixed:0};
// what each state says in the line
const SAY={person:'needs you in Bottlenecks',open:'still broken',working:'the fixer is on it',deploy:'fix waits for the daily deploy'};

// issues filed in the window (a problem that broke then), with where each one stands now; one closed as a duplicate or
// filed again is the same problem, not another
export function fromIssues(list,{since,until=Infinity,isTest=()=>false,names=a=>a}){const out=[];
 for(const i of list||[]){if(isTest(i.agent)||/PLANNED TEST|planned (?:ladder )?test|ladder[- ]proof/i.test([i.missing,i.evidence].join(' ')))continue;
  if(['closed','stopped','expired','declined'].includes(i.state)||i.what==='Automatic rollback')continue;
  if(!((i.created||0)>=since&&(i.created||0)<=until))continue;if(i.state==='gone'&&/duplicate|filed again|original issue|fixed and proven as/i.test(i.resolvedBy||''))continue;
  const state=['fixed','gone'].includes(i.state)?'fixed':i.state==='needs_human'||i.state==='stuck'&&i.need?'person':i.state==='deploy'?'deploy':i.state==='stuck'||i.state==='open'?'open':'working';
  out.push({key:i.healthKey&&/\|tool\|/.test(i.healthKey)?'tool:'+i.healthKey.split('|tool|')[1].toLowerCase():'issue:'+i.id,what:short(String(i.missing||'').replace(/^.{1,60}? (?:reported a system problem|is blocked):\s*/,'')),agents:[names(i.agent)],state,at:i.created||0})}
 return out}
// Health problems still open that started in the window (and are not an issue already)
export function fromEvents(events,{since,until=Infinity,isTest=()=>false,names=a=>a}){return (events||[]).filter(e=>(e.created||0)>=since&&(e.created||0)<=until&&e.kind!=='alerts'&&!(e.agent&&isTest(e.agent)))
 .map(e=>({key:/\|tool\|/.test(e.topic||'')?'tool:'+String(e.topic).split('|tool|')[1].split('|')[0].toLowerCase():'health:'+(e.topic||e.id),what:short(e.text),agents:e.agent?[names(e.agent)]:[],state:'open',at:e.created}))}
// the Activity log: "<Agent>: the tool server "x" stopped connecting" … "works again", one item per thing
const BROKE=/\s+(?:stopped connecting|is broken|is missing its tools|is down|stopped answering|keeps failing|cannot start|does not start)\b.*$/i,AGAIN=/\s+(?:works again|is working again|answers again|is back(?: on)?)\b.*$/i;
// a tool server is "still broken" only when Health still has it open (open: the open Health events' text); otherwise
// it was put right by itself (the automations guard reconnects tool servers without a "works again" row every time)
export function fromActivity(rows,{since,until=Infinity,open=null}){const by=new Map();
 for(const x of rows||[]){if((x.t||0)<since||(x.since||x.t||0)>until||x.cls==='started')continue;const t=one(x.title);if(/finished a run|needs your OK|declined|team group|Fixed by aqeelOS|could not fix this|the owner has been told/i.test(t))continue;
  const m=/^([^:]{1,60}):\s+(.*)$/.exec(t);const who=m?m[1].replace(/\s*\(extra number\)$/,''):'',rest=m?m[2]:t;
  const broke=BROKE.test(rest),again=AGAIN.test(rest);if(!broke&&!again)continue;
  const what=rest.replace(broke?BROKE:AGAIN,'').trim(),tool=/tool server "([^"]+)"/i.exec(what)?.[1];const key=tool?'tool:'+tool.toLowerCase():'act:'+what.toLowerCase();
  const it=by.get(key)||{key,what:tool?'the tool server '+tool:what,agents:[],broke:0,again:0,at:x.since||x.t};
  if(who&&!it.agents.includes(who))it.agents.push(who);if(broke){it.broke=Math.max(it.broke,x.t);if(x.resolved)it.again=Math.max(it.again,x.resolved)}if(again)it.again=Math.max(it.again,x.t);it.at=Math.min(it.at,x.since||x.t);by.set(key,it)}
 const still=x=>open==null?true:open.some(t=>t.toLowerCase().includes(x.what.replace(/^the tool server /,'').toLowerCase()));
 return [...by.values()].filter(x=>x.broke).map(({broke,again,...x})=>({...x,state:again>=broke||!still(x)?'fixed':'open'}))}
// automatic rollbacks: the agent's versions file has a "rollback" event; a later "ok" means it answers again
export function fromRollbacks(files,{since,until=Infinity,isTest=()=>false,names=a=>a}){const out=[];
 for(const [a,d] of Object.entries(files||{})){if(isTest(a))continue;const ev=d?.events||[];
  for(const e of ev)if(e.kind==='rollback'&&(e.at||0)>=since&&e.at<=until){const ok=ev.some(x=>x.kind==='ok'&&x.at>e.at);
   out.push({key:'rollback:'+a,what:names(a)+' stopped answering after changing itself, so its changes were undone',agents:[],state:ok?'fixed':'open',at:e.at})}}
 return out}
// deploy results: the last line of each deploy's log on the box ("AQ-DEPLOY DONE" or "AQ-DEPLOY FAILED <step>")
export function fromDeploys(logs,{since,until=Infinity,tz}){const out=[],at=t=>new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t);
 const l=[...(logs||[])].filter(d=>d.at>=since&&d.at<=until).sort((a,b)=>a.at-b.at);
 const stopped=[];
 for(const [k,d] of l.entries()){const m=/AQ-DEPLOY FAILED\s*(.*)$/m.exec(d.text||'');if(!m)continue;const step=one(m[1])||'a step';if(step==='busy')continue;
  if(!/go live/i.test(step)){stopped.push(d);continue}const later=l.slice(k+1).some(x=>/AQ-DEPLOY DONE/.test(x.text||''));
  out.push({key:'deploy:'+d.at,what:'the '+at(d.at)+' deploy failed while going live',agents:[],state:later?'fixed':'open',deploy:true,at:d.at})}
 if(stopped.length)out.unshift({key:'deploy:stopped',what:stopped.length===1?'the '+at(stopped[0].at)+' deploy stopped at its checks, nothing changed':stopped.length+' deploys stopped at their checks, nothing changed',agents:[],state:'fixed',deploy:true,at:stopped[0].at});
 return {items:out,ok:l.filter(d=>/AQ-DEPLOY DONE/.test(d.text||'')).length}}

// kinds that come in batches, one item each: [key, label, the name inside the problem]
const KINDS=[['skill','missing skill files',/^The skill (\S+) points to/i],['signin','app sign-ins',/sign-?in|oauth/i,/\b(composio|notion|slack[\w-]*|google|gmail|github|linear)\b/gi],
 ['group','bot removed from Telegram groups',/^Removed from the Telegram group\s*(.*)$/i],['access','file access',/\b(?:read\/?exec(?:ute)?|access|permission)\b/i]];
export function kindOf(x){if(x.deploy||/^tool:|^rollback:/.test(x.key))return null;for(const [k,label,re,names] of KINDS){const m=re.exec(x.what);if(!m)continue;
  const n=names?[...new Set([...x.what.matchAll(names)].map(y=>y[1].toLowerCase()))]:m[1]?[m[1]]:[];return {key:'kind:'+k,label,names:n}}return null}
// the live test after each deploy (scripts/live-test.mjs) and its automatic undo (box-live.sh): a failed test whose
// undo worked is fixed by itself; no undo, or one that failed, is not
export function fromLiveTests(runs,{since,until=Infinity}){return (runs||[]).filter(r=>r&&r.ok===false&&r.at>=since&&r.at<=until).map(r=>{
 const why=one((r.failed||[]).map(f=>String(f).split(':')[0]).join(', '))||'its check';
 return {key:'deploy:live:'+r.at,what:'the deploy of '+String(r.sha||'').slice(0,8)+' failed its live test ('+why+')'+(r.undo?.ok?', so the previous version was put back':r.undo?' and putting the previous version back failed':''),agents:[],state:r.undo?.ok?'fixed':'open',deploy:true,at:r.at}})}
// one item per problem: the same key, the same kind, or the same problem on several agents (similar names), merged
export function merge(items){const out=[];
 for(const x0 of items){const k=x0.names?null:kindOf(x0),x=k?{...x0,key:k.key,what:k.label,names:k.names}:x0;
  const y=out.find(o=>o.key===x.key||!k&&!x.names&&!o.deploy&&!x.deploy&&!o.names&&similar(o.what,x.what)>=0.8||o.what.toLowerCase()===x.what.toLowerCase());
  if(!y){out.push({...x,agents:[...x.agents],...(x.names?{names:[...x.names]}:{})});continue}
  for(const v of x.names||[])if(y.names&&!y.names.includes(v))y.names.push(v);
  for(const a of x.agents)if(!y.agents.includes(a))y.agents.push(a);
  // fixed only when every source says so; otherwise the one that needs the most attention
  if(RANK[x.state]>RANK[y.state])y.state=x.state;y.at=Math.min(y.at,x.at)}
 return out.sort((a,b)=>RANK[b.state]-RANK[a.state]||a.at-b.at)}
const whoOf=x=>x.agents.length>1?x.agents.length+' agents':x.agents.length&&!x.what.startsWith(x.agents[0])?x.agents[0]:'';
const who=(x,say)=>{const w=[whoOf(x),say].filter(Boolean).join(', ');return w?' ('+w+')':''};
const named=x=>x.names?.length?x.what+': '+x.names.slice(0,2).join(', ')+(x.names.length>2?' and '+(x.names.length-2)+' more':''):x.what;
const list=(l,f)=>{const s=l.slice(0,3).map(f);if(l.length>3)s.push(l.length-3+' more');return s.join('; ')};
// the line: "Yesterday: everything worked." or what broke, then what is fixed and what is not
export function morningLine(items){const l=merge(items);if(!l.length)return 'Yesterday: everything worked.';
 const fixed=l.filter(x=>x.state==='fixed'),not=l.filter(x=>x.state!=='fixed'),n=l.length;
 const head='Yesterday: '+(n===1?'1 thing went wrong':n+' things went wrong');
 if(!not.length)return head+(n===1?' and fixed itself: ':', all fixed by itself: ')+list(fixed,x=>named(x)+who(x))+'.';
 const a='.'+(fixed.length?' Fixed by itself: '+list(fixed,x=>named(x)+who(x))+'.':'');
 const b=not.length?'\nNot fixed yet: '+list(not,x=>named(x)+who(x,SAY[x.state]))+'.':'';
 return head+a+b}

// the box's side: reads the files, sends once a day at AT in tz
export function createMorning({DATA,deployLogs='/tmp',collect,send,tz=()=>'Asia/Jakarta',now=()=>Date.now(),log=m=>console.log(m)}){
 const FILE=path.join(DATA,'morning.json');
 const local=t=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 async function logs(since){const out=[];let names=[];try{names=(await readdir(deployLogs)).filter(f=>/^aq-deploy-.*\.log$/.test(f))}catch{return out}
  for(const f of names){const p=path.join(deployLogs,f),s=await stat(p).catch(()=>null);if(!s||s.mtimeMs<since)continue;out.push({at:s.mtimeMs,text:String(await readFile(p,'utf8').catch(()=>'')).slice(-4000)})}return out}
 async function versions(){const dir=path.join(DATA,'agent-versions'),o={};let l=[];try{l=await readdir(dir)}catch{return o}
  for(const f of l){if(f.startsWith('.')||/\.(tmp|bak.*)$/.test(f))continue;try{o[f.replace(/\.json$/,'')]=JSON.parse(await readFile(path.join(dir,f),'utf8'))}catch{}}return o}
 // the line for the 24 hours before t
 async function build(t=now()){const since=t-864e5,c=await collect();const o={since,until:t,isTest:c.isTest||(()=>false),names:c.names||(a=>a)};
  const dep=fromDeploys(await logs(since),{since,until:t,tz:tz()});
  const live=fromLiveTests((await readFile(path.join(DATA,'live-test.json'),'utf8').then(JSON.parse).catch(()=>({}))).runs,{since,until:t});
  // a deploy that "failed while going live" because its live test failed is that live test's item
  dep.items=dep.items.filter(d=>!/going live/.test(d.what)||!live.some(x=>Math.abs(x.at-d.at)<30*60e3));
  return morningLine([...live,...fromIssues(c.issues,o),...fromEvents(c.events,o),...fromActivity(c.activity,{...o,open:(c.events||[]).map(e=>[e.text,e.topic,e.detail].join(' '))}),...fromRollbacks(await versions(),o),...dep.items])}
 async function tick(){const t=now(),p=local(t);if(+p.hour*60+ +p.minute<AT.hour*60+AT.minute)return null;const day=p.year+'-'+p.month+'-'+p.day;
  const st=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>({}));if(st.day===day)return null;
  // marked first: a send that fails lands in the bell (ownerSend) and is not sent again every few minutes
  await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify({day,at:t}));await rename(FILE+'.tmp',FILE);
  const text=await build(t);try{await send(text);log('morning line sent: '+text.replace(/\n/g,' / '))}catch(e){log('morning line: not sent ('+e.message+'), it is in the bell')}return text}
 return {build,tick}}
