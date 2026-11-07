// Tests for live context each message and the traceback guard (app/agent-live.mjs, engine/aqeelos-live). Run: node --test scripts/agent-live.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createAgentLive,senderRole,errorSig} from '../app/agent-live.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));const ENGINE=path.join(here,'..','engine','aqeelos-live');
const POLICY={owner:{name:'Aqeel',telegram:['1543470752'],whatsapp:['6281336263417']},teams:[{name:'Continue',agents:['continue-support'],members:[{name:'Amri',telegram:['1339820731'],full_authority:['continue-support']}]}]};
const TB='Traceback (most recent call last):\n  File "/home/claude/workspaces/continue-support/test_chat_watchdog.py", line 10, in <module>\n    r=json.loads(x)\n  File "/usr/lib/python3.12/json/__init__.py", line 346, in loads\n    return d(s)\njson.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)';

async function make(){const H=await mkdtemp(path.join(tmpdir(),'al-'));await mkdir(path.join(H,'profiles','continue-support'),{recursive:true});await mkdir(path.join(H,'profiles','default--whatsapp-2'),{recursive:true});
 for(const a of ['','profiles/continue-support','profiles/default--whatsapp-2'])await writeFile(path.join(H,a,'config.yaml'),'x: 1\n');await mkdir(path.join(H,'profiles','.deleted'),{recursive:true});
 const cfg={},sets=[];let capsText=['Checked by aqeelOS from your real settings at 2026-11-07 00:00 UTC.','- Tools: lockbox, my_health'];let t=1e12;
 const L=createAgentLive({HERMES_HOME:H,DATA:path.join(H,'data'),listAgents:async()=>['default','continue-support'],readConfig:async a=>cfg[a]||{},setKey:async(a,k,v)=>{sets.push([a,k,v]);cfg[a]={plugins:{enabled:v}}},
  pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),capabilities:async()=>capsText,policy:async()=>POLICY,engineDir:ENGINE,log:()=>{},now:()=>t});
 return {L,H,cfg,sets,setCaps:c=>{capsText=c},tick:ms=>{t+=ms}}}

test('the sender is checked against the team policy, never by display name',()=>{
 assert.equal(senderRole(POLICY,'telegram','1543470752').role,'owner');
 assert.equal(senderRole(POLICY,'whatsapp','6281336263417@s.whatsapp.net').role,'owner');
 assert.deepEqual(senderRole(POLICY,'telegram','1339820731'),{role:'member',name:'Amri',team:'Continue',full:['continue-support']});
 assert.equal(senderRole(POLICY,'telegram','999'),null);assert.equal(senderRole(POLICY,'slack','1543470752'),null);assert.equal(senderRole(POLICY,'telegram',''),null)});

test('a chat gets the capability list on its first turn and again only when it changed; customers and schedules never',async()=>{const {L,setCaps,tick}=await make();
 let r=await L.context('continue-support',{platform:'telegram',sender:'1543470752',first:true});
 assert.match(r.text,/from Aqeel, the owner, verified/);assert.match(r.text,/What you can do right now[\s\S]*lockbox/);
 const again=await L.context('continue-support',{platform:'telegram',sender:'1543470752',seen:r.hash});assert.doesNotMatch(again.text,/What you can do/);
 setCaps(['Checked by aqeelOS at later.','- Tools: lockbox, my_health, new_tool']);tick(61e3);
 const changed=await L.context('continue-support',{platform:'telegram',sender:'1543470752',seen:r.hash});assert.match(changed.text,/new_tool/);assert.notEqual(changed.hash,r.hash);
 const stranger=await L.context('continue-support',{platform:'telegram',sender:'42',seen:changed.hash});assert.match(stranger.text,/not verified as the owner/);
 const member=await L.context('continue-support',{platform:'telegram',sender:'1339820731',seen:changed.hash});assert.match(member.text,/Amri \(team Continue\)[\s\S]*changes to your own work/);
 assert.equal((await L.context('continue-support',{platform:'whatsapp',sender:'628111',first:true})).text,'');
 assert.equal((await L.context('continue-support',{platform:'cron',first:true})).text,'');
 for(const pf of ['cli','tool','oneshot'])assert.doesNotMatch((await L.context('continue-support',{platform:pf,sender:'uid:1001',first:true})).text,/Sender check/)});

test('a held script error is kept once per kind, told to the agent once, and listed in its health',async()=>{const {L,tick}=await make();
 await L.hold('continue-support',{error:TB,platform:'cron'});const r2=await L.hold('continue-support',{error:TB.replace('line 10','line 11'),platform:'cron'});assert.equal(r2.count,2);
 assert.equal(errorSig(TB),errorSig(TB.replace('line 10','line 12')));assert.notEqual(errorSig(TB),errorSig(TB.replace('JSONDecodeError','KeyError')));
 const c=await L.context('continue-support',{platform:'telegram',sender:'1543470752',first:true});assert.match(c.text,/held a script error[\s\S]*JSONDecodeError[\s\S]*2×, from cron/);
 assert.doesNotMatch((await L.context('continue-support',{platform:'telegram',sender:'1543470752',seen:c.hash})).text,/held a script error/);
 assert.match((await L.healthLines('continue-support')).join(),/2× from cron: json.decoder.JSONDecodeError/);
 // a copy's errors belong to its agent; customers never see them
 await L.hold('continue-support--wa2',{error:TB.replace('JSONDecodeError','KeyError'),platform:'whatsapp'});assert.equal((await L.heldFor('continue-support')).length,2);
 assert.equal((await L.context('continue-support',{platform:'whatsapp',sender:'628111'})).text,'');
 tick(7*3600e3);await L.hold('continue-support',{error:TB,platform:'cron'});assert.match((await L.context('continue-support',{platform:'telegram',sender:'1543470752',seen:c.hash})).text,/JSONDecodeError/)});

test('the plugin goes into every home (copies too) and is switched on once; a switched-off plugin stays off',async()=>{const {L,H,cfg,sets}=await make();cfg['default--whatsapp-2']={plugins:{disabled:['aqeelos-live']}};
 const c=await L.install();assert.deepEqual(c.sort(),['continue-support','default','default--whatsapp-2']);
 assert.equal(await readFile(path.join(H,'profiles','continue-support','plugins','aqeelos-live','__init__.py'),'utf8'),await readFile(path.join(ENGINE,'__init__.py'),'utf8'));
 assert.deepEqual(sets.map(s=>s[0]).sort(),['continue-support','default']);assert.deepEqual(await L.install(),[]);
 assert.equal((await L.homes()).includes('.deleted'),false);assert.ok(await L.keyOk(await L.key()));assert.equal(await L.keyOk('nope'),false)});

test('the engine guard holds tracebacks back: a note in team chats, silence for schedules, own words kept',()=>{
 const run=(text,platform)=>JSON.parse(execFileSync('python3',['-I','-c',`import sys,json,importlib.util as u
s=u.spec_from_file_location("g",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m)
print(json.dumps(m.guard_reply(sys.argv[2],sys.argv[3])))`,path.join(ENGINE,'__init__.py'),text,platform],{encoding:'utf8'}));
 assert.match(run(TB,'telegram')[0],/held back from this chat/);assert.equal(run(TB,'cron')[0],'[SILENT]');
 const mixed=run('Here is the summary.\n\n```\n'+TB+'\n```\nI will retry.','slack');assert.match(mixed[0],/^Here is the summary\.\n\nI will retry\./);assert.match(mixed[1],/JSONDecodeError/);
 assert.doesNotMatch(run(TB,'whatsapp')[0],/script|health/);
 assert.match(run('Error: boom\n    at a (/x.js:1:2)\n    at b (/y.js:3:4)\n    at c (node:z:5:6)','telegram')[1],/at c/);
 assert.deepEqual(run('Normal reply. File "x", line 3 once.','telegram'),[null,''])});
