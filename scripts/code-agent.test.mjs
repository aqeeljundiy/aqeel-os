// node --test scripts/code-agent.test.mjs: the plain Code agent (owner, 15 Nov 2026: "i selected no agent and it auto picks Donna" ...
// "A plain Code agent"). Only the tool groups building needs, no one's memory or apps, and never in an agent list.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const HH=await mkdtemp(path.join(tmpdir(),'code-agent-'));process.env.HERMES_HOME=HH;
for(const a of ['shop','aqeelos-code-agent','aqeelos-help']){await mkdir(path.join(HH,'profiles',a),{recursive:true});await writeFile(path.join(HH,'profiles',a,'config.yaml'),'model: {}\n')}
const {agentNames,listedAgent,CODE_AGENT}=await import('../app/agentops.mjs');
const {codeOff,CODE_KEEP,CODE_SOUL}=await import('../app/code-agent.mjs');

test('only the tool groups building needs stay on: no memory, skills, past chats, connected apps, schedules or messaging',()=>{
 const engine=['web','browser','terminal','file','code_execution','vision','image_gen','todo','clarify','memory','skills','session_search','connections','cronjob','delegation','discord','computer_use','tts','billion-context'];
 const off=codeOff(engine.map(name=>({name,enabled:true})));
 for(const k of ['memory','skills','session_search','connections','cronjob','delegation','discord','computer_use'])assert.ok(off.includes(k),k+' is off');
 for(const k of ['terminal','file','web','browser'])assert.ok(!off.includes(k)&&CODE_KEEP.includes(k),k+' stays on')});

test('it is never in an agent list, wherever agents are listed',async()=>{
 assert.equal(CODE_AGENT,'aqeelos-code-agent');
 assert.deepEqual((await agentNames()).sort(),['default','shop']);
 assert.equal(listedAgent(CODE_AGENT),false);assert.equal(listedAgent('shop'),true)});

test('its instructions say what it is and steer nothing',()=>{
 assert.match(CODE_SOUL,/no memory, skills or connected apps/);assert.match(CODE_SOUL,/the way they ask/);
 assert.doesNotMatch(CODE_SOUL,/HTML|design|style|summary/i)});
