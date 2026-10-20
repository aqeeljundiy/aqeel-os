import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentRun,displayCommand} from './agent.mjs';

test('approvals wait for a decision, resume the run and reject stale or unknown answers',()=>{
 const run=new AgentRun({projectId:'p',chatId:'c',provider:'codex',prompt:'x'});const answers=[];
 const a=run.ask('command','Run this command?','npm install',d=>answers.push(d));
 assert.equal(run.state,'waiting');assert.equal(run.view().events.at(-1).status,'pending');
 assert.throws(()=>run.decide(a.key,'yolo'),/Unknown decision/);
 run.decide(a.key,'accept');assert.deepEqual(answers,['accept']);assert.equal(run.state,'running');assert.equal(a.status,'approved');
 assert.throws(()=>run.decide(a.key,'accept'),/no longer pending/);
 const b=run.ask('file','Apply?','index.html',d=>answers.push(d));run.denyAll();assert.equal(b.status,'denied');assert.deepEqual(answers,['accept','decline']);
});
test('updated events keep their key and are returned to pollers again',()=>{
 const run=new AgentRun({});const e=run.emit({type:'command',command:'dir',status:'running',output:''});const after=run.seq;
 run.update(e,{status:'completed'});const again=run.view(after).events;assert.equal(again.length,1);assert.equal(again[0].key,e.key);assert.equal(again[0].status,'completed');
});
test('Codex PowerShell wrapper is unwrapped for display',()=>{
 assert.equal(displayCommand(`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'git status'`),'git status');
 assert.equal(displayCommand(`"C:\\Windows\\powershell.exe" -NoProfile -Command 'echo ''hi'''`),"echo 'hi'");
 assert.equal(displayCommand('npm test'),'npm test');
});
test('double-quoted Codex commands unwrap and read-only actions are recognised',async()=>{
 const {readOnly}=await import('./agent.mjs');
 assert.equal(displayCommand(String.raw`"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Get-Content -Raw .\hello.txt; Write-Output \"hi\""`),String.raw`Get-Content -Raw .\hello.txt; Write-Output "hi"`);
 assert.equal(readOnly({commandActions:[{type:'read'},{type:'listFiles'}]}),true);
 assert.equal(readOnly({commandActions:[{type:'read'},{type:'unknown'}]}),false);
 assert.equal(readOnly({commandActions:[]}),false);
 assert.equal(readOnly({commandActions:[{type:'search'}],networkApprovalContext:{host:'x'}}),false);
});
test('questions wait for answers, keep only asked ids, and the checklist updates in place',()=>{
 const run=new AgentRun({});let got;const q=run.askQuestions([{id:'a',question:'Colour?',options:[{label:'Blue'}]}],a=>got=a);
 assert.equal(run.state,'waiting');assert.throws(()=>run.answer(q.key,null));run.answer(q.key,{a:'Blue',zzz:'ignored'});assert.deepEqual(got,{a:['Blue']});assert.equal(run.state,'running');assert.throws(()=>run.answer(q.key,{a:'x'}),/no longer open/);
 run.setPlan([{text:'one',status:'pending'}]);const first=run.planEvent.key;run.setPlan([{text:'one',status:'completed'}]);assert.equal(run.planEvent.key,first);assert.equal(run.events.filter(e=>e.type==='plan').length,1);
 let cancelled='x';run.askQuestions([{id:'b',question:'?'}],a=>cancelled=a);run.denyAll();assert.equal(cancelled,null);
});
