// Continue after a restart (owner, 12 Nov 2026): "like the try again button, but you don't have to press it".
// Nothing waits for an idle box any more, so a deploy, the nightly update, a crash or an engine restart can cut work in
// two. This keeps a journal of what is in progress (DATA/resume/journal.json, written as things start and end, so a
// crash is covered too) and, once the app and the engine are back, continues each thing once:
//  - a chat reply aqeelOS was streaming: one more message goes into the same chat (the path the chat's Retry uses), a
//    short system note that says it was interrupted. Whether the note asks the agent to check what already went out
//    depends on what the engine's own record of the chat shows (chatPlan);
//  - a schedule run the engine had running: its "run now" (POST /api/cron/jobs/<id>/trigger), unless it finished,
//    delivered, or ran again meanwhile (runPlan);
//  - a fixer run: its process outlives the app, so it is only looked at again (the fixer loop takes it from there).
//  - a background task a chat's agent had handed to a sub-run (the engine's "background delegation", its ledger table
//    async_delegations): after a restart the engine itself hands an interrupted one back to the chat as an "interrupted" result
//    (it cannot start it again with its brief). aqeelOS journals it while it runs (kind 'deleg', read on the 30 s tick), counts it
//    on Health once the engine has handed it back, and when the engine did not (a web chat), tells the agent once in that chat:
//    "your background task <title> was interrupted by a restart at <time>; start it again if it is still needed" (delegNote,
//    delegPlan). In a Telegram or WhatsApp chat nothing is sent from here (the engine's hand-back is the message);
//  - a Telegram, WhatsApp (any channel) chat: the engine itself carries on from the person's last message (its
//    resume_pending, which the patch engine/patches/2026-11-12-channel-resume-continue.patch turns from "session restored,
//    what next?" into "continue; check what already went out"). aqeelOS only watches: it journals every channel chat the
//    engine has marked (kind 'channel', syncChannels), counts it on Health when the engine has carried on (the mark is
//    gone), and lists it when the engine did not (older than the limit, or the provider never answered). It sends nothing
//    there: a second message from here would be a second reply to a person or customer.
// Rules: an entry is continued once (claimed on disk before the call; what happened is read from the engine before any
// second try), nothing older than the limit (2 h unless the install says otherwise), three interruptions of the same
// thing and it stops, a provider that does not answer is tried again later instead of dropped.
// The rules are pure and tested (scripts/resume.test.mjs); the engine side is resume-engine.mjs; server.mjs wires both.
import {storeHooks} from './store.mjs';
import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const many=(n,one,more=one+'s')=>n+' '+(n===1?one:more);

/* ---------- the note the agent gets ---------- */
export const NOTE_START='[System note from aqeelOS: you were interrupted by ';
export const NOTE_RE=/^\[System note from aqeelOS: you were interrupted by (an update|a restart) at [^\]]*\]\s*/;
// tools that only read: after these alone, nothing can have gone out
export const READ_ONLY=/^(read_file|search_files|web_search|web_extract|session_search|skill_view|skills_list|memory|todo|tool_search|tool_describe|vision_analyze|clarify|_thinking)$/;
export const outward=tools=>(tools||[]).some(t=>!READ_ONLY.test(String(t)));
const hhmm=(t,tz)=>{try{return new Intl.DateTimeFormat('en-GB',{timeZone:tz||undefined,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t))}catch{return new Date(t).toISOString().slice(11,16)}};
// started: the agent had done something; caution: something may have gone out (or it cannot be known);
// text: the person's message, added only when the engine never stored it
export function noteFor({why='restart',at,tz='',started=false,caution=false,text=''}){
 const head=NOTE_START+(why==='update'?'an update':'a restart')+' at '+hhmm(at,tz);
 const say=!started?'; nothing had been done yet. Carry on with my last message.]'
  :caution?'; check what already went out before repeating it. Then continue my last request from where you stopped.]'
  :'. Continue my last request from where you stopped; do not redo steps whose results are already above.]';
 return head+say+(text?'\n\n'+text:'')}

// the note for a background task the restart cut off (the chat's agent decides whether it is still needed)
export const delegNote=({title='',at,tz='',why='restart'})=>NOTE_START.replace('you were interrupted by ','your background task ')+'“'+String(title||'a background task').replace(/\s+/g,' ').slice(0,100)+'” was interrupted by '+(why==='update'?'an update':'a restart')+' at '+hhmm(at,tz)+'; start it again if it is still needed.]';

/* ---------- what to do with one interrupted thing ----------
   Each answers {do:'send'|'trigger'|'kick'|'wait'|'skip'|'giveup', why, ...}. `p` is what the engine's own record says
   (resume-engine.mjs); null = it could not be read, which is never a reason to act. */
const tooOld=(e,now,maxAge)=>now-(e.cut0||e.cutAt||e.at)>maxAge;
const ageWhy=maxAge=>'older than '+(maxAge>=3600e3?Math.round(maxAge/360e3)/10+' h':Math.round(maxAge/60e3)+' min');
export const MAX_TIMES=3;
// p: {missing, pending, markedAt (ms)}: the engine's own routing record of the chat (gateway_routing.resume_pending)
export function channelPlan(e,p,now,{maxAge=7200e3}={}){
 const old=tooOld(e,now,maxAge);
 if(!p)return old?{do:'giveup',why:ageWhy(maxAge)}:{do:'wait',why:'the engine’s record of the chat could not be read'};
 if(p.missing)return {do:'skip',why:'the chat no longer exists'};
 if(!p.pending)return {do:'done'};   // the engine carried on and cleared its mark
 if(old)return {do:'giveup',why:'the engine did not carry on within '+ageWhy(maxAge).replace('older than ','')+' (the provider may not have answered)'};
 return {do:'wait',why:'the engine is continuing it'}}
// p: {missing, stored, answered, personAfter, tools:[names], openCall, posted, lastAt (ms), engineSame}
export function chatPlan(e,p,now,{maxAge=7200e3,tz=''}={}){
 const old=tooOld(e,now,maxAge);
 if(!p)return old?{do:'giveup',why:ageWhy(maxAge)}:{do:'wait',why:'the engine’s record of the chat could not be read'};
 if(p.missing)return {do:'giveup',why:'the chat no longer exists'};
 if(p.personAfter)return {do:'skip',why:'the person wrote again'};
 if(p.answered)return {do:'skip',why:'it was already answered'};
 if(old)return {do:'giveup',why:ageWhy(maxAge)};
 if((e.n||0)>=MAX_TIMES)return {do:'giveup',why:'interrupted '+MAX_TIMES+' times while continuing'};
 // still moving: an app restart leaves the engine's turn running (wait longer), an engine restart may be followed by
 // the engine's own recovery (a short wait)
 const quiet=p.engineSame?180e3:45e3;if(p.lastAt&&now-p.lastAt<quiet)return {do:'wait',why:'the engine is still working on it'};
 const started=!!(p.stored&&((p.tools||[]).length||p.openCall||p.partial)),caution=started&&(p.openCall||p.posted||outward(p.tools));
 return {do:'send',caution:!!caution,started,note:noteFor({why:e.why,at:e.cutAt||now,tz,started,caution,text:p.stored?'':e.text||''})}}
// p: {missing, status, error, delivered, ownerLive, newer, enabled, posted}
export const CUT_ERR=/interrupt|restart|shutdown|shut down|cancel|terminat|killed|sigterm|sigkill|owner.*(gone|dead)|process.*(gone|dead|exited)/i;
export function runPlan(e,p,now,{maxAge=7200e3}={}){
 const old=tooOld(e,now,maxAge);
 if(!p)return old?{do:'giveup',why:ageWhy(maxAge)}:{do:'wait',why:'the engine’s record of the run could not be read'};
 if(p.status==='completed')return {do:'skip',why:'it finished'};
 if(p.newer)return {do:'skip',why:'it ran again since'};
 if((p.status==='running'||p.status==='claimed')&&p.ownerLive)return {do:'wait',why:'it is still running'};
 if(p.status==='failed'&&!CUT_ERR.test(String(p.error||'')))return {do:'skip',why:'it failed by itself'};
 if(old)return {do:'giveup',why:ageWhy(maxAge)};
 if((e.n||0)>=MAX_TIMES)return {do:'giveup',why:'interrupted '+MAX_TIMES+' times while continuing'};
 if(p.missing&&!p.jobKnown)return {do:'giveup',why:'the schedule no longer exists'};
 if(p.enabled===false)return {do:'giveup',why:'the schedule is switched off'};
 // an outward result that is already known is never repeated
 if(p.delivered)return {do:'giveup',why:'its result was already delivered, so it was not run again'};
 if(p.posted)return {do:'giveup',why:'it had already posted, so it was not run again'};
 return {do:'trigger'}}
// p: {missing, state, status, error, delivery:'pending'|'delivered'|'dropped', ownerLive, appChat, newer}: the engine's own ledger row of the task
export const DELEG_HANDBACK_MS=240e3;   // the engine hands an interrupted task back by itself within minutes of its start; later than that it did not
export function delegPlan(e,p,now,{maxAge=7200e3,tz=''}={}){
 const old=tooOld(e,now,maxAge);
 if(!p)return old?{do:'giveup',why:ageWhy(maxAge)}:{do:'wait',why:'the engine’s record of the task could not be read'};
 if(p.missing)return {do:'skip',why:'the engine no longer lists it'};
 if(/^(running|stalling|finalizing)$/.test(p.state||'')){if(p.ownerLive)return {do:'wait',why:'it is still running'};return old?{do:'giveup',why:ageWhy(maxAge)}:{do:'wait',why:'the engine has not closed it yet'}}
 if(p.status==='completed')return {do:'skip',why:'it finished'};
 if(p.newer)return {do:'skip',why:'it was started again since'};
 if(!(p.status==='unknown'||p.status==='interrupted'||CUT_ERR.test(String(p.error||''))))return {do:'skip',why:'it failed by itself'};
 if(p.delivery==='delivered')return {do:'done'};   // the engine handed the (interrupted) result back to the chat: the agent knows
 if(old)return {do:'giveup',why:ageWhy(maxAge)};
 if(p.delivery==='pending'&&now-(e.cutAt||now)<DELEG_HANDBACK_MS)return {do:'wait',why:'the engine is handing it back to the chat'};
 if((e.n||0)>=MAX_TIMES)return {do:'giveup',why:'interrupted '+MAX_TIMES+' times while continuing'};
 if(!p.appChat)return {do:'giveup',why:'the engine did not hand it back to the chat, and nothing is sent from here into a Telegram or WhatsApp chat'};
 return {do:'send',note:delegNote({title:e.title,at:e.cutAt||now,tz,why:e.why})}}
// p: {alive, done}
export function fixerPlan(e,p,now,{maxAge=7200e3}={}){
 if(!p)return {do:'wait',why:'the fixer’s record could not be read'};
 if(p.done)return {do:'skip',why:'it finished'};
 if(p.alive)return tooOld(e,now,maxAge)?{do:'skip',why:'it is still running'}:{do:'wait',why:'it is still running'};
 return {do:'kick'}}

/* ---------- the line on System › Health ---------- */
export function healthLine(last,{tz='',now=Date.now()}={}){if(!last||!last.at||now-last.at>24*3600e3)return '';
 const parts=[];if(last.chats)parts.push(many(last.chats,'chat'));if(last.schedules)parts.push(many(last.schedules,'schedule'));if(last.delegs)parts.push(many(last.delegs,'background task'));if(last.helpers)parts.push(many(last.helpers,'fixer run'));
 const failed=last.failed||[],head='Restarted at '+hhmm(last.at,tz)+': ';
 const cont=parts.length?parts.join(parts.length>2?', ':' and ')+' continued':'';
 const bad=failed.length?failed.length+' could not ('+failed.slice(0,3).map(f=>f.what+': '+f.why).join('; ')+(failed.length>3?'; and '+(failed.length-3)+' more':'')+')':'';
 const wait=last.waiting?many(last.waiting,'is','are')+' still waiting to continue':'';
 const all=[cont,bad,wait].filter(Boolean);return head+(all.length?all.join(', ')+'.':'nothing was in progress.')}

/* ---------- the journal and the pass ---------- */
const BACKOFF=[60e3,120e3,300e3,600e3];
export function createResume({DATA,actMs=180e3,now=()=>Date.now(),log=m=>console.log(m),on=true,maxAge=()=>7200e3,tz=()=>'',stagger=4000,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
 // ready(): the app and the engine answer. probe*/act*: see the plans above. Each act answers {ok} | {retry,why} | {fail,why}
 ready=async()=>true,probeChat=async()=>null,sendChat=async()=>({fail:true,why:'not wired'}),probeRun=async()=>null,triggerRun=async()=>({fail:true,why:'not wired'}),
 probeChannel=async()=>null,probeDeleg=async()=>null,probeFixer=async()=>null,kickFixer=async()=>({ok:true}),nameOf=a=>a}={}){
 const FILE=path.join(DATA,'resume','journal.json'),NOTE=path.join(DATA,'resume','planned.json'),PROC=randomBytes(6).toString('hex');
 let j=null;
 const load=()=>{if(j)return j;try{j=JSON.parse(readFileSync(FILE,'utf8'))}catch(e){j=null;if(e.code!=='ENOENT'){const keep=FILE+'.corrupt-'+now();try{renameSync(FILE,keep)}catch{}log('resume: the journal could not be read ('+e.message+'); it is kept as '+path.basename(keep)+' and a new one starts');try{storeHooks.bad?.(FILE,'kept as '+path.basename(keep)+': '+e.message)}catch{}}}if(!j||typeof j!=='object'||!Array.isArray(j.entries))j={v:1,entries:[],done:[],last:null};j.done||=[];return j};
 // written at once and whole (a small file): a crash a moment later still finds it
 const save=()=>{try{mkdirSync(path.dirname(FILE),{recursive:true});j.saved=now();const t=FILE+'.'+process.pid+'.tmp';writeFileSync(t,JSON.stringify(j));renameSync(t,FILE)}catch(e){log('resume: journal not saved: '+e.message)}};
 const find=id=>load().entries.find(e=>e.id===id);
 const drop=e=>{j.entries=j.entries.filter(x=>x!==e)};
 const what=e=>e.kind==='chat'?nameOf(e.agent)+'’s chat'+(e.userName?' with '+e.userName:''):e.kind==='channel'?nameOf(e.agent)+'’s '+(e.platform||'channel')+' chat':e.kind==='schedule'?'“'+(e.name||e.job)+'”':e.kind==='deleg'?nameOf(e.agent)+'’s background task “'+(e.title||e.deleg)+'”':'fixer run '+(e.run||'');
 const event=(why,at)=>{load();if(!j.last||Math.abs(at-j.last.at)>10*60e3)j.last={at,why,chats:0,schedules:0,delegs:0,helpers:0,failed:[],waiting:0};else if(why==='update')j.last.why='update';return j.last};
 const finish=(e,result,why='')=>{drop(e);j.done.push({id:e.id,kind:e.kind,agent:e.agent,what:what(e),result,why,at:now(),...(e.kind==='channel'?{key:e.key,mk:e.mk}:{})});j.done=j.done.slice(-200);
  if(result==='resumed'||result==='gaveup'){const L=event(e.why||'restart',e.cutAt||now());if(result==='resumed')L[e.kind==='chat'||e.kind==='channel'?'chats':e.kind==='schedule'?'schedules':e.kind==='deleg'?'delegs':'helpers']++;else L.failed.push({what:what(e),why})}
  if(result!=='skipped'||why!=='it finished')log('resume: '+what(e)+' '+(result==='resumed'?'continued':result==='gaveup'?'not continued: '+why:'left alone: '+why))};

 /* a chat reply starts: {agent,session,user,userName,text,opts,gw,from,n,cut0} → id. Ends with end() or cut(). */
 function begin(o){if(!on)return '';load();const e={id:randomBytes(8).toString('hex'),kind:'chat',agent:String(o.agent||'default'),session:String(o.session||''),user:o.user||'',userName:o.userName||'',
   text:String(o.text||'').slice(0,20000),opts:o.opts||{},channel:o.channel||'app',gw:o.gw||0,at:now(),proc:PROC,state:'open',n:o.n||0,...(o.from?{from:o.from}:{}),...(o.cut0?{cut0:o.cut0}:{})};
  j.entries.push(e);save();return e.id}
 function end(id){if(!id)return;const e=find(id);if(!e||e.state!=='open')return;drop(e);save()}
 // interrupted while the app stayed up (the engine restarted under a reply)
 function cut(id,why='restart'){if(!id)return false;const e=find(id);if(!e||e.state!=='open')return false;e.state='cut';e.cutAt=now();e.cut0||=e.cutAt;e.why=why;event(why,e.cutAt);save();
  log('resume: '+what(e)+' was interrupted by '+(why==='update'?'an update':'a restart')+'; it continues by itself');return true}
 // the engine's runs (schedules, fixer runs) seen in progress now: [{kind:'schedule',agent,exec,job,name,since}|{kind:'fixer',run,pid}]
 // new ones are journaled; ones no longer in progress are looked at by the next pass (finished = dropped quietly)
 function sync(list,kind){if(!on)return 0;load();let changed=0;const key=x=>kind==='schedule'?x.agent+'|'+x.exec:kind==='deleg'?x.agent+'|'+x.deleg:String(x.run);const seen=new Set(list.map(key));
  for(const x of list){if(j.entries.some(e=>e.kind===kind&&key(e)===key(x)))continue;
   j.entries.push({id:randomBytes(8).toString('hex'),kind,...x,at:now(),state:'open',n:0});changed++}
  for(const e of j.entries)if(e.kind===kind&&e.state==='open'&&!seen.has(key(e))){e.state='cut';e.cutAt=now();e.cut0||=e.cutAt;e.why=e.why||j.planned?.why||'restart';e.quiet=true;changed++}
  if(changed)save();return changed}
 // the engine's channel chats (Telegram, WhatsApp, ...) it has marked as cut off by a restart now: [{agent,key,platform,session,markedAt (ms)}].
 // Each new mark is journaled (state 'cut', waiting for the engine to carry on); marks older than the limit are the engine's
 // own old leftovers and are not journaled; a mark already settled here (same key and time) is never journaled again.
 function syncChannels(list){if(!on)return 0;load();let n=0;const old=now()-maxAge();
  for(const x of list||[]){const mk=Math.round(+x.markedAt||0);if(!mk||mk<old)continue;
   if(j.entries.some(e=>e.kind==='channel'&&e.key===x.key&&e.agent===x.agent&&e.mk===mk)||j.done.some(d=>d.kind==='channel'&&d.key===x.key&&d.agent===x.agent&&d.mk===mk))continue;
   // the engine marks a chat before it restarts, so one mark may be seen again after the engine's restart: one entry per key while one is open
   if(j.entries.some(e=>e.kind==='channel'&&e.key===x.key&&e.agent===x.agent)){const e=j.entries.find(e=>e.kind==='channel'&&e.key===x.key&&e.agent===x.agent);e.mk=mk;e.cutAt=mk;continue}
   j.entries.push({id:randomBytes(8).toString('hex'),kind:'channel',agent:String(x.agent||'default'),key:String(x.key||''),platform:String(x.platform||''),session:String(x.session||''),mk,at:now(),cutAt:mk,cut0:mk,why:'restart',state:'cut',n:0});n++}
  if(n)save();return n}
 // every half minute while replies are in progress: the journal's time stays close to the moment a crash would cut them
 function beat(){if(on&&load().entries.some(e=>e.state==='open'&&e.kind==='chat'))save()}
 // a planned stop (the app got a signal: a deploy or an update is replacing it). Synchronous: it runs as the app ends
 function planned(why='update'){if(!on)return;load();j.planned={at:now(),why};save()}
 // the app started: every reply the previous app was streaming was cut with it
 function boot(){if(!on)return 0;load();const at=now(),plan=j.planned&&at-j.planned.at<15*60e3?j.planned:null,when=plan?.at||j.saved||at;let n=0;
  // a deploy or the nightly update leaves a note next to the journal (scripts/box-live.sh, auto-update.mjs): then it was an update
  let note=null;try{note=JSON.parse(readFileSync(NOTE,'utf8'));unlinkSync(NOTE)}catch{}
  const why=note&&at-Number(note.at||0)<30*60e3&&note.why==='update'?'update':plan?plan.why:'restart';
  for(const e of j.entries){if(e.kind==='fixer'&&e.state==='open'){e.state='cut';e.cutAt=when;e.cut0||=when;e.why=why;e.quiet=true}   // its process outlives the app: looked at again, continued only if it is gone
   // a schedule, background task, channel or fixer entry the last app was continuing when it ended: back to waiting, like a chat (audit M1:
   // only chats were reset, the others stayed "resuming" for ever and Health kept saying one is still waiting)
   if(e.kind!=='chat'&&e.state==='resuming'&&e.proc!==PROC)e.state='cut';
   if(e.kind!=='chat'||e.proc===PROC)continue;
   if(e.state==='open'){e.state='cut';e.cutAt=when;e.cut0||=when;e.why=why;n++}
   else if(e.state==='resuming'){e.state='cut';n++}   // the app ended while continuing it: what happened is read from the engine first
   e.proc=PROC}
  const L=event(why,at);L.boot=true;delete j.planned;save();
  log('resume: aqeelOS started after '+(why==='update'?'an update':'a restart')+'; '+(n?many(n,'reply','replies')+' to continue':'no reply was in progress'));return n}

 let running=null;
 // one pass over everything interrupted; safe to call often (one at a time, and each entry is claimed before it is acted on)
 function run(){return running||=pass().finally(()=>{running=null})}
 async function pass(){if(!on)return summary();load();const due=()=>j.entries.filter(e=>e.state==='cut'&&!(e.next>now()));
  if(!due().length)return summary();
  if(!await ready().catch(()=>false))return summary();
  const order={chat:0,channel:0,deleg:1,schedule:1,fixer:2},list=due().sort((a,b)=>order[a.kind]-order[b.kind]||a.at-b.at),cfg={maxAge:maxAge(),tz:tz()};let acted=0;
  for(const e of list){if(e.state!=='cut')continue;let p=null,plan;
   try{p=await ({chat:probeChat,channel:probeChannel,schedule:probeRun,deleg:probeDeleg}[e.kind]||probeFixer)(e)}catch(er){log('resume: probe failed for '+what(e)+': '+er.message)}
   if(e.state!=='cut'||!j.entries.includes(e))continue;   // ended or cut again while the engine was read
   plan=({chat:chatPlan,channel:channelPlan,schedule:runPlan,deleg:delegPlan}[e.kind]||fixerPlan)(e,p,now(),cfg);
   if(plan.do==='done'){finish(e,'resumed');save();continue}
   if(plan.do==='wait'){later(e,plan.why);continue}
   if(plan.do==='skip'){finish(e,'skipped',plan.why);save();continue}
   if(plan.do==='giveup'){if(e.quiet&&/no longer exists|switched off/.test(plan.why))finish(e,'skipped',plan.why);else finish(e,'gaveup',plan.why);save();continue}
   if(acted++)await sleep(stagger);
   // claimed on disk before anything is sent: a second pass, or the app starting again right now, never sends it twice
   if(e.kind==='deleg')e.text=plan.note;   // what the chat's own journal entry would send again if the reply to the note is cut too
   e.state='resuming';e.n=(e.n||0)+1;e.claimed=now();save();let r;
   // Bounded (audit H10, 12 Nov 2026): an engine that took the message and then stayed silent kept this promise open for ever, and with it
   // every later pass (run() hands out the pass that is running), so nothing was continued for any agent until the app restarted. After
   // actMs the entry goes back to waiting (its probe reads the engine first, so it is not sent twice) and the pass goes on with the rest.
   {const ac=new AbortController();let timer;
    const limit=new Promise(res=>{timer=setTimeout(()=>{ac.abort();res({retry:true,why:'no answer within '+Math.round(actMs/60e3)+' minutes'})},actMs);timer.unref?.()});
    try{r=await Promise.race([Promise.resolve().then(()=>plan.do==='send'?sendChat(e,plan.note,plan,ac.signal):plan.do==='trigger'?triggerRun(e,ac.signal):kickFixer(e,ac.signal)),limit])}catch(er){r={retry:true,why:String(er.message||er).slice(0,160)}}
    finally{clearTimeout(timer)}}
   if(!j.entries.includes(e))continue;
   if(r?.ok){finish(e,'resumed');save()}
   else if(r?.skip){finish(e,'skipped',r.why||'');save()}
   else if(r?.retry){e.state='cut';e.n--;later(e,r.why||'the provider did not answer')}
   else{finish(e,'gaveup',r?.why||'it could not be started');save()}}
  return summary()}
 function later(e,why){e.waits=(e.waits||0)+1;e.next=now()+BACKOFF[Math.min(e.waits-1,BACKOFF.length-1)];e.lastWhy=why;save()}
 function summary(){load();const waiting=j.entries.filter(e=>e.state==='cut'||e.state==='resuming').filter(e=>!e.quiet).length;if(j.last&&j.last.waiting!==waiting){j.last.waiting=waiting;save()}return j.last}

 const pendingFor=(agent,session)=>{const e=load().entries.find(e=>e.kind==='chat'&&e.agent===agent&&e.session===session&&(e.state==='cut'||e.state==='resuming'));return e?{why:e.why||'restart',at:e.cutAt,user:e.user}:null};
 const pending=()=>load().entries.filter(e=>e.state==='cut'||e.state==='resuming').length;
 const inFlight=()=>load().entries.filter(e=>e.state==='open').length;
 // how many things of one kind are in progress now (the maintenance-window restart waits gently for background tasks too)
 const openOf=kind=>load().entries.filter(e=>e.state==='open'&&e.kind===kind).length;
 return {begin,end,cut,sync,syncChannels,beat,planned,boot,run,pendingFor,pending,inFlight,openOf,last:()=>load().last,line:()=>healthLine(load().last,{tz:tz(),now:now()}),entries:()=>load().entries.map(e=>({...e})),_file:FILE}}
