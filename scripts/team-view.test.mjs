// Team view (app/team-view.mjs): who may look, what comes back, and that every lookup is written down. Run: node --test scripts/team-view.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createTeamView,mask} from '../app/team-view.mjs';

const SESS={web_admin:{source:'api_server'},web_member:{source:'api_server'},web_unknown:{source:'api_server'},tg_owner:{source:'telegram',uid:'111',chat_type:'dm'},tg_other:{source:'telegram',uid:'222',chat_type:'dm'},tg_group:{source:'telegram',uid:'111',chat_type:'group'},job:{source:'cron'}};
const OWNERS={web_admin:'a1',web_member:'m1',admin_chat:'a1',member_chat:'m1'};
const PEOPLE={owner:{id:'owner',name:'Owner',admin:true},a1:{id:'a1',name:'Ada',admin:true},m1:{id:'m1',name:'Sam',admin:false}};
const users={sessionOwner:id=>OWNERS[id]||null,byId:id=>PEOPLE[id],isAdmin:u=>!!u.admin,people:()=>Object.values(PEOPLE),home:p=>'/people/'+p.id};
const RECENT=1794000000;
const LIST=[{id:'member_chat',source:'api_server',uid:'api',agent:'default',at:RECENT,messages:12,title:'Quarterly plan',origin:'{}'},{id:'child',parent:'member_chat',source:'api_server',agent:'priv',at:RECENT+5,messages:3,origin:'{}'},{id:'tg',source:'telegram',uid:'222',agent:'default',at:RECENT,messages:4,origin:'{"user_name":"Rae"}'}];
async function make({on=true,read=[{role:'user',text:'please use sk-abcdefghijklmnopqrstuv',at:RECENT},{role:'tool',text:'raw',at:RECENT},{role:'assistant',text:'done',at:RECENT}]}={}){
 const DATA=await mkdtemp(path.join(tmpdir(),'tv-'));const calls=[];
 const run=async a=>{calls.push(a);if(a.op==='chain')return SESS[a.id]?[{id:a.id,...SESS[a.id]}]:[];if(a.op==='list')return LIST;if(a.op==='read')return read;return []};
 const T=createTeamView({HERMES_HOME:'/h/.hermes',DATA,users,run,python:async()=>'p',policy:async()=>({owner:{name:'Owner',telegram:['111']},teams:[]}),agents:async()=>['default','priv'],isOn:async()=>on,now:()=>RECENT*1000});
 return {T,DATA,calls}}
const asks=s=>({session:s,platform:'',uid:''});

test('a group chat the owner started is refused: the session only remembers who spoke first',async()=>{const {T}=await make();assert.match((await T.call(asks('tg_group'),{})).error,/group/)});
test('off by default for everyone, even an admin',async()=>{const {T}=await make({on:false});assert.match((await T.call(asks('web_admin'),{})).error,/off/)});
test('an admin in the app and the owner on a channel may look',async()=>{const {T}=await make();assert.ok((await T.call(asks('web_admin'),{})).people);assert.ok((await T.call(asks('tg_owner'),{})).people)});
test('a member, another sender on a channel, a schedule and an untracked chat may not',async()=>{const {T}=await make();
 for(const s of ['web_member','tg_other','tg_group','job','web_unknown','nope',''])assert.ok((await T.call(asks(s),{action:'list'})).error,s)});
test('what the model passes cannot change who is asking',async()=>{const {T}=await make();assert.ok((await T.call(asks('web_member'),{action:'overview',session:'web_admin',who:'Owner',uid:'111'})).error)});
test('a channel sender claiming the owner\'s id in the call is not believed: the session decides',async()=>{const {T}=await make();assert.ok((await T.call({session:'tg_other',platform:'telegram',uid:'111'},{})).error)});
test('overview groups by person, private agents included, and a compressed chat keeps its person',async()=>{const {T}=await make();const r=await T.call(asks('web_admin'),{});const s=r.people.find(p=>p.person==='Sam');assert.equal(s.chats,2);assert.equal(s.messages,15);assert.deepEqual(s.agents,{default:1,priv:1});assert.ok(r.people.find(p=>p.person==='Rae'))});
test('list filters by person',async()=>{const {T}=await make();const r=await T.call(asks('web_admin'),{action:'list',person:'sam'});assert.equal(r.total,2);assert.ok(r.chats.every(c=>c.person==='Sam'))});
test('read returns the words, masks keys and leaves tool output out',async()=>{const {T}=await make();const r=await T.call(asks('web_admin'),{action:'read',agent:'default',chat:'member_chat'});assert.deepEqual(r.messages.map(m=>m.role),['user','assistant']);assert.doesNotMatch(r.messages[0].text,/abcdefghijkl/);assert.match(r.messages[0].text,/key hidden/)});
test('automatic runs stay out unless asked for',async()=>{const {T,calls}=await make();await T.call(asks('web_admin'),{action:'list'});assert.ok(calls.filter(c=>c.op==='list').pop().skip.includes('cron'));await T.call(asks('web_admin'),{action:'list',include_automated:true});assert.deepEqual(calls.filter(c=>c.op==='list').pop().skip,[])});
test('every lookup is logged, a refused one is not a lookup, and the list hides session ids',async()=>{const {T,DATA}=await make();await T.call(asks('web_admin'),{action:'read',agent:'default',chat:'member_chat'});await T.call(asks('web_member'),{action:'list'});
 const lines=(await readFile(path.join(DATA,'team-view-log.jsonl'),'utf8')).trim().split('\n');assert.equal(lines.length,1);const [e]=await T.recent();assert.equal(e.who,'Ada');assert.equal(e.chat,'member_chat');assert.equal(e.session,undefined)});
test('mask catches the common key shapes and leaves ordinary words',()=>{for(const s of ['ghp_abcdefghijklmnop1234','Bearer abcdefghijklmnop.qrs','api_key=abcd1234efgh','password: hunter2hunter','xoxb-1234567890-abcdefgh'])assert.match(mask(s),/key hidden/,s);assert.equal(mask('the token economy is fine'),'the token economy is fine')});
