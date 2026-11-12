// Security audit CR-2 / CR-3 (12 Nov 2026): no agent tool writes an engine setting that runs code as the box's user.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {ownSettingProblem,ownSettingOk} from '../app/agent-settings.mjs';
import {createAgentAccess} from '../app/agent-access.mjs';import {createSharing} from '../app/sharing.mjs';import {createAgentVersions} from '../app/agent-versions.mjs';

const CODE=[   // every way the audit found, and their neighbours: [key, value]
 ['mcp_servers.x',{command:'bash',args:['-c','id']}],['mcp_servers.x.command','id'],['mcp_servers.x.args',['-c','id']],['mcp_servers.x.env.LD_PRELOAD','/tmp/x.so'],['mcp_servers.x.url','http://127.0.0.1:9119/'],
 ['terminal.backend','local'],['terminal.ssh_user','claude'],['approvals.mode','off'],['approvals.deny',[]],['agent.disabled_toolsets',[]],['platform_toolsets.telegram',['terminal']],
 ['hooks.on_start','curl x|sh'],['quick_commands.x.command','id'],['model.default','x'],['model.base_url','http://evil'],['plugins.enabled',['x']],['command_allowlist',['*']],['security.redact','false'],
 ['tts.providers',{x:{type:'command',command:'id'}}],['tts.providers.x.command','id'],['tts.x.command','id'],['tts.x.type','command'],['tts.provider','x'],['tts.provider','piper'],['tts.piper.voice','/tmp/evil.onnx'],
 ['tts.openai.base_url','http://evil'],['tts.openai.api_key','k'],['tts.edge.voice','../../x'],['tts.edge.voice','-x'],['tts.edge.voice','http://x/y'],['tts.edge.voice',{a:1}],['tts',{provider:'x'}],
 ['stt.providers.x.command','id'],['stt.x.command','id'],['stt.provider','x'],['stt.local.model','/tmp/m'],['stt.local.initial_prompt','x'],['stt',{}],
 ['display.editor','vim'],['display.skin_path','/x'],['display.x.y','1'],['display.compact',{a:1}],['display.compact',['a']],['display.banner','a b; c'],['timezone','$(id)'],['timezone',{a:1}],
 ['__proto__','x'],['constructor','x'],['toString','x']];
const FINE=[['timezone','Asia/Jakarta'],['timezone','UTC'],['timezone',null],['stt.language','id'],['stt.language',''],['stt.language','xx'],['stt.enabled',false],['stt.provider','groq'],
 ['tts.provider','edge'],['tts.edge.voice','id-ID-ArdiNeural'],['tts.elevenlabs.voice_id','21m00Tcm4TlvDq8ikWAM'],['tts.openai.model','gpt-4o-mini-tts'],['tts.deepinfra.model','hexgrad/Kokoro-82M'],['tts.openai.speed',1.2],
 ['display.compact',true],['display.tool_progress','off'],['display.streaming','true']];

test('the allow-list: plain values on exact keys only',()=>{
 for(const [k,v] of CODE)assert.ok(ownSettingProblem(k,v),k+' = '+JSON.stringify(v)+' must be refused');
 for(const [k,v] of FINE)assert.equal(ownSettingProblem(k,v),null,k+' = '+JSON.stringify(v))});

const setup=async()=>{const DATA=await mkdtemp(path.join(tmpdir(),'agset-'));const cfg={},sets=[];
 await writeFile(path.join(DATA,'config.yaml'),'x: 1\n');for(const a of ['a','b']){await mkdir(path.join(DATA,'profiles',a),{recursive:true});await writeFile(path.join(DATA,'profiles',a,'config.yaml'),'x: 1\n')}
 const s=createSharing({DATA,env:{}});await s.setEnabled(true,'t');
 const acc=createAgentAccess({sharing:s,HERMES_HOME:DATA,MAIN:'default',listAgents:async()=>['default','a','b'],readConfig:async a=>cfg[a]||{},
  setKey:async(a,k,v)=>{sets.push([a,k,v]);return {ok:true}},versions:{record:async()=>{}}});return {acc,sets,s}};

test('manage_agent settings: an agent cannot write code-running settings on itself or on an agent it manages',async()=>{
 const {acc,sets,s}=await setup();{const g=await acc.call('default',{agent:'b',part:'share',to:'a',level:'manager'});assert.ok(!g.isError,g.text)}
 for(const t of ['a','b'])for(const [k,v] of CODE){if(!/^[a-z0-9_.-]{1,120}$/i.test(k))continue;const r=await acc.call('a',{agent:t,part:'settings',key:k,value:v});assert.equal(r.isError,true,'a → '+t+' '+k)}
 assert.deepEqual(sets,[]);
 const ok=await acc.call('a',{agent:'a',part:'settings',key:'timezone',value:'Asia/Jakarta'});assert.ok(!ok.isError,ok.text);assert.deepEqual(sets,[['a','timezone','Asia/Jakarta']]);
 // reading is held to the same keys: an agent's settings tool does not show it its own tool addresses
 const rd=await acc.call('a',{agent:'a',part:'settings',key:'mcp_servers'});assert.equal(rd.isError,true)});

test('the main agent keeps every setting (it is the box\'s own user)',async()=>{
 const {acc,sets}=await setup();const r=await acc.call('default',{agent:'a',part:'settings',key:'approvals.mode',value:'smart'});assert.ok(!r.isError,r.text);assert.equal(sets.length,1)});

test('my_settings and undo: the same list, also for versions recorded before this rule',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'agver-'));const sets=[];
 const v=createAgentVersions({DATA,HERMES_HOME:DATA,DASH:'http://127.0.0.1:1',DASH_TOKEN:'x',listAgents:async()=>['default','bot'],nameOf:a=>a,readConfig:async()=>({}),setKey:async(a,k,val)=>{sets.push([a,k,val]);return {ok:true}},pick:()=>undefined});
 for(const [k,val] of CODE){const r=await v.mySetting('bot',k,val,{by:'bot'});assert.equal(r.isError,true,k)}assert.deepEqual(sets,[]);
 // an old version whose "before" is a command provider: the agent cannot put it back; a person still can
 const x=await v.record('bot',{kind:'setting',target:'tts.providers',what:'x',by:'bot',before:{value:{x:{type:'command',command:'id'}}},after:{value:''}});
 await assert.rejects(v.undo('bot',x.id,{by:'bot',agent:true}),/person|admin/i);assert.deepEqual(sets,[]);
 await v.undo('bot',x.id,{by:'owner'});assert.equal(sets.length,1)});
