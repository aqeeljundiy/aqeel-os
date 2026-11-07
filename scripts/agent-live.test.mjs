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
const POLICY={owner:{name:'Abel',telegram:['1000000001'],whatsapp:['6281200000001']},teams:[{name:'Cove',agents:['cove-support'],members:[{name:'Ari',telegram:['1339820731'],full_authority:['cove-support']}]}]};
const TB='Traceback (most recent call last):\n  File "/home/claude/workspaces/cove-support/test_chat_watchdog.py", line 10, in <module>\n    r=json.loads(x)\n  File "/usr/lib/python3.12/json/__init__.py", line 346, in loads\n    return d(s)\njson.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)';

async function make(){const H=await mkdtemp(path.join(tmpdir(),'al-'));await mkdir(path.join(H,'profiles','cove-support'),{recursive:true});await mkdir(path.join(H,'profiles','default--whatsapp-2'),{recursive:true});
 for(const a of ['','profiles/cove-support','profiles/default--whatsapp-2'])await writeFile(path.join(H,a,'config.yaml'),'x: 1\n');await mkdir(path.join(H,'profiles','.deleted'),{recursive:true});
 const cfg={},sets=[];let capsText=['Checked by aqeelOS from your real settings at 2026-11-07 00:00 UTC.','- Tools: lockbox, my_health'];let t=1e12;
 const L=createAgentLive({HERMES_HOME:H,DATA:path.join(H,'data'),chatInfo:async(a,pf,id)=>id==='-100gone'?{title:'',gone:true}:{title:'Continue - Support Agent'},topicName:async(a,c,t)=>t==='89'?'Questions (topic 89)':null,listAgents:async()=>['default','cove-support'],readConfig:async a=>cfg[a]||{},setKey:async(a,k,v)=>{sets.push([a,k,v]);cfg[a]={plugins:{enabled:v}}},
  pick:(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c),capabilities:async()=>capsText,policy:async()=>POLICY,engineDir:ENGINE,log:()=>{},now:()=>t});
 return {L,H,cfg,sets,setCaps:c=>{capsText=c},tick:ms=>{t+=ms}}}

test('the sender is checked against the team policy, never by display name',()=>{
 assert.equal(senderRole(POLICY,'telegram','1000000001').role,'owner');
 assert.equal(senderRole(POLICY,'whatsapp','6281200000001@s.whatsapp.net').role,'owner');
 assert.deepEqual(senderRole(POLICY,'telegram','1339820731'),{role:'member',name:'Ari',team:'Cove',full:['cove-support']});
 assert.equal(senderRole(POLICY,'telegram','999'),null);assert.equal(senderRole(POLICY,'slack','1000000001'),null);assert.equal(senderRole(POLICY,'telegram',''),null)});

test('a chat gets the capability list on its first turn and again only when it changed; customers and schedules never',async()=>{const {L,setCaps,tick}=await make();
 let r=await L.context('cove-support',{platform:'telegram',sender:'1000000001',first:true});
 assert.match(r.text,/from Abel, the owner, verified/);assert.match(r.text,/What you can do right now[\s\S]*lockbox/);
 const again=await L.context('cove-support',{platform:'telegram',sender:'1000000001',seen:r.hash});assert.doesNotMatch(again.text,/What you can do/);
 setCaps(['Checked by aqeelOS at later.','- Tools: lockbox, my_health, new_tool']);tick(61e3);
 const changed=await L.context('cove-support',{platform:'telegram',sender:'1000000001',seen:r.hash});assert.match(changed.text,/new_tool/);assert.notEqual(changed.hash,r.hash);
 const stranger=await L.context('cove-support',{platform:'telegram',sender:'42',seen:changed.hash});assert.match(stranger.text,/not verified as the owner/);
 const member=await L.context('cove-support',{platform:'telegram',sender:'1339820731',seen:changed.hash});assert.match(member.text,/Ari \(team Cove\)[\s\S]*changes to your own work/);
 assert.equal((await L.context('cove-support',{platform:'whatsapp',sender:'628111',first:true})).text,'');
 assert.equal((await L.context('cove-support',{platform:'cron',first:true})).text,'');
 for(const pf of ['cli','tool','oneshot'])assert.doesNotMatch((await L.context('cove-support',{platform:pf,sender:'uid:1001',first:true})).text,/Sender check/)});

test('a held script error is kept once per kind, told to the agent once, and listed in its health',async()=>{const {L,tick}=await make();
 await L.hold('cove-support',{error:TB,platform:'cron'});const r2=await L.hold('cove-support',{error:TB.replace('line 10','line 11'),platform:'cron'});assert.equal(r2.count,2);
 assert.equal(errorSig(TB),errorSig(TB.replace('line 10','line 12')));assert.notEqual(errorSig(TB),errorSig(TB.replace('JSONDecodeError','KeyError')));
 const c=await L.context('cove-support',{platform:'telegram',sender:'1000000001',first:true});assert.match(c.text,/held a script error[\s\S]*JSONDecodeError[\s\S]*2×, from cron/);
 assert.doesNotMatch((await L.context('cove-support',{platform:'telegram',sender:'1000000001',seen:c.hash})).text,/held a script error/);
 assert.match((await L.healthLines('cove-support')).join(),/2× from cron: json.decoder.JSONDecodeError/);
 // a copy's errors belong to its agent; customers never see them
 await L.hold('cove-support--wa2',{error:TB.replace('JSONDecodeError','KeyError'),platform:'whatsapp'});assert.equal((await L.heldFor('cove-support')).length,2);
 assert.equal((await L.context('cove-support',{platform:'whatsapp',sender:'628111'})).text,'');
 tick(7*3600e3);await L.hold('cove-support',{error:TB,platform:'cron'});assert.match((await L.context('cove-support',{platform:'telegram',sender:'1000000001',seen:c.hash})).text,/JSONDecodeError/)});

test('the plugin goes into every home (copies too) and is switched on once; a switched-off plugin stays off',async()=>{const {L,H,cfg,sets}=await make();cfg['default--whatsapp-2']={plugins:{disabled:['aqeelos-live']}};
 const c=await L.install();assert.deepEqual(c.sort(),['cove-support','default','default--whatsapp-2']);
 assert.equal(await readFile(path.join(H,'profiles','cove-support','plugins','aqeelos-live','__init__.py'),'utf8'),await readFile(path.join(ENGINE,'__init__.py'),'utf8'));
 assert.deepEqual(sets.map(s=>s[0]).sort(),['cove-support','default']);assert.deepEqual(await L.install(),[]);
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

test('the plugin starts long quiet direct chats fresh and stops a repeated call after 3',()=>{
 const py=code=>JSON.parse(execFileSync('python3',['-I','-c',`import sys,json,importlib.util as u
s=u.spec_from_file_location("g",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m)
${code}`,path.join(ENGINE,'__init__.py')],{encoding:'utf8'}));
 assert.deepEqual(py('print(json.dumps([m.should_roll("dm","telegram",7,200000,1),m.should_roll("dm","telegram",7,1000,4),m.should_roll("dm","telegram",2,900000,9),m.should_roll("group","telegram",9,900000,9),m.should_roll("dm","webhook",9,900000,9),m.should_roll("dm","telegram",7,1000,1)]))'),[true,true,false,false,false,false]);
 assert.deepEqual(py('c={};print(json.dumps([bool(m.repeat_block(c,"t:{}")) for _ in range(5)]+[bool(m.repeat_block(c,"t:{\\"x\\":1}"))]))'),[false,false,false,true,true,false])});

test('a group chat is named as it is now, with its topic role; a group the bot left is said so',async()=>{const {L}=await make();
 const c=await L.context('cove-support',{platform:'telegram',sender:'1000000001',chat:{chat_id:'-1001',thread_id:'89',chat_type:'group',chat_name:'Longevity - Support Agents / topic 89'}});
 assert.match(c.text,/This chat now: "Continue - Support Agent", topic Questions \(topic 89\) \(earlier messages may call it "Longevity - Support Agents": that is its old name\)/);
 assert.match((await L.context('cove-support',{platform:'telegram',sender:'1000000001',chat:{chat_id:'-100gone',chat_type:'supergroup'}})).text,/no longer a member/);
 assert.doesNotMatch((await L.context('cove-support',{platform:'telegram',sender:'1000000001',chat:{chat_id:'1000000001',chat_type:'dm'}})).text,/This chat now/)});
