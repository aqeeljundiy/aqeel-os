import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {runGemini,geminiAuth,geminiSignIn,locateGemini} from './gemini.mjs';
import {AgentRun} from './agent.mjs';

const fake={command:process.execPath,args:[path.join(path.dirname(fileURLToPath(import.meta.url)),'test-fixtures','fake-acp.mjs')]};
const job=mode=>new AgentRun({projectId:'p',chatId:'c',provider:'gemini',model:'',mode,prompt:'Make a page'});

test('a Gemini turn maps ACP updates to run events and asks before editing',async()=>{
 const run=job('ask');let models=null,session=null;const cwd=os.tmpdir();
 const pending=runGemini(run,{gemini:fake,env:process.env,cwd,prompt:'Make a page',onSession:id=>session=id,onModels:m=>models=m});
 for(let i=0;i<100&&!run.pending.size;i++)await new Promise(r=>setTimeout(r,20));
 const [key,p]=[...run.pending][0];assert.equal(p.event.kind,'file');run.decide(key,'acceptForSession');
 const r=await pending;assert.equal(r.state,'complete');assert.equal(r.text,'Permission: always. done');
 assert.equal(session,'sess-1');assert.equal(models[0].modelId,'gemini-test-pro');
 const types=run.events.map(e=>e.type);for(const t of ['plan','thinking','file','approval','message'])assert.ok(types.includes(t),t);
 assert.equal(run.events.find(e=>e.type==='file').status,'completed');assert.deepEqual([run.usage.input,run.usage.output],[120,30]);
});

test('plan mode rejects edits without asking and full access allows them',async()=>{
 const plan=await runGemini(job('plan'),{gemini:fake,env:process.env,cwd:os.tmpdir(),prompt:'x'});assert.equal(plan.text,'Permission: no. planned');
 const full=await runGemini(job('full'),{gemini:fake,env:process.env,cwd:os.tmpdir(),prompt:'x'});assert.equal(full.text,'Permission: ok. done');
});

test('sign-in state comes from cached Google credentials or an API key',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'cba-gemini-'));try{
  assert.equal((await geminiAuth({},home)).ready,false);assert.equal((await geminiAuth({GEMINI_API_KEY:'x'},home)).method,'gemini-api-key');
  await mkdir(path.join(home,'.gemini'));await writeFile(path.join(home,'.gemini','oauth_creds.json'),'{}');await writeFile(path.join(home,'.gemini','google_accounts.json'),'{"active":"me@example.com"}');
  const a=await geminiAuth({},home);assert.equal(a.ready,true);assert.equal(a.email,'me@example.com');
  await geminiSignIn(fake,{cwd:os.tmpdir(),env:process.env});
 }finally{await rm(home,{recursive:true,force:true})}
});

test('the CLI is found through its npm package entry',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cba-gem-pkg-'));try{const dir=path.join(root,'node_modules','@google','gemini-cli');await mkdir(path.join(dir,'dist'),{recursive:true});
  await writeFile(path.join(dir,'package.json'),JSON.stringify({bin:{gemini:'dist/index.js'}}));await writeFile(path.join(dir,'dist','index.js'),'');
  const g=await locateGemini({appRoot:root});assert.equal(g.command,process.execPath);assert.equal(g.args[0],path.join(dir,'dist','index.js'));
 }finally{await rm(root,{recursive:true,force:true})}
});
