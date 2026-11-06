import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKirimdevAgent,conversationSession} from '../app/kirimdev-agent.mjs';
test('runner uses supported named continue, unique private files, cleanup on success and error',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-runner-'));const pending=[];
 const run=createKirimdevAgent({DATA,home:DATA,live:true,execute:(bin,args,opts,cb)=>{pending.push({args,cb})}});
 const session=conversationSession('agent','line','customer');
 const one=run('agent','one',{session}),two=run('agent','two',{session:conversationSession('agent','line','other')});
 while(pending.length<2)await new Promise(r=>setTimeout(r,5));
 const files=pending.map(x=>x.args.at(-1));assert.notEqual(files[0],files[1]);
 assert.deepEqual((await Promise.all(files.map(f=>readFile(f,'utf8')))).sort(),['one','two']);
 assert.ok(pending.every(x=>x.args.includes('--create-if-missing')&&x.args.includes('--continue')&&x.args.includes('tool')));
 // Concurrent mkdir/writeFile completion order is unspecified. Match the
 // invocation by its session, not by when the execute callback was registered.
 const success=pending.find(x=>x.args[x.args.indexOf('--continue')+1]===session);
 const failure=pending.find(x=>x!==success);
 const settled=Promise.allSettled([one,two]);
 success.cb(null,'answer');failure.cb({code:1});
 const out=await settled;assert.equal(out[0].status,'fulfilled');assert.equal(out[0].value,'answer');assert.equal(out[1].status,'rejected');assert.match(out[1].reason.message,/the agent stopped \(1\)/);
 assert.deepEqual(await readdir(DATA),[]);
 assert.notEqual(session,conversationSession('agent','other-line','customer'));
 assert.notEqual(session,conversationSession('other-agent','line','customer'));
 assert.notEqual(session,conversationSession('agent','line','customer','reset'));
});
