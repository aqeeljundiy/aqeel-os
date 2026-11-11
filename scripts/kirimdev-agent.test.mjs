import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createKirimdevAgent,conversationSession,stoppedWhy} from '../app/kirimdev-agent.mjs';
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
test('a customer run gets only the customer tool server and its own key, ended with the run',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-cust-'));const seen=[];const runs=new Map();
 const customer={begin:r=>{const t='tok'+runs.size;runs.set(t,r);return t},end:t=>runs.delete(t)};
 const run=createKirimdevAgent({DATA,home:DATA,live:true,customer:()=>customer,execute:(bin,args,opts,cb)=>{seen.push({args,env:opts.env});cb(null,'hi')}});
 assert.equal(await run('cove-support','q',{session:conversationSession('a','l','c'),run:{line:'140',conversation:'cnv',phone:'628',mode:'test'}}),'hi');
 const a=seen[0].args;assert.equal(a[a.indexOf('-t')+1],'aqeelos-customer');assert.equal(seen[0].env.TERMINAL_AQEELOS_CUSTOMER_RUN,'tok0');assert.equal(runs.size,0);
 await run('cove-support','q',{session:conversationSession('a','l','c')});assert.equal(seen[1].args.includes('-t'),false);
});
test('a sandboxed customer run continues a thread of its own, never the one made with other tools',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-th-'));const seen=[];
 const run=createKirimdevAgent({DATA,home:DATA,live:true,customer:()=>({begin:()=>'t',end:()=>{}}),execute:(b,args,o,cb)=>{seen.push(args[args.indexOf('--continue')+1]);cb(null,'ok')}});
 const s=conversationSession('a','l','c');await run('a','q',{session:s,run:{line:'l',conversation:'c',phone:'1'}});await run('a','q',{session:s});
 assert.notEqual(seen[0],s);assert.match(seen[0],/^kirimdev-[a-f0-9]{64}$/);assert.equal(seen[1],s)});
test('the run key travels in the run\'s instructions (the gateway runs it) and never reaches the reply',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-key-'));let q='';
 const run=createKirimdevAgent({DATA,home:DATA,live:true,customer:()=>({begin:()=>'KEY123secret',end:()=>{}}),execute:(b,args,o,cb)=>{q=readFileSync(args[args.indexOf('--query-file')+1],'utf8');cb(null,'Halo kak KEY123secret')}});
 const out=await run('a','Customer says hi',{session:conversationSession('a','l','c'),run:{line:'l',conversation:'c',phone:'1'}});
 assert.match(q,/^Customer says hi\n\nRun key for your tools in this chat: KEY123secret /);assert.equal(out,'Halo kak ')});
test('a failed engine run keeps its own reason (stderr, stdout), without the run key and session lines (12 Nov 2026)',async()=>{
 const DATA=await mkdtemp(path.join(tmpdir(),'kd-why-'));
 const run=createKirimdevAgent({DATA,home:DATA,live:true,customer:()=>({begin:()=>'KEY123secret',end:()=>{}}),execute:(b,a,o,cb)=>cb({code:1},"partial KEY123secret reply\n\nsession_id: local-9","⚠️ You've hit your session limit · resets 10pm (UTC)\n")});
 await assert.rejects(run('a','q',{session:conversationSession('a','l','c'),run:{line:'l',conversation:'c',phone:'1'}}),e=>/^the agent stopped \(1\): .*session limit · resets 10pm \(UTC\)/.test(e.message)&&!/KEY123|session_id/.test(e.message));
 assert.equal(stoppedWhy({signal:'SIGTERM'},'','') ,'the agent stopped (SIGTERM)');
 assert.ok(stoppedWhy({code:1},'x'.repeat(2000),'').length<340)});
