// Activity (UI audit 17): the page used to say "Nothing here needs you" above rows that ask the person to act. A row that asks is marked, and
// the summary line counts those plus Health's Needs you (same needGroups), so the line and the list agree.
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createNews} from '../app/news.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {asksYou,askOf} from '../app/bottlenecks.mjs';
const src=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
test('rows that ask the person to act are recognised, the quiet ones are not',()=>{
 assert.equal(asksYou({title:"Rina's self-runs are paused",text:"its last 3 runs failed. Look at them and resume in aqeelOS (Automations › Runs itself)."}),true);
 assert.equal(asksYou({title:'No channel to you is set up yet',text:'so this alert waits here. Pick one under Alerts go to on System › Teams.'}),true);
 assert.equal(asksYou({title:'Aisar Agent works again',text:'It answered after a restart.'}),false);
 assert.equal(asksYou({title:'Restarted the agents',text:'Two agents were restarted.'}),false)});
test('the summary line is made from Health\'s Needs you and the rows that ask, and the fixed sentence is gone',()=>{
 assert.ok(!/Nothing here needs you\.'/.test(src('core.js')),'the static claim is gone from the page description');
 const a=src('activity-page.js');assert.match(a,/HealthIssues\.needGroups/);assert.match(a,/l\.filter\(x=>x\.ask\)/);assert.match(a,/Nothing here needs you right now/);
 assert.match(src('news.mjs'),/askOf\(x\)/)});
test('one ask is one thing: the alert-channel sentence on many alerts is marked once, on the newest',async()=>{
 const n=createNews({DATA:mkdtempSync(path.join(tmpdir(),'aq-act-'))}),why=' No channel to you is set up yet, so this alert waits here. Pick one under Alerts go to on System › Teams.';
 for(const a of ['A','B','C'])await n.add({aud:'admins',title:a+' stopped answering',text:'it did not answer.'+why,key:'k'+a});
 await n.add({aud:'admins',title:'Pixel Agent restarted',text:'all well'});
 const rows=await n.activity({id:'owner'},true),marked=rows.filter(x=>x.ask);
 assert.equal(marked.length,1,'the same ask is counted once');assert.match(marked[0].ask,/^Pick one under Alerts go to/);assert.match(marked[0].title,/^C /,'on the newest');
 assert.ok(!rows.find(x=>x.title==='Pixel Agent restarted').ask)});
