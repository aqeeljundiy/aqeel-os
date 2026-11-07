// node scripts/morning.test.mjs — the morning line (owner's stability plan, 8 Nov 2026): one plain line at 07:30 WIB,
// "Yesterday: everything worked." or exactly what broke and whether it fixed itself, from data, no model call
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fromLiveTests,short,fromIssues,fromEvents,fromActivity,fromRollbacks,fromDeploys,merge,morningLine,createMorning} from '../app/morning.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const NOW=Date.parse('2026-11-08T00:30:00Z'),since=NOW-864e5,H=3600e3;   // 07:30 WIB
const names=a=>({sesa:'Sesa','continue-support':'Continue Support',default:'Donna AI'})[a]||a;
const o={since,names,isTest:a=>/^mb-/.test(a)};

await t('a quiet day is one line',()=>{assert.equal(morningLine([]),'Yesterday: everything worked.')});
await t('issues: fixed by itself, a person, the daily deploy, being fixed; old, closed, test and planned items left out',()=>{
 const l=fromIssues([{id:'i1',agent:'sesa',state:'fixed',created:NOW-5*H,fixed:NOW-4*H,missing:'The skill maps points to a file that is not there. Missing: x.py'},
  {id:'i2',agent:'continue-support',state:'needs_human',created:NOW-3*H,missing:'A new API key for Xendit; the old one was revoked'},
  {id:'i3',agent:'sesa',state:'deploy',created:NOW-2*H,missing:'Kirimdev labels are not set after a payment'},
  {id:'i4',agent:'sesa',state:'fixing',created:NOW-H,missing:'Composio sign-in fails'},
  {id:'i5',agent:'sesa',state:'stuck',created:NOW-9*864e5,updated:NOW-9*864e5,missing:'old and quiet'},
  {id:'i6',agent:'sesa',state:'closed',created:NOW-H,missing:'closed by a person'},{id:'i7',agent:'mb-z4b1u',state:'queued',created:NOW-H,missing:'a test agent'},
  {id:'i8',agent:'sesa',state:'queued',created:NOW-H,missing:'PLANNED TEST, no action needed: ladder'}],o);
 assert.deepEqual(l.map(x=>[x.what,x.state]),[['The skill maps points to a file that is not there','fixed'],['A new API key for Xendit','person'],['Kirimdev labels are not set after a payment','deploy'],['Composio sign-in fails','working']]);
 const line=morningLine(l);assert.equal(line,'Yesterday: 4 things went wrong. Fixed by itself: missing skill files: maps (Sesa).\nNot fixed yet: A new API key for Xendit (Continue Support, needs you in Bottlenecks); app sign-ins: composio (Sesa, the fixer is on it); Kirimdev labels are not set after a payment (Sesa, fix waits for the daily deploy).')});
await t('Activity: a tool server that stopped on several agents and works again is one fixed item; one still down is not',()=>{
 const row=(title,t,x={})=>({title,t,cls:'activity',...x});
 const l=fromActivity([row('Donna AI: the tool server "aqeelos-notify" works again',NOW-H),row('Sesi AI: the tool server "aqeelos-notify" stopped connecting',NOW-3*H,{count:4,since:NOW-6*H}),
  row('Pixel Agent: the tool server "aqeelos-notify" stopped connecting',NOW-3*H),row('Continue Support: the tool server "aqeelos-notify" is missing its tools',NOW-2*H),
  row('Donna AI: the tool server "notion" stopped connecting',NOW-2*H),row('Donna AI (extra number): the tool server "notion" stopped connecting',NOW-2*H),
  row('Sesa finished a run it started itself (2 min). Reason: aqeelOS health: A schedule failed',NOW-H),row('Old: the tool server "x" stopped connecting',since-H)],o);
 assert.deepEqual(l.map(x=>[x.what,x.state,x.agents.length]),[['the tool server aqeelos-notify','fixed',4],['the tool server notion','open',1]]);
 assert.equal(morningLine(l),'Yesterday: 2 things went wrong. Fixed by itself: the tool server aqeelos-notify (4 agents).\nNot fixed yet: the tool server notion (Donna AI, still broken).');
 // still broken only when Health still has it open now
 const rows=[row('Donna AI: the tool server "notion" stopped connecting',NOW-2*H),row('Sesa: the tool server "composio" stopped connecting',NOW-2*H)];
 assert.deepEqual(fromActivity(rows,{...o,open:['Tool servers do not start: notion']}).map(x=>x.state),['open','fixed'])});
await t('the same problem from an issue and Activity is one item; fixed only when every source says so',()=>{
 const l=merge([...fromIssues([{id:'i9',agent:'default',state:'fixed',created:NOW-2*H,fixed:NOW-H,healthKey:'health|aqeelos|tool|aqeelos-notify',missing:'aqeelOS\'s own tool server aqeelos-notify is failing for 5 agents'}],o),
  ...fromActivity([{title:'Sesa: the tool server "aqeelos-notify" stopped connecting',t:NOW-3*H},{title:'Sesa: the tool server "aqeelos-notify" works again',t:NOW-H}],o),
  ...fromEvents([{id:'e1',kind:'skill',text:'The skill maps points to a file that is not there',created:NOW-H,agent:'sesa',topic:'health|sesa|skill|maps'},{id:'e2',kind:'skill',text:'The skill maps points to a file that is not there',created:NOW-H,agent:'continue-support'}],o),
  ...fromEvents([{id:'e3',kind:'alerts',text:'our own alert',created:NOW-H},{id:'e4',kind:'down',text:'old',created:since-H}],o)]);
 assert.deepEqual(l.map(x=>[x.state,x.agents.length]),[['open',2],['fixed',2]]);
 const k=merge([...fromIssues([{id:'ia',agent:'default',state:'queued',created:NOW-H,healthKey:'health|aqeelos|tool|aqeelos-notify',missing:'x'}],o),...fromActivity([{title:'Sesa: the tool server "aqeelos-notify" works again',t:NOW-H},{title:'Sesa: the tool server "aqeelos-notify" stopped connecting',t:NOW-2*H}],o)]);
 assert.equal(k.length,1);assert.equal(k[0].state,'working')});
await t('automatic rollbacks and deploys: an undo the agent recovered from is fixed; a deploy stopped at its checks changed nothing; a failed go-live fixed by a later deploy',()=>{
 const r=fromRollbacks({sesa:{events:[{kind:'rollback',at:NOW-5*H},{kind:'ok',at:NOW-4*H}]},'continue-support':{events:[{kind:'rollback',at:NOW-2*H}]},'mb-z4b1u':{events:[{kind:'rollback',at:NOW-H}]},default:{events:[{kind:'rollback',at:since-H}]}},o);
 assert.deepEqual(r.map(x=>[x.what,x.state]),[['Sesa stopped answering after changing itself, so its changes were undone','fixed'],['Continue Support stopped answering after changing itself, so its changes were undone','open']]);
 const d=fromDeploys([{at:Date.parse('2026-11-07T07:02:00Z'),text:'…\nAQ-DEPLOY FAILED checks'},{at:Date.parse('2026-11-07T07:20:00Z'),text:'AQ-DEPLOY FAILED busy'},{at:Date.parse('2026-11-07T09:10:00Z'),text:'AQ-DEPLOY FAILED go live'},{at:Date.parse('2026-11-07T09:40:00Z'),text:'x\nAQ-DEPLOY DONE'},{at:since-H,text:'AQ-DEPLOY FAILED pack'}],{since,tz:'Asia/Jakarta'});
 assert.equal(d.ok,1);assert.deepEqual(d.items.map(x=>[x.what,x.state]),[['the 14:02 deploy stopped at its checks, nothing changed','fixed'],['the 16:10 deploy failed while going live','fixed']]);
 assert.equal(fromDeploys([{at:NOW-H,text:'AQ-DEPLOY FAILED go live'}],{since,tz:'Asia/Jakarta'}).items[0].state,'open');
 assert.equal(fromDeploys([{at:NOW-3*H,text:'AQ-DEPLOY FAILED checks'},{at:NOW-2*H,text:'AQ-DEPLOY FAILED checks'}],{since,tz:'Asia/Jakarta'}).items[0].what,'2 deploys stopped at their checks, nothing changed')});
await t('the live test after a deploy: undone by itself is fixed; no undo or a failed undo is not',()=>{
 const l=fromLiveTests([{at:NOW-3*H,sha:'2b560f9abc',ok:false,failed:['tools: aqeelos-notify did not answer','agent: no answer'],undo:{at:NOW-3*H,ok:true}},{at:NOW-2*H,sha:'abcdef12',ok:false,failed:['engine: 1 unclean exit'],undo:{ok:false}},{at:NOW-H,sha:'x',ok:true},{at:since-H,ok:false}],o);
 assert.deepEqual(l.map(x=>[x.what,x.state]),[['the deploy of 2b560f9a failed its live test (tools, agent), so the previous version was put back','fixed'],['the deploy of abcdef12 failed its live test (engine) and putting the previous version back failed','open']])});
await t('a batch of one kind is one item: missing skill files, app sign-ins, groups, file access',()=>{const is=(id,agent,missing,state='fixed')=>({id,agent,state,created:NOW-H,missing});
 const l=merge(fromIssues([is('a','sesa','The skill maps points to a file that is not there'),is('b','continue-support','The skill continue-vial-labels points to a file that is not there'),is('c','default','The skill whatsapp-support-agents points to 2 files that are not there','queued'),
  is('d','sesa','Sesa reported a system problem: A sign-in for composio, notion and slack'),is('e','cont-socmed','Continue Social Media is blocked: A sign-in for Notion and for Slack (OAuth)'),
  is('f','continue-threads','Read/execute access for ag-continue-threads to /home/claude/work/labels'),is('g','cont-socmed','Removed from the Telegram group Continue - Socials')],o));
 assert.deepEqual(l.map(x=>[x.what,x.state,x.agents.length]),[['missing skill files','working',3],['app sign-ins','fixed',2],['file access','fixed',1],['bot removed from Telegram groups','fixed',1]]);
 assert.equal(morningLine(l),'Yesterday: 4 things went wrong. Fixed by itself: app sign-ins: composio, notion and 1 more (2 agents); file access (continue-threads); bot removed from Telegram groups: Continue - Socials (cont-socmed).\nNot fixed yet: missing skill files: maps, continue-vial-labels and 1 more (3 agents, the fixer is on it).')});
await t('short names and long lists stay one or two lines',()=>{assert.equal(short('Tool servers do not start: composio, notion (OAuth). More text here'),'Tool servers do not start: composio, notion');
 assert.ok(short('x '.repeat(80)).length<=70);
 const many=Array.from({length:6},(_,k)=>({key:'k'+k,what:'problem number '+k,agents:[],state:k<4?'fixed':'open',at:k}));const line=morningLine(many);
 assert.match(line,/Fixed by itself: problem number 0; problem number 1; problem number 2; 1 more\./);assert.equal(line.split('\n').length,2)});
await t('sent once a day at 07:30 local time through the alert route; a failed send is not repeated',async()=>{const d=await mkdtemp(path.join(tmpdir(),'mo-'));const logs=path.join(d,'tmp');await mkdir(logs);
 await writeFile(path.join(logs,'aq-deploy-1-1.log'),'AQ-DEPLOY FAILED checks\n');await writeFile(path.join(logs,'aq-deploy-2-2.log'),'AQ-DEPLOY FAILED go live\n');await utimes(path.join(logs,'aq-deploy-2-2.log'),(NOW-H)/1000,(NOW-H)/1000);
 await writeFile(path.join(d,'live-test.json'),JSON.stringify({runs:[{at:NOW-H-60e3,sha:'2b560f9abc',ok:false,failed:['tools: x'],undo:{ok:true}}]}));await utimes(path.join(logs,'aq-deploy-1-1.log'),(NOW-2*H)/1000,(NOW-2*H)/1000);
 await mkdir(path.join(d,'agent-versions'));await writeFile(path.join(d,'agent-versions','sesa'),JSON.stringify({events:[{kind:'rollback',at:NOW-3*H},{kind:'ok',at:NOW-2*H}]}));
 let now=NOW-31*60e3;const sent=[];let fail=false;const M=createMorning({DATA:d,deployLogs:logs,tz:()=>'Asia/Jakarta',now:()=>now,log:()=>{},
  send:async x=>{sent.push(x);if(fail)throw Error('telegram down')},collect:async()=>({issues:[],events:[],activity:[],names})});
 assert.equal(await M.tick(),null,'06:59: not yet');now=NOW;const line=await M.tick();
 assert.equal(line,'Yesterday: 3 things went wrong, all fixed by itself: Sesa stopped answering after changing itself, so its changes were undone; the 05:30 deploy stopped at its checks, nothing changed; the deploy of 2b560f9a failed its live test (tools), so the previous version was put back.');
 assert.equal(sent.length,1);now=NOW+H;assert.equal(await M.tick(),null,'once a day');
 now=NOW+864e5;fail=true;assert.ok(await M.tick());now+=10*60e3;assert.equal(await M.tick(),null,'a failed send went to the bell and is not sent again');assert.equal(sent.length,2)});
console.log(n+' passed');
