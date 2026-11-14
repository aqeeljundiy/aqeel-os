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
import {issueActs,itemActs,vagueLabel,findApp,cleanSteps,mcpCanSignIn,DOES,STEP_KINDS} from '../app/need-action.mjs';
import {createQuestions,cleanQuestion} from '../app/questions.mjs';
import {parseResult,parseSort} from '../app/issues.mjs';
import {src as sourceOf} from './lib/source.mjs';

// ---- the client's actions(x), run on its own source with stubs
const calls=[];const stub=(n,v)=>(...a)=>{calls.push([n,...a]);return v};
const ctx={S:{me:{admin:true},profile:'default'},UI:async()=>({}),post:stub('post',Promise.resolve({})),toast:()=>{},closeLayers:()=>{},drawer:()=>({}),esc:s=>String(s),icon:()=>'',Why:{rows:()=>'',wire:()=>{}},Poll:{add:()=>{}},ACT:{},
 document:{querySelector:()=>null,createElement:()=>({append(){}})},ident:a=>({name:a}),go:()=>{},fail:()=>{},promptBox:async()=>null,confirmBox:stub('confirmBox',Promise.resolve(true)),Pages:{reconnect:stub('Pages.reconnect')},Connect:{add:()=>{}},GC:{open:stub('GC.open')},del:stub('del',Promise.resolve({})),
 Signins:{go:stub('Signins.go')},openAgentScreen:()=>{},editAgent:()=>{},navigator:{clipboard:{writeText:async()=>{}}},RanNow:{mark:()=>{}},H:async()=>({}),setTimeout,location:{origin:'x'},window:{open:()=>null}};
vm.createContext(ctx);vm.runInContext(readFileSync(new URL('../app/bottlenecks.js',import.meta.url),'utf8')+';this.__B=Bottlenecks;',ctx);
const B=ctx.__B;

const acct=state=>({kind:'account',id:'account|k',title:'x',account:{key:'p:x',name:'Proton ChatGPT',state}});
const SAMPLES={
 signin:[{kind:'signin',id:'signin|a|n',agent:'a',agentName:'A',title:'x',signin:{app:'Higgsfield',name:'higgsfield',agent:'a'}}],
 account:['signedout','credit','rejected','exhausted'].map(acct),
 invite:[{kind:'invite',id:'invite|c',title:'x',invite:{name:'N',code:'c'}}],
 access:[{kind:'access',id:'access|r',rid:'r',agentName:'A',title:'x'}],
 cadence:[{kind:'cadence',id:'cadence|a',agent:'a',title:'x',jobs:[{job:'j',name:'Runner',every:10,suggest:{what:'unread DMs'}}]},{kind:'cadence',id:'cadence|b',agent:'b',title:'x',jobs:[{job:'k',name:'Recap',every:5}]}],
 design:[{kind:'design',id:'design|a',agent:'a',title:'x',jobs:[{job:'j',name:'Recap',runs:188,silent:179,how:'script',mechanical:true,label:'Make it script-only'}]},{kind:'design',id:'design|b',agent:'b',title:'x',jobs:[{job:'k',name:'Sync',runs:75,silent:69,how:'ask',mechanical:false,label:''}]}],
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
 kirimdev:[{kind:'kirimdev',id:'event|e',title:'x'}],
 repeat:[{kind:'repeat',id:'event|e',agent:'a',title:'A answered the same post twice',data:{post:'https://www.threads.com/@x/post/1'}}]};
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
 assert.equal(lab({kind:'report',id:'r',agent:'a',agentName:'Sesa',title:'x',missing:'x',acts:[{do:'signin-app',agent:'sesa',name:'higgsfield',app:'Higgsfield',label:'Sign in to Higgsfield',step:1}]}),'Sign in to Higgsfield')});

test('vague labels are caught',()=>{for(const l of ['Open','View','OK','Got it','Review','Done','','Click here to do the thing now please'])assert.ok(vagueLabel(l),l);
 for(const l of ['Sign in to Higgsfield','Paste the token','Run again','Check again','Copy the command'])assert.ok(!vagueLabel(l),l)});

// ---- needs: a button only when the action is real (12 Nov 2026, owner: "What's the point of clicking sign in if it
// doesn't lead me anywhere?"). What the install has: signin = a sign-in page can start for that agent's copy.
const MCP=[{id:'higgsfield',label:'Higgsfield',detail:'https://mcp.higgsfield.ai/mcp',users:[{id:'continue-threads',signed:false,signin:true},{id:'sesa',signed:false,signin:true}]},
 {id:'notion-aqeel',label:'Notion',detail:'https://mcp.notion.com/mcp',users:[{id:'default',signed:true,signin:true}]},{id:'slack',label:'Slack',detail:'https://mcp.slack.com/mcp',users:[{id:'default',signed:false,signin:true}]},
 // the two that made the lying button: a tool called pixel that runs a command (no address, so no sign-in page), and a Google file added as an app
 {id:'pixel',label:'pixel',detail:'npx',users:[{id:'pixel-agent',signed:true,signin:false},{id:'fakhri-agent',signed:true,signin:false}]},
 {id:'WO Dashboard - Google Sheet',label:'WO Dashboard - Google Sheet',detail:'https://docs.google.com/spreadsheets/d/1abc/edit',users:[{id:'fakhri-agent',signed:true,signin:true}]}];
const ACCOUNTS=[{key:'p:openai-codex',name:'Proton ChatGPT',state:'signedout',listed:true},{key:'p:antigravity-subscription',name:'Google AI Pro (Antigravity)',aka:['Google AI Pro (Antigravity)'],state:'signedout',listed:true},{key:'claude:main',name:'Claude',listed:true}];
const AGENTS=[{id:'default',name:'Donna'},{id:'pixel-agent',name:'Pixel Agent'},{id:'fakhri-agent',name:'Fakhri Agent'},{id:'continue-threads',name:'Threads'},{id:'continue-support',name:'Support'},{id:'sesa',name:'Sesa'}];
const C={mcp:MCP,accounts:ACCOUNTS,agents:AGENTS};
// the two real items on the P&P install, word for word
const FAKHRI={id:'i0000000a',agent:'fakhri-agent',title:'Fakhri Agent needs a person for a fix',need:"The owner of the Wood Origins dashboard sheet must connect a real Google Sheets integration for Fakhri Agent, signing in with their Google account, and remove the 'WO Dashboard - Google Sheet' entry that only holds the spreadsheet link. Alternatively, they can tell aqeelOS to use the Pixel Google account for this sheet."};
const PIXEL={id:'i0000000b',agent:'pixel-agent',title:'Pixel Agent needs a person for a fix',need:"Sign in again to the ChatGPT/Codex account ('Proton ChatGPT') and to Antigravity on aqeelOS Models › Accounts, because both sign-ins are dead or revoked. Until then, take openai-codex out of the Models priority list or turn auto-switch off so agents aren't moved onto it."};
const dos=a=>a.map(x=>x.do),labels=a=>a.map(x=>x.label);
const CMD='`sudo systemctl restart box-agent`';

test('fixture (a), Fakhri: Connect Google for Fakhri Agent and Remove the sheet link entry, never "Sign in to pixel"',()=>{
 const a=issueActs(FAKHRI,C);assert.deepEqual(labels(a),['Connect Google for Fakhri Agent','Remove the sheet link entry','Check again']);
 assert.deepEqual([a[0].do,a[0].agent,a[0].step],['google','fakhri-agent',1]);
 assert.deepEqual([a[1].do,a[1].agent,a[1].name,a[1].step],['remove-app','fakhri-agent','WO Dashboard - Google Sheet',2]);
 assert.ok(!a.some(x=>x.do==='signin-app'),'no app sign-in');assert.ok(!labels(a).some(l=>/pixel/i.test(l)))});
test('fixture (a) as the install is today: the entry is gone already, so that step is ticked and Google is the one button',()=>{
 const a=issueActs(FAKHRI,{...C,mcp:MCP.filter(m=>!/WO Dash/.test(m.id)),google:[{id:'owner@example.com',users:[{id:'default'},{id:'fakhri-agent'}]}]});
 assert.deepEqual(a.map(x=>[x.do,x.step||0]),[['google',1],['done',2],['recheck',0]]);assert.match(a[0].say,/uses owner@example\.com now/);assert.match(a[1].say,/WO Dashboard - Google Sheet.*removed/)});
test('fixture (b), Pixel: one sign-in per account named, each with its real alternative, never "Sign in to pixel"',()=>{
 const a=issueActs(PIXEL,C);assert.deepEqual(labels(a),['Sign in to Proton ChatGPT','Take it out of the priority list','Sign in to Antigravity','Take it out of the priority list','Check again']);
 assert.deepEqual(a.map(x=>[x.do,x.key||'',x.step||0,!!x.alt]),[['signin-account','p:openai-codex',1,false],['unlist-account','p:openai-codex',1,true],['signin-account','p:antigravity-subscription',2,false],['unlist-account','p:antigravity-subscription',2,true],['recheck','',0,false]]);
 // an account that is not in the priority list has no "take it out" button; one aqeelOS does not know has no sign-in at all
 const b=issueActs(PIXEL,{...C,accounts:[{key:'p:openai-codex',name:'Proton ChatGPT',state:'signedout',listed:false}]});assert.deepEqual(labels(b),['Sign in to Proton ChatGPT','Check again']);
 const c=issueActs(PIXEL,{...C,accounts:[]});assert.deepEqual(c.map(x=>[x.do,x.to,x.label]),[['go','/models/models','Open AI accounts'],['recheck',undefined,'Check again']])});
test('facts first: steps written by the fixer or the sorter are used as they are, and each is checked',()=>{
 const st=[{what:'google',agent:'fakhri-agent'},{what:'remove-app',id:'WO Dashboard - Google Sheet',agent:'fakhri-agent'}];
 assert.deepEqual(dos(issueActs({agent:'fakhri-agent',need:'Do the two things.',steps:st},C)),['google','remove-app','recheck']);
 // provider names and aliases find the account; "alt" makes a step secondary
 const p=issueActs({agent:'pixel-agent',need:'x',steps:[{what:'ai-account',id:'chatgpt'},{what:'ai-account',id:'Antigravity',alt:true}]},{...C,accounts:ACCOUNTS.map(x=>({...x,listed:false}))});
 assert.deepEqual(p.map(x=>[x.do,x.key||'',!!x.alt]),[['signin-account','p:openai-codex',false],['signin-account','p:antigravity-subscription',true],['recheck','',false]]);
 // the app is gone already: that step is done (a tick), the other one is still a button
 const g=issueActs({agent:'fakhri-agent',need:'x',steps:st},{...C,mcp:MCP.filter(m=>!/WO Dash/.test(m.id))});assert.deepEqual(dos(g),['google','done','recheck']);
 // junk is dropped, never trusted
 assert.deepEqual(cleanSteps([{what:'rm -rf',id:'x'},{what:'app',id:'slack',agent:'../etc',alt:'yes'},null,'x']),[{what:'app',id:'slack',agent:''}]);
 assert.deepEqual(parseResult('RESULT: '+JSON.stringify({status:'needs_human',need:'Sign in',steps:[{what:'ai-account',id:'Proton ChatGPT'},{what:'bogus'}]})).steps,[{what:'ai-account',id:'Proton ChatGPT',agent:''}]);
 assert.deepEqual(parseSort('SORT: '+JSON.stringify({kind:'person',title:'t',need:'n',group:'g',steps:[{what:'google',agent:'fakhri-agent'}]})).steps,[{what:'google',id:'',agent:'fakhri-agent'}])});
test('a sign-in is only offered when a sign-in page can start: no address, or its own key, is the page instead',()=>{
 // the tool called pixel runs a command: even told to sign in to it, the button is the Connections page
 for(const i of [{agent:'pixel-agent',need:'x',steps:[{what:'app',id:'pixel',agent:'pixel-agent'}]},{agent:'pixel-agent',need:"Sign in to 'pixel' again for Pixel Agent."}]){
  const a=issueActs(i,C);assert.deepEqual(a.map(x=>[x.do,x.to]),[['go','/abilities/connections'],['recheck',undefined]])}
 assert.equal(mcpCanSignIn({url:'https://mcp.x.com/mcp',auth:'oauth'}),true);assert.equal(mcpCanSignIn({url:'https://mcp.x.com/mcp'}),true);
 for(const b of [{command:'npx'},{url:'https://x.com',auth:'header'},{url:'https://x.com',bearer_token:'k'},{url:'https://x.com',headers:{Authorization:'Bearer k'}},null])assert.equal(mcpCanSignIn(b),false,JSON.stringify(b));
 // an app that is signed in already is not a sign-in button
 assert.deepEqual(dos(issueActs({agent:'default',need:'x',steps:[{what:'app',id:'Notion',agent:'default'}]},C)),['go','recheck'])});
test('an unknown need is a deep link, never a sign-in',()=>{
 const none=['signin-app','signin-account','google','screen','remove-app','unlist-account'];
 for(const need of ['Amri to confirm the QRIS picture shows on the 3124 tester phone.','Pay the Tripay invoice for November.','Decide whether Pixel should keep answering in the pixel group.','Somebody has to sign the contract with pixel media and sign in at the bank.','Add the key under System > Keys.']){
  const a=issueActs({id:'i1',agent:'pixel-agent',title:'Pixel Agent needs a person for a fix',need},C);assert.ok(!a.some(x=>none.includes(x.do)),need+': '+JSON.stringify(dos(a)));assert.equal(a[0].do,'go',need);assert.ok(a[0].to.startsWith('/'),need);assert.equal(a.at(-1).do,'recheck')}
 assert.equal(issueActs({agent:'x',need:'Add the key under System > Keys.'},C)[0].to,'/system/keys');
 // with no install facts at all nothing is guessed either
 assert.deepEqual(dos(issueActs(PIXEL,{})),['go','recheck']);assert.equal(issueActs(PIXEL,{})[0].to,'/models/models')});
test('every action a need can produce has a handler, and the handler does something real',async()=>{
 const src=readFileSync(new URL('../app/bottlenecks.js',import.meta.url),'utf8'),body=src.slice(src.indexOf(' act(a,x){'),src.indexOf(' // a question (questions.mjs)'));
 const handled=[...body.matchAll(/case '([a-z-]+)':/g)].map(m=>m[1]);
 // everything the resolver can produce, from every kind of step against a full and an empty install
 const all=new Set();const every=STEP_KINDS.flatMap(what=>[{what,id:'Proton ChatGPT',agent:'fakhri-agent'},{what,id:'higgsfield',agent:'sesa'},{what,id:'WO Dashboard - Google Sheet',agent:'fakhri-agent'},{what,id:'nope',agent:'nobody'}]);
 for(const cx of [C,{}])for(const s of every)for(const x of issueActs({id:'i1',agent:'fakhri-agent',need:'x',steps:[s]},cx))all.add(x.do);
 for(const i of [FAKHRI,PIXEL,{agent:'default',need:'On the server run '+CMD+' as root.'},{agent:'default',need:'Donna cannot log back in to the KirimDev website: its session expired and the password page is open in her browser.'}])for(const x of issueActs(i,C))all.add(x.do);
 for(const d of all)assert.ok(handled.includes(d),'"'+d+'" has no handler in Bottlenecks.act');
 for(const d of all)if(d!=='done')assert.ok(DOES.includes(d),'"'+d+'" is not a declared action');
 for(const d of DOES)assert.ok(handled.includes(d),'declared action "'+d+'" has no handler');assert.ok(DOES.every(d=>all.has(d)),'not produced here: '+DOES.filter(d=>!all.has(d)));
 // the handlers call what exists: the functions on the page, and routes the server has
 const srv=sourceOf('app/server.mjs')+readFileSync(new URL('../app/accounts.mjs',import.meta.url),'utf8');
 for(const r of ['/ui/accounts/unlist','/ui/mcp/start-signin','/ui/health/issues/retry'])assert.ok(srv.includes("'"+r+"'"),r);
 const front=['core.js','pages.js','connect.js','google-connect.js','mcp-share.js','screen.js'].map(f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8')).join('\n');
 for(const fn of ['Pages.reconnect=','async reconnect(key,name)','const GC=','async open(opt={})','const Signins=','async go(x){','const openAgentScreen=','function confirmBox(','const del=','function go('])assert.ok(front.includes(fn),'missing on the page: '+fn);
 // run each handler against stubs: it starts the real thing and never ends in a toast that says it cannot
 calls.length=0;const said=[];ctx.toast=(m,k)=>said.push([m,k]);
 const run=a=>Promise.race([Promise.resolve(B.act(a,{id:'i1'})),new Promise(r=>setTimeout(r,20))]);
 for(const a of [...issueActs(FAKHRI,C),...issueActs(PIXEL,C)])await run(a);
 const names=calls.map(c=>c[0]);for(const n of ['GC.open','confirmBox','del','Pages.reconnect','post'])assert.ok(names.includes(n),n+' was not called: '+names);
 assert.ok(!names.includes('Signins.go'),'no app sign-in was started');assert.ok(!said.some(([m,k])=>k==='err'||/only tools|cannot|can.t/i.test(m)),JSON.stringify(said))});
test('several steps are drawn as a numbered list, a button each; one step is just its button',()=>{
 const a=B.needBtns(issueActs(PIXEL,C),{id:'i1'});
 assert.deepEqual(a.map(r=>[r[0],r[2],r[3]?.step||0,!!r[3]?.alt]),[['Sign in to Proton ChatGPT',true,1,false],['Take it out of the priority list',false,1,true],['Sign in to Antigravity',false,2,false],['Take it out of the priority list',false,2,true],['Check again',false,0,false]]);
 for(const r of a.filter(r=>r[3]))assert.ok(r[3].say&&r[3].say.length>12,'a step says what to do');assert.equal(a.filter(r=>r[2]).length,1,'one primary')});
test('the Higgsfield sign-in is a Sign in to Higgsfield button on the right agent, not a generic one',()=>{
 const a=issueActs({agent:'continue-threads',title:"Higgsfield app won't connect for Threads agent",need:"Open the aqeelOS connector sign-in for higgsfield (reconnect_my_connector, or `hermes -p continue-threads mcp login higgsfield`) and click Allow on Higgsfield's consent page."},C);
 assert.deepEqual([a[0].do,a[0].agent,a[0].name,a[0].app,a[0].label],['signin-app','continue-threads','higgsfield','Higgsfield','Sign in to Higgsfield']);assert.equal(a.at(-1).do,'recheck');
 const b=issueActs({agent:'continue-support',need:'Re-authorize Higgsfield for continue-support: reconnect the higgsfield app in aqeelOS (reconnect_my_connector) or run `hermes mcp login higgsfield` for that profile and approve in the browser.'},C);
 assert.equal(b[0].do,'signin-app');assert.equal(b[0].agent,'continue-threads');   // the agent that has it and is not signed in
 assert.equal(findApp('notion',C).id,'notion-aqeel')});
test('the agent\'s screen, a command, and nothing special',()=>{
 assert.equal(issueActs({agent:'default',need:'Donna cannot log back in to the KirimDev website: its session expired and the password page is open in her browser.'},C)[0].do,'screen');
 const c=issueActs({agent:'default',need:'On the server run '+CMD+' as root.'},C);assert.deepEqual([c[0].do,c[0].cmd],['copy','sudo systemctl restart box-agent']);
 const d=issueActs({agent:'default',need:'Amri to confirm the QRIS picture shows on the 3124 tester phone.'},C);assert.deepEqual(dos(d),['go','recheck']);assert.equal(d[0].to,'/system/health')});
test('merged app sign-ins in the popup get one Sign in button per app that can really sign in',()=>{
 const a=itemActs({kind:'apps',agent:'sesa',title:'Higgsfield and Slack need a sign-in'},C);assert.deepEqual(labels(a),['Sign in to Higgsfield','Sign in to Slack']);
 assert.equal(a[0].agent,'sesa');assert.equal(a[1].agent,'default');
 assert.deepEqual(itemActs({kind:'apps',agent:'pixel-agent',title:'pixel needs a sign-in'},C),[],'a tool with no sign-in page gets no button here: the item keeps Open Connected apps');
 // a fixer message in the popup takes the facts of its issue, and never points back at Health from Health
 const m=itemActs({kind:'alerts',title:'Pixel Agent needs a person for a fix',text:'issue i0000000b'},C,PIXEL);assert.deepEqual(dos(m),['signin-account','unlist-account','signin-account','unlist-account']);
 assert.deepEqual(itemActs({kind:'alerts',title:'x',text:'What is needed: pay the invoice'},C),[])});
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
 const srv=sourceOf('app/server.mjs'),iss=readFileSync(new URL('../app/issues.mjs',import.meta.url),'utf8');
 for(const n of ['ask_owner','question_done','my_questions','/ui/questions/answer','questions.contextLines','questions.open'])assert.ok(srv.includes(n),n);assert.match(iss,/CHOICE between approaches/)});
