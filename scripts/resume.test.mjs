// Continue after a restart (app/resume.mjs): the journal, one continuation per interrupted thing, care with what may
// already have gone out, the age limit, a provider that does not answer. Run: node --test scripts/resume.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createResume,chatPlan,channelPlan,runPlan,fixerPlan,noteFor,healthLine,NOTE_RE,outward} from '../app/resume.mjs';

const dir=()=>mkdtempSync(path.join(tmpdir(),'aq-resume-'));
const T0=Date.parse('2026-11-11T17:10:00Z');   // 00:10 in Jakarta
// one "app": a clock it shares with the test, and a record of what it sent
function app(DATA,clock,over={}){const sent=[],triggered=[],kicked=[];
 const r=createResume({DATA,actMs:1500,now:()=>clock.t,log:()=>{},tz:()=>'Asia/Jakarta',stagger:0,sleep:async()=>{},   // actMs: a test that leaves a reply unanswered (the app "dies") ends soon after
 
  probeChat:async()=>({stored:true,tools:[],lastAt:clock.t-10*60e3}),sendChat:async(e,note)=>{sent.push({id:e.id,session:e.session,note});return {ok:true}},
  probeRun:async()=>({status:'unknown',error:'owner process gone',ownerLive:false,newer:false,enabled:true,jobKnown:true}),triggerRun:async e=>{triggered.push(e.job);return {ok:true}},
  probeFixer:async()=>({done:false,alive:false}),kickFixer:async e=>{kicked.push(e.run);return {ok:true}},...over});
 return {r,sent,triggered,kicked}}
const chat={agent:'donna',session:'s1',user:'u1',userName:'Aqeel',text:'Post the weekly report',opts:{model:'m1'}};

test('a reply in progress is journaled at once, and one that ends leaves nothing behind',()=>{const D=dir(),c={t:T0},{r}=app(D,c);
 const a=r.begin(chat),b=r.begin({...chat,session:'s2'});
 const onDisk=JSON.parse(readFileSync(path.join(D,'resume','journal.json'),'utf8'));
 assert.equal(onDisk.entries.length,2);assert.equal(onDisk.entries[0].text,'Post the weekly report');assert.equal(onDisk.entries[0].state,'open');
 r.end(a);assert.equal(r.inFlight(),1);r.end(b);assert.equal(r.inFlight(),0);assert.equal(r.pending(),0)});

test('after a restart the interrupted reply is continued once, in the same chat, and never again',async()=>{const D=dir(),c={t:T0};
 app(D,c).r.begin(chat);                       // the app dies here (a crash: nothing else is written)
 c.t+=90e3;const two=app(D,c);assert.equal(two.r.boot(),1);
 assert.deepEqual(two.r.pendingFor('donna','s1')?.why,'restart');
 await two.r.run();await two.r.run();
 assert.equal(two.sent.length,1);assert.equal(two.sent[0].session,'s1');assert.match(two.sent[0].note,NOTE_RE);
 assert.equal(two.r.pending(),0);assert.equal(two.r.pendingFor('donna','s1'),null);
 // a third start finds nothing left to continue
 c.t+=60e3;const three=app(D,c);assert.equal(three.r.boot(),0);await three.r.run();assert.equal(three.sent.length,0);
 assert.equal(two.r.last().chats,1)});

test('two passes at the same moment send one message',async()=>{const D=dir(),c={t:T0};app(D,c).r.begin(chat);c.t+=60e3;
 let n=0;const two=app(D,c,{sendChat:async()=>{n++;await new Promise(r=>setTimeout(r,20));return {ok:true}}});two.r.boot();
 await Promise.all([two.r.run(),two.r.run(),two.r.run()]);assert.equal(n,1)});

test('the app ending while it continues a reply does not send it twice: the engine is read first',async()=>{const D=dir(),c={t:T0};app(D,c).r.begin(chat);c.t+=60e3;
 // the second app claims the entry and dies before it hears back
 const two=app(D,c,{sendChat:()=>new Promise(()=>{})});two.r.boot();void two.r.run();await new Promise(r=>setTimeout(r,20));
 assert.equal(JSON.parse(readFileSync(path.join(D,'resume','journal.json'),'utf8')).entries[0].state,'resuming');
 // the third app: the engine shows the reply was given meanwhile, so nothing is sent
 c.t+=60e3;const three=app(D,c,{probeChat:async()=>({stored:true,answered:true,tools:['terminal'],lastAt:c.t-5*60e3})});three.r.boot();await three.r.run();
 assert.equal(three.sent.length,0);assert.equal(three.r.pending(),0)});

test('a reply that was already answered, or that the person wrote after, is left alone',async()=>{
 for(const p of [{stored:true,answered:true},{stored:true,personAfter:true}]){const D=dir(),c={t:T0};app(D,c).r.begin(chat);c.t+=60e3;
  const two=app(D,c,{probeChat:async()=>p});two.r.boot();await two.r.run();assert.equal(two.sent.length,0);assert.equal(two.r.pending(),0);assert.equal(two.r.last().failed.length,0)}});

test('what may already have gone out: the note asks the agent to check before repeating it',()=>{const e={at:T0,cutAt:T0+60e3,why:'update',text:'Post the weekly report'},now=T0+10*60e3;
 // nothing was done yet: carry on, plainly
 let p=chatPlan(e,{stored:true,tools:[],lastAt:T0},now,{tz:'Asia/Jakarta'});assert.equal(p.do,'send');assert.equal(p.caution,false);
 assert.match(p.note,/interrupted by an update at 00:11; nothing had been done yet/);
 // only reading so far: continue, no warning needed
 p=chatPlan(e,{stored:true,tools:['read_file','web_search'],lastAt:T0},now);assert.equal(p.caution,false);assert.match(p.note,/do not redo steps/);
 // a tool that can act outward ran, a call has no result, or a post was recorded: check first
 for(const x of [{tools:['terminal']},{tools:['mcp_kirimdev_send_message']},{tools:['read_file'],openCall:true},{tools:['read_file'],posted:true}]){
  p=chatPlan(e,{stored:true,lastAt:T0,...x},now);assert.equal(p.do,'send');assert.equal(p.caution,true,JSON.stringify(x));assert.match(p.note,/check what already went out before repeating it/)}
 assert.equal(outward(['read_file','memory']),false);assert.equal(outward(['browser_navigate']),true);
 // the engine never stored the person's message: it goes along with the note, once
 p=chatPlan(e,{stored:false,tools:[],lastAt:0},now);assert.ok(p.note.endsWith('\n\nPost the weekly report'));
 assert.equal(noteFor({why:'restart',at:T0,tz:'UTC',started:true,caution:true}).startsWith('[System note from aqeelOS: you were interrupted by a restart at 17:10; check'),true)});

test('a schedule whose result already went out is not run again',()=>{const e={cutAt:T0},now=T0+60e3;
 assert.equal(runPlan(e,{status:'unknown',delivered:true,enabled:true,jobKnown:true},now).do,'giveup');
 assert.match(runPlan(e,{status:'unknown',posted:true,enabled:true,jobKnown:true},now).why,/already posted/);
 assert.equal(runPlan(e,{status:'unknown',enabled:true,jobKnown:true},now).do,'trigger');
 assert.equal(runPlan(e,{status:'completed'},now).do,'skip');
 assert.equal(runPlan(e,{status:'unknown',newer:true},now).do,'skip');
 assert.equal(runPlan(e,{status:'running',ownerLive:true},now).do,'wait');
 assert.equal(runPlan(e,{status:'running',ownerLive:false,enabled:true,jobKnown:true},now).do,'trigger');   // its process is gone
 assert.equal(runPlan(e,{status:'failed',error:'the model returned nothing'},now).do,'skip');               // failed by itself: the engine's own business
 assert.equal(runPlan(e,{status:'failed',error:'interrupted by gateway shutdown',enabled:true,jobKnown:true},now).do,'trigger');
 assert.equal(runPlan(e,{status:'unknown',enabled:false,jobKnown:true},now).do,'giveup');
 assert.equal(runPlan(e,null,now).do,'wait')});

test('a schedule run seen in progress is run again once after it was cut off, and not when it finished',async()=>{const D=dir(),c={t:T0},a=app(D,c);
 const runs=[{kind:'schedule',agent:'default',exec:'x1',job:'j1',name:'Weekly report',since:new Date(T0).toISOString()},{kind:'schedule',agent:'cove',exec:'x2',job:'j2',name:'Comments',since:new Date(T0).toISOString()}];
 a.r.sync(runs,'schedule');a.r.sync(runs,'schedule');assert.equal(a.r.inFlight(),2);
 // the engine restarts: neither is running any more. One finished in time, the other was cut
 c.t+=60e3;a.r.sync([],'schedule');
 const b=app(D,c,{probeRun:async e=>e.exec==='x1'?{status:'unknown',error:'owner gone',enabled:true,jobKnown:true}:{status:'completed'}});
 await b.r.run();await b.r.run();
 assert.deepEqual(b.triggered,['j1']);assert.equal(b.r.pending(),0);assert.equal(b.r.last().schedules,1);
 assert.match(b.r.line(),/^Restarted at 00:11: 1 schedule continued\.$/)});

test('nothing older than the limit is continued; it is listed with the reason',async()=>{const D=dir(),c={t:T0};app(D,c).r.begin(chat);
 c.t+=3*3600e3;const two=app(D,c);two.r.boot();await two.r.run();
 assert.equal(two.sent.length,0);assert.equal(two.r.pending(),0);
 assert.equal(two.r.last().failed.length,1);assert.match(two.r.last().failed[0].why,/older than 2 h/);
 // the limit is the install's setting
 const D2=dir(),c2={t:T0};app(D2,c2).r.begin(chat);c2.t+=3*3600e3;const far=app(D2,c2,{maxAge:()=>6*3600e3});far.r.boot();await far.r.run();assert.equal(far.sent.length,1);
 assert.equal(chatPlan({at:T0,cutAt:T0},{stored:true,tools:[]},T0+2*3600e3+1).do,'giveup');assert.equal(chatPlan({at:T0,cutAt:T0},{stored:true,tools:[]},T0+2*3600e3-1e3).do,'send')});

test('a provider that does not answer: tried again later, not dropped, and still only one continuation',async()=>{const D=dir(),c={t:T0};app(D,c).r.begin(chat);c.t+=60e3;
 let calls=0;const two=app(D,c,{sendChat:async()=>{calls++;return calls<3?{retry:true,why:'rate limit reached'}:{ok:true}}});two.r.boot();
 await two.r.run();assert.equal(calls,1);assert.equal(two.r.pending(),1);assert.equal(two.r.last().waiting,1);
 await two.r.run();assert.equal(calls,1,'not before its wait is over');
 c.t+=61e3;await two.r.run();assert.equal(calls,2);assert.equal(two.r.pending(),1);
 c.t+=121e3;await two.r.run();assert.equal(calls,3);assert.equal(two.r.pending(),0);
 assert.equal(two.r.last().chats,1);assert.equal(two.r.last().failed.length,0);
 // a provider that stays away past the limit: given up, with the reason
 const D2=dir(),c2={t:T0};app(D2,c2).r.begin(chat);c2.t+=60e3;const down=app(D2,c2,{sendChat:async()=>({retry:true,why:'overloaded'})});down.r.boot();
 for(let i=0;i<20;i++){await down.r.run();c2.t+=11*60e3}
 assert.equal(down.r.pending(),0);assert.match(down.r.last().failed[0].why,/older than 2 h/)});

test('the engine not back yet: nothing is sent until it answers',async()=>{const D=dir(),c={t:T0};app(D,c).r.begin(chat);c.t+=60e3;
 let up=false;const two=app(D,c,{ready:async()=>up});two.r.boot();await two.r.run();assert.equal(two.sent.length,0);assert.equal(two.r.pending(),1);
 up=true;await two.r.run();assert.equal(two.sent.length,1)});

test('the same reply interrupted again and again stops after three times',async()=>{const D=dir(),c={t:T0};let id=app(D,c).r.begin(chat),n=0;
 for(let i=0;i<5;i++){c.t+=60e3;const a=app(D,c,{sendChat:async e=>{n++;a.r.begin({...chat,from:e.id,n:e.n,cut0:e.cut0});return {ok:true}}});a.r.boot();await a.r.run()}
 assert.equal(n,3);void id});

test('a reply cut by an engine restart while the app stayed up: continued, and the chat is told meanwhile',async()=>{const D=dir(),c={t:T0},a=app(D,c);
 const id=a.r.begin(chat);assert.equal(a.r.cut(id,'update'),true);assert.equal(a.r.cut(id,'update'),false);
 assert.deepEqual(a.r.pendingFor('donna','s1'),{why:'update',at:T0,user:'u1'});
 c.t+=5*60e3;await a.r.run();assert.equal(a.sent.length,1);assert.match(a.sent[0].note,/by an update at 00:10/);assert.equal(a.r.pendingFor('donna','s1'),null)});

test('a deploy leaves a note, so the chat says "an update"; a signal alone says "a restart"',async()=>{const D=dir(),c={t:T0},a=app(D,c);a.r.begin(chat);a.r.planned('restart');
 mkdirSync(path.join(D,'resume'),{recursive:true});writeFileSync(path.join(D,'resume','planned.json'),JSON.stringify({at:c.t,why:'update'}));
 c.t+=30e3;const b=app(D,c);b.r.boot();assert.equal(b.r.pendingFor('donna','s1').why,'update');assert.equal(b.r.pendingFor('donna','s1').at,T0);
 const D2=dir(),c2={t:T0},x=app(D2,c2);x.r.begin(chat);x.r.planned('restart');c2.t+=30e3;const y=app(D2,c2);y.r.boot();assert.equal(y.r.pendingFor('donna','s1').why,'restart')});

test('a fixer run outlives the app: looked at again, started again only when its process is gone',async()=>{
 assert.equal(fixerPlan({cutAt:T0},{done:true},T0).do,'skip');assert.equal(fixerPlan({cutAt:T0},{alive:true},T0).do,'wait');assert.equal(fixerPlan({cutAt:T0},{alive:false,done:false},T0).do,'kick');
 const D=dir(),c={t:T0},a=app(D,c);a.r.sync([{kind:'fixer',run:'i1-1',pid:42,agent:'default'}],'fixer');c.t+=60e3;
 const b=app(D,c);b.r.boot();await b.r.run();assert.deepEqual(b.kicked,['i1-1']);assert.equal(b.r.last().helpers,1)});

test('the line on Health',()=>{const now=T0+60e3,tz='Asia/Jakarta';
 assert.equal(healthLine({at:T0,chats:3,schedules:2,helpers:0,failed:[{what:'Donna’s chat',why:'older than 2 h'}],waiting:0},{tz,now}),'Restarted at 00:10: 3 chats and 2 schedules continued, 1 could not (Donna’s chat: older than 2 h).');
 assert.equal(healthLine({at:T0,chats:1,schedules:0,helpers:0,failed:[],waiting:2},{tz,now}),'Restarted at 00:10: 1 chat continued, 2 are still waiting to continue.');
 assert.equal(healthLine({at:T0,chats:0,schedules:0,helpers:0,failed:[],waiting:0},{tz,now}),'Restarted at 00:10: nothing was in progress.');
 assert.equal(healthLine({at:T0,chats:1,failed:[]},{tz,now:T0+25*3600e3}),'');assert.equal(healthLine(null),'')});

test('a test copy journals nothing and continues nothing',async()=>{const D=dir(),c={t:T0},a=app(D,c,{on:false});
 assert.equal(a.r.begin(chat),'');assert.equal(a.r.boot(),0);await a.r.run();assert.equal(a.sent.length,0)});

/* ---------- Telegram / WhatsApp chats: the engine carries them on, aqeelOS watches (12 Nov 2026) ---------- */
const mark=(over={})=>({agent:'donna',key:'agent:main:telegram:dm:42',platform:'telegram',session:'t1',markedAt:T0+5e3,...over});

test('a channel chat the engine marked is journaled once, counted when the engine carried on, and never sent from here',async()=>{const D=dir(),c={t:T0+60e3};let marked=true;
 const a=app(D,c,{probeChannel:async()=>({missing:false,pending:marked,markedAt:T0+5e3})});a.r.boot();
 assert.equal(a.r.syncChannels([mark()]),1);assert.equal(a.r.syncChannels([mark()]),0,'seen again: still one entry');
 assert.equal(a.r.pending(),1);await a.r.run();assert.equal(a.r.pending(),1,'the engine has not carried on yet: it waits');
 marked=false;c.t+=60e3;await a.r.run();await a.r.run();
 assert.equal(a.r.pending(),0);assert.equal(a.r.last().chats,1);assert.equal(a.sent.length,0,'nothing is sent from aqeelOS into a channel');
 // the settled mark is not journaled again, even though the engine's record may still show it for a moment
 assert.equal(a.r.syncChannels([mark()]),0);
 assert.match(a.r.line(),/1 chat continued/)});

test('a channel mark older than the limit is the engine’s old leftover: not journaled; one that never got carried on is listed',async()=>{const D=dir(),c={t:T0+3*3600e3};
 const a=app(D,c,{probeChannel:async()=>({missing:false,pending:true,markedAt:T0+5e3})});a.r.boot();
 assert.equal(a.r.syncChannels([mark({markedAt:T0})]),0,'3 h old: left alone');
 c.t=T0+60e3;const b=app(dir(),c,{probeChannel:async()=>({missing:false,pending:true,markedAt:T0+5e3})});b.r.boot();assert.equal(b.r.syncChannels([mark()]),1);
 c.t=T0+2*3600e3+60e3;await b.r.run();assert.equal(b.r.pending(),0);
 assert.equal(b.r.last().failed.length,1);assert.match(b.r.last().failed[0].why,/did not carry on/);assert.match(b.r.last().failed[0].what,/telegram chat/);
 assert.equal(b.r.syncChannels([mark()]),0,'a settled mark that stays in the engine is not journaled again')});

test('channelPlan: gone chat, marker cleared, still waiting, unreadable',()=>{const e={cutAt:T0,cut0:T0,mk:T0},now=T0+60e3;
 assert.equal(channelPlan(e,{missing:true},now).do,'skip');assert.equal(channelPlan(e,{missing:false,pending:false},now).do,'done');
 assert.equal(channelPlan(e,{missing:false,pending:true},now).do,'wait');assert.equal(channelPlan(e,null,now).do,'wait');
 assert.equal(channelPlan(e,null,T0+3*3600e3).do,'giveup');assert.equal(channelPlan(e,{missing:false,pending:true},T0+3*3600e3).do,'giveup')});

test('the engine not back yet: a channel entry waits and nothing is decided',async()=>{const D=dir(),c={t:T0+60e3};let up=false,probes=0;
 const a=app(D,c,{ready:async()=>up,probeChannel:async()=>{probes++;return {missing:false,pending:false}}});a.r.boot();a.r.syncChannels([mark()]);
 await a.r.run();assert.equal(probes,0);assert.equal(a.r.pending(),1);up=true;await a.r.run();assert.equal(a.r.pending(),0)});

test('the engine patch and the settings that switch it on are in place',()=>{const rd=f=>readFileSync(new URL(f,import.meta.url),'utf8');
 const patch=rd('../engine/patches/2026-11-12-channel-resume-continue.patch');
 for(const m of ['HERMES_RESUME_CONTINUE','gateway_resume_continue','+++ b/gateway/run.py','+++ b/gateway/run_turn_runner.py','+++ b/hermes_cli/config_defaults.py','do NOT ask'.replace('do NOT ask','do NOT say the session was restored')])assert.ok(patch.includes(m)||patch.includes(m.replace('do NOT say','Do NOT say')),m);
 const ad=rd('../app/agent-defaults.mjs');assert.ok(ad.includes("'agent.gateway_resume_continue'")&&ad.includes("'agent.gateway_auto_continue_freshness'"));
 assert.match(src('app/server.mjs'),/resumeSecs:\(\)=>resumeMaxMs\(installSettings\(\)\)\/1000/)});

/* ---------- background tasks (the engine's "background delegation"): journaled while they run, handed back by the engine, else told once (12 Nov 2026) ---------- */
import {delegPlan,delegNote} from '../app/resume.mjs';
import {src} from './lib/source.mjs';
const dg=(over={})=>({kind:'deleg',agent:'donna',deleg:'deleg_1',title:'Research the competitor pricing pages',session:'s1',key:'agent:main:telegram:group:9',since:T0-5*60e3,...over});
const cut={status:'unknown',state:'unknown',delivery:'pending',error:'Delegation owner exited before recording a terminal result; outcome unknown.',appChat:true,newer:false,ownerLive:false};

test('a background task is journaled while it runs; when the engine restarts under it, a web chat is told once, with the title and the time',async()=>{const D=dir(),c={t:T0};let p={state:'running',ownerLive:true},sent=[];
 const a=app(D,c,{probeDeleg:async()=>p,sendChat:async(e,note)=>{sent.push({session:e.session,agent:e.agent,note,text:e.text});return {ok:true}}});a.r.boot();
 assert.equal(a.r.sync([dg()],'deleg'),1);assert.equal(a.r.sync([dg()],'deleg'),0,'seen again: still one entry');assert.equal(a.r.openOf('deleg'),1);
 await a.r.run();assert.equal(sent.length,0,'running: nothing is sent');
 c.t+=60e3;assert.equal(a.r.sync([],'deleg'),1,'no longer running: looked at');assert.equal(a.r.openOf('deleg'),0);
 p={...cut};await a.r.run();assert.equal(sent.length,0,'the engine is handing it back: it gets its minutes');
 c.t+=5*60e3;await a.r.run();await a.r.run();
 assert.equal(sent.length,1);assert.equal(sent[0].session,'s1');assert.equal(sent[0].agent,'donna');
 assert.equal(sent[0].note,'[System note from aqeelOS: your background task “Research the competitor pricing pages” was interrupted by a restart at 00:11; start it again if it is still needed.]');
 assert.equal(sent[0].text,sent[0].note,'if the reply to the note is cut as well, the chat journal continues from the note');
 assert.equal(a.r.pending(),0);assert.equal(a.r.last().delegs,1);assert.match(a.r.line(),/1 background task continued/)});

test('a task the engine itself handed back (delivered), or that finished, or that failed by itself, is never told again',()=>{const e=dg({cutAt:T0}),now=T0+10*60e3;
 assert.equal(delegPlan(e,{...cut,delivery:'delivered',status:'error',error:' interrupted'},now).do,'done');
 assert.equal(delegPlan(e,{...cut,status:'completed',delivery:'pending'},now).do,'skip');
 assert.equal(delegPlan(e,{...cut,status:'error',error:'Billing or credits exhausted: HTTP 429'},now).do,'skip');
 assert.equal(delegPlan(e,{...cut,newer:true},now).do,'skip','the agent already started it again');
 assert.equal(delegPlan(e,{missing:true},now).do,'skip');
 assert.equal(delegPlan(e,{state:'running',ownerLive:true},now).do,'wait');assert.equal(delegPlan(e,{state:'running',ownerLive:false},now).do,'wait','the engine has not closed it yet')});

test('a Telegram or WhatsApp chat gets nothing from here: it is listed when the engine did not hand the task back; old ones are not continued',()=>{const e=dg({cutAt:T0}),now=T0+10*60e3;
 const ch=delegPlan(e,{...cut,appChat:false},now);assert.equal(ch.do,'giveup');assert.match(ch.why,/nothing is sent from here/);
 assert.equal(delegPlan(e,{...cut},T0+3*3600e3).do,'giveup');assert.match(delegPlan(e,cut,T0+3*3600e3).why,/older than 2 h/);
 assert.equal(delegPlan(e,null,now).do,'wait');assert.equal(delegPlan(e,null,T0+3*3600e3).do,'giveup');
 assert.equal(delegPlan({...e,n:3},cut,now).do,'giveup');
 assert.match(delegNote({title:'x\ny',at:T0,tz:'Asia/Jakarta',why:'update'}),/“x y” was interrupted by an update at 00:10/)});

test('a task in a web chat while a reply runs there, or while the provider is down, is tried again later and still told once',async()=>{const D=dir(),c={t:T0};let sent=0,mode='retry';
 const a=app(D,c,{probeDeleg:async()=>cut,sendChat:async()=>{if(mode==='retry')return {retry:true,why:'a reply is already running there'};sent++;return {ok:true}}});a.r.boot();
 a.r.sync([dg()],'deleg');c.t+=60e3;a.r.sync([],'deleg');c.t+=5*60e3;await a.r.run();assert.equal(sent,0);assert.equal(a.r.pending(),1);
 mode='ok';c.t+=10*60e3;await a.r.run();await a.r.run();assert.equal(sent,1);assert.equal(a.r.pending(),0)});

test('background tasks are wired: read from the engine’s ledger on the tick, before aqeelOS restarts the engine, and counted on Health',()=>{
 const rd=f=>readFileSync(new URL(f,import.meta.url),'utf8'),s=src('app/server.mjs'),e=rd('../app/resume-engine.mjs');
 assert.ok(s.includes("resume.sync(dl,'deleg')")&&s.includes("probeDeleg:e=>resumeEng.probeDeleg(e)")&&s.includes('await beforeEngineStop({syncDelegs'),'tick, probe and the moment before an own restart (behaviour: route-handlers.test.mjs)');
 assert.ok(e.includes('from async_delegations')&&e.includes('delegation_id')&&e.includes('mode=ro'),'read-only, the engine’s own ledger');
 assert.equal(healthLine({at:T0,chats:0,schedules:0,delegs:2,helpers:0,failed:[],waiting:0},{tz:'Asia/Jakarta',now:T0+6e4}),'Restarted at 00:10: 2 background tasks continued.')});

// Audit H10 (12 Nov 2026): one continued chat whose stream stayed silent blocked all continuing until the app restarted.
test('H10: a continued chat that never answers is given up after its limit, the rest is continued, and later passes run',async()=>{const D=dir(),c={t:T0};
 const one=app(D,c);one.r.begin(chat);one.r.begin({...chat,session:'s2',text:'Second'});c.t+=60e3;
 const sent=[],aborted=[];
 const two=app(D,c,{actMs:60,sendChat:(e,note,plan,signal)=>{sent.push(e.session);if(e.session==='s1')return new Promise(()=>{signal?.addEventListener('abort',()=>aborted.push(e.session))});return Promise.resolve({ok:true})}});
 assert.equal(two.r.boot(),2);const t=Date.now();await two.r.run();assert.ok(Date.now()-t<5000,'the pass ended');
 assert.deepEqual(sent,['s1','s2'],'the second chat was still continued');assert.deepEqual(aborted,['s1'],'the silent stream was told to stop');
 assert.equal(two.r.pendingFor('donna','s2'),null);assert.ok(two.r.pendingFor('donna','s1'),'the silent one waits for another try');
 const j=JSON.parse(readFileSync(path.join(D,'resume','journal.json'),'utf8')).entries.find(e=>e.session==='s1');assert.equal(j.state,'cut');assert.match(j.lastWhy,/no answer within/);
 // a later pass is a new pass (not the stuck one handed out again): after the back-off it tries the first chat once more
 c.t+=5*60e3;await two.r.run();assert.deepEqual(sent,['s1','s2','s1'])});

// Audit M1: only chats went from "resuming" back to waiting at start; a schedule, background task, channel or fixer entry stayed there for ever.
for(const kind of ['schedule','deleg','channel','fixer'])test('M1: a '+kind+' entry that was being continued when the app ended waits again after the start',()=>{const D=dir(),c={t:T0};
 mkdirSync(path.join(D,'resume'),{recursive:true});
 writeFileSync(path.join(D,'resume','journal.json'),JSON.stringify({v:1,saved:T0,done:[],last:null,entries:[{id:'x1',kind,agent:'donna',job:'j1',run:'r1',session:'s9',state:'resuming',n:1,at:T0-60e3,cutAt:T0-30e3,claimed:T0-10e3}]}));
 const a=app(D,c);a.r.boot();const e=JSON.parse(readFileSync(path.join(D,'resume','journal.json'),'utf8')).entries;
 assert.equal(a.r.pending(),1);const live=a.r.pending();assert.equal(live,1);
 const st=(e.find(x=>x.id==='x1')||{}).state;assert.ok(st===undefined||st==='cut'||st==='resuming');
 // five starts later it is not still "resuming": the pass can act on it
 for(let i=0;i<5;i++){c.t+=60e3;app(D,c).r.boot()}
 const after=JSON.parse(readFileSync(path.join(D,'resume','journal.json'),'utf8')).entries.find(x=>x.id==='x1');assert.ok(!after||after.state!=='resuming','still resuming after five starts')});

// Audit M12: the engine's error column often holds the agent's own last words; "restart" or "cancel" inside them is not a cut
test('M12: a schedule that failed by itself is not run again because its error text mentions a restart',()=>{const e={cutAt:T0},now=T0+60e3,p=x=>({status:'failed',ownerLive:false,newer:false,enabled:true,jobKnown:true,...x});
 assert.equal(runPlan(e,p({error:'The unreplied check script crashed, so I could not finish. I tried to restart it twice and then cancelled the run; please look at the traceback in the log.'}),now).do,'skip');
 assert.equal(runPlan(e,p({error:'I could not reach the sheet. If this keeps happening the owner may want to restart the Google connection, which was killed last week by a password change, and then run me again by hand.'}),now).do,'skip');
 // the engine's own short words still count
 for(const error of ['interrupted','Scheduler restarted while the job was running','owner process gone','cancelled','Killed (SIGKILL)'])assert.notEqual(runPlan(e,p({error}),now).do,'skip',error)});
