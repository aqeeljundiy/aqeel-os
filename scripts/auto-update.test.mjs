// Automatic updates: when they may run (scripts/auto-update.mjs). Since 12 Nov 2026 that is the install's maintenance
// window (app/maintenance.mjs), 00:00 to 01:00 Jakarta time unless the install sets its own.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mayUpdateNow} from './auto-update.mjs';

const at=(iso)=>new Date(iso);
test('runs only inside the maintenance window, 00:00 to 01:00 Jakarta time by default',()=>{
 assert.equal(mayUpdateNow(at('2026-11-09T17:00:00Z'),{}),true);    // 00:00 in Jakarta
 assert.equal(mayUpdateNow(at('2026-11-09T17:45:00Z'),{}),true);    // 00:45
 assert.equal(mayUpdateNow(at('2026-11-09T18:00:00Z'),{}),false);   // 01:00
 assert.equal(mayUpdateNow(at('2026-11-09T18:30:00Z'),{}),false);   // 01:30: the old quiet hours no longer count
 assert.equal(mayUpdateNow(at('2026-11-09T16:59:00Z'),{}),false);   // 23:59
 assert.equal(mayUpdateNow(at('2026-11-09T17:30:00Z'),{timezone:'Europe/Amsterdam'}),true)});   // the window has its own zone
test('an install with its own window follows that one',()=>{const s={maintenance:{from:'02:00',to:'03:00',tz:'UTC'}};
 assert.equal(mayUpdateNow(at('2026-11-09T02:10:00Z'),s),true);assert.equal(mayUpdateNow(at('2026-11-09T17:10:00Z'),s),false)});
test('a broken window setting falls back to the default instead of stopping updates',()=>{
 assert.equal(mayUpdateNow(at('2026-11-09T17:10:00Z'),{maintenance:{from:'x',to:'y',tz:'Not/AZone'}}),true);
 assert.equal(mayUpdateNow(at('2026-11-09T12:00:00Z'),{maintenance:{tz:'Not/AZone'}}),false)});

/* ---------- what may be deployed (security audit H-5, 12 Nov 2026) ---------- */
import {checksPassed,repoSlug} from './auto-update.mjs';
import {mkdtempSync,writeFileSync as wf,readFileSync as rf,mkdirSync,existsSync as ex} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync,spawn} from 'node:child_process';import {createServer} from 'node:http';import {fileURLToPath} from 'node:url';
const SHA='a'.repeat(40),run=(o={})=>({head_sha:SHA,head_branch:'main',event:'push',path:'.github/workflows/tests.yml',status:'completed',conclusion:'success',run_attempt:1,created_at:'2026-11-12T00:00:00Z',...o});
const gh=runs=>async()=>({ok:true,status:200,json:async()=>({workflow_runs:runs})});

test('a version is taken only when GitHub says its checks passed on main',async()=>{
 assert.equal(repoSlug('https://github.com/aqeeljundiy/aqeel-os.git'),'aqeeljundiy/aqeel-os');
 assert.deepEqual(await checksPassed('o/r',SHA,{fetchFn:gh([run()])}),{ok:true});
 // not from main, not from a push, another commit, another workflow: none of them counts
 for(const o of [{head_branch:'claude/i1'},{event:'pull_request'},{event:'pull_request_target'},{head_sha:'b'.repeat(40)},{path:'.github/workflows/other.yml'}]){const r=await checksPassed('o/r',SHA,{fetchFn:gh([run(o)])});assert.equal(r.ok,false,JSON.stringify(o));assert.equal(r.wait,true)}
 let r=await checksPassed('o/r',SHA,{fetchFn:gh([run({status:'in_progress',conclusion:null})])});assert.equal(r.ok,false);assert.equal(r.wait,true);
 r=await checksPassed('o/r',SHA,{fetchFn:gh([run({conclusion:'failure'})])});assert.equal(r.ok,false);assert.equal(r.wait,undefined,'a failed version is skipped, not waited for');
 r=await checksPassed('o/r',SHA,{fetchFn:gh([run({conclusion:'failure'}),run({run_attempt:2})])});assert.equal(r.ok,true,'a passed re-run counts');
 r=await checksPassed('o/r',SHA,{fetchFn:gh([run()]),required:['tests.yml','fixer-gate.yml']});assert.equal(r.ok,false,'every required check');
 // GitHub not reachable, or an error: no update
 r=await checksPassed('o/r',SHA,{fetchFn:async()=>{throw new Error('offline')}});assert.equal(r.ok,false);assert.equal(r.wait,true);
 r=await checksPassed('o/r',SHA,{fetchFn:async()=>({ok:false,status:403,json:async()=>({})})});assert.equal(r.ok,false);assert.equal(r.wait,true);
 r=await checksPassed('',SHA,{fetchFn:gh([run()])});assert.equal(r.ok,false)});

test('an install does not move to a commit GitHub has not passed, and runs nothing from it',{skip:process.platform==='win32'&&'needs sh'},async()=>{
 const T=mkdtempSync(path.join(tmpdir(),'au-')),remote=path.join(T,'remote'),app=path.join(T,'app'),data=path.join(T,'data'),home=path.join(T,'home');mkdirSync(home);
 const g=(a,cwd)=>execFileSync('git',['-c','user.name=t','-c','user.email=t@example.com','-c','init.defaultBranch=main',...a],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 mkdirSync(remote);g(['init','-q'],remote);mkdirSync(path.join(remote,'app'));mkdirSync(path.join(remote,'scripts'));wf(path.join(remote,'app','x.mjs'),'export const v=1;\n');g(['add','-A'],remote);g(['commit','-qm','one'],remote);
 g(['clone','-q',remote,app],T);const first=g(['rev-parse','HEAD'],app);
 wf(path.join(remote,'app','x.mjs'),'export const v=2;\n');g(['commit','-qam','two'],remote);const second=g(['rev-parse','HEAD'],remote);
 let answer={workflow_runs:[]};const hits=[];const srv=createServer((q,s)=>{hits.push(q.url);if(q.url==='/healthz'){s.writeHead(200);return s.end('ok')}s.writeHead(200,{'content-type':'application/json'});s.end(JSON.stringify(answer))});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;
 // not spawnSync: the stub GitHub below lives in this process and must answer while the update runs
 const go=()=>new Promise(res=>spawn(process.execPath,[fileURLToPath(new URL('./auto-update.mjs',import.meta.url)),'--now'],{stdio:'ignore',env:{...process.env,AQEELOS_APP:app,AQEELOS_HOME:home,UI_DATA_DIR:data,UI_PORT:String(port),AQ_REPO:remote,AQ_REPO_SLUG:'o/r',AQ_CHECKS_API:'http://127.0.0.1:'+port,AQ_UPDATE_RESTART:'true'}}).on('exit',res));
 const st=()=>JSON.parse(rf(path.join(data,'auto-update.json'),'utf8'));
 try{
  await go();assert.equal(g(['rev-parse','HEAD'],app),first,'no check yet: not installed');assert.equal(st().waiting.to,second);assert.equal(st().skip,undefined);
  answer={workflow_runs:[run({head_sha:second,event:'pull_request',head_branch:'claude/i1'})]};await go();assert.equal(g(['rev-parse','HEAD'],app),first,'a pull request\'s own check does not count');
  answer={workflow_runs:[run({head_sha:second,conclusion:'failure'})]};await go();assert.equal(g(['rev-parse','HEAD'],app),first);assert.equal(st().last.result,'refused');assert.equal(st().skip,second);
  wf(path.join(remote,'app','x.mjs'),'export const v=3;\n');g(['commit','-qam','three'],remote);const third=g(['rev-parse','HEAD'],remote);
  answer={workflow_runs:[run({head_sha:third})]};await go();assert.equal(g(['rev-parse','HEAD'],app),third,'passed on main: installed');assert.equal(st().last.result,'updated')}
 finally{srv.close()}});
