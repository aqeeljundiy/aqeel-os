// End-to-end proof that aqeelOS continues by itself after a hard kill (RES-1; owner: "like the try again button, but you don't have to press it").
// The REAL app (app/server.mjs) is started on a free port with a throwaway data folder, next to a FAKE engine (scripts/lib/fake-engine.mjs) that
// speaks the engine's API for chat turns and schedule runs and can hang, die and refuse. The app is killed with SIGKILL in the middle of a chat
// turn, a schedule run and a fixer run, started again, and the test checks that each is continued once (nothing sent to a customer twice, nothing
// posted twice), that the person can see it, and that something cut again and again is not retried for ever. No network, one machine, under a minute.
// How the app is kept inside this machine, and why time runs 60 times quicker, is in scripts/lib/e2e-preload.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {existsSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {FakeEngine,NOTE_START} from './lib/fake-engine.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const WARP=60,R0=Date.now();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(what,fn,ms=20000)=>{const t=Date.now();for(;;){let v;try{v=await fn()}catch{}if(v)return v;if(Date.now()-t>ms)throw new Error('timed out waiting for: '+what+'\n'+tail());await sleep(40)}};
const portFree=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});

let tmp,home,hh,data,logf,engine,port,base,appLog='',proc=null,cookie='',stub,fakePy;const kids=[];
const tail=()=>'--- journal ---\n'+JSON.stringify(journal()).slice(0,2500)+'\n--- app log (resume lines) ---\n'+appLog.split('\n').filter(l=>/resume|=== app/.test(l)).slice(-30).join('\n');
const journal=()=>{try{return JSON.parse(readFileSync(path.join(data,'resume','journal.json'),'utf8'))}catch{return {entries:[],done:[]}}};
const launches=()=>{try{return readFileSync(logf,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(x=>x.k==='launch')}catch{return []}};
const api=async(method,p,body)=>fetch(base+p,{method,headers:{cookie,'x-hui':'1',...(body?{'content-type':'application/json'}:{})},body}).then(async r=>({status:r.status,json:await r.json().catch(()=>null)}));

async function startApp(){
 const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,HOME:home,USERPROFILE:home,TMPDIR:tmp,TEMP:tmp,TMP:tmp,HERMES_HOME:hh,UI_DATA_DIR:data,UI_PORT:String(port),UI_HOST:'127.0.0.1',UI_INSECURE_COOKIE:'1',
  AQEELOS_LIVE:'1',HERMES_DASH:engine.dashUrl,HERMES_API:engine.gateUrl,HERMES_WEBHOOKS:stub,HERMES_WA_CLOUD:stub,N8N_URL:stub,API_SERVER_KEY:'k',HERMES_DASHBOARD_SESSION_TOKEN:'t',HERMES_BIN:path.join(tmp,'no-engine'),
  UI_SECRET:'resume-e2e-secret-'+port,UI_SIGNIN_FREE_TRIES:'1000000',E2E_WARP:String(WARP),E2E_R0:String(R0),E2E_LOG:logf,E2E_FAKE_PY:fakePy};
 const mine=proc=spawn(process.execPath,['--import',pathToFileURL(path.join(ROOT,'scripts','lib','e2e-preload.mjs')).href,path.join(ROOT,'app','server.mjs')],{cwd:home,stdio:['ignore','pipe','pipe'],env});
 mine.stdout.on('data',d=>appLog+=d);mine.stderr.on('data',d=>appLog+=d);mine.on('exit',()=>{if(proc===mine)proc=null});
 appLog+='\n=== app starts ===\n';
 await until('the app answers',async()=>(await fetch(base+'/healthz')).ok,30000)}
const killApp=async()=>{const p=proc;if(!p)return;proc=null;p.kill('SIGKILL');await new Promise(r=>p.once('exit',r));appLog+='\n=== app killed (SIGKILL) ===\n'};

test.before(async()=>{
 tmp=await mkdtemp(path.join(tmpdir(),'resume-e2e-'));home=path.join(tmp,'home');hh=path.join(home,'.hermes');data=path.join(tmp,'data');logf=path.join(tmp,'e2e.log');await mkdir(data,{recursive:true});await writeFile(logf,'');
 fakePy=path.join(hh,'installs','i1','environments','e1','venv','bin','python');await mkdir(path.dirname(fakePy),{recursive:true});await writeFile(fakePy,'');
 await writeFile(path.join(hh,'config.yaml'),'{}');
 // a quarter of an hour is the shortest time the app keeps trying (install.json resumeMaxHours)
 await writeFile(path.join(data,'install.json'),JSON.stringify({timezone:'Asia/Jakarta',resumeMaxHours:0.25}));
 // one problem waiting for the fixer, so a fixer run exists early (the app's own start-up checks may file others)
 await writeFile(path.join(data,'issues.json'),JSON.stringify({items:[{id:'ie2e00001',key:'default|the weekly sheet is not updated',agent:'default',state:'queued',tries:0,count:1,created:R0,updated:R0,notBefore:0,history:[],missing:'The weekly sheet is not updated',evidence:'The sheet job ends with an empty answer.',sorted:'unique'}],runs:{}}));
 engine=await new FakeEngine({home:hh,warp:WARP,r0:R0}).start();
 const s=await new Promise(r=>{const x=createServer((q,a)=>{a.writeHead(200,{'content-type':'application/json'});a.end('{}')});x.listen(0,'127.0.0.1',()=>r(x))});kids.push(s);stub='http://127.0.0.1:'+s.address().port;
 port=await portFree();base='http://127.0.0.1:'+port;
 await startApp();
 const r=await fetch(base+'/auth/setup',{method:'POST',headers:{'content-type':'application/json','x-hui':'1'},body:JSON.stringify({name:'Owner',email:'owner@resume.test',password:'Resume-test-pw-1'})});
 assert.equal(r.status,200,'owner setup: '+r.status);cookie=(r.headers.getSetCookie()||[]).map(x=>x.split(';')[0]).find(x=>x.startsWith('hui='));assert.ok(cookie,'no cookie')});
test.after(async()=>{await killApp();for(const l of launches())try{process.kill(l.pid)}catch{}await engine?.stop();for(const s of kids)s.close?.();await sleep(200);await rm(tmp,{recursive:true,force:true}).catch(()=>{})});

test('the app starts with the fake engine and the resume journal is on',async()=>{
 await until('the journal file',()=>existsSync(path.join(data,'resume','journal.json')));});

/* ---------- helpers for a person in a chat ---------- */
async function person(sid,text){const ac=new AbortController();
 const r=await fetch(base+'/gapi/api/sessions/'+sid+'/chat/stream',{method:'POST',headers:{cookie,'x-hui':'1','content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({message:text}),signal:ac.signal});
 const seen=[];(async()=>{try{for await(const c of r.body)seen.push(Buffer.from(c).toString())}catch{}})();return {status:r.status,seen,stop:()=>ac.abort()}}
const notes=sid=>engine.posts.filter(p=>p.sid===sid&&p.note);
const sentOnce=key=>engine.effects.filter(e=>e.key===key).length;
const entryOf=sid=>journal().entries.find(e=>e.kind==='chat'&&e.session===sid);
// let the app run on for a while (in the app's own, faster time) and then look again: a second send would show by now
const settle=ms=>sleep(ms);

test('chat: killed mid-turn, the engine goes on and answers while the app is away: nothing is sent again',async()=>{
 engine.script=()=>[{tool:'read_file',key:'r1'},{tool:'send_message',outward:true,key:'invoice-1',args:{to:'customer-a'}},{hang:true},{say:'The invoice went to the customer.'}];
 const c=await person('s-survive','Send the invoice to the customer');assert.equal(c.status,200);
 await until('the reply is journaled and the message went out',()=>entryOf('s-survive')?.state==='open'&&sentOnce('invoice-1')===1);
 await killApp();engine.release();                           // the engine's turn finishes while the app is down
 await until('the engine stored its answer',()=>engine.session('s-survive').messages.some(m=>m.role==='assistant'&&/went to the customer/.test(m.content)));
 await startApp();
 await until('the journal settles',()=>!entryOf('s-survive')&&journal().done.some(d=>d.kind==='chat'));
 await settle(900);
 assert.equal(notes('s-survive').length,0,'no note was sent: the reply was already there');
 assert.equal(engine.posts.filter(p=>p.sid==='s-survive').length,1,'the engine got one message in this chat');
 assert.equal(sentOnce('invoice-1'),1,'the customer got the invoice once')});

test('chat: killed mid-turn together with the engine after a message went out: continued once, told to check what went out, no second message',async()=>{
 engine.script=()=>[{tool:'read_file',key:'r2'},{tool:'send_message',outward:true,key:'invoice-2',args:{to:'customer-b'}},{hang:true},{say:'All sent.'}];
 const c=await person('s-cut','Send the invoice to customer B');assert.equal(c.status,200);
 await until('the message went out and the reply is journaled',()=>entryOf('s-cut')?.state==='open'&&sentOnce('invoice-2')===1);
 await killApp();engine.restart();                            // the turn is cut: the engine restarted too
 await startApp();
 await until('one note reaches the chat',()=>notes('s-cut').length>=1);
 await until('the engine finished the continued turn',()=>engine.session('s-cut').messages.some(m=>m.role==='assistant'&&m.content==='All sent.'));
 await until('the journal is settled',()=>!entryOf('s-cut')&&journal().done.some(d=>d.kind==='chat'&&d.result==='resumed'));
 await settle(1000);                                          // several more passes: nothing may be sent again
 const n=notes('s-cut');assert.equal(n.length,1,'exactly one note');
 assert.match(n[0].text,/interrupted by a restart at \d\d:\d\d/);assert.match(n[0].text,/check what already went out/,'the agent is told to check what already went out');
 assert.equal(sentOnce('invoice-2'),1,'the customer got the invoice once');
 // the person sees it: the note is a message in the chat, and the chat page turns it into "Interrupted by a restart, continued by itself"
 const mine=engine.session('s-cut').messages.find(m=>m.role==='user'&&m.content.startsWith(NOTE_START));assert.ok(mine);
 const chatJs=readFileSync(path.join(ROOT,'app','chat.js'),'utf8'),re=new RegExp(/RESUME_RE:\/(.*)\/,/.exec(chatJs)[1]);assert.ok(re.test(mine.content),'chat.js recognises the note');
 const h=await api('GET','/ui/health/resume');assert.match(h.json.line,/1 chat continued/,'Health says so: '+h.json.line)});

test('chat: killed after only reading: continued once with the plain note, not the check-first one',async()=>{
 engine.script=()=>[{tool:'read_file',key:'r3'},{hang:true},{say:'Read it all.'}];
 await person('s-read','Summarise the file');
 await until('journaled and reading done',()=>entryOf('s-read')?.state==='open'&&engine.session('s-read').messages.some(m=>m.role==='tool'));
 await killApp();engine.restart();await startApp();
 await until('one note',()=>notes('s-read').length===1);await until('finished',()=>engine.session('s-read').messages.some(m=>m.content==='Read it all.'));
 await settle(900);assert.equal(notes('s-read').length,1);assert.doesNotMatch(notes('s-read')[0].text,/check what already went out/);assert.match(notes('s-read')[0].text,/Continue my last request/)});

test('cut again and again while continuing (a chat and a schedule run): tried three times, then left, said on Health and in the chat',async()=>{
 engine.script=()=>[{tool:'read_file',key:'r4'},{hang:true},{say:'never'}];engine.resumeHangs=99;
 engine.jobs.push({id:'j-loop',name:'Hourly sync',hang:true});engine.flush();engine.hangingRun('j-loop');await until('the run is journaled',()=>jobEntry('j-loop')?.state==='open');
 await person('s-loop','Do the long job');
 await until('journaled',()=>entryOf('s-loop')?.state==='open'&&engine.session('s-loop').messages.some(m=>m.role==='tool'));
 for(let i=1;i<=3;i++){await killApp();engine.restart();await startApp();await until('note '+i,()=>notes('s-loop').length===i);
  await until('run now '+i,()=>engine.triggers.filter(t=>t.job==='j-loop').length===i);
  await until('the continued turn and run are journaled',()=>entryOf('s-loop')?.state==='open'&&jobEntry('j-loop')?.state==='open')}
 await killApp();engine.restart();await startApp();
 await until('left alone after the third cut',()=>journal().done.some(d=>d.kind==='chat'&&d.result==='gaveup')&&journal().done.some(d=>d.kind==='schedule'&&d.result==='gaveup'),20000);
 await settle(900);engine.resumeHangs=0;
 assert.equal(notes('s-loop').length,3,'three tries, never a fourth');assert.equal(engine.triggers.filter(t=>t.job==='j-loop').length,3,'run now three times, never a fourth');assert.equal(jobEntry('j-loop'),undefined,JSON.stringify(engine.executions.filter(x=>x.job_id==='j-loop').map(x=>[x.id,x.status,x.claimed_at]))+' | '+JSON.stringify(journal().done.filter(d=>d.kind==='schedule').map(d=>[d.exec,d.result,d.why])));assert.equal(entryOf('s-loop'),undefined);
 const h=await api('GET','/ui/health/resume');assert.match(h.json.line,/could not/);assert.match(h.json.line,/3 times/);
 // the chat itself says so (peek: what the chat page asks when it opens)
 const peek=await api('GET','/ui/live?agent=default&session=s-loop&peek=1');assert.match(peek.json.gaveUp||'',/3 times/,'the chat is told it was not continued: '+JSON.stringify(peek.json))});

/* ---------- schedule runs ---------- */
const deliveries=job=>engine.effects.filter(e=>e.kind==='delivery'&&e.job===job&&e.ok);
const runsOf=job=>engine.executions.filter(x=>x.job_id===job);
const jobEntry=job=>journal().entries.find(e=>e.kind==='schedule'&&e.job===job);
const seenInJournal=job=>until('the run is journaled',()=>jobEntry(job)?.state==='open');

test('schedule: killed mid-run together with the engine: run now, once; the result goes out once',async()=>{
 engine.jobs.push({id:'j-cut',name:'Daily stock report',deliver:'telegram',ms:80});engine.flush();
 engine.hangingRun('j-cut');await seenInJournal('j-cut');
 await killApp();engine.restart();await startApp();
 await until('aqeelOS starts the schedule again',()=>engine.triggers.filter(t=>t.job==='j-cut').length>=1);
 await until('the new run delivered',()=>deliveries('j-cut').length===1);
 await until('the journal is settled',()=>!jobEntry('j-cut')&&journal().done.some(d=>d.kind==='schedule'&&d.result==='resumed'));await settle(900);
 assert.equal(engine.triggers.filter(t=>t.job==='j-cut').length,1,'run now was pressed once');assert.equal(deliveries('j-cut').length,1,'the report was delivered once');
 assert.equal(runsOf('j-cut').length,2,'the cut run and its one replacement');
 assert.match((await api('GET','/ui/health/resume')).json.line,/schedules? continued/)});

test('schedule: killed mid-run while the engine kept running: it finishes by itself, nothing is run again',async()=>{
 engine.jobs.push({id:'j-live',name:'Morning post',deliver:'telegram',ms:80});engine.flush();
 engine.hangingRun('j-live');await seenInJournal('j-live');
 await killApp();engine.release();await until('the run finished in the engine',()=>runsOf('j-live')[0].status==='completed');
 await startApp();await until('settled',()=>!jobEntry('j-live')&&journal().done.some(d=>d.kind==='schedule'&&/finished|ran again/.test(d.why)),20000);await settle(900);
 assert.equal(engine.triggers.filter(t=>t.job==='j-live').length,0);assert.equal(runsOf('j-live').length,1);assert.equal(deliveries('j-live').length,1,'one delivery, from the first run')});

test('schedule: finished while the app was away but Telegram was down: the report is not run again (nothing is posted twice); it shows on Health as not delivered',async()=>{
 engine.jobs.push({id:'j-undel',name:'Evening summary',deliver:'telegram',ms:80});engine.flush();engine.provider.telegram=false;
 engine.hangingRun('j-undel');await seenInJournal('j-undel');
 await killApp();engine.release();await until('the run finished and its delivery failed',()=>runsOf('j-undel')[0].delivery_outcome==='failed');
 await startApp();await until('settled',()=>!jobEntry('j-undel')&&journal().done.some(d=>d.kind==='schedule'&&/finished/.test(d.why)),20000);await settle(900);
 engine.provider.telegram=true;
 assert.equal(engine.triggers.filter(t=>t.job==='j-undel').length,0,'the run is not started again: that would repeat its work and post twice');assert.equal(runsOf('j-undel').length,1)});

test('schedule: the engine still runs it when the app is back: it is waited for, never started a second time',async()=>{
 engine.jobs.push({id:'j-wait',name:'Weekly digest',deliver:'telegram',ms:80});engine.flush();
 engine.hangingRun('j-wait');await seenInJournal('j-wait');
 await killApp();await startApp();await settle(1500);                    // several passes while it is still running
 assert.equal(engine.triggers.filter(t=>t.job==='j-wait').length,0,'not started again while it runs');
 engine.release();await until('delivered',()=>deliveries('j-wait').length===1);await settle(900);
 assert.equal(engine.triggers.filter(t=>t.job==='j-wait').length,0);assert.equal(runsOf('j-wait').length,1);assert.equal(deliveries('j-wait').length,1)});

/* ---------- fixer runs ---------- */
const issuesDb=()=>{try{return JSON.parse(readFileSync(path.join(data,'issues.json'),'utf8'))}catch{return {items:[],runs:{}}}};
const liveRun=()=>Object.values(issuesDb().runs||{}).find(r=>!r.done&&r.pid);
const alive=p=>{try{process.kill(p,0);return true}catch{return false}};
test('fixer run: its process outlives the app: after a kill it is looked at, never started a second time, and taken over once when it ends',async()=>{
 const r1=await until('a fixer run is going',()=>liveRun()&&journal().entries.some(e=>e.kind==='fixer'&&e.run===liveRun().id&&e.state==='open'),30000);
 const run=liveRun(),before=launches().length;assert.ok(alive(run.pid));
 await killApp();await startApp();await settle(1500);
 assert.equal(launches().length,before,'no second fixer was started while the first one lives');assert.ok(alive(run.pid));assert.ok(!issuesDb().runs[run.id].done,'its run is still open');
 assert.equal(journal().done.filter(d=>d.kind==='fixer'&&d.result==='gaveup').length,0);
 // the run ends without a result (what a restart that takes the fixer with it looks like)
 process.kill(run.pid);await until('the app closes the run',()=>issuesDb().runs[run.id].done,20000);
 const rec=issuesDb().runs[run.id],item=issuesDb().items.find(i=>i.id===run.issue);
 assert.equal(item.history.filter(h=>h.run===run.id).length,1,'its end is recorded once');
 assert.ok(item.tries<=3);await settle(900);assert.equal(issuesDb().items.find(i=>i.id===run.issue).history.filter(h=>h.run===run.id).length,1)});

/* ---------- the engine is not there when the app comes back ---------- */
const healthItems=()=>{try{return JSON.parse(readFileSync(path.join(data,'bottlenecks.json'),'utf8')).events.filter(e=>e.topic==='resume-waiting')}catch{return []}};
test('engine down when the app is back: it waits and asks again, says so once on Health, and continues once when the engine returns',async()=>{
 engine.script=()=>[{tool:'read_file',key:'r5'},{tool:'send_message',outward:true,key:'order-list-1'},{hang:true},{say:'Back on it.'}];
 await person('s-down','Send the order list');await until('journaled',()=>entryOf('s-down')?.state==='open'&&sentOnce('order-list-1')===1);
 await killApp();engine.restart();engine.setDown(true);await startApp();
 await until('one Health item says it is waiting',()=>healthItems().length===1,30000);
 assert.equal(notes('s-down').length,0,'nothing is sent while the engine does not answer');
 assert.ok(entryOf('s-down'),'the chat is still waiting to be continued');
 assert.match(healthItems()[0].text,/interrupted thing/);await settle(800);assert.equal(healthItems().length,1,'one item, not one per try');
 engine.setDown(false);
 await until('continued once',()=>notes('s-down').length===1&&engine.session('s-down').messages.some(m=>m.content==='Back on it.'),30000);
 await until('the Health item goes away',()=>healthItems().length===0).catch(e=>{throw new Error(e.message+JSON.stringify(healthItems()))});await settle(800);
 assert.equal(notes('s-down').length,1);assert.equal(sentOnce('order-list-1'),1)});

/* ---------- a Telegram chat the restart cut off, and the provider is down for a while ---------- */
test('telegram chat cut by a restart while the provider is down: aqeelOS sends nothing itself, shows it waits, and counts it once the engine has answered the person',async()=>{
 engine.provider.telegram=false;engine.markChannelCut('tg:private:77','s-tg');   // what the engine records at its restart
 await killApp();await startApp();
 await until('journaled as waiting',()=>journal().entries.some(e=>e.kind==='channel'&&e.key==='tg:private:77'&&e.state==='cut'),20000);
 assert.equal(engine.channelCarryOn('tg:private:77'),false,'the provider is still down: the engine cannot answer yet');
 await until('Health says it still waits',async()=>/still waiting/.test((await api('GET','/ui/health/resume')).json.line));
 engine.provider.telegram=true;assert.equal(engine.channelCarryOn('tg:private:77'),true);   // the provider is back: the engine answers the person, once
 await until('counted as continued',()=>journal().done.some(d=>d.kind==='channel'&&d.result==='resumed'),20000);await settle(800);
 assert.equal(engine.posts.filter(p=>p.sid==='s-tg').length,0,'aqeelOS wrote nothing into the customer chat');
 assert.equal(engine.effects.filter(e=>e.kind==='channel-reply').length,1,'the person got one answer');
 assert.equal(journal().entries.filter(e=>e.kind==='channel').length,0)});
