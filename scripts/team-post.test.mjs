// aqeelOS's own posts in a Telegram topic are kept in that topic's conversation (app/team-post.mjs, 14 Nov 2026).
// node --test scripts/team-post.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {createTeamPost,MIRROR_LABEL,MIRROR_PY} from '../app/team-post.mjs';

async function make({ok=true,mirrorOut='mirrored',live=true}={}){const H=await mkdtemp(path.join(tmpdir(),'tp-'));await mkdir(path.join(H,'profiles','cove-support'),{recursive:true});
 await writeFile(path.join(H,'profiles','cove-support','.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 const sent=[],ran=[],logs=[];let done;const mirrored=new Promise(r=>done=r);
 const P=createTeamPost({HERMES_HOME:H,homeOf:a=>path.join(H,'profiles',a),live,python:async()=>'/engine/python',log:m=>logs.push(m),
  fetchFn:async(url,o)=>{sent.push([url,JSON.parse(o.body)]);return {ok:true,json:async()=>({ok,result:{message_id:77}})}},
  run:(cmd,args,opts,cb)=>{let input='';const c={stdin:{end:x=>{input=x;ran.push([cmd,args,JSON.parse(input)]);setImmediate(()=>{cb(null,mirrorOut+'\n','');done()})}}};return c}});
 return {P,H,sent,ran,logs,mirrored}}

test('a post goes to the topic with the agent\'s bot, then into that topic\'s conversation as a note marked as aqeelOS\'s',async()=>{const t=await make();
 assert.equal(await t.P.send('cove-support',-1001,3,'❓ HANDOFF (Rory, Ana, +628123)\nCustomer asked: dosisnya?'),77);
 assert.equal(t.sent[0][0],'https://api.telegram.org/bot123:abc/sendMessage');assert.deepEqual(t.sent[0][1],{chat_id:-1001,message_thread_id:3,text:'❓ HANDOFF (Rory, Ana, +628123)\nCustomer asked: dosisnya?'});
 await t.mirrored;const [cmd,args,d]=t.ran[0];assert.equal(cmd,'/engine/python');assert.deepEqual(args,['-I','-c',MIRROR_PY]);
 assert.equal(d.home,path.join(t.H,'profiles','cove-support'));assert.equal(d.src,path.join(t.H,'hermes-agent'));assert.equal(d.chat,'-1001');assert.equal(d.thread,3);
 assert.ok(d.text.startsWith(MIRROR_LABEL+'\n❓ HANDOFF'),'marked as aqeelOS\'s post, so the agent does not take it for its own words')});

test('the engine\'s own mirror is used, as a user-role note, scoped to the agent\'s home',()=>{
 assert.match(MIRROR_PY,/from gateway\.mirror import mirror_to_session/);assert.match(MIRROR_PY,/role='user'/);assert.match(MIRROR_PY,/os\.environ\['HERMES_HOME'\]=d\['home'\]/);
 assert.match(MIRROR_PY,/mirror_to_session\('telegram',str\(d\['chat'\]\)/)});

test('nothing is kept when Telegram did not take the post; a failed mirror never fails the post; no preview when asked',async()=>{
 const no=await make({ok:false});assert.equal(await no.P.send('cove-support',-1,2,'x'),false);await new Promise(r=>setTimeout(r,20));assert.equal(no.ran.length,0);
 const bad=await make({mirrorOut:'Traceback'});assert.equal(await bad.P.send('cove-support',-1,2,'x',{preview:false}),77);await bad.mirrored;await new Promise(r=>setImmediate(r));
 assert.equal(bad.sent[0][1].disable_web_page_preview,true);assert.ok(bad.logs.some(l=>/not kept in the topic/.test(l)));
 const off=await make({live:false});assert.equal(await off.P.send('cove-support',-1,2,'x'),false);assert.equal(off.sent.length,0)});
