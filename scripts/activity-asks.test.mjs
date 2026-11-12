// Activity (UI audit 17): the page used to say "Nothing here needs you" above rows that ask the person to act. A row that asks is marked, and
// the summary line counts those plus Health's Needs you (same needGroups), so the line and the list agree.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {asksYou} from '../app/bottlenecks.mjs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
test('rows that ask the person to act are recognised, the quiet ones are not',()=>{
 assert.equal(asksYou({title:"Rina's self-runs are paused",text:"its last 3 runs failed. Look at them and resume in aqeelOS (Automations › Runs itself)."}),true);
 assert.equal(asksYou({title:'No channel to you is set up yet',text:'so this alert waits here. Pick one under Alerts go to on System › Teams.'}),true);
 assert.equal(asksYou({title:'Aisar Agent works again',text:'It answered after a restart.'}),false);
 assert.equal(asksYou({title:'Restarted the agents',text:'Two agents were restarted.'}),false)});
test('the summary line is made from Health\'s Needs you and the rows that ask, and the fixed sentence is gone',()=>{
 assert.ok(!/Nothing here needs you\.'/.test(src('core.js')),'the static claim is gone from the page description');
 const a=src('activity-page.js');assert.match(a,/HealthIssues\.needGroups/);assert.match(a,/l\.filter\(x=>x\.ask\)/);assert.match(a,/Nothing here needs you right now/);
 assert.match(src('news.mjs'),/asksYou\(x\)&&!x\.resolved\?\{\.\.\.x,ask:true\}/)});
