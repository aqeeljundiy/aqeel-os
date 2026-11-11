// Tests for the free Gemini route that reads documents for the agents' maps (app/graph-relay.mjs): a loopback relay,
// a fake agy, no network. Run: node --test scripts/graph-relay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRelay,promptOf,isFreeModel,isQuota,FREE_MODEL} from '../app/graph-relay.mjs';

// a fake agy: records its arguments and what it was sent, then plays the events it is given
function fakeAgy(events,{keep=null}={}){const calls=[];
 const spawn=(bin,args,o)=>{const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.kill=()=>{p.killed=true;p.emit('close')};
  let sent='';p.stdin.on('data',d=>{sent+=d});p.stdin.on('end',()=>{calls.push({bin,args,cwd:o.cwd,env:o.env,sent});
   setImmediate(()=>{for(const e of (typeof events==='function'?events(sent):events))p.stdout.write(JSON.stringify(e)+'\n');p.stdout.end();setImmediate(()=>p.emit('close'))})});return p};
 return {spawn,calls}}
const ok=text=>[{event:'init',conversation_id:'c1',init:{agent:'aqeelos-relay'}},{event:'result',result:{status:'SUCCESS',response:text}}];
const post=(r,body,key=r.key)=>fetch(r.url+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});

test('only Gemini names pass, and quota words are recognised',()=>{
 for(const m of ['gemini-3.8-flash-low','gemini-4-argon-high'])assert.equal(isFreeModel(m),true);
 for(const m of ['claude-sonnet-5-5-low','gpt-5','','gemini','models/x'])assert.equal(isFreeModel(m),false,m);
 assert.equal(isQuota('RESOURCE_EXHAUSTED (code 429): Individual quota reached'),true);assert.equal(isQuota('network down'),false);
 assert.equal(promptOf([{role:'system',content:'Be brief'},{role:'user',content:[{type:'text',text:'Map this'}]}]),'[Instructions]\nBe brief\n\nMap this')});

test('a request becomes one agy call with a text-only agent, a Gemini model and a one-run key',async()=>{
 const f=fakeAgy(ok('hello'));const R=createRelay({spawn:f.spawn,home:await mkdtemp(path.join(tmpdir(),'rl-')),env:{PATH:'/usr/bin',OPENAI_API_KEY:'paid-key',ANTHROPIC_API_KEY:'paid'}});
 const r=await R.start({});try{
  assert.equal((await post(r,{messages:[]},'wrong')).status,401);
  assert.equal((await post(r,{model:'claude-sonnet-5-5-low',messages:[{role:'user',content:'x'}]})).status,400,'a Claude name is refused');assert.equal(f.calls.length,0);
  const res=await post(r,{model:FREE_MODEL,messages:[{role:'system',content:'Return JSON'},{role:'user',content:'the document text'}]});assert.equal(res.status,200);
  const j=await res.json();assert.equal(j.choices[0].message.content,'hello');assert.equal(j.model,FREE_MODEL);
  const c=f.calls[0];assert.ok(c.args.includes('--agent')&&c.args.includes('aqeelos-relay'));assert.equal(c.args[c.args.indexOf('--model')+1],FREE_MODEL);
  assert.ok(JSON.parse(c.sent).message.content.includes('the document text'));assert.ok(!c.sent.includes('SOUL'),'only the prompt graphify built');
  assert.ok(!('OPENAI_API_KEY' in c.env)&&!('ANTHROPIC_API_KEY' in c.env),'no key of the server reaches agy');
  assert.ok(!c.cwd.includes('workspaces'),'a fresh empty folder');
  assert.equal(r.stats.requests,1)}finally{await r.stop()}});

test('a tool step stops the request for safety',async()=>{
 const f=fakeAgy([{event:'init',conversation_id:'c2',init:{agent:'aqeelos-relay'}},{event:'step_update',step_update:{step_type:'tool',tool_name:'run_command'}}]);
 const R=createRelay({spawn:f.spawn,home:await mkdtemp(path.join(tmpdir(),'rl-'))});const r=await R.start({});
 try{const res=await post(r,{messages:[{role:'user',content:'x'}]});assert.equal(res.status,502);assert.match((await res.json()).error.message,/Stopped for safety/)}finally{await r.stop()}});

test('the plan\'s limit is reported once, answered with 429, and later requests do not reach agy',async()=>{
 const f=fakeAgy([{event:'init',conversation_id:'c3',init:{agent:'aqeelos-relay'}},{event:'result',result:{status:'ERROR',error:'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 60h'}}]);
 let told=0;const R=createRelay({spawn:f.spawn,home:await mkdtemp(path.join(tmpdir(),'rl-'))});const r=await R.start({onQuota:()=>told++});
 try{const a=await post(r,{messages:[{role:'user',content:'x'}]});assert.equal(a.status,429);const b=await post(r,{messages:[{role:'user',content:'y'}]});assert.equal(b.status,429);
  assert.equal(told,1);assert.equal(f.calls.length,1,'no second try against an empty plan');assert.equal(r.stats.quota,true)}finally{await r.stop()}});

test('a model name that is not Gemini cannot even start the relay',async()=>{await assert.rejects(createRelay({}).start({model:'claude-opus-5-5-high'}),/Only a Gemini model/)});
