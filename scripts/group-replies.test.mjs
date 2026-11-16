// Tests for answering in a group without a tag (app/group-replies.mjs, the "Where you are answering" line in app/agent-live.mjs,
// the tag rule and group_replies tool in engine/aqeelos-live). Run: node --test scripts/group-replies.test.mjs
// 16 Nov 2026: the main agent took the home channel's id for the group it was in, said the group was "already set", and
// thought tagged messages had reached it untagged. Every id here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ids,freeList,topicEntry,envLines,mode,modeWords,createGroupReplies} from '../app/group-replies.mjs';
import {createAgentLive} from '../app/agent-live.mjs';
import {src} from './lib/source.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));const ENGINE=path.join(here,'..','engine','aqeelos-live');
const GROUP='-1001111111111',HOME='-1002222222222';
const pick=(c,k)=>k.split('.').reduce((o,x)=>o?.[x],c);

test('the list is read where the engine reads it: extra block, then the platform block, then the old top-level block',()=>{
 assert.deepEqual(ids([HOME,-1003]),[HOME,'-1003']);assert.deepEqual(ids('a, b'),['a','b']);assert.deepEqual(ids('["x","y"]'),['x','y']);assert.deepEqual(ids(null),[]);assert.deepEqual(ids(''),[]);
 assert.deepEqual(freeList({},'chat'),{key:'platforms.telegram.free_response_chats',list:[],raw:null});
 assert.equal(freeList({platforms:{telegram:{free_response_chats:[HOME]}}},'chat').key,'platforms.telegram.free_response_chats');
 assert.equal(freeList({platforms:{telegram:{free_response_chats:[HOME],extra:{free_response_chats:[GROUP]}}}},'chat').key,'platforms.telegram.extra.free_response_chats');
 assert.deepEqual(freeList({telegram:{free_response_topics:GROUP+':5'}},'topic'),{key:'telegram.free_response_topics',list:[GROUP+':5'],raw:GROUP+':5'});
 assert.equal(topicEntry(GROUP,''),GROUP+':1','General is topic 1');assert.equal(topicEntry(GROUP,'7'),GROUP+':7');
 assert.deepEqual(envLines('A=1\nexport TELEGRAM_FREE_RESPONSE_CHATS="x,y"\n# c'),{A:'1',TELEGRAM_FREE_RESPONSE_CHATS:'x,y'})});

test('the answer is about THIS chat id: the home channel on the list does not make another group free',()=>{
 const conf={platforms:{telegram:{require_mention:true,home_channel:{chat_id:HOME},free_response_chats:[HOME]}}};
 const m=mode(conf,{},GROUP,'1');assert.equal(m.chat,false);assert.equal(m.topic,false);assert.equal(m.requireMention,true);
 assert.match(modeWords(m,{topic:true}),/Not on your free-response list: here you only get messages that tag you/);
 assert.match(modeWords(mode(conf,{},HOME,''),{}),/This group is on your free-response list/);
 assert.match(modeWords(mode({...conf,platforms:{telegram:{...conf.platforms.telegram,free_response_topics:[GROUP+':1']}}},{},GROUP,''),{topic:true}),/This topic is on your free-response list/);
 assert.match(modeWords(mode({},{},GROUP,'')),/every message in this group, tagged or not/,'require_mention off (the engine default)');
 assert.match(modeWords(mode(conf,{TELEGRAM_REQUIRE_MENTION:'false'},GROUP,'')),/tagged or not/,'.env wins');
 const envList=mode(conf,{TELEGRAM_FREE_RESPONSE_CHATS:GROUP},GROUP,'');assert.equal(envList.chat,true);assert.equal(envList.envChats,true);
 assert.match(modeWords(mode({...conf,platforms:{telegram:{...conf.platforms.telegram,allowed_chats:[HOME]}}},{},GROUP,'')),/not on your allowed_chats list/)});

function rig({session={source:'telegram',chat_type:'group',chat_id:GROUP,thread_id:'1'},conf={platforms:{telegram:{require_mention:true,free_response_chats:[HOME]}}},env={},failSave=false,noReadBack=false}={}){
 const st={conf:structuredClone(conf),sets:[],versions:[],restarts:[]};
 const set=(o,k,v)=>{const p=k.split('.');let x=o;for(const s of p.slice(0,-1))x=x[s]??=({});x[p.at(-1)]=v};
 const G=createGroupReplies({readConfig:async()=>structuredClone(st.conf),setKey:async(a,k,v)=>{if(failSave)return {ok:false,out:'disk full'};st.sets.push([a,k,v]);if(!noReadBack)set(st.conf,k,v);return {ok:true}},
  versions:{record:async(a,x)=>{st.versions.push({a,...x});return {id:String(st.versions.length)}}},restartLater:w=>st.restarts.push(w),python:async()=>null,nameOf:a=>a==='default'?'Main':a,
  run:async(a,id)=>id==='s1'?session:null,readEnv:async()=>env,log:()=>{}});
 return {G,st}}
const OWNER={name:'Abel',role:'owner'};

test('add puts THIS chat on the list the engine reads, as a version, reloads gracefully, and says saved only after it reads back',async()=>{const {G,st}=rig();
 const r=await G.call('default',{session:'s1',who:OWNER},{action:'add',why:'Abel asked: reply without a tag'});
 assert.equal(r.ok,true);assert.equal(r.saved,true);assert.equal(r.chat_id,GROUP);assert.equal(r.chat,true);
 assert.deepEqual(st.sets,[['default','platforms.telegram.free_response_chats',[HOME,GROUP]]]);
 assert.equal(st.versions.length,1);assert.equal(st.versions[0].kind,'setting');assert.equal(st.versions[0].target,'platforms.telegram.free_response_chats');
 assert.deepEqual(st.versions[0].before,{value:[HOME]});assert.deepEqual(st.versions[0].after,{value:[HOME,GROUP]});
 assert.equal(st.restarts.length,1);assert.match(r.text,/Saved in platforms\.telegram\.free_response_chats as change 1\. It takes effect after aqeelOS reloads you/);
 const again=await G.call('default',{session:'s1',who:OWNER},{action:'add'});assert.equal(again.unchanged,true);assert.equal(st.sets.length,1,'nothing written twice');
 const off=await G.call('default',{session:'s1',who:OWNER},{action:'remove'});assert.equal(off.saved,true);assert.deepEqual(st.sets[1][2],[HOME]);assert.equal(off.chat,false)});

test('a topic is saved as <chat>:<topic>, General as 1',async()=>{const {G,st}=rig({session:{source:'telegram',chat_type:'supergroup',chat_id:GROUP,thread_id:'7'}});
 const r=await G.call('cove',{session:'s1',who:OWNER},{action:'add',scope:'topic'});assert.equal(r.saved,true);assert.deepEqual(st.sets,[['cove','platforms.telegram.free_response_topics',[GROUP+':7']]]);
 const {G:G2}=rig({session:{source:'telegram',chat_type:'group',chat_id:GROUP,thread_id:null}});
 assert.match((await G2.call('cove',{session:'s1',who:OWNER},{action:'add',scope:'topic'})).error,/no topic id/)});

test('nothing changes unless the engine session is a Telegram group, the asker is verified, and the chat is allowed',async()=>{
 const no=async(o,who,args={action:'add'})=>{const {G,st}=rig(o);const r=await G.call('default',{session:'s1',who},args);assert.equal(st.sets.length,0);assert.equal(st.restarts.length,0);return r.error||''};
 assert.match(await no({},null),/Only the owner or a team member/);
 assert.match(await no({session:{source:'slack',chat_type:'group',chat_id:'C1'}},OWNER),/Telegram groups only/);
 assert.match(await no({session:{source:'telegram',chat_type:'dm',chat_id:'1'}},OWNER),/private chat/);
 assert.match(await no({conf:{platforms:{telegram:{require_mention:true,allowed_chats:[HOME]}}}},OWNER),/not on your allowed_chats list/);
 assert.match(await no({env:{TELEGRAM_FREE_RESPONSE_CHATS:HOME}},OWNER),/\.env file/);
 assert.match(await no({},OWNER,{action:'delete'}),/action is status, add or remove/);
 {const {G}=rig();assert.match((await G.call('default',{session:'other',who:OWNER},{action:'add'})).error,/cannot find this chat/);assert.match((await G.call('default',{session:'',who:OWNER},{action:'add'})).error,/no chat behind it/)}
 {const {G,st}=rig({failSave:true});const r=await G.call('default',{session:'s1',who:OWNER},{action:'add'});assert.match(r.error,/Could not save it: disk full/);assert.equal(st.versions.length,0);assert.equal(st.restarts.length,0)}
 {const {G,st}=rig({noReadBack:true});const r=await G.call('default',{session:'s1',who:OWNER},{action:'add'});assert.match(r.error,/did not read back/);assert.equal(r.saved,undefined);assert.equal(st.versions.length,0);assert.equal(st.restarts.length,0)}
 {const {G}=rig();const s=await G.call('default',{session:'s1',who:null},{action:'status'});assert.equal(s.ok,true,'anyone may see the status');assert.equal(s.chat_id,GROUP);assert.match(s.words,/Not on your free-response list/)}});

test('every group message tells the agent the chat and topic ids, whether it was tagged, and what its settings say for this id',async()=>{
 const H=await mkdtemp(path.join(tmpdir(),'gr-'));await mkdir(path.join(H,'profiles'),{recursive:true});await writeFile(path.join(H,'config.yaml'),'x: 1\n');
 const cfg={default:{platforms:{telegram:{require_mention:true,home_channel:{chat_id:HOME},free_response_chats:[HOME]}}}};
 const L=createAgentLive({HERMES_HOME:H,DATA:path.join(H,'data'),chatInfo:async()=>({title:'Made-up Group'}),listAgents:async()=>['default'],readConfig:async a=>cfg[a]||{},setKey:async()=>({ok:true}),pick,capabilities:async()=>[],
  policy:async()=>({owner:{name:'Abel',telegram:['1000000001']}}),engineDir:ENGINE,log:()=>{}});
 const t=(await L.context('default',{platform:'telegram',sender:'1000000001',chat:{chat_id:GROUP,thread_id:'1',chat_type:'group',chat_name:'Made-up Group / General',tagged:'mention'}})).text;
 assert.match(t,new RegExp('Where you are answering: telegram group, chat id '+GROUP+', topic id 1 \\("General"\\)\\. This message: it tags you \\(the "@" and your name are taken out'));
 assert.match(t,/Without a tag: Not on your free-response list/);assert.doesNotMatch(t,new RegExp(HOME),'the home channel id is never offered as this chat');
 assert.match(t,/use group_replies: it changes this chat only/);assert.match(t,/never say a channel setting is on, off or saved unless you checked it against this chat id/);
 assert.match((await L.context('default',{platform:'telegram',sender:'1000000001',chat:{chat_id:HOME,chat_type:'group',tagged:'none'}})).text,/does not tag you[\s\S]*This group is on your free-response list/);
 assert.doesNotMatch((await L.context('default',{platform:'telegram',sender:'1000000001',chat:{chat_id:'1000000001',chat_type:'dm'}})).text,/Where you are answering/);
 assert.deepEqual(await L.who('telegram','1000000001'),{name:'Abel',role:'owner'});assert.equal(await L.who('telegram','42'),null)});

test('the plugin reads the tag from the platform message (before the engine strips it), passes it on, and gives every agent group_replies',()=>{
 const py=code=>JSON.parse(execFileSync('python3',['-I','-c',`import sys,json,importlib.util as u
from types import SimpleNamespace as N
s=u.spec_from_file_location("g",sys.argv[1]);m=u.module_from_spec(s);s.loader.exec_module(m)
${code}`,path.join(ENGINE,'__init__.py')],{encoding:'utf8'}));
 assert.deepEqual(py(`E=lambda t,o,l,**k:N(type=t,offset=o,length=l,**k)
out=[m.tag_of(N(text="check @MadeUpBot",entities=[E("mention",6,10)]),7,"MadeUpBot"),
 m.tag_of(N(text="check @OtherBot",entities=[E("mention",6,9)]),7,"MadeUpBot"),
 m.tag_of(N(text="\\U0001F600 @madeupbot hi",entities=[E("mention",3,10)]),7,"MadeUpBot"),
 m.tag_of(N(text="hey you",entities=[E("text_mention",4,3,user=N(id=7))]),7,"MadeUpBot"),
 m.tag_of(N(text="/new@MadeUpBot",entities=[E("bot_command",0,14)]),7,"MadeUpBot"),
 m.tag_of(N(text="ok",entities=[],reply_to_message=N(from_user=N(id=7))),7,"MadeUpBot"),
 m.tag_of(N(text="ok",entities=None,caption="look @MadeUpBot",caption_entities=[E("MessageEntityType.MENTION",5,10)]),7,"MadeUpBot"),
 m.tag_of(N(text="just chatting",entities=[]),7,"MadeUpBot"),
 m.tag_of(N(text="x"),None,None), m.tag_of(None,7,"MadeUpBot")]
print(json.dumps(out))`),['mention','none','mention','mention','mention','reply','mention','none','','']);
 const plugin=src('engine/aqeelos-live/__init__.py');
 assert.match(plugin,/chat\["tagged"\] = _tags\.get\(/);assert.match(plugin,/_note_tag\(event, gateway\)/);
 assert.match(plugin,/\n    ctx\.register_tool\("group_replies", "aqeelos-group-replies", GROUP_REPLIES_SCHEMA, _group_replies\)/,'registered for every agent, not inside the main-agent branch');
 assert.match(plugin,/_post\("\/group-replies", \{"session": str\(session_id or ""\), "sender": sender/,'the chat comes from the engine session, not from the model');
 assert.doesNotMatch(plugin.slice(plugin.indexOf('GROUP_REPLIES_SCHEMA = {'),plugin.indexOf('def _group_replies')),/chat_id/,'the tool takes no chat id from the model');
 const hooks=src('app/hooks-routes.mjs');assert.match(hooks,/p==='\/agent-live\/group-replies'[\s\S]{0,200}agentLive\.keyOk\(b\.key\)/);assert.match(hooks,/'chat_name','tagged'\]/)});
