// Audit H2 (12 Nov 2026): no good backup on the live box for three nights and nothing said. A backup takes over an hour, every deploy
// restarted the app and killed it, and each killed run used up one of the night's three tries.
// Here: the backup runs in its own process and outlives an app restart (the next app instance follows it and records its result once),
// a run that was cut off gets its try back, and the end of the night's window without a good backup is told once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createBackups,LOCAL_NAME} from '../app/backup.mjs';
import {localParts} from '../app/tz.mjs';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
function scene(x={}){const T=mkdtempSync(path.join(tmpdir(),'aq-bkjob-')).split(path.sep).join('/'),HOME=T+'/home',H=HOME+'/.hermes',DATA=T+'/data',TMP=T+'/tmp';
 for(const d of [H,DATA,TMP,HOME+'/workspaces/a'])mkdirSync(d,{recursive:true});writeFileSync(H+'/config.yaml','x: 1\n'.repeat(50));writeFileSync(HOME+'/workspaces/a/notes.txt','hello');
 const told=[],solved=[];
 const make=(y={})=>createBackups({DATA,HOME,HERMES_HOME:H,TMP,MIN:1,tz:()=>'UTC',fetchImpl:async()=>{throw Error('no network in tests')},disk:async()=>({free:1e12,dev:'d'}),notify:(...a)=>told.push(a),solved:()=>solved.push(1),jobPoll:40,...x,...y});
 const state=()=>JSON.parse(readFileSync(DATA+'/backups.json','utf8'));
 return {T,HOME,H,DATA,TMP,make,told,solved,state,JOB:DATA+'/backup-job.json',LOCALDIR:HOME+'/aqeelos-local-backups',done:()=>rmSync(T,{recursive:true,force:true})}}
// a stand-in for the job process: writes the job file like backup-job.mjs does, works for `ms`, then finishes (or is killed first)
function fakeJob(s,{ms=600,fail=''}={}){const f=s.T+'/fake-job.mjs';writeFileSync(f,`
import {writeFileSync,renameSync} from 'node:fs';
const o=JSON.parse(process.env.AQ_BACKUP_JOB),JOB=o.DATA+'/backup-job.json';
const w=x=>{writeFileSync(JOB+'.t',JSON.stringify({pid:process.pid,at:o.at,name:o.name,why:o.why,phase:'packing',beat:Date.now(),...x}));renameSync(JOB+'.t',JOB)};
w({});const hb=setInterval(()=>w({}),50);
setTimeout(()=>{clearInterval(hb);w(${fail?`{done:true,error:${JSON.stringify(fail)}}`:`{done:true,last:{at:o.at,ok:true,name:o.name,size:12345,local:true,why:o.why,secs:1,skipped:0},note:o.name+' kept'}`})},${ms});
`);return [process.execPath,f]}
const today=()=>localParts(Date.now(),'UTC').day;

test('the real job, start to end: a detached backup lands on the box and its result is recorded',{skip:process.platform==='win32'&&'needs bash, tar and openssl'},async()=>{const s=scene();try{
 const b=s.make({detach:true});const last=await b.run('by hand');assert.equal(last.ok,true);assert.equal(last.local,true);
 const l=readdirSync(s.LOCALDIR);assert.equal(l.length,1);assert.ok(LOCAL_NAME.test(l[0]));assert.ok(last.size>100);
 assert.equal(existsSync(s.JOB),false,'the job file is gone once its result is recorded');assert.deepEqual(readdirSync(s.TMP),[]);
 const st=s.state();assert.equal(st.last.ok,true);assert.equal(st.lastSize,last.size);assert.equal(st.tries.n,1);assert.equal((await b.status()).running,false)}finally{s.done()}});

test('an app restart in the middle does not stop the backup: the next app instance follows the same job and records it once',async()=>{const s=scene();try{
 const cmd=fakeJob(s,{ms:700});const a=s.make({detach:true,jobCmd:cmd});const first=a.run('scheduled');first.catch(()=>{});
 for(let i=0;i<100&&!existsSync(s.JOB);i++)await wait(20);const j=JSON.parse(readFileSync(s.JOB,'utf8'));assert.ok(j.pid>0);assert.equal(s.state().tries.n,1);a.stopFollowing();await first.catch(()=>{});   // the first app instance is gone
 // "restart": a new instance on the same data while the job is still working (the old one is simply gone in real life)
 const b=s.make({detach:true,jobCmd:cmd});const up=await b.startUp();assert.deepEqual(up,{adopted:true});assert.equal((await b.status()).running,true);
 // while it is followed, nothing starts a second backup
 b.run('scheduled').catch(()=>{});await wait(60);assert.equal(JSON.parse(readFileSync(s.JOB,'utf8')).pid,j.pid,'the same job, not a second one');
 const last=await b.following();assert.equal(last.ok,true);assert.equal(last.size,12345);
 const st=s.state();assert.equal(st.last.ok,true);assert.equal(st.lastOkAt,j.at);assert.equal(st.tries.n,1,'the restart did not use up another try');assert.equal(existsSync(s.JOB),false);
 assert.ok(s.solved.length>=1);assert.deepEqual(s.told,[])}finally{s.done()}});

test('a job that finished while the app was away is picked up at the next start',async()=>{const s=scene();try{
 const at=Date.now()-5000;writeFileSync(s.JOB,JSON.stringify({pid:999999,at,name:'aqeelos-x.tar.gz.enc',why:'scheduled',done:true,last:{at,ok:true,name:'aqeelos-x.tar.gz.enc',size:777,local:true,why:'scheduled'},note:'kept'}));
 const b=s.make({detach:true});await b.startUp();await b.following();assert.equal(s.state().lastOkAt,at);assert.equal(existsSync(s.JOB),false);
 // and a failed one is recorded as failed, with its reason
 const s2=scene();writeFileSync(s2.DATA+'/backups.json',JSON.stringify({tries:{day:today(),n:1}}));writeFileSync(s2.JOB,JSON.stringify({pid:999999,at,name:'n',why:'by hand',done:true,error:'Not enough free disk space'}));
 const b2=s2.make({detach:true});await b2.startUp();await b2.following().catch(()=>{});assert.equal(s2.state().last.ok,false);assert.match(s2.state().last.error,/disk space/);s2.done()}finally{s.done()}});

test('three runs cut off in one night: each gives its try back, so a new instance still tries in the window',async()=>{const s=scene();try{
 const dead=await new Promise(res=>{const c=spawn(process.execPath,['-e','0']);c.on('close',()=>res(c.pid))});
 for(let i=1;i<=3;i++){   // each round: a try was counted, the job died with the app, the next start finds it
  const st=existsSync(s.DATA+'/backups.json')?s.state():{};writeFileSync(s.DATA+'/backups.json',JSON.stringify({...st,tries:{...(st.tries||{}),day:today(),n:(st.tries?.n||0)+1}}));
  writeFileSync(s.JOB,JSON.stringify({pid:dead,at:Date.now()-60e3,name:'aqeelos-2026-11-12-03-0'+i+'.tar.gz.enc',why:'scheduled',phase:'packing',beat:Date.now()-1000}));
  writeFileSync(s.TMP+'/aqeelos-2026-11-12-03-0'+i+'.tar.gz.enc','half');
  const b=s.make({detach:true});const up=await b.startUp();assert.equal(up.cut,true);assert.equal(up.back,true);
  assert.equal(s.state().tries.n,0,'round '+i+': the cut-off run does not count');assert.equal(existsSync(s.JOB),false);assert.deepEqual(readdirSync(s.TMP),[],'its half archive is removed')}
 // now a tick inside the window starts a backup (the hour is the window's start)
 const H=localParts(Date.now(),'UTC').hour;writeFileSync(s.DATA+'/backups.json',JSON.stringify({...s.state(),settings:{hour:H}}));
 const b=s.make({detach:true,jobCmd:fakeJob(s,{ms:100})});await b.tick();assert.equal(s.state().last.ok,true,'the fourth start of the night made the backup');assert.deepEqual(s.told,[])}finally{s.done()}});

test('a job whose process is alive but silent (no heartbeat) counts as cut off; a pid that was reused does not keep the lock for ever',async()=>{const s=scene();try{
 writeFileSync(s.DATA+'/backups.json',JSON.stringify({tries:{day:today(),n:2}}));
 writeFileSync(s.JOB,JSON.stringify({pid:process.pid,at:Date.now()-3600e3,name:'n',why:'scheduled',phase:'packing',beat:Date.now()-10*60e3}));
 const b=s.make({detach:true});const up=await b.startUp();assert.equal(up.cut,true);assert.equal(s.state().tries.n,1)}finally{s.done()}});

test('giving tries back is bounded: at most six a day',async()=>{const s=scene();try{
 writeFileSync(s.DATA+'/backups.json',JSON.stringify({tries:{day:today(),n:3,back:6}}));writeFileSync(s.TMP+'/aqeelos-2026-11-12-03-00.tar.gz.enc','half');
 const up=await s.make().startUp();assert.equal(up.cut,true);assert.equal(up.back,false);assert.equal(s.state().tries.n,3)}finally{s.done()}});

test('without the detached job (the old way), an archive left by a killed run gives the try back too',async()=>{const s=scene();try{
 writeFileSync(s.DATA+'/backups.json',JSON.stringify({tries:{day:today(),n:3}}));writeFileSync(s.TMP+'/aqeelos-2026-11-12-03-00.tar.gz.enc','half');writeFileSync(s.TMP+'/aqeelos-2026-11-12-03-00.tar.gz.enc.err','x');
 const up=await s.make().startUp();assert.equal(up.cut,true);assert.equal(s.state().tries.n,2);assert.deepEqual(readdirSync(s.TMP),[]);
 // nothing left behind: nothing given back
 assert.deepEqual(await s.make().startUp(),{});assert.equal(s.state().tries.n,2)}finally{s.done()}});

test('the window ends without a good backup: told once; with a good one: nothing',async()=>{const s=scene();try{
 let t=Date.parse('2026-11-12T03:10:00Z');const fail=fakeJob(s,{ms:20,fail:'Google Drive said 500'});
 writeFileSync(s.DATA+'/backups.json',JSON.stringify({settings:{hour:3},since:t,tries:{day:'2026-11-12',n:3}}));   // the night's tries are used up
 const b=s.make({detach:true,jobCmd:fail,now:()=>t});
 await b.tick();assert.equal(s.state().window.day,'2026-11-12');assert.deepEqual(s.told,[]);
 t=Date.parse('2026-11-12T08:50:00Z');await b.tick();assert.deepEqual(s.told,[],'still inside the window');
 t=Date.parse('2026-11-12T09:05:00Z');await b.tick();assert.equal(s.told.length,1);assert.match(s.told[0][0],/backup was not made/);
 await b.tick();t+=3600e3;await b.tick();assert.equal(s.told.length,1,'once per night');
 // it also holds across a restart
 await s.make({detach:true,jobCmd:fail,now:()=>t}).tick();assert.equal(s.told.length,1);
 // the next night a backup works: nothing is said
 t=Date.parse('2026-11-13T03:10:00Z');const ok=s.make({detach:true,jobCmd:fakeJob(s,{ms:20}),now:()=>t});await ok.tick();assert.equal(s.state().last.ok,true);
 t=Date.parse('2026-11-13T09:05:00Z');await ok.tick();assert.equal(s.told.length,1)}finally{s.done()}});

test('a failed run keeps the last good size for the disk check (a 20 GB backup is not assumed to be 2 GB after one failure)',async()=>{const s=scene({disk:async()=>({free:5e9,dev:'d'})});try{
 writeFileSync(s.DATA+'/backups.json',JSON.stringify({lastSize:20e9,last:{at:Date.now()-1e6,ok:false,error:'x'}}));
 await assert.rejects(()=>s.make().run('by hand'),/Not enough free disk space/)}finally{s.done()}});
