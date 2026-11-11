// node --test scripts/health-actions.test.mjs — every "Needs you" kind has ONE primary button that does the thing, with a plain
// label (owner, 12 Nov 2026: "it asked me to sign into Higgsfield, why not just give me a button to sign in?"), and the
// question kind (questions.mjs) is filed once, answered once and handed back to whoever asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {personNeed,memberCan} from '../app/bottlenecks.mjs';
import {issueActs,itemActs,vagueLabel,appsFor} from '../app/need-action.mjs';
import {createQuestions,cleanQuestion} from '../app/questions.mjs';
import {parseResult} from '../app/issues.mjs';

// ---- the client's actions(x), run on its own source with stubs
const calls=[];const stub=(n,v)=>(...a)=>{calls.push([n,...a]);return v};
const ctx={S:{me:{admin:true},profile:'default'},UI:async()=>({}),post:async()=>({}),toast:()=>{},closeLayers:()=>{},drawer:()=>({}),esc:s=>String(s),icon:()=>'',Why:{rows:()=>'',wire:()=>{}},Poll:{add:()=>{}},ACT:{},
 document:{querySelector:()=>null,createElement:()=>({append(){}})},ident:a=>({name:a}),go:()=>{},fail:()=>{},promptBox:async()=>null,confirmBox:async()=>true,Pages:{reconnect:()=>{}},Connect:{add:()=>{}},GC:{open:()=>{}},
 Signins:{go:()=>{}},openAgentScreen:()=>{},editAgent:()=>{},navigator:{clipboard:{writeText:async()=>{}}},RanNow:{mark:()=>{}},H:async()=>({}),setTimeout,location:{origin:'x'},window:{open:()=>null}};
vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../app/bottlenecks.js',import.meta.url),'utf8')+';this.__B=Bottlenecks;',ctx);
const B=ctx.__B;

const acct=state=>({kind:'account',id:'account|k',title:'x',account:{key:'p:x',name:'Proton ChatGPT',state}});
const SAMPLES={
 signin:[{kind:'signin',id:'signin|a|n',agent:'a',agentName:'A',title:'x',signin:{app:'Higgsfield',name:'higgsfield',agent:'a'}}],
 account:['signedout','credit','rejected','exhausted'].map(acct),
 invite:[{kind:'invite',id:'invite|c',title:'x',invite:{name:'N',code:'c'}}],
 access:[{kind:'access',id:'access|r',rid:'r',agentName:'A',title:'x'}],
 conflict:[{kind:'conflict',id:'conflict|c',cid:'c',title:'x',sides:[{key:'a',label:'A'},{key:'b',label:'B'}]}],
 question:[{kind:'question',id:'question|q',qid:'q',title:'Which way?',options:[{key:'a',label:'Wait',effect:'Nothing changes',recommended:false},{key:'b',label:'Roll back',effect:'Back to Monday',recommended:true}],allowOther:true}],
 instructions:[{kind:'instructions',id:'instr|a|p',agent:'a',pid:'p',title:'x'}],
 github_token:[{kind:'github_token',id:'event|e',title:'The fixer needs a GitHub token'}],
 ticket:[{kind:'ticket',id:'ticket|waiting',title:'x'}],
 accounts:[{kind:'accounts',id:'event|e',data:{account:'k',label:'L'},title:'x'},{kind:'accounts',id:'event|e2',title:'x'}],
 alerts:[{kind:'alerts',id:'event|e',title:'Needs a person',text:'issue i0a1b2c3d'},{kind:'alerts',id:'event|e',title:'Needs a person',text:'What is needed: do it'}],
 channel:[{kind:'channel',id:'channel|a|whatsapp|1',channel:{agent:'a',id:'whatsapp',needs_link:true}},{kind:'channel',id:'channel|a|telegram|1',channel:{agent:'a',id:'telegram',needs_link:false}}],
 group:[{kind:'group',id:'event|g',agent:'a',title:'Removed from the Telegram group Team'}],
 report:[{kind:'report',id:'report|r',agent:'a',agentName:'A',title:'A is blocked: x',missing:'x'}],
 apps:[{kind:'apps',id:'report|r',agent:'a',title:'Notion and Slack need a sign-in',acts:[{do:'signin-app',agent:'a',name:'notion',label:'Sign in to Notion'},{do:'signin-app',agent:'a',name:'slack',label:'Sign in to Slack'}]}],
 schedule:[{kind:'schedule',id:'sched|a|j|1',agent:'a',title:'x',job:{id:'j',name:'J'}}],
 stopped:[{kind:'stopped',id:'event|e',agent:'a',title:'x'}],
 kirimdev:[{kind:'kirimdev',id:'event|e',title:'x'}]};
// kinds that have nothing to press by design (the fixer has them; personNeed is null for them)
const NO_BUTTON=new Set(['system']);

test('every kind a person is asked about has a sample here, so a new kind cannot ship without a button',()=>{
 const src=readFileSync(new URL('../app/bottlenecks.mjs',import.meta.url),'utf8'),body=src.slice(src.indexOf('export function personNeed'),src.indexOf('const cap='));
 const kinds=[...body.matchAll(/case '([a-z_]+)':/g)].map(m=>m[1]).filter(k=>!NO_BUTTON.has(k));assert.ok(kinds.length>=12,'found '+kinds.length+' kinds');
 for(const k of kinds)assert.ok(SAMPLES[k]?.length,'kind "'+k+'" is asked of a person but has no sample (and so maybe no button) in health-actions.test.mjs')});

test('every sample has exactly one primary button, with a plain label (verb + object, at most five words)',()=>{
 for(const [k,list] of Object.entries(SAMPLES))for(const x of list){const a=B.actions(x);const prim=a.filter(r=>r[2]);
  // a conflict is a choice between sides: every side is a button and none is preferred (rule-conflicts.mjs, not changed here)
  if(k==='conflict'){assert.ok(a.length>=3&&a.every(r=>!vagueLabel(r[0])));continue}
  assert.equal(prim.length,1,k+': '+JSON.stringify(a.map(r=>[r[0],r[2]])));assert.ok(!vagueLabel(prim[0][0]),k+': vague primary "'+prim[0][0]+'"');
  for(const r of a)assert.ok(r[0]&&!/^(ok|got it|dismiss)$/i.test(r[0]),k+': button "'+r[0]+'"');assert.equal(typeof prim[0][1],'function')}});

test('the labels say what the button does',()=>{
 const lab=x=>B.actions(x).filter(r=>r[2]).map(r=>r[0])[0];
 assert.equal(lab(acct('signedout')),'Sign in again');assert.equal(lab(acct('rejected')),'Paste a new key');assert.equal(lab(acct('exhausted')),'Add an account');
 assert.equal(lab(SAMPLES.signin[0]),'Sign in to Higgsfield');assert.equal(lab(SAMPLES.github_token[0]),'Paste the token');assert.equal(lab(SAMPLES.question[0]),'Roll back');
 assert.equal(lab(SAMPLES.apps[0]),'Sign in to Notion');assert.equal(lab(SAMPLES.channel[0]),'Link again');assert.equal(lab(SAMPLES.channel[1]),'Reconnect it');
 assert.equal(lab(SAMPLES.instructions[0]),'Read the changes');assert.equal(lab(SAMPLES.ticket[0]),'Answer the tickets');assert.equal(lab(SAMPLES.schedule[0]),'Run again');
 assert.equal(lab({kind:'report',id:'r',agent:'a',agentName:'Sesa',title:'x',missing:'x'}),'Ask Sesa to retry');
 assert.equal(lab({kind:'report',id:'r',agent:'a',agentName:'Sesa',title:'x',missing:'x',acts:[{do:'signin-app',agent:'sesa',name:'higgsfield',app:'Higgsfield',label:'Sign in to Higgsfield'}]}),'Sign in to Higgsfield')});

test('vague labels are caught',()=>{for(const l of ['Open','View','OK','Got it','Review','Done','','Click here to do the thing now please'])assert.ok(vagueLabel(l),l);
 for(const l of ['Sign in to Higgsfield','Paste the token','Run again','Check again','Copy the command'])assert.ok(!vagueLabel(l),l)});

// ---- the real open items on both servers (12 Nov 2026) and what their button must be
const MCP=[{id:'higgsfield',label:'Higgsfield',users:[{id:'continue-threads',signed:false},{id:'sesa',signed:false}]},{id:'notion-aqeel',label:'Notion',users:[{id:'default',signed:true}]},{id:'slack',label:'Slack',users:[{id:'default',signed:false}]}];
const ACCOUNTS=[{key:'p:codex',name:'Proton ChatGPT',state:'signedout'},{key:'p:antigravity',name:'Antigravity',state:'signedout'}];
const C={mcp:MCP,accounts:ACCOUNTS};
test('the Higgsfield sign-in is a Sign in to Higgsfield button on the right agent, not a generic one',()=>{
 const a=issueActs({agent:'continue-threads',title:"Higgsfield app won't connect for Threads agent",need:"Open the aqeelOS connector sign-in for higgsfield (reconnect_my_connector, or `hermes -p continue-threads mcp login higgsfield`) and click Allow on Higgsfield's consent page."},C);
 assert.deepEqual(a[0],{do:'signin-app',agent:'continue-threads',name:'higgsfield',app:'Higgsfield',label:'Sign in to Higgsfield'});assert.equal(a.at(-1).do,'recheck');
 const b=issueActs({agent:'continue-support',need:'Re-authorize Higgsfield for continue-support: reconnect the higgsfield app in aqeelOS (reconnect_my_connector) or run `hermes mcp login higgsfield` for that profile and approve in the browser.'},C);
 assert.equal(b[0].do,'signin-app');assert.equal(b[0].agent,'continue-thr'.length?'continue-threads':'');   // the agent that has it and is not signed in
 assert.equal(appsFor('sign in to notion',MCP)[0].id,'notion-aqeel')});
test('an expired AI account becomes a button for each account named',()=>{
 const a=issueActs({agent:'pixel-agent',need:"Sign in again to the ChatGPT/Codex account ('Proton ChatGPT') and to Antigravity on aqeelOS Models › Accounts, because both sign-ins are dead or revoked."},C);
 assert.deepEqual(a.map(x=>x.label),['Sign in to Proton ChatGPT','Sign in to Antigravity','Check again'])});
test('Google, the agent\'s screen, a command, and nothing special',()=>{
 assert.equal(issueActs({agent:'fakhri-agent',need:'The owner must connect a real Google Sheets integration for Fakhri Agent, signing in with their Google account.'},{mcp:[],accounts:[]})[0].do,'google');
 assert.equal(issueActs({agent:'default',need:'Donna cannot log back in to the KirimDev website: its session expired and the password page is open in her browser.'},{mcp:[],accounts:[]})[0].do,'screen');
 const c=issueActs({agent:'default',need:'On the server run `sudo systemctl restart box-agent` as root.'},{mcp:[],accounts:[]});assert.deepEqual([c[0].do,c[0].cmd],['copy','sudo systemctl restart box-agent']);
 const d=issueActs({agent:'default',need:'Amri to confirm the QRIS picture shows on the 3124 tester phone.'},C);assert.deepEqual(d.map(x=>x.do),['recheck'])});
test('merged app sign-ins in the popup get one Sign in button per app',()=>{
 const a=itemActs({kind:'apps',agent:'sesa',title:'Notion and Slack need a sign-in'},C);assert.deepEqual(a.map(x=>x.label),['Sign in to Notion','Sign in to Slack']);
 assert.equal(a[1].agent,'default')});
test('the person sentence names no ids and no commands',()=>{
 for(const [k,list] of Object.entries(SAMPLES))for(const x of list){const t=personNeed(x);if(t)assert.ok(!/\b[ie][0-9a-f]{8}\b|reconnect_my_connector|hermes /.test(t),k+': '+t)}});

// ---- questions: filed once, answered once, handed back
const mk=(o={})=>createQuestions({DATA:mkdtempSync(path.join(tmpdir(),'q-')),names:a=>'N-'+a,log:()=>{},...o});
const Q={question:'Roll the change back, or keep it and fix forward?',options:[{label:'Roll back',effect:'Back to Monday\'s version, 10 minutes',recommended:true},{label:'Fix forward',effect:'Keeps today\'s work, may take a day'}]};
test('a question is cleaned: 2-4 options with effects, one recommended',()=>{
 const c=cleanQuestion({...Q,options:[...Q.options,{label:'c',effect:'c'},{label:'d',effect:'d'},{label:'e',effect:'e'}]});assert.equal(c.options.length,4);assert.deepEqual(c.options.map(o=>o.recommended),[true,false,false,false]);assert.equal(c.allowOther,true);
 assert.throws(()=>cleanQuestion({question:'x',options:[{label:'a',effect:'b'}]}),/2 to 4/);assert.throws(()=>cleanQuestion({question:'x',options:[{label:'a',effect:'b'},{label:'c'}]}),/effect/);assert.throws(()=>cleanQuestion({options:Q.options}),/question/)});
test('filed once: the same question from the same asker is one item',async()=>{
 const q=mk(),a=await q.file({kind:'fixer',agent:'a',issue:'i1'},Q),b=await q.file({kind:'fixer',agent:'a',issue:'i1'},Q),c=await q.file({kind:'fixer',agent:'a',issue:'i2'},Q);
 assert.equal(a.qid,b.qid);assert.notEqual(a.qid,c.qid);const open=await q.open();assert.equal(open.length,2);assert.equal(open[0].kind,'question');assert.equal(open[0].title,Q.question);assert.equal(personNeed(open[0]).length>0,true);assert.ok(memberCan(open[0]))});
test('answered once, and the fixer gets the answer (hand-back), then the item leaves',async()=>{
 const got=[];const q=mk({onAnswer:async x=>got.push(x)});const f=await q.file({kind:'fixer',agent:'a',issue:'i1'},Q);
 const r=await q.answer(f.qid,{choice:'a'},'Owner');assert.equal(r.answered.text,'Roll back');assert.equal(got.length,1);assert.equal(got[0].issue,'i1');assert.match(got[0].answered.effect,/Monday/);
 assert.equal((await q.open()).length,0);await assert.rejects(q.answer(f.qid,{choice:'b'},'Owner'),/already answered/);assert.equal(got.length,1,'handed back once')});
test('Something else takes words, and needs them',async()=>{const q=mk(),f=await q.file({kind:'app'},Q);
 await assert.rejects(q.answer(f.qid,{choice:'other',text:' '}),/Say what/);await assert.rejects(q.answer(f.qid,{choice:'zz'}),/Pick one/);
 const r=await q.answer(f.qid,{choice:'other',text:'Ask Amri first'});assert.equal(r.answered.text,'Ask Amri first')});
test('an agent gets the answer in its next turn until it says it used it',async()=>{
 const q=mk(),f=await q.file({kind:'agent',agent:'sesa'},Q);assert.deepEqual(await q.contextLines('sesa'),[]);
 await q.answer(f.qid,{choice:'b'},'Owner');const l=await q.contextLines('sesa');assert.match(l.join('\n'),/Fix forward/);assert.match(l.join('\n'),new RegExp('question_done with '+f.qid));
 assert.deepEqual(await q.contextLines('other'),[]);await q.ack('sesa',f.qid);assert.deepEqual(await q.contextLines('sesa'),[]);await assert.rejects(q.ack('other',f.qid),/No such/)});
test('a member sees only questions of agents they may use',async()=>{const q=mk();await q.file({kind:'agent',agent:'mine'},Q);await q.file({kind:'agent',agent:'theirs'},{...Q,question:'Another?'});await q.file({kind:'app'},{...Q,question:'App?'});
 assert.equal((await q.open(a=>a==='mine',false)).length,1);assert.equal((await q.open(()=>true,true)).length,3)});
test('the fixer asks a question in its RESULT, and a bad one is dropped instead of breaking the result',()=>{
 const ok=parseResult('x\nRESULT: '+JSON.stringify({status:'needs_human',need:'choose',question:Q}));assert.equal(ok.question.options.length,2);assert.equal(ok.question.options[0].recommended,true);
 const bad=parseResult('RESULT: '+JSON.stringify({status:'needs_human',need:'choose',question:{question:'x',options:[]}}));assert.equal(bad.question,null);assert.equal(bad.need,'choose')});
test('the question tool and its answer route exist, and the fixer prompt tells it to ask',()=>{
 const srv=readFileSync(new URL('../app/server.mjs',import.meta.url),'utf8'),iss=readFileSync(new URL('../app/issues.mjs',import.meta.url),'utf8');
 for(const n of ['ask_owner','question_done','my_questions','/ui/questions/answer','questions.contextLines','questions.open'])assert.ok(srv.includes(n),n);assert.match(iss,/CHOICE between approaches/)});
