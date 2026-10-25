import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inside,createBridge} from './bridge.mjs';
import {AgentRun} from './agent.mjs';

// the code bridge on this computer: paths stay in the project, only a run that is going on here is served, Plan only reads
test('code bridge: paths stay inside the project, runs and modes are kept',async()=>{const base=await mkdtemp(path.join(os.tmpdir(),'cba-bridge-')),proj=path.join(base,'proj');
 try{await mkdir(path.join(proj,'src'),{recursive:true});await writeFile(path.join(proj,'a.txt'),'one\ntwo\n');await writeFile(path.join(base,'secret.txt'),'no');await symlink(base,path.join(proj,'out')).catch(()=>{});
  assert.ok((await inside(proj,'src/new/file.js')).endsWith(path.join('src','new','file.js')));assert.ok((await inside(proj,path.join(proj,'a.txt'))).endsWith('a.txt'));
  for(const bad of ['../secret.txt',path.join(base,'secret.txt'),'out/secret.txt','out/new.txt','src/../../secret.txt'])await assert.rejects(inside(proj,bad),/outside the project/,bad);
  const b=createBridge(),run=new AgentRun({mode:'full'});run.projectDir=proj;const id=b.open(run);
  assert.match((await b.job({run:id,tool:'project_read',args:{path:'a.txt'}})).text,/1\tone/);
  assert.equal((await b.job({run:id,tool:'project_write',args:{path:'src/b.txt',content:'hi'}})).state,'done');assert.equal(await readFile(path.join(proj,'src','b.txt'),'utf8'),'hi');
  assert.equal((await b.job({run:'nope',tool:'project_read',args:{path:'a.txt'}})).state,'failed');
  run.mode='plan';const w=await b.job({run:id,tool:'project_write',args:{path:'c.txt',content:'x'}});assert.equal(w.state,'failed');assert.match(w.text,/Plan only/);
  b.close(id);assert.equal((await b.job({run:id,tool:'project_read',args:{path:'a.txt'}})).state,'failed')}
 finally{await rm(base,{recursive:true,force:true})}});
