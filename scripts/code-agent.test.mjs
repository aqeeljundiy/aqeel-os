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

// 15 Nov 2026: made from nothing, the Code agent had no model sign-in plugin, so every Code turn with no agent picked stopped with
// "Could not find the 'claude-subscription-directsdk-experimental' CLI command" before any model (Gemini, Claude) was asked
test('it gets the main agent\'s model sign-ins (model-provider plugins), and only those',async()=>{
 const {providerPlugins,createCodeAgent}=await import('../app/code-agent.mjs');const {access,readFile:rf}=await import('node:fs/promises');
 assert.deepEqual(providerPlugins(['sub-x','live-x','../evil'],n=>n==='sub-x'||n==='../evil'?'name: x\nkind: model-provider\n':'name: y\n'),['sub-x']);
 for(const [p,kind] of [['sub-x','kind: model-provider'],['live-x','']]){await mkdir(path.join(HH,'plugins',p),{recursive:true});await writeFile(path.join(HH,'plugins',p,'plugin.yaml'),'name: '+p+'\n'+kind+'\n')}
 const cfg={default:{plugins:{enabled:['sub-x','live-x']},model:{default:'m',provider:'sub-x'}},'aqeelos-code-agent':{plugins:{enabled:['live-x']}}};
 const calls=[];const hermes=async(a,args)=>{calls.push([a,...args]);if(args[0]==='plugins'&&args[1]==='enable')cfg[a].plugins.enabled.push(args[2]);return {ok:true}};
 const pick=(o,k)=>k.split('.').reduce((x,y)=>x?.[y],o);const was=globalThis.fetch;globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({})});
 try{const ca=createCodeAgent({DASH:'http://dash.invalid',DASH_TOKEN:'t',API_KEY:'',codeBridge:null,readConfig:async a=>cfg[a],pick,hermes,restart:async why=>calls.push(['restart',why]),log:()=>{}});
  assert.equal(await ca.ensure(),true);
  assert.ok(await access(path.join(HH,'profiles','aqeelos-code-agent','plugins','sub-x','plugin.yaml')).then(()=>true,()=>false),'the plugin is copied into its profile');
  assert.deepEqual(calls.filter(c=>c[1]==='plugins'),[['aqeelos-code-agent','plugins','enable','sub-x']],'only the model-provider plugin is switched on');
  assert.equal(calls.filter(c=>c[0]==='restart').length,1,'the agents restart once so the engine loads it');
  calls.length=0;assert.equal(await ca.ensure(),true);assert.equal(calls.length,0,'nothing again once it is on, and no restart')}
 finally{globalThis.fetch=was}});
