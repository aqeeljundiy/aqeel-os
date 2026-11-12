// node --test scripts/proof-fixer-tells.test.mjs
// GOOG-6 and QR-3 (12 Nov 2026), proven with the real issue loop (app/issues.mjs), the real bell (app/news.mjs) and the real "tell whoever
// asked" (app/route-handlers.mjs issueReply, what server.mjs hands the loop as reply), with a stand-in fixer that writes the scripted result
// of each fix run and proof run. No model, no engine.
//  GOOG-6  "Tell me when it's fixed": an issue filed from a chat in aqeelOS ends in ONE line in the bell of the person whose chat it is,
//          linked to that chat, when the fix is proven. Found by this proof and fixed with it: a proven fix told nobody at all, and the bell
//          kept only the first word about an issue (one key per issue), so "needs a person" swallowed a later "Fixed".
//  QR-3    A proof run that names something only a person can do files "needs a person" at once, instead of two more fix runs that are
//          rolled back for the same reason.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createIssues} from '../app/issues.mjs';import {createNews} from '../app/news.mjs';import {issueReply} from '../app/route-handlers.mjs';
import {src as sourceOf} from './lib/source.mjs';

const POL={owner:{name:'Owner',telegram:['1']},teams:[{name:'Brand',agents:['a1'],contact:'Mem',members:[{name:'Mem',telegram:['2']}]}],fixer:{on:true,agent:'default',cap:20}};
const CHAT='api_1794370454_294eabeb',SAM={id:'u-sam',name:'Sam'},ADMIN={id:'u-admin',name:'Admin'};
async function setup({fix=[],proof=[],owners={[CHAT]:SAM.id},quiet=()=>null}={}){const d=await mkdtemp(path.join(tmpdir(),'aq-ft-'));await writeFile(path.join(d,'team-policy.json'),JSON.stringify(POL));
 const runs=[],said={owner:[],team:[],channel:[],health:[]},news=createNews({DATA:d});
 const users={sessionOwner:id=>owners[id]||null,byId:id=>[SAM,ADMIN].find(u=>u.id===id)||null};
 const launch=async o=>{const p=await readFile(path.join(o.dir,'prompt.txt'),'utf8'),kind=/^You are the aqeelOS fixer's proof run/.test(p)?'proof':'fix';runs.push(kind);
  await writeFile(path.join(o.dir,'out.txt'),'RESULT: '+JSON.stringify((kind==='fix'?fix:proof).shift()));await writeFile(path.join(o.dir,'exit'),'0');return 1};
 const I=createIssues({DATA:d,bin:'x',fixerHome:d,log:()=>{},launch,alive:async()=>false,quiet,tz:()=>'UTC',busy:async()=>0,apply:async()=>({ok:true}),envFiles:async()=>[],
  reply:(i,text)=>issueReply({i,text,users,news,nameOf:a=>a==='a1'?'Rory':a,info:async t=>{said.health.push(t)},send:async o=>{said.channel.push(o)}}),
  tellOwner:async x=>{said.owner.push(x)},toTeam:async(a,m,x)=>{said.team.push([m.name,x]);return true}});
 const item=async()=>(await I._db()).items[0];
 const run=async(until,max=30)=>{for(let k=0;k<max;k++){await I.tick();const i=await item();if(i.state==='queued')i.notBefore=0;if(until.includes(i.state))return i}return item()};
 return {I,news,runs,said,item,run,bell:u=>news.list(u,u===ADMIN)}}
const WEB={platform:'api_server',uid:'api',chat:CHAT,who:'Sam'};
const NOCHANGE={status:'no_change',summary:'It already works; nothing to change.'},PROVEN={status:'proven',proof:'Ran the sheet read at 10:01 UTC and it returned 12 rows.'};

test('GOOG-6: an issue filed from a chat in aqeelOS, fixed and proven: one line in that person\'s bell, linked to the chat; nobody else hears',async()=>{
 const s=await setup({fix:[NOCHANGE],proof:[PROVEN]});
 await s.I.file({agent:'a1',missing:'The agent cannot read the price sheet',evidence:'403 from the sheet',origin:WEB});
 const i=await s.run(['fixed','stuck','needs_human']);assert.equal(i.state,'fixed',JSON.stringify(i.history));assert.ok(i.toldFixed,'remembered, so it is said once');
 const bell=await s.bell(SAM);assert.equal(bell.length,1);
 assert.equal(bell[0].title,'Rory: Fixed: The agent cannot read the price sheet How it was checked: Ran the sheet read at 10:01 UTC and it returned 12 rows.');
 assert.deepEqual([bell[0].go,bell[0].label,bell[0].cls,bell[0].icon],['/chat/'+CHAT,'Open the chat','started','check'],'a bell item that opens the chat they asked in');
 assert.deepEqual(await s.bell(ADMIN),[],'not in anyone else\'s bell');assert.equal(s.said.owner.length+s.said.team.length+s.said.channel.length+s.said.health.length,0,'the owner, the team and the channels hear nothing');
 // another tick, a restart of the loop: still one line
 await s.I.tick();await s.I.tick();assert.equal((await s.bell(SAM)).length,1)});

test('GOOG-6: "needs a person" first and "Fixed" later are two lines in the bell (the bell used to keep only the first word about an issue)',async()=>{
 const s=await setup({fix:[{status:'needs_human',need:'A new Tripay key is needed; nobody has one on the box.',summary:'no key'},NOCHANGE],proof:[PROVEN]});
 const f=await s.I.file({agent:'a1',missing:'The payment link fails',origin:WEB});
 assert.equal((await s.run(['needs_human','fixed'])).state,'needs_human');let bell=await s.bell(SAM);assert.equal(bell.length,1);assert.match(bell[0].title,/needs a person for a fix/);
 await s.I.retry(f.issue.id);   // the person added the key and pressed Try again
 assert.equal((await s.run(['fixed','stuck'])).state,'fixed');bell=await s.bell(SAM);
 assert.equal(bell.length,2,bell.map(b=>b.title).join(' | '));assert.match(bell[0].title,/^Rory: Fixed: The payment link fails/);assert.equal(s.said.owner.length,0)});

test('GOOG-6: the rules that stay: a Telegram chat is not messaged about a fix, a chat whose person is unknown tells nobody, a test agent says nothing',async()=>{
 const tg=await setup({fix:[NOCHANGE],proof:[PROVEN]});await tg.I.file({agent:'a1',missing:'x is broken',origin:{platform:'telegram',uid:'2',chat:'-100',thread:'3'}});
 assert.equal((await tg.run(['fixed'])).state,'fixed');assert.equal(tg.said.channel.length+tg.said.owner.length+tg.said.team.length+(await tg.bell(SAM)).length,0,'no "Fixed by aqeelOS" in a channel (7 Nov 2026)');
 const unknown=await setup({fix:[NOCHANGE],proof:[PROVEN],owners:{}});await unknown.I.file({agent:'a1',missing:'y is broken',origin:WEB});
 const i=await unknown.run(['fixed']);assert.equal(i.state,'fixed');assert.equal(i.toldFixed,undefined);assert.equal(unknown.said.owner.length+unknown.said.team.length+(await unknown.bell(SAM)).length,0,'a fix is never pushed to the owner instead');
 const quiet=await setup({fix:[NOCHANGE],proof:[PROVEN],quiet:()=>'test'});await quiet.I.file({agent:'a1',missing:'z is broken',origin:WEB});
 assert.equal((await quiet.run(['fixed'])).state,'fixed');assert.equal((await quiet.bell(SAM)).length,0)});

test('GOOG-6: server.mjs hands the issue loop this same reply',()=>{
 assert.match(sourceOf('app/server.mjs'),/const replyInTopic=\(i,text\)=>issueReply\(\{i,text,users,news,/);assert.match(sourceOf('app/server.mjs'),/reply:replyInTopic,tellOwner:srToOwner/)});

test('QR-3: a proof only a person can give files "needs a person" at once: one fix run, one proof run, one message; Try again runs it again',async()=>{
 const NEED='Pay the Kirimdev invoice for this month: the line is suspended until then, so no reply can be seen.';
 const s=await setup({fix:[NOCHANGE,NOCHANGE],proof:[{status:'not_proven',proof:'The line answers HTTP 402 at 09:14 UTC.',need:NEED},PROVEN]});
 const f=await s.I.file({agent:'a1',missing:'Replies do not go out on the support line',origin:{platform:'telegram',uid:'2',chat:'-100',thread:'3'}});
 const i=await s.run(['needs_human','stuck','fixed']);
 assert.equal(i.state,'needs_human',JSON.stringify(i.history));assert.equal(i.need,NEED);assert.equal(i.tries,1,'no second and third try');assert.deepEqual(s.runs,['fix','proof']);
 assert.equal(s.said.channel.length,1,'whoever asked hears it once, in the chat they asked in');assert.match(s.said.channel[0].text,/needs a person for a fix[\s\S]*Pay the Kirimdev invoice[\s\S]*Try again/);assert.equal(s.said.channel[0].chat,'-100:3');
 for(let k=0;k<4;k++)await s.I.tick();assert.deepEqual(s.runs,['fix','proof'],'it waits: nothing more runs by itself');assert.equal(s.said.channel.length,1);
 await s.I.retry(f.issue.id);assert.equal((await s.run(['fixed','stuck','needs_human'])).state,'fixed');assert.deepEqual(s.runs,['fix','proof','fix','proof'])});

test('QR-3: what is not a person\'s job is not asked: an approval or "send a message from the tester phone" in the proof goes on to the next try',async()=>{
 for(const need of ['The owner should approve the change before it stays.','Someone must send a WhatsApp message from the tester phone to see the reply.','']){
  const s=await setup({fix:[NOCHANGE,NOCHANGE],proof:[{status:'not_proven',proof:'no reply seen',need},PROVEN]});
  await s.I.file({agent:'a1',missing:'Replies do not go out on the support line',origin:{}});
  const i=await s.run(['fixed','stuck','needs_human']);assert.equal(i.state,'fixed',need);assert.deepEqual(s.runs,['fix','proof','fix','proof'],need);assert.equal(s.said.team.length+s.said.owner.length,0,need)}});
