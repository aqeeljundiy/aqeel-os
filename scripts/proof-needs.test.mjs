// node --test scripts/proof-needs.test.mjs
// HEALTH-9 (12 Nov 2026): "every Needs-you item has one button that really does the thing", proven on the REAL app (app/server.mjs,
// scripts/lib/app-rig.mjs) with a stand-in engine. scripts/health-actions.test.mjs already holds the first half: every kind has one primary
// button with a plain label, and the button's handler on the page calls a function or route that exists. This file is the second half: the
// app lists real Needs-you items, the test presses each one's button the way the page does (the same request), and what the button
// promises is then true in the app: the issue is queued again, the token is saved and its card is gone, the engine was told to run the
// schedule, the question is answered, the app entry is removed, "Not now" hides the item for a day.
import test from 'node:test';import assert from 'node:assert/strict';
import {writeFile,readFile,stat} from 'node:fs/promises';import path from 'node:path';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {startApp} from './lib/app-rig.mjs';

const A='agent-a',ISSUE='i0a1b2c3d',NOW=Date.now();
let rig,engineJobs=[{id:'job9',name:'Morning recap',enabled:true,last_status:'error',last_error:'The sheet did not answer',last_run_at:new Date(NOW-3600e3).toISOString()}];
test.before(async()=>{rig=await startApp({agents:[A],
 engine:r=>r.kind==='dash'&&r.method==='GET'&&r.path==='/api/cron/jobs'?{jobs:r.q.profile===A?engineJobs:[]}:undefined,
 seed:async({data})=>{
  await writeFile(path.join(data,'bottlenecks.json'),JSON.stringify({snooze:{},fixed:{},reports:[{id:'r1aaaaaaaaaa',key:A+'|k',agent:A,what:'to send payment links',missing:'It needs a new API key for the payment provider',fix:'Add the key',created:NOW,updated:NOW,count:1,from:null}],
   events:[{id:'e1',kind:'github_token',text:'The fixer needs a GitHub token',detail:'Fixes wait for review as branches on the box. Add the token and their pull requests open by themselves.',created:NOW,topic:'github_token'},
    {id:'e2',kind:'alerts',text:'Agent A needs a person for a fix',detail:'Problem: the payment link fails\nWhat is needed: Pay the invoice of the payment provider for November.\n\naqeelOS fixes the rest by itself once this is done (issue '+ISSUE+' on System › Health).',created:NOW}]}));
  await writeFile(path.join(data,'issues.json'),JSON.stringify({runs:{},items:[{id:ISSUE,key:A+'|the payment link fails',agent:A,source:'agent',what:'',missing:'The payment link fails',evidence:'',proposed_fix:'',affects:[],needs:[],created:NOW,updated:NOW,count:1,by:{platform:null,uid:null,chat:null,thread:null},byName:null,tries:1,history:[],state:'needs_human',need:'Pay the invoice of the payment provider for November.',decision:'filed by '+A}]}));
  await writeFile(path.join(data,'questions.json'),JSON.stringify({items:[{qid:'q111111111111',kind:'fixer',agent:A,issue:'',question:'Roll the agent back to Monday, or wait for the fix?',allowOther:true,state:'open',created:NOW,updated:NOW,count:1,
   options:[{key:'a',label:'Wait',effect:'Nothing changes today',recommended:false},{key:'b',label:'Roll back',effect:'The agent is as it was on Monday',recommended:true}]}]}));
  await writeFile(path.join(data,'conflicts.json'),JSON.stringify({items:[{cid:'c11111111111',source:'agent',agent:A,topic:'Reply hours',title:'Agent a: Reply hours',question:'You told Agent a things that do not fit together. Which one counts?',strictText:'Until you choose, Agent a follows the strictest side.',people:false,state:'open',created:NOW,updated:NOW,count:1,
   sides:[{key:'a',label:'Answer customers until 21:00',what:'Answer customers until 21:00',text:'Answer customers until 21:00 (the team chat, Monday)'},{key:'b',label:'Answer customers until 17:00',what:'Answer customers until 17:00',text:'Answer customers until 17:00 (its instructions)'}]}]}));
  await writeFile(path.join(data,'access-requests.json'),JSON.stringify({items:[{rid:'q22222222222',kind:'mcp',id:'notes-app',label:'Notes app',owner:'default',to:A,by:A,dir:'get',why:'to read the weekly plan',person:'',from:null,created:NOW,updated:NOW,count:1}]}))}})});
test.after(async()=>{await rig?.stop()});
const needs=async()=>{const r=await rig.http('GET','/ui/bottlenecks',{cookie:rig.owner});assert.equal(r.status,200,r.text);return r.json.items};
const press=(p,body,method='POST')=>rig.http(method,p,{cookie:rig.owner,body});
const J=async f=>JSON.parse(await readFile(path.join(rig.data,f),'utf8'));

// the page's own list of buttons for an item (app/bottlenecks.js actions), so the test presses what a person would see
const calls=[];const ctx={S:{me:{admin:true},profile:'default',tab:{}},UI:'',H:'/hapi',post:(base,p,b)=>{b=b===undefined?undefined:JSON.parse(JSON.stringify(b));calls.push(['POST',String(base)+p,b]);return press(String(base)+p,b).then(r=>{if(r.status>=400)throw new Error(r.json?.error||r.text);return r.json})},
 del:(base,p)=>{calls.push(['DELETE',String(base)+p]);return press(String(base)+p,undefined,'DELETE').then(r=>r.json)},toast:()=>{},closeLayers:()=>{},drawer:()=>({}),esc:s=>String(s),icon:()=>'',Why:{rows:()=>'',wire:()=>{}},Poll:{add:()=>{}},ACT:{},
 document:{querySelector:()=>null,createElement:()=>({append(){}})},ident:a=>({name:a}),go:()=>{},fail:()=>{},promptBox:async()=>null,confirmBox:async()=>true,Pages:{reconnect:()=>{}},Connect:{add:()=>{}},GC:{open:()=>{}},Signins:{go:()=>{},open:()=>{}},
 openAgentScreen:()=>{},editAgent:()=>{},navigator:{clipboard:{writeText:async()=>{}}},RanNow:{mark:()=>{}},setTimeout,location:{origin:'x'},window:{open:()=>null}};
vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../app/bottlenecks.js',import.meta.url),'utf8')+';this.__B=Bottlenecks;',ctx);
const buttons=x=>ctx.__B.actions(x);   // [[label, handler, primary], …]
const primary=x=>{const b=buttons(x).filter(a=>a[2]===true);assert.equal(b.length,1,x.kind+': exactly one primary button, got '+JSON.stringify(buttons(x).map(a=>a[0])));return b[0]};

test('the app lists what needs a person, each kind once, each with exactly one primary button',async()=>{const items=await needs();
 assert.deepEqual(items.map(x=>x.kind).sort(),['access','alerts','conflict','github_token','question','report'],JSON.stringify(items.map(x=>[x.kind,x.title])));
 for(const x of items.filter(x=>!['question','conflict'].includes(x.kind)))primary(x);   // a conflict has one button per side and none is the app's pick
 assert.deepEqual([...buttons(items.find(x=>x.kind==='conflict'))].map(b=>String(b[0])),['A: Answer customers until 21:00','B: Answer customers until 17:00','Something else']);
 const q=items.find(x=>x.kind==='question'),qb=buttons(q);assert.ok(qb.length>=2);assert.equal(qb.filter(b=>b[2]===true).length,1,'the recommended choice is the one primary button')});

test('"Try the fix again" on a fixer message: the issue really goes back to the fixer, and the card leaves',async()=>{
 const x=(await needs()).find(i=>i.kind==='alerts'),[label,go]=primary(x);assert.equal(label,'Try the fix again');
 calls.length=0;await go();assert.deepEqual(calls[0],['POST','/ui/health/issues/retry',{id:ISSUE}]);
 const i=(await J('issues.json')).items.find(i=>i.id===ISSUE);assert.equal(i.state,'queued');assert.equal(i.tries,0,'a fresh count');
 const shown=(await press('/ui/health/issues',undefined,'GET')).json.items.find(i=>i.id===ISSUE);assert.equal(shown.state,'queued','Health shows it queued');
 assert.ok(!(await needs()).some(i=>i.id===x.id),'the card is gone')});

test('"Paste the token": a wrong one is refused and the card stays; a real-looking one is saved where the fixer reads it and the card is gone',async()=>{
 const x=(await needs()).find(i=>i.kind==='github_token');assert.equal(primary(x)[0],'Paste the token');
 assert.equal((await press('/ui/health/fixer-token',{token:'short'})).status,400);assert.ok((await needs()).some(i=>i.kind==='github_token'));
 const token='github_pat_'+'A1b2C3d4'.repeat(5);assert.equal((await press('/ui/health/fixer-token',{token})).status,200);
 const f=path.join(rig.data,'fixer-github-token');assert.equal((await readFile(f,'utf8')).trim(),token);if(process.platform!=='win32')assert.equal((await stat(f)).mode&0o777,0o600,'only the app can read it');
 assert.ok(!(await needs()).some(i=>i.kind==='github_token'),'the card is gone')});

test('"Run again" on a failed schedule: the engine is told to run exactly that schedule of that agent, and the card leaves',async()=>{
 // a failed schedule is on System › Health, not in the popup (7 Nov 2026: it is the fixer's first); its card there has the same button
 const x={id:'sched|'+A+'|job9|'+engineJobs[0].last_run_at,kind:'schedule',agent:A,title:'A schedule failed: Morning recap',job:{id:'job9',name:'Morning recap'}},[label,go]=primary(x);assert.equal(label,'Run again');
 const before=rig.seen.length;await go();
 const hit=rig.seen.slice(before).find(r=>r.kind==='dash'&&r.method==='POST'&&r.path==='/api/cron/jobs/job9/trigger');assert.ok(hit,'the engine got the run: '+JSON.stringify(rig.seen.slice(before).map(r=>r.method+' '+r.path)));
 assert.equal(hit.q.profile,A);assert.equal(hit.headers['x-hermes-session-token'],'engine-token');
 assert.ok((await J('bottlenecks.json')).fixed[x.id]>0,'and the card is marked done')});

test('a question: tapping a choice answers it once, the asker gets the answer, and it leaves; a second tap says it was answered',async()=>{
 const x=(await needs()).find(i=>i.kind==='question');
 const r=await press('/ui/questions/answer',{qid:x.qid,choice:'b'});assert.equal(r.status,200,r.text);assert.equal(r.json.answer,'Roll back');
 const q=(await J('questions.json')).items[0];assert.deepEqual([q.state,q.answered.choice,q.answered.text,q.answered.effect],['answered','b','Roll back','The agent is as it was on Monday']);
 assert.equal((await press('/ui/questions/answer',{qid:x.qid,choice:'a'})).status,409);assert.ok(!(await needs()).some(i=>i.kind==='question'))});

test('a conflict: choosing a side answers it with that side and it leaves',async()=>{
 const x=(await needs()).find(i=>i.kind==='conflict');calls.length=0;await buttons(x)[1][1]();assert.deepEqual(calls[0],['POST','/ui/conflicts/decide',{cid:x.cid,choice:'b'}]);
 const c=(await J('conflicts.json')).items[0];assert.deepEqual([c.state,c.answered.choice,c.answered.text],['answered','b','Answer customers until 17:00 (its instructions)']);assert.ok(!(await needs()).some(i=>i.kind==='conflict'))});

test('an access request: Decline closes it as declined and it leaves (Allow is the same route with ok true)',async()=>{
 const x=(await needs()).find(i=>i.kind==='access');assert.equal(primary(x)[0],'Allow');const decline=buttons(x).find(b=>b[0]==='Decline');calls.length=0;await decline[1]();
 assert.deepEqual(calls[0],['POST','/ui/access/decide',{rid:x.rid,ok:false}]);const r=(await J('access-requests.json')).items[0];assert.ok(r.done>0);assert.equal(r.ok,false);assert.ok(!(await needs()).some(i=>i.kind==='access'))});

test('"Not now" hides a report for a day (it is not marked fixed); the retry button of a report marks it done',async()=>{
 const x=(await needs()).find(i=>i.kind==='report');assert.match(primary(x)[0],/^Ask .* to retry$/);
 const later=buttons(x).find(b=>b[0]==='Not now');calls.length=0;await later[1]();assert.deepEqual(calls[0],['POST','/ui/bottlenecks/later',{id:x.id}]);
 const db=await J('bottlenecks.json');assert.ok(db.snooze[x.id]>Date.now()+23*3600e3&&db.snooze[x.id]<Date.now()+25*3600e3,'hidden until tomorrow');assert.equal(db.reports[0].fixed,undefined);
 assert.ok(!(await needs()).some(i=>i.id===x.id));
 assert.equal((await press('/ui/bottlenecks/done',{id:x.id})).status,200);assert.ok((await J('bottlenecks.json')).reports[0].fixed>0)});

test('the buttons of a fixer "needs a person" step: removing an app entry reaches the engine for that agent; taking an account out of the list is a real route',async()=>{
 calls.length=0;const before=rig.seen.length;
 await ctx.__B.act({do:'remove-app',agent:A,name:'sheet-link',app:'Price sheet'},{id:ISSUE});
 assert.deepEqual(calls[0],['DELETE','/hapi/mcp/servers/sheet-link?profile='+A]);
 const hit=rig.seen.slice(before).find(r=>r.kind==='dash'&&r.method==='DELETE'&&r.path==='/api/mcp/servers/sheet-link');assert.ok(hit,'the engine was asked to remove it');assert.equal(hit.q.profile,A);
 const un=await press('/ui/accounts/unlist',{key:'p:nothing-here'});assert.notEqual(un.status,404,'the route exists');assert.notEqual(un.status,401);
 // "Check again" on an issue is the same retry as above
 calls.length=0;await ctx.__B.act({do:'recheck'},{id:ISSUE});assert.deepEqual(calls[0],['POST','/ui/health/issues/retry',{id:ISSUE}])});

test('nobody who is not signed in can press any of these',async()=>{
 for(const [m,p,b] of [['POST','/ui/health/issues/retry',{id:ISSUE}],['POST','/ui/health/fixer-token',{token:'github_pat_'+'x'.repeat(40)}],['POST','/ui/questions/answer',{qid:'q111111111111',choice:'a'}],['POST','/ui/bottlenecks/done',{id:'event|e1'}],['POST','/hapi/cron/jobs/job9/trigger?profile='+A,{}],['DELETE','/hapi/mcp/servers/sheet-link?profile='+A,undefined]]){
  const r=await rig.http(m,p,{body:b});assert.ok([401,403].includes(r.status)||(r.status>=300&&r.status<400),m+' '+p+' answered '+r.status)}});
