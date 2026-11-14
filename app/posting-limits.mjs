// Posting limits and live checks (5 Nov 2026, brief item 9). An agent that posts in public (Cove Threads' comments)
// used to keep its limits only in words inside prompts, run from hand-made loops it could not see, and comments that
// Threads hid were never noticed. Now, per agent, set on Schedules › Run rules:
//  - one run at a time: the engine runs that agent's schedules one after another (cron.max_parallel_jobs = 1), so two
//    runs never fight over its one browser; a schedule that is due waits for the one running;
//  - posting limits: a day, an hour, minutes between posts, lighter night hours, the share of hot leads and a pause
//    file. Before each posting run the engine asks aqeelOS (a small gate script in the agent's scripts folder): either
//    the run is skipped without starting the AI, or the agent is told how many it may post this time;
//  - live checks: after each post the agent calls record_post; aqeelOS opens the public page in a fresh, signed-out
//    browser and looks for the text, again about 30 minutes later. A post that is not visible is a failure: it shows
//    under Bottlenecks and is sent to the alert chat, and the agent slows down for a few hours.
// Limits that bind (12 Nov 2026, customer-safety audit H1): the limits used to be words the model was asked to keep. Now the scripts that
// post (comment_send.py, dm_send.py, thread_full.py ...) ask first and say afterwards, through scripts/posting-guard.py:
//  - POST /posting-check/<agent>/<sig> {kind}: the limits of that kind (comment, dm, thread, reply) decide; allowed = a ticket that already
//    counts against the limits (so two scripts cannot both take the last slot); refused = the script exits with the reason;
//  - POST /posting-sending {ticket}: right before the click that posts. From then on an action is under way;
//  - POST /posting-record {ticket,kind,post_url,text}: right after it. A ticket that is sending and has no record after unrecordedSec
//    seconds is an "unrecorded action": it stays counted, and ONE Health item per agent says so;
//  - POST /posting-cancel {ticket}: nothing was posted (only before sending).
// Limits per kind: rules.subjects = {comment:{perDay,perHour,gapMin,...},dm:{...},thread:{...},reply:{...}}; each inherits the agent's rule for
// what it does not set. With no subjects the one rule governs every kind, as before. A kind without a rule may not post.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,mkdir,rename,stat,mkdtemp,rm,chmod} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {silentPosting} from './silent-ok.mjs';import {createRelayHeal} from './relay-heal.mjs';

export const DEFAULTS={on:false,perDay:20,perHour:3,gapMin:10,perRun:2,quietFrom:1,quietTo:5,quietPerHour:1,hotShare:0,afterMissingPerHour:2,afterMissingHours:6,
 stopFile:'',checkUrl:'',alert:'',tz:'',recheckMin:30,subject:'',unrecordedSec:600,subjects:{},jobs:{}};   // subject: what the limits govern (thread, comment or dm); '' = read from the pause file and page   // '' = the box's zone (tz.mjs)
export const KINDS=['comment','dm','thread','reply'];   // reply: an answer in a chat the other person started
export const KIND_NAME={comment:'comments',dm:'DMs',thread:'own threads',reply:'DM answers'};
const SUBJ_NUM=['perDay','perHour','gapMin','perRun','quietFrom','quietTo','quietPerHour'];
const NUM={unrecordedSec:[60,3600],perDay:[1,500],perHour:[1,60],gapMin:[0,240],perRun:[1,20],quietFrom:[0,23],quietTo:[0,24],quietPerHour:[0,60],hotShare:[0,100],afterMissingPerHour:[0,60],afterMissingHours:[0,72],recheckMin:[5,240]};
export function clean(r){const o={...DEFAULTS};for(const [k,v] of Object.entries(r||{})){if(!(k in DEFAULTS))continue;
  if(k in NUM){const n=Math.round(Number(v));if(!Number.isFinite(n))throw Error(k+' must be a number');const [lo,hi]=NUM[k];o[k]=Math.min(hi,Math.max(lo,n))}
  else if(k==='on')o.on=!!v;
  else if(k==='subject'){const s=String(v||'').trim().toLowerCase();if(s&&!KINDS.includes(s))throw Error('The limits govern '+KINDS.join(', '));o.subject=s}
  else if(k==='subjects'){o.subjects={};for(const [kind,sr] of Object.entries(v||{})){if(!KINDS.includes(kind))throw Error('Limits per kind: '+KINDS.join(', ')+' (not '+kind+')');const c={};
   for(const f of SUBJ_NUM)if(sr&&sr[f]!==undefined&&sr[f]!==''){const n=Math.round(Number(sr[f]));if(!Number.isFinite(n))throw Error(kind+': '+f+' must be a number');const [lo,hi]=NUM[f];c[f]=Math.min(hi,Math.max(lo,n))}o.subjects[kind]=c}}
  else if(k==='jobs'){o.jobs={};for(const [id,l] of Object.entries(v||{})){if(!/^[\w-]{1,64}$/.test(id))throw Error('Unknown schedule id');const ks=[...new Set([].concat(l||[]).map(x=>String(x).toLowerCase()))];if(ks.some(x=>!KINDS.includes(x)))throw Error('A schedule posts '+KINDS.join(', '));o.jobs[id]=ks}}
  else if(k==='stopFile'){const s=String(v||'').trim();if(s&&(s.startsWith('/')||s.split('/').includes('..')))throw Error('The pause file is a path inside the agent’s folder, like .tools/STOP_COMMENTS');o.stopFile=s.slice(0,200)}
  else if(k==='checkUrl'){const s=String(v||'').trim();if(s&&!/^https:\/\/[^\s]+$/.test(s))throw Error('The page to check is a full https:// address');o.checkUrl=s.slice(0,300)}
  else if(k==='alert'){const s=String(v||'').trim();if(s&&!/^telegram:-?\d+(:\d+)?$/.test(s))throw Error('Alerts go to telegram:<chat id> or telegram:<chat id>:<topic id>');o.alert=s}
  else if(k==='tz'){const s=String(v||'').trim();if(s)try{new Intl.DateTimeFormat('en',{timeZone:s})}catch{throw Error('Unknown time zone')}o.tz=s}}
 return o}

const fmt=new Map();
export function local(t,tz){tz=zoneOr(tz);if(!fmt.has(tz))fmt.set(tz,new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(fmt.get(tz).formatToParts(new Date(t)).map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)%24,clock:p.hour+':'+p.minute}}
const inQuiet=(h,a,b)=>a===b?false:a<b?h>=a&&h<b:h>=a||h<b;
import {zoneName as tzName,zoneOr} from './tz.mjs';
const zoneName=tz=>tzName(tz);

// may this run post, and how many: the same numbers the person sees on the Run rules panel
export function decide(rules,entries,{now=Date.now(),stopped=false}={}){const r={...DEFAULTS,...rules},L=local(now,r.tz);
 const today=entries.filter(e=>local(e.at,r.tz).date===L.date),hour=entries.filter(e=>now-e.at<3600e3&&e.at<=now);
 const last=entries.reduce((m,e)=>Math.max(m,e.at),0),since=last?(now-last)/60e3:Infinity;
 const quiet=inQuiet(L.hour,r.quietFrom,r.quietTo),missing=entries.find(e=>e.status==='missing'&&now-(e.missingAt||e.at)<r.afterMissingHours*3600e3);
 let cap=r.perHour,why='';if(quiet&&r.quietPerHour<cap){cap=r.quietPerHour;why='night hours ('+String(r.quietFrom).padStart(2,'0')+':00 to '+String(r.quietTo).padStart(2,'0')+':00)'}
 if(missing&&r.afterMissingPerHour<cap){cap=r.afterMissingPerHour;why='a post was not visible on '+local(missing.missingAt||missing.at,r.tz).clock+', so slower for '+r.afterMissingHours+' hours'}
 const hot=today.filter(e=>e.lead==='hot').length,share=today.length?Math.round(hot/today.length*100):100;
 const base={today:today.length,perDay:r.perDay,hour:hour.length,cap,since:Number.isFinite(since)?Math.floor(since):null,share,quiet,slowed:!!missing,why,clock:L.clock+' '+zoneName(r.tz)};
 const no=reason=>({...base,allow:false,n:0,reason});
 if(stopped)return no('Paused: the pause file '+r.stopFile+' is there. Remove it to post again.');
 if(today.length>=r.perDay)return no('Done for today: '+today.length+' of '+r.perDay+' posted.');
 if(hour.length>=cap)return no(hour.length+' posted in the last hour, the limit is '+cap+(why?' ('+why+')':'')+'.');
 if(since<r.gapMin)return no('The last post was '+Math.floor(since)+' min ago; posts are at least '+r.gapMin+' min apart.');
 const n=Math.max(0,Math.min(r.perRun,cap-hour.length,r.perDay-today.length));
 return {...base,allow:n>0,n,reason:n>0?'':'No room left this hour.',needHot:r.hotShare>0&&share<r.hotShare}}

// ---- limits per kind (comment, dm, thread, reply) ----
// the rule one kind obeys: the agent's rule with that kind's own numbers on top. No subjects set = the one old rule for everything. A kind
// with no rule of its own (when some kinds have one) has none: it may not post.
export const hasSubjects=r=>!!r&&Object.keys(r.subjects||{}).length>0;
export function ruleFor(rules,kind){const r={...DEFAULTS,...rules};if(!hasSubjects(r))return r;const S=r.subjects[kind];if(!S)return null;
 const {subjects,jobs,...base}=r;return {...base,hotShare:0,...S,subjects,jobs}}
export const kindOf=e=>(e&&e.kind)||'comment';
// the entries a kind's limits count: all of them with the one old rule, else only that kind's
export const entriesOf=(rules,entries,kind)=>hasSubjects({...DEFAULTS,...rules})?entries.filter(e=>kindOf(e)===kind):entries;
export const defaultKind=rules=>{const r={...DEFAULTS,...rules};return r.subject||(hasSubjects(r)?(r.subjects.comment?'comment':Object.keys(r.subjects)[0]):'comment')};
export function decideKind(rules,entries,kind,{now=Date.now(),stopped=false}={}){const r=ruleFor(rules,kind);
 if(!r){const L=local(now,rules?.tz);return {allow:false,n:0,today:0,perDay:0,hour:0,cap:0,since:null,share:0,quiet:false,slowed:false,why:'',clock:L.clock+' '+zoneName(rules?.tz),reason:'There is no Run rule for '+(KIND_NAME[kind]||kind)+' on this agent, so none may go out. Set one on Schedules › Run rules.'}}
 return decide(r,entriesOf(rules,entries,kind),{now,stopped})}
// which kinds a schedule posts: the owner's list for that schedule (rules.jobs), else what its name says. [] = it does not post.
export function jobKinds(job,rules){const own=(rules?.jobs||{})[job?.id];if(own)return own;const n=String(job?.name||'');if(!n)return [];const k=[];
 if(/\bcomments?\b/i.test(n))k.push('comment');
 if(/own[- ]?posts?|mini-?threads?|\bthread runner\b/i.test(n))k.push('thread');
 if(/\bDMs?\b/i.test(n)){if(/answer|repl/i.test(n))k.push('reply');else k.push('dm')}
 return k}
// a schedule posts several kinds: it may run while ANY of them has room. list = [{kind, d}] -> {allow, reason}
export const jobDecision=list=>({allow:list.some(x=>x.d.allow),reason:list.filter(x=>!x.d.allow).map(x=>(KIND_NAME[x.kind]||x.kind)+': '+x.d.reason).join(' ')});

// the text the engine puts in front of the agent's instructions for a posting run
export function gateText(r,d){if(!d.allow)return 'aqeelOS posting limits ('+d.clock+'): no post this run. '+d.reason+'\n{"wakeAgent": false}';
 return ['aqeelOS posting limits, checked '+d.clock+' (these numbers count; they replace any count of your own):',
  '- Today: '+d.today+' of '+d.perDay+' posted'+(r.hotShare>0?', '+d.share+'% hot leads (target '+r.hotShare+'%)':'')+'.',
  '- Last hour: '+d.hour+' of '+d.cap+(d.why?' ('+d.why+')':'')+'. '+(d.since==null?'Nothing posted yet.':'Last post '+d.since+' min ago.'),
  '- This run: post at most '+d.n+(d.n>1?', at least '+r.gapMin+' min apart':'')+'.',
  ...(r.hotShare>0?[d.needHot?'- The hot share is below target: post only to HOT leads this run.':'- The hot share is on target: hot leads first; one warm lead is fine.']:[]),
  '- Right after EACH post, call record_post (aqeelos-notify) with the post link, the exact text you posted and the lead (hot or warm). It checks that the public can see it.',
  '- If record_post says it is NOT visible: stop posting this run, and start your final answer with the line [CRON_FAILURE], then one line on what happened.'].join('\n')}

// the same, when the agent has limits per kind or a schedule posts several kinds: list = [{kind,d,rule}], j = jobDecision(list)
export function gateTextKinds(list,j){const clock=list[0]?.d.clock||'';if(!j.allow)return 'aqeelOS posting limits ('+clock+'): no post this run. '+j.reason+'\n{"wakeAgent": false}';
 return ['aqeelOS posting limits, checked '+clock+' (these numbers count; the scripts that post ask aqeelOS first and refuse what is over the limit):',
  ...list.map(x=>'- '+(KIND_NAME[x.kind]||x.kind)+': '+(x.d.allow?'today '+x.d.today+' of '+x.d.perDay+', last hour '+x.d.hour+' of '+x.d.cap+(x.d.why?' ('+x.d.why+')':'')+', '+(x.d.since==null?'none yet':'last '+x.d.since+' min ago')+(x.rule&&x.rule.gapMin?', at least '+x.rule.gapMin+' min apart':'')+'; room for '+x.d.n+' this run.':'none now. '+x.d.reason)),
  '- A posting script that answers REFUSED_POSTING_LIMIT is final for this run: do not post another way (no other script, no typing it in the browser yourself).',
  '- The scripts record each post themselves. A post made any other way must be recorded with record_post (aqeelos-notify): the link and the exact text.'].join('\n')}

// the words to look for on the public page: letters and digits only (Threads shortens links and shows emoji its own way)
export const squash=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function needle(text){const s=squash(String(text||'').split('\n').find(l=>squash(l).length>=12)||text);return s.slice(0,40)}
export const seen=(page,text)=>{const n=needle(text);return n.length>=6&&squash(page).includes(n)};

// a public page as someone signed out sees it: a fresh headless Chrome with an empty profile, closed after each look
export function headlessLook({chrome='/opt/aqeelos/chrome/chrome',wait=9000}={}){let chain=Promise.resolve();
 const once=async url=>{const dir=await mkdtemp(path.join(tmpdir(),'aq-look-'));let c;
  try{c=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+dir,'--window-size=1200,2400','about:blank'],{stdio:['ignore','ignore','pipe']});
   const wsUrl=await new Promise((res,rej)=>{let b='';const t=setTimeout(()=>rej(Error('the check browser did not start')),20000);c.on('error',e=>{clearTimeout(t);rej(e)});
    c.stderr.on('data',d=>{b+=d;const m=/DevTools listening on (ws:\S+)/.exec(b);if(m){clearTimeout(t);res(m[1])}})});
   const ws=new WebSocket(wsUrl);let i=0;const pend={};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}};
   await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(Error('the check browser did not answer'))});
   const call=(method,params={},sessionId)=>new Promise(r=>{i++;pend[i]=r;ws.send(JSON.stringify({id:i,method,params,...(sessionId?{sessionId}:{})}))});
   const {result:{targetId}}=await call('Target.createTarget',{url:'about:blank'});const {result:{sessionId}}=await call('Target.attachToTarget',{targetId,flatten:true});
   await call('Page.navigate',{url},sessionId);await new Promise(r=>setTimeout(r,wait));
   await call('Runtime.evaluate',{expression:'window.scrollBy(0,2400)'},sessionId);await new Promise(r=>setTimeout(r,2500));
   const v=(await call('Runtime.evaluate',{expression:'document.body?document.body.innerText:""',returnByValue:true},sessionId)).result?.result?.value;ws.close();
   if(typeof v!=='string')throw Error('the page did not load');return v}
  finally{if(c&&c.exitCode==null){const gone=new Promise(r=>c.once('exit',r));c.kill('SIGKILL');await Promise.race([gone,new Promise(r=>setTimeout(r,5000))])}
   await rm(dir,{recursive:true,force:true}).catch(()=>{})}};
 // one look at a time on the box (each is a whole Chrome)
 return url=>{const p=chain.then(()=>Promise.race([once(url),new Promise((_,rej)=>setTimeout(()=>rej(Error('the check took too long')),60000))]));chain=p.catch(()=>{});return p}}

export function createPostingLimits({DATA,WORK,HERMES_HOME,PORT,live=true,reconnect=async()=>{},sig,setKey,readConfig,pick,look=headlessLook(),event=async()=>{},solved=async()=>{},engineTools=async()=>null,lastAnswer=async()=>'',telegram=async()=>false,signAll=null,nameOf=a=>a,log=m=>console.log(m),now=()=>Date.now(),retryMs=40000}){
 // every signature in the agents' folders is kept current by relay-heal.mjs (signAll: (label, agent) => signature, from relay-keys.mjs); ensure() runs it
 const heal=signAll?createRelayHeal({HERMES_HOME,WORK,sign:signAll,readConfig,pick,log}):null;
 const FILE=path.join(DATA,'posting-limits.json'),LOGS=path.join(DATA,'posting-log');let db=null;
 const load=async()=>{if(!db){db=await readStore(FILE);db.agents||={};db.gates||={};db.gateLog||={}}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(db,null,1))};
 const posts=new Map();
 const logFile=a=>path.join(LOGS,a+'.json');
 async function entries(a){if(!posts.has(a)){let l=[];try{l=JSON.parse(await readFile(logFile(a),'utf8'))}catch{}posts.set(a,l)}return posts.get(a)}
 async function keep(a){const l=(await entries(a)).filter(e=>now()-e.at<14*864e5);posts.set(a,l);await mkdir(LOGS,{recursive:true});await writeFile(logFile(a)+'.tmp',JSON.stringify(l));await rename(logFile(a)+'.tmp',logFile(a))}
 const rulesOf=async a=>{await load();return db.agents[a]?clean(db.agents[a]):null};
 const stopped=async(a,r)=>!!(r.stopFile&&await stat(path.join(WORK,a,r.stopFile)).catch(()=>null));
 const gateName='aqeelos-posting-gate.sh',gatePath=a=>path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'scripts',gateName);
 // the gate script the engine runs before a posting run (its last line says whether the AI starts at all)
 async function writeGate(a){if(!live)return gateName;const f=gatePath(a);await mkdir(path.dirname(f),{recursive:true});
  const body='#!/bin/bash\n# Written by aqeelOS (Schedules › Run rules › Posting limits). Asks aqeelOS whether this run may post.\n'
   +'curl -sf -m 20 "http://127.0.0.1:'+PORT+'/posting-gate/'+a+'/'+sig(a)+'" || printf \'aqeelOS did not answer, so no post this run.\\n{"wakeAgent": false}\\n\'\n';
  if((await readFile(f,'utf8').catch(()=>''))!==body){await writeFile(f,body,{mode:0o700});await chmod(f,0o700)}return gateName}
 const stoppedFor=async(a,r,kind)=>{const rk=ruleFor(r,kind);return rk?stopped(a,rk):false};
 const normKind=(k,r)=>KINDS.includes(String(k||'').toLowerCase())?String(k).toLowerCase():defaultKind(r);
 // kinds: the kinds this run's schedule posts (run-gates.mjs); none = the posting gate script of the whole agent
 async function gate(a,{kinds=null}={}){const r=await rulesOf(a);if(!r?.on)return 'aqeelOS posting limits are off for this agent: no post this run.\n{"wakeAgent": false}';
  const l=await entries(a);let text,d0;
  if(!(kinds&&kinds.length)&&!hasSubjects(r)){const d=decide(r,l,{now:now(),stopped:await stopped(a,r)});d0=d;text=gateText(r,d)}
  else{const ks=kinds&&kinds.length?kinds:KINDS.filter(k=>r.subjects[k]),list=[];
   for(const k of ks)list.push({kind:k,d:decideKind(r,l,k,{now:now(),stopped:await stoppedFor(a,r,k)}),rule:ruleFor(r,k)});
   const j=jobDecision(list);d0={allow:j.allow,n:Math.max(0,...list.map(x=>x.d.allow?x.d.n:0)),reason:j.reason};text=gateTextKinds(list,j)}
  await load();db.gates[a]={at:now(),allow:d0.allow,n:d0.n,reason:d0.reason};db.gateLog[a]=[...(db.gateLog[a]||[]),{at:now(),allow:d0.allow,n:d0.n}].filter(g=>now()-g.at<48*3600e3).slice(-120);await save();return text}

 // the same decision as the gate, for a script that posts without a model (12 Nov 2026, the comment queue): numbers, no text, nothing logged as a gate call
 async function allowNow(a,kind){const r=await rulesOf(a);if(!r?.on)return {allow:false,n:0,reason:'aqeelOS posting limits are off for this agent'};
  kind=normKind(kind,r);const d=decideKind(r,await entries(a),kind,{now:now(),stopped:await stoppedFor(a,r,kind)});return {allow:d.allow,n:d.n,reason:d.allow?'':await told(a,kind,d.reason||'not now',r.tz),kind,today:d.today,perDay:d.perDay,hour:d.hour,cap:d.cap,sinceMin:d.since,gapMin:ruleFor(r,kind)?.gapMin??r.gapMin}}

 // A refusal that repeats (12 Nov 2026): an agent refused for the same reason every few minutes posted the same warning to the team chat each time.
 // The first refusal of a reason is plain; the same reason for the same agent and kind within the hour comes with "already reported at <time>; do not
 // report again", and the memory is cleared when that kind may post again.
 const TOLD_MS=3600e3;
 async function told(a,kind,reason,tz){await load();const t=(db.told||={}),k=a+'|'+kind,key=String(reason).replace(/\d+/g,'#'),x=t[k];
  if(x&&x.key===key&&now()-x.at<TOLD_MS)return reason+' Already reported at '+local(x.at,tz).clock+'; do not report this again.';
  t[k]={key,at:now()};await save().catch(()=>{});return reason}
 async function forget(a,kind){await load();if(db.told?.[a+'|'+kind]){delete db.told[a+'|'+kind];await save().catch(()=>{})}}
 // the posting guard's file in the agent's workspace (.tools/posting-guard.json): the app owns it and makes it again with the key in use
 async function guardFile(a){if(!live||!heal)return 'none';try{const r=await heal.guardFile(a,{base:'http://127.0.0.1:'+PORT,sig:sig(a)});if(r!=='none'&&db?.keyStale?.[a]){delete db.keyStale[a];await save().catch(()=>{});await solved(a,'posting-guard-key').catch(()=>{})}return r}
  catch(e){log('posting guard file '+a+': '+e.message);return 'failed'}}
 // a posting route refused a signature (server.mjs): make the file again now, so the guard's one retry reads the new one. When that cannot be done
 // there is ONE Health item (and again after 6 hours at the earliest), never one per run.
 const staleAt=new Map();
 async function staleKey(a0){const a=String(a0).split('--')[0];try{return await staleKey1(a)}catch(e){log('posting guard key '+a+': '+e.message);return 'failed'}}
 async function staleKey1(a){await load();const r=await rulesOf(a);if(!r?.on||!live||now()-(staleAt.get(a)||0)<60e3)return 'ignored';staleAt.set(a,now());
  const res=await guardFile(a);if(res==='written'){log('posting: the guard key of '+a+' was out of date and is made again');return 'written'}
  // the file already holds the key in use: the refused signature came from somewhere else (anything on this box can call the route with a made-up
  // one, for any agent), so there is nothing to repair and nothing to tell the owner (review of 12 Nov 2026)
  if(res==='same')return 'ignored';
  const k=(db.keyStale||={});if(now()-(k[a]||0)>6*3600e3){k[a]=now();await save().catch(()=>{});
   await event('guard-key',nameOf(a)+": the posting guard's key is out of date",'The posting guard in its workspace (.tools/posting-guard.json) is refused by aqeelOS and could not be made again ('+res+'). Nothing is posted until it is. aqeelOS re-issues it at its next start.',{topic:'posting-guard-key',agent:a}).catch(()=>{})}
  return 'raised'}
 // ---- the guard: what the scripts that post call (scripts/posting-guard.py) ----
 // one thing at a time per agent, so two checks can never both take the last slot
 const mu=new Map();const exclusive=(a,fn)=>{const p=(mu.get(a)||Promise.resolve()).then(()=>fn());mu.set(a,p.catch(()=>{}));return p};
 const nums=d=>({today:d.today,perDay:d.perDay,hour:d.hour,cap:d.cap,sinceMin:d.since});
 // check: may one post of this kind go out now. Allowed = a ticket that counts against the limits from this moment.
 async function guard(a,kind){return exclusive(a,async()=>{const r=await rulesOf(a);if(!r?.on)return {allow:false,reason:'aqeelOS posting limits are off for this agent, so nothing may be posted.'};
  kind=String(kind||'').toLowerCase();if(!KINDS.includes(kind))return {allow:false,reason:'Unknown kind "'+kind+'": use '+KINDS.join(', ')+'.'};
  const l=await entries(a),d=decideKind(r,l,kind,{now:now(),stopped:await stoppedFor(a,r,kind)});
  if(!d.allow){await load();const g=(db.refused||={})[a]=((db.refused||{})[a]||[]).filter(x=>now()-x<48*3600e3);g.push(now());await save().catch(()=>{});return {allow:false,kind,reason:await told(a,kind,d.reason,r.tz),...nums(d)}}
  await forget(a,kind);
  const e={id:randomBytes(5).toString('hex'),at:now(),kind,status:'pending',post:'',text:'',lead:'hot'};l.push(e);await keep(a);
  return {allow:true,kind,ticket:e.id,...nums(d)}})}
 // sending: the click that posts is next. cancel: nothing was posted (not after sending: then the record, or the lack of it, is what counts)
 async function mark(a,ticket,op){return exclusive(a,async()=>{const l=await entries(a),e=l.find(x=>x.id===String(ticket||''));if(!e)return {ok:false,text:'No such ticket (it may have run out). Nothing changed.'};
  if(op==='sending'){if(e.status==='pending'){e.status='sending';e.sendingAt=now();await keep(a)}return {ok:['sending','checking','visible','recorded','unchecked'].includes(e.status),text:'ok'}}
  if(e.status==='pending'){posts.set(a,l.filter(x=>x!==e));await keep(a);return {ok:true,text:'Cancelled: it no longer counts.'}}
  return {ok:false,text:'Not cancelled: its state is '+e.status+'. It counts against the limits.'}})}
 async function alert(a,r,e,how){const who=nameOf(a),short=String(e.text).replace(/\s+/g,' ').slice(0,140);
  const title=who+': a post is not visible on Threads';
  const detail=(how==='later'?'It was visible at first and was gone '+r.recheckMin+' min later. ':'It was not visible right after posting. ')+'Post: '+(e.post||'unknown')+'. Text: "'+short+'". '+who+' posts at most '+r.afterMissingPerHour+' an hour for the next '+r.afterMissingHours+' hours.';
  await event('comment',title,detail,{topic:'comment|'+e.id,agent:a}).catch(()=>{});
  const m=/^telegram:(-?\d+)(?::(\d+))?$/.exec(r.alert||'');let sent=false;if(m)sent=await telegram(a,m[1],m[2]||null,'⚠️ '+title+'\n'+detail).catch(()=>false);
  e.alerted=now();e.alertSent=!!sent;log('posting: '+a+' post '+e.id+' not visible ('+how+')'+(m&&!sent?', alert not delivered':''))}
 // look on the public page first, then on the post itself
 // 'unchecked' when no page could be opened at all (the check browser failed): that is not the post's fault
 async function check(a,r,e){let looked=false;for(const u of [r.checkUrl,e.post].filter(Boolean)){try{const p=await look(u);looked=true;if(seen(p,e.text))return 'visible'}catch{}}return looked?'missing':'unchecked'}

 // record_post (the agent's tool) and /posting-record (the posting scripts): what was just posted. With a ticket from guard() it closes that ticket;
 // without one it closes the oldest open ticket of that kind from the last half hour, or counts as a new post. A post over the limits, or made while the
 // pause file is there, is recorded and answered as an error that says to stop. Comments (and threads with a link) are looked up on the public page.
 async function record(a,{post_url,ref,text,lead,kind,ticket}={}){const r=await rulesOf(a);if(!r?.on)return {isError:true,text:'You have no posting limits in aqeelOS, so nothing to record.'};
  const t=String(text||'').trim(),u0=String(post_url||ref||'').trim(),u=/^https:\/\/\S+$/.test(u0)?u0:'',id=u?'':u0.slice(0,200);kind=normKind(kind,r);
  if(u0&&!u&&!ticket&&post_url)return {isError:true,text:'post_url is the full https:// link of the post you replied to.'};
  const open=['pending','sending','unrecorded'];
  const got=await exclusive(a,async()=>{const l=await entries(a);
   let e=ticket?l.find(x=>x.id===String(ticket)):l.filter(x=>kindOf(x)===kind&&['pending','sending'].includes(x.status)&&now()-x.at<30*60e3).sort((x,y)=>x.at-y.at)[0];
   if(ticket&&e&&!open.includes(e.status))return {again:e};          // the same ticket twice: nothing new
   if(!e&&!t&&kind==='comment')return {err:'Give the exact text you posted.'};
   const stop=await stoppedFor(a,r,kind),lateRec=e?.status==='unrecorded';
   const before=e?null:decideKind(r,l,kind,{now:now(),stopped:stop});
   if(e){Object.assign(e,{status:'checking',at:now(),post:u,ref:id,text:t.slice(0,2000),lead:lead==='warm'?'warm':'hot'});if(lateRec){e.late=true;delete e.unrecordedAt}
    if(stop)e.over=decideKind(r,[],kind,{now:now(),stopped:true}).reason}
   else{e={id:randomBytes(5).toString('hex'),at:now(),kind,post:u,ref:id,text:t.slice(0,2000),lead:lead==='warm'?'warm':'hot',status:'checking'};if(!before.allow)e.over=before.reason;l.push(e)}
   await keep(a);return {e}});
  if(got.err)return {isError:true,text:got.err};if(got.again)return {text:'Already recorded.'};
  const e=got.e;const l=await entries(a);
  if(e.over)await event('comment',nameOf(a)+' posted over its limits',e.over+' Post: '+(u||id||'unknown')+'.',{topic:'comment-over',agent:a}).catch(()=>{});
  const rep=await repeatOf(a,r,e,l);
  const needCheck=!!t&&(kind==='comment'||(kind==='thread'&&!!u));let s;
  if(needCheck){s=await check(a,r,e);if(s!=='visible'){await new Promise(x=>setTimeout(x,retryMs));s=await check(a,r,e)}}else s='recorded';
  e.checkedAt=now();if(s==='missing'){e.status='missing';e.missingAt=now();await alert(a,r,e,'now')}else e.status=s;await keep(a);
  const d=decideKind(r,l,kind,{now:now(),stopped:await stoppedFor(a,r,kind)});const count='Today: '+d.today+' of '+d.perDay+(r.hotShare>0&&kind==='comment'?', '+d.share+'% hot':'')+(hasSubjects(r)?' ('+(KIND_NAME[kind]||kind)+')':'')+'.';
  const said=x=>rep?{...x,text:x.text+' '+rep}:x;
  if(e.over)return said({isError:true,text:'STOP posting this run: this post was over the limits ('+e.over+'). It is recorded and the owner sees it under Bottlenecks. '+count});
  if(e.status==='visible')return said({text:'Recorded and visible to the public on Threads (checked signed out). '+count});
  if(e.status==='recorded')return said({text:'Recorded. '+count});
  if(e.status==='unchecked')return said({text:'Recorded. The visibility check could not run right now; aqeelOS checks it again within minutes. '+count});
  return said({isError:true,text:'NOT visible: the post cannot be found on the public page or the post itself (checked signed out, twice). The owner has been told. Stop posting this run, and start your final answer with the line [CRON_FAILURE], then one line on what happened.'})}

 // The same post answered twice (15 Nov 2026, Cove Threads: two answering runs 11 minutes apart each answered one reply, and
 // on 12 Nov one person got the same answer reworded five times). The owner: "if there are things that conflict, agents need to
 // be able to spot it, or even show it on Bottlenecks". A comment recorded for a link that already got one of ours in the last
 // day is told to the agent in the record's answer (so it stops), and shown under Bottlenecks with the alert chat told, so a
 // person deletes the extra one. Their next message has its own link, so a real conversation is never flagged.
 const hm=(ms,tz)=>{try{return new Date(ms).toLocaleTimeString('en-GB',{timeZone:tz||undefined,hour:'2-digit',minute:'2-digit'})}catch{return new Date(ms).toISOString().slice(11,16)}};
 async function repeatOf(a,r,e,l){if(kindOf(e)!=='comment'||!e.post)return '';
  const prev=l.filter(x=>x.id!==e.id&&x.post===e.post&&kindOf(x)==='comment'&&!['pending','sending'].includes(x.status)&&e.at-x.at<24*3600e3&&e.at>=x.at).sort((x,y)=>y.at-x.at)[0];
  if(!prev)return '';e.repeatOf=prev.id;await keep(a);
  const who=nameOf(a),q=x=>'"'+String(x.text||'').replace(/\s+/g,' ').slice(0,120)+'"';
  const title=who+' answered the same post twice';
  const detail='Post: '+e.post+'. First at '+hm(prev.at,r.tz)+': '+q(prev)+'. Again at '+hm(e.at,r.tz)+': '+q(e)+'. Open the post and delete the extra reply, keep the first. '+who+' was told not to send to this post again.';
  await event('repeat',title,detail,{topic:'repeat|'+a+'|'+e.post,agent:a,data:{post:e.post}}).catch(()=>{});
  const m=/^telegram:(-?\d+)(?::(\d+))?$/.exec(r.alert||'');if(m)await telegram(a,m[1],m[2]||null,'⚠️ '+title+'\n'+detail).catch(()=>false);
  log('posting: '+a+' answered '+e.post+' again ('+prev.id+' then '+e.id+')');
  return 'REPEAT: this post already had our answer at '+hm(prev.at,r.tz)+' ('+q(prev)+'). Do not send to this post again in this or any run; the owner sees it under Bottlenecks. If they wrote something new, it has its own link: answer that one.'}

 // a script said it was about to post and never recorded it: it may have posted, so it stays counted and is ONE Health item per agent.
 // A ticket that never got as far as "sending" is dropped after the same time (the script died before it posted).
 async function expire(a,r){return exclusive(a,async()=>{const l=await entries(a),ms=r.unrecordedSec*1000;let ch=false;
  for(const e of l)if(e.status==='sending'&&now()-(e.sendingAt||e.at)>ms){e.status='unrecorded';e.unrecordedAt=now();ch=true;log('posting: '+a+' '+kindOf(e)+' ticket '+e.id+' was sent and never recorded')}
  const stale=l.filter(e=>e.status==='pending'&&now()-e.at>ms);if(stale.length){posts.set(a,l.filter(e=>!stale.includes(e)));ch=true}
  if(ch)await keep(a)})}
 const unrecordedOf=async a=>(await entries(a)).filter(e=>e.status==='unrecorded'&&now()-e.at<24*3600e3);
 const unrecAt=new Map();
 async function unrecordedItem(a){if(now()-(unrecAt.get(a)||0)<10*60e3)return;unrecAt.set(a,now());const u=await unrecordedOf(a),topic='unrecorded';
  if(u.length){const when=new Date(u[0].sendingAt||u[0].at).toISOString().slice(0,16).replace('T',' ')+' UTC';
   await event('silent',nameOf(a)+': '+u.length+' posting action'+(u.length===1?'':'s')+' without a record',
    'A posting script said it was about to post ('+u.map(e=>KIND_NAME[kindOf(e)]||kindOf(e)).join(', ')+'; the first at '+when+') and no record came, so it may have posted. They count against the limits. Look at the profile and at the script\'s last output. Gone by itself 24 hours after the last one.',{topic,agent:a}).catch(()=>{})}
  else await solved(a,topic).catch(()=>{})}

 // one line for System › Health: today's numbers per kind against the limits, and the unrecorded actions
 async function line(a){const r=await rulesOf(a);if(!r?.on)return null;const l=await entries(a),ks=hasSubjects(r)?KINDS.filter(k=>r.subjects[k]):[defaultKind(r)],u=(await unrecordedOf(a)).length;
  const rows=ks.map(k=>({kind:k,name:KIND_NAME[k],d:decideKind(r,l,k,{now:now(),stopped:false})}));
  const refused=(((await load()).refused||{})[a]||[]).filter(x=>now()-x<24*3600e3).length;
  return {agent:a,unrecorded:u,refused,kinds:rows.map(x=>({kind:x.kind,today:x.d.today,perDay:x.d.perDay,hour:x.d.hour,cap:x.d.cap})),
   text:'Posting today: '+rows.map(x=>x.name+' '+x.d.today+'/'+x.d.perDay+' (hour '+x.d.hour+'/'+x.d.cap+')').join(', ')+'. Unrecorded actions: '+u+'.'+(refused?' Refused by the limits: '+refused+'.':'')}}

 // every minute: checks that could not run, and the second look about 30 minutes after each post
 let busy=false;const silenceAt=new Map();
 // ONE Health item per agent while its runs are allowed to post and no post is recorded (silent-ok.mjs); gone by itself once one is
 async function silence(a,r,l){if(now()-(silenceAt.get(a)||0)<10*60e3)return;silenceAt.set(a,now());await load();
  const gates=db.gateLog[a]||[],stop=await stopped(a,r),topic='silent-posting';
  const x=silentPosting({gates,entries:l,now:now(),stopped:stop,tools:await engineTools(a).catch(()=>null),answer:await lastAnswer(a).catch(()=>'')});
  if(x)await event('silent',x.text,x.detail,{topic,agent:a}).catch(()=>{});else await solved(a,topic).catch(()=>{})}
 let ticks=0;
 async function tick(){if(busy)return;busy=true;try{await load();if(++ticks%10===0)await ensure().catch(x=>log('posting ensure: '+x.message));for(const a of Object.keys(db.agents)){const r=await rulesOf(a);if(!r?.on)continue;await expire(a,r).catch(x=>log('posting expire: '+x.message));await unrecordedItem(a).catch(x=>log('posting unrecorded: '+x.message));const l=await entries(a);await silence(a,r,l.filter(x=>x.status!=='pending')).catch(x=>log('posting silence: '+x.message));
   const e=l.find(x=>(x.status==='unchecked'&&now()-x.at>60e3)||(x.status==='checking'&&now()-x.at>120e3))||   // 'checking' for over 2 minutes: the app restarted during the look (audit M15)
    l.find(x=>x.status==='visible'&&!x.rechecked&&now()-x.at>=r.recheckMin*60e3&&now()-x.at<6*3600e3);if(!e)continue;
   const s=await check(a,r,e);if(s!=='unchecked'&&e.status==='checking')e.status='unchecked';if(s==='unchecked'){if(e.status==='checking')e.status='unchecked';if(now()-e.at>3600e3){e.status='missing';e.missingAt=now();e.checkFailed=true;await alert(a,r,e,'now')}continue}
   if(e.status==='visible')e.rechecked=now();e.checkedAt=now();
   if(s==='missing'){const was=e.status;e.status='missing';e.missingAt=now();await alert(a,r,e,was==='visible'?'later':'now')}else e.status='visible';await keep(a)}}
  catch(x){log('posting check: '+x.message)}finally{busy=false}}

 // Run rules panel: the agent's one-at-a-time setting, its limits, today's numbers and its recent posts
 async function view(a){const c=await readConfig(a).catch(()=>null);const serial=Number(pick(c||{},'cron.max_parallel_jobs'))===1;const r=await rulesOf(a),l=await entries(a);await load();
  const dk=r?defaultKind(r):'comment',d=r?decideKind(r,l,dk,{now:now(),stopped:await stoppedFor(a,r,dk)}):null;
  const kinds=r&&hasSubjects(r)?await Promise.all(KINDS.filter(k=>r.subjects[k]).map(async k=>({kind:k,name:KIND_NAME[k],rule:ruleFor(r,k),status:decideKind(r,l,k,{now:now(),stopped:await stoppedFor(a,r,k)})}))):[];
  return {agent:a,serial,rules:r||{...DEFAULTS},set:!!r,gateScript:gateName,status:d,stopped:r?await stoppedFor(a,r,dk):false,kind:dk,kinds,unrecorded:r?(await unrecordedOf(a)).length:0,lastGate:db.gates[a]||null,
   recent:l.slice(-25).reverse().map(e=>({id:e.id,at:e.at,kind:kindOf(e),post:e.post||e.ref||'',text:String(e.text||'').slice(0,240),lead:e.lead,status:e.status,rechecked:e.rechecked||null,over:e.over||null,alerted:e.alerted||null}))}}
 async function set(a,b){if(b.serial!==undefined){const r=await setKey(a,'cron.max_parallel_jobs',b.serial?'1':'0');if(r&&r.ok===false)throw Error('Could not change it: '+String(r.out||'').trim().slice(-200))}
  // turned on: its gate script, and its aqeelOS tool connection again. The engine keeps the tool list it read first, so this alone did not
  // give a running agent record_post (11 Nov): the tool is now listed for every agent from the start (server.mjs tools/list)
  if(b.rules){await load();const was=!!db.agents[a]?.on;const r=clean({...(db.agents[a]||{}),...b.rules});db.agents[a]=r;await save();if(r.on){await writeGate(a);await guardFile(a)}if(r.on!==was&&live)await reconnect(a).catch(e=>log('posting: tool reconnect '+a+': '+e.message))}
  return view(a)}
 // gate scripts for every agent with limits on (a restored box, a new port)
 async function ensure(){await load();for(const a of Object.keys(db.agents))if(db.agents[a].on){await writeGate(a).catch(e=>log('posting gate '+a+': '+e.message));await guardFile(a)}
  // every other signature in the agents' folders too (relay-heal.mjs), so none of them can go stale after a key rotation
  if(live&&heal){const r=await heal.sweep().catch(e=>({changed:[],failed:[],err:e.message}));if(r.changed.length)log('relay keys: '+r.changed.length+' file(s) in the agents folders carried an old signature and were made again')}}
 const usesLimits=async a=>!!(await rulesOf(a))?.on;
 return {gate,allowNow,guard,mark,record,line,tick,view,set,ensure,staleKey,usesLimits,gateName,silence:async a=>{silenceAt.delete(a);const r=await rulesOf(a);if(r?.on)await silence(a,r,await entries(a))}}}
