// Engine processes on an old environment (app/engine-procs.mjs, AU-47, 23 Nov 2026).
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {kindOf,staleProcs,currentEnv,engineProcs} from '../app/engine-procs.mjs';
const OLD='e3d7c4fd6e29431ebb2a12ef26ef8ad8',CUR='95486a3d86004fab9fde62434e613537';
const map=env=>`7f00-7f01 r-xp 0 0:0 1 /home/claude/.hermes/installs/dfaaeb6b3b073535/environments/${env}/venv/lib/python3.14/site-packages/x.so\n`;

test('what is watched: the dashboard and the gateway, not the bash wrapper or anything else',()=>{
 assert.equal(kindOf('/x/python3 -I -c sys.path.insert(0, /home/claude/.hermes/hermes-agent) -p default dashboard --no-open'),'dashboard');
 assert.equal(kindOf('python3 -c ... hermes -p default gateway run --replace'),'gateway');
 assert.equal(kindOf('node server.mjs'),null);assert.equal(kindOf('hermes -p default chat'),null)});

test('the Elkiya case: a dashboard left on the rolled-back environment is found, the current gateway is not',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ep-')),proc=path.join(dir,'proc'),H=path.join(dir,'.hermes');
 const add=async(pid,cmd,env)=>{await mkdir(path.join(proc,String(pid)),{recursive:true});await writeFile(path.join(proc,String(pid),'cmdline'),cmd.split(' ').join('\0'));await writeFile(path.join(proc,String(pid),'maps'),env?map(env):'')};
 await add(1797581,'/h/python3 -I -c hermes -p default dashboard --no-open',OLD);await add(1864331,'/h/python3 -I -c hermes -p default gateway run --replace',CUR);
 await add(1864328,'bash -c hermes -p default gateway run --replace',null);await add(42,'node /app/server.mjs',CUR);await mkdir(path.join(proc,'self'),{recursive:true});
 await mkdir(path.join(H,'installs','dfaaeb6b3b073535'),{recursive:true});await writeFile(path.join(H,'installs','dfaaeb6b3b073535','facts.json'),JSON.stringify({packages:{venv:{environment:H+'/installs/dfaaeb6b3b073535/environments/'+CUR+'/venv'}}}));
 const procs=await engineProcs({proc}),cur=await currentEnv(H);assert.equal(cur,CUR);
 assert.deepEqual(procs.map(p=>[p.pid,p.kind]).sort((a,b)=>a[0]-b[0]),[[1797581,'dashboard'],[1864331,'gateway']],'the bash wrapper and other programs are left out');
 assert.deepEqual(staleProcs(procs,cur),[{pid:1797581,kind:'dashboard',env:OLD}]);
 assert.deepEqual(staleProcs(procs,null),[],'nothing known about the current one: nothing is called old')});
