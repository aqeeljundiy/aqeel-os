// Tests for scripts/job-script-wire.mjs (a model schedule becomes a script-only schedule, and back). Run: node --test scripts/job-script-wire.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {planUpdate,undoUpdate} from './job-script-wire.mjs';

const OLD={id:'c0a6ba56f9c3',name:'4AM',no_agent:false,script:'aqeelos-gate-c0a6ba56f9c3.sh',deliver:'local',schedule:{kind:'cron',expr:'0 4 * * *',display:'every day at 4:00'},schedule_display:'every day at 4:00',prompt:'It is 4:00 AM. wake',enabled:true};

test('the plan remembers what was there and sends only the script-only fields',()=>{
 const {was,updates}=planUpdate(OLD,{script:'wakeup-nudge.py',deliver:'whatsapp:1@lid',expr:'0,2,4,6,8 4 * * *'});
 assert.deepEqual(was,{no_agent:false,script:'aqeelos-gate-c0a6ba56f9c3.sh',deliver:'local',schedule:'every day at 4:00',prompt:'It is 4:00 AM. wake',enabled:true});
 assert.deepEqual(updates,{no_agent:true,script:'wakeup-nudge.py',deliver:'whatsapp:1@lid',schedule:'0,2,4,6,8 4 * * *'});
 assert.deepEqual(planUpdate(OLD,{script:'x.sh'}).updates,{no_agent:true,script:'x.sh'},'delivery and clock stay unless given');
 assert.equal(undoUpdate({script:null,no_agent:false}).script,'')});

async function fake(job=OLD){const calls=[];const srv=createServer((req,res)=>{let b='';req.on('data',d=>b+=d).on('end',()=>{calls.push([req.method,req.url,b?JSON.parse(b):null,req.headers['x-hermes-session-token']]);res.writeHead(200,{'content-type':'application/json'});res.end(req.method==='GET'?JSON.stringify({jobs:[job]}):'{"ok":true}')})});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {calls,port:srv.address().port,close:()=>srv.close()}}
const run=(args,env)=>new Promise(res=>execFile(process.execPath,[path.join(path.dirname(fileURLToPath(import.meta.url)),'job-script-wire.mjs'),...args],{env:{...process.env,...env}},(e,out,err)=>res({code:e?e.code:0,out,err})));

test('dry run changes nothing; apply copies the script, keeps the first state, updates the schedule; undo puts it back',async()=>{
 const D=await mkdtemp(path.join(tmpdir(),'jsw-')),home=path.join(D,'home'),data=path.join(D,'data');await mkdir(home,{recursive:true});await writeFile(path.join(D,'x.py'),'print(1)');
 const f=await fake();const env={HERMES_DASH:'http://127.0.0.1:'+f.port,HERMES_DASHBOARD_SESSION_TOKEN:'tok'};
 const base=['--agent','default','--job',OLD.id,'--script','wakeup-nudge.py','--from',path.join(D,'x.py'),'--deliver','whatsapp:1@lid','--home',home,'--data',data];
 let r=await run(base,env);assert.equal(r.code,0);assert.match(r.out,/\[dry run\] 2\. PUT/);assert.equal(f.calls.filter(c=>c[0]==='PUT').length,0);await assert.rejects(stat(path.join(home,'scripts','wakeup-nudge.py')));
 r=await run([...base,'--apply'],env);assert.equal(r.code,0,r.err);const put=f.calls.find(c=>c[0]==='PUT');assert.equal(put[1],'/api/cron/jobs/'+OLD.id+'?profile=default');assert.equal(put[3],'tok');
 assert.deepEqual(put[2],{updates:{no_agent:true,script:'wakeup-nudge.py',deliver:'whatsapp:1@lid'}});assert.equal(await readFile(path.join(home,'scripts','wakeup-nudge.py'),'utf8'),'print(1)');
 const kept=JSON.parse(await readFile(path.join(data,'job-wired','default-'+OLD.id+'.json'),'utf8'));assert.equal(kept.prompt,OLD.prompt);assert.equal(kept.no_agent,false);
 await run([...base,'--apply'],env);assert.equal(JSON.parse(await readFile(path.join(data,'job-wired','default-'+OLD.id+'.json'),'utf8')).no_agent,false,'a second apply keeps the first state');
 r=await run(['--agent','default','--job',OLD.id,'--undo','--data',data],env);assert.match(r.out,/undone/);const back=f.calls.filter(c=>c[0]==='PUT').at(-1)[2].updates;
 assert.equal(back.no_agent,false);assert.equal(back.script,'aqeelos-gate-c0a6ba56f9c3.sh');assert.equal(back.prompt,OLD.prompt);assert.equal(back.deliver,'local');f.close()});

test('a bad script name or no recorded state is refused',async()=>{const D=await mkdtemp(path.join(tmpdir(),'jsw2-'));const f=await fake();const env={HERMES_DASH:'http://127.0.0.1:'+f.port,HERMES_DASHBOARD_SESSION_TOKEN:'t'};
 assert.equal((await run(['--agent','default','--job','abc','--script','../x.sh','--data',D],env)).code,2);assert.equal((await run(['--agent','default','--job','abc','--undo','--data',D],env)).code,2);f.close()});
