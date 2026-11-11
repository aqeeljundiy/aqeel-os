import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,utimesSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {newLines,processesLine,expired,pruneTests,BAK,DEPLOY_TMP,createBoxOps} from '../app/box-ops.mjs';

test('issue lines: only whole new lines, and a trimmed file is read again from the start',()=>{
 const a='{"at":1,"agent":"x","key":"screen-stopped","what":"w"}\n';
 let r=newLines(a+'{"at":2,"agent":"y"',0);assert.equal(r.items.length,1);assert.equal(r.offset,a.length);
 r=newLines(a,r.offset);assert.equal(r.items.length,0);
 r=newLines('junk\n'+a,999);assert.equal(r.items.length,1)});

test('process line',()=>{const now=1e12;
 assert.equal(processesLine({at:now/1000,expected:10,running:10,agents:{}},now).text,'10 expected, 10 running');
 const x=processesLine({at:now/1000,expected:10,running:12,agents:{a:{extra:[1,2]}}},now);assert.equal(x.ok,false);assert.match(x.text,/extra on a \(2\)/);
 assert.equal(processesLine({at:now/1000-600,expected:1,running:1},now).stale,true);
 assert.equal(processesLine(null).ok,false)});

test('expiry picks only what is older than 30 days, and the names it may touch',()=>{const now=Date.now(),d=864e5;
 assert.deepEqual(expired([{name:'old',mtimeMs:now-31*d},{name:'new',mtimeMs:now-29*d}],now),['old']);
 for(const n of ['issues.json.bak-20261106-i','agent-trust.json.bak-20oct','backup-20261106-sharing-enable','x.bak'])assert.ok(BAK.test(n),n);
 for(const n of ['backups.json','backup-key','backup-models.json','bottlenecks.json'])assert.ok(!BAK.test(n),n);
 assert.ok(DEPLOY_TMP.test('aq-deploy-1762-123.log')&&DEPLOY_TMP.test('box-pack-1762-9.sh')&&!DEPLOY_TMP.test('aqeelos-x.tar.gz.enc'))});

test('test agents leave the list only when gone on two passes in a row',()=>{
 const text='# comment\nreal\ngone1\ngone2\n',have=n=>n==='real';
 const a=pruneTests(text,have,new Set());assert.equal(a.removed,0);assert.equal(a.text,text);
 const b=pruneTests(text,have,new Set(['gone1']));assert.equal(b.removed,1);assert.equal(b.text,'# comment\nreal\ngone2\n')});

test('expire on a folder: old fixer patches, .bak copies and broken environments go; the rest stays',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),HOME=path.join(root,'home'),DATA=path.join(HOME,'data'),HH=path.join(HOME,'.hermes'),TMP=path.join(root,'tmp');
 for(const d of [DATA+'/fixer-patches',DATA+'/drift',HH+'/profiles/real',HH+'/pixel-tools',HH+'/logs',TMP])mkdirSync(d,{recursive:true});
 const old=(f,body='x')=>{writeFileSync(f,body);const t=new Date(Date.now()-40*864e5);utimesSync(f,t,t)};
 old(DATA+'/fixer-patches/a.patch');writeFileSync(DATA+'/fixer-patches/b.patch','new');old(DATA+'/issues.json.bak-1');old(DATA+'/issues.json');
 mkdirSync(HH+'/pixel-tools/venv.broken-3.14.7');const t=new Date(Date.now()-40*864e5);utimesSync(HH+'/pixel-tools/venv.broken-3.14.7',t,t);
 old(TMP+'/aq-deploy-1-2.log');writeFileSync(HH+'/.aqeelos-test-agents','real\ngone\n');
 const ops=createBoxOps({HOME,DATA,HERMES_HOME:HH,TMP});
 const r=await ops.expire();
 assert.ok(!existsSync(DATA+'/fixer-patches/a.patch')&&existsSync(DATA+'/fixer-patches/b.patch'));
 assert.ok(!existsSync(DATA+'/issues.json.bak-1')&&existsSync(DATA+'/issues.json'));
 assert.ok(!existsSync(HH+'/pixel-tools/venv.broken-3.14.7')&&!existsSync(TMP+'/aq-deploy-1-2.log'));
 assert.equal(r.removed,0);await ops.expire();assert.equal(readFileSync(HH+'/.aqeelos-test-agents','utf8'),'real\n')});

test('intake files one issue per agent and kind',async()=>{
 const HOME=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),DATA=path.join(HOME,'d');mkdirSync(DATA);
 const filed=[];const ops=createBoxOps({HOME,DATA,HERMES_HOME:HOME,fileIssue:async o=>{filed.push(o);return {}}});
 const l=k=>JSON.stringify({at:1,agent:'sesa',key:k,what:'its screen failed 5 times'})+'\n';
 writeFileSync(HOME+'/.aqeelos-agent-issues.jsonl',l('screen-stopped')+l('screen-stopped')+l('chrome-stopped'));
 assert.equal(await ops.intake(),2);assert.equal(await ops.intake(),0);
 assert.equal(filed[0].agent,'sesa');assert.equal(filed[0].healthKey,'box:sesa:screen-stopped')});

import {limitLines,parseEvents,screensLine} from '../app/box-ops.mjs';
test('limits: defaults 4 GB and 15 min, lean, set per agent; an AdsPower screen never sleeps and gets 8 GB',()=>{
 assert.equal(limitLines(['a','b','c'],{agents:{b:{memory_cap_gb:2,sleep_minutes:0}}},n=>n==='c'),['a 4096 15 lean','b 2048 0 lean','c 8192 0 lean',''].join('\n'));
 assert.equal(limitLines(['a'],{default:{sleep_minutes:0}}),'a 4096 0 lean\n');assert.equal(limitLines([]),'')
 // the screen mode is a per-install setting with a per-agent override; anything else means lean
 assert.equal(limitLines(['a','b'],{default:{screen_mode:'desktop'},agents:{b:{screen_mode:'lean'}}}),'a 4096 15 desktop\nb 4096 15 lean\n');
 assert.equal(limitLines(['a'],{default:{screen_mode:'nonsense'}}),'a 4096 15 lean\n')});

test('Health line: screens awake and asleep, wakes in the last 24 h, failed, slowest',()=>{
 const now=1e9*1000,t=s=>1e9-s;
 const j={at:1e9,agents:{a:{asleep:true,mode:'lean-fluxbox'},b:{asleep:false,mode:'lean-fluxbox'},c:{asleep:true,mode:'desktop'}}};
 const ev=parseEvents([{at:t(60),agent:'a',event:'wake',ms:4200,ok:true},{at:t(50),agent:'c',event:'wake',ms:11800,ok:true},{at:t(40),agent:'c',event:'wake',ms:60000,ok:false},
  {at:t(90000),agent:'a',event:'wake',ms:99000,ok:true},{at:t(30),agent:'a',event:'sleep',ms:900,ok:true}].map(x=>JSON.stringify(x)).join('\n')+'\nnot json\n');
 assert.equal(ev.length,5);
 const r=screensLine(j,ev,now);
 assert.equal(r.text,'Screens: 1 awake, 2 asleep; wakes in the last 24 h: 3, failed: 1, slowest: 11.8 s');
 assert.equal(r.ok,false);
 assert.equal(screensLine({agents:{a:{asleep:false}}},[],now).text,'Screens: 1 awake, 0 asleep; wakes in the last 24 h: 0, failed: 0, slowest: 0 s');
 assert.match(screensLine({agents:{a:{asleep:false,nosleep:true}}},[],now).text,/Kept always on after failed wakes: a/)});

test('OPS-13: the agents mid-reply, once each, from live reply keys',async()=>{
 const {busyText}=await import('../app/box-ops.mjs');
 assert.equal(busyText(['b|s1','a|s2','b|s3','../x|s','default|s']),'a\nb\ndefault\n');
 assert.equal(busyText([]),'')});

import {tmpExpired,TMP_OWN,unreadable} from '../app/box-ops.mjs';
test('OPS-18: /tmp: only aqeelOS\'s own scratch goes, after 3 days; the test copy only while no check holds it',()=>{const now=Date.now(),d=864e5,e=(name,age)=>({name,mtimeMs:now-age*d});
 const own=['aq-deploy-1794011246-30378.log','aq-deploy-1794011246-30378.sh','aq-deploy-1794011246-30378','box-pack-1794-9852.sh','hui-check-1794-8243.tgz','hui-1794-73977.tgz','code-1794-73977.tgz',
  'aq-commits-1794374549-1590','aq-engsim.k3j2h1','aq-engsim-3061037.out','aq-boxops-DEueTg','aqeelos-restore-1794011246','aqeelos-2026-11-11-03-00.tar.gz.enc.oerr'];
 const theirs=['aqfix','pytest-of-claude','ppl','leadtest','shot-9644','aq-wake.nHf2x3','aq-desktop-1.0.9','aq-check.lock','.org.chromium.Chromium.yA2DmR','ui.log','code-projects','hui-notes.txt','aq-deploy'];
 for(const n of own)assert.ok(TMP_OWN.test(n),n);for(const n of theirs)assert.ok(!TMP_OWN.test(n),n);
 assert.deepEqual(tmpExpired([...own,...theirs].map(n=>e(n,10)),now).sort(),[...own].sort(),'old: only its own');
 assert.deepEqual(tmpExpired(own.map(n=>e(n,2)),now),[],'younger than 3 days stays');
 assert.deepEqual(tmpExpired([e('aq-stage',10)],now),['aq-stage']);assert.deepEqual(tmpExpired([e('aq-stage',10)],now,{checking:true}),[]);assert.deepEqual(tmpExpired([e('aq-stage',1)],now),[])});

test('OPS-18: pruneTmp removes the old own scratch on disk and leaves the rest',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),HOME=path.join(root,'home'),DATA=path.join(HOME,'data'),TMP=path.join(root,'tmp');
 for(const d of [DATA,TMP,TMP+'/aq-deploy-1-2',TMP+'/aqfix',TMP+'/aq-stage'])mkdirSync(d,{recursive:true});
 const old=f=>{const t=new Date(Date.now()-5*864e5);utimesSync(f,t,t)};writeFileSync(TMP+'/aq-deploy-1-2.log','x');writeFileSync(TMP+'/ui.log','x');
 for(const f of ['/aq-deploy-1-2.log','/aq-deploy-1-2','/aqfix','/aq-stage','/ui.log'])old(TMP+f);
 const ops=createBoxOps({HOME,DATA,HERMES_HOME:HOME,TMP});const gone=await ops.pruneTmp();
 assert.deepEqual(gone.sort(),['aq-deploy-1-2','aq-deploy-1-2.log','aq-stage']);assert.ok(existsSync(TMP+'/aqfix')&&existsSync(TMP+'/ui.log')&&!existsSync(TMP+'/aq-stage'));
 // a deploy check holds the test copy: it stays
 mkdirSync(TMP+'/aq-stage');mkdirSync(TMP+'/aq-check.lock');old(TMP+'/aq-stage');assert.deepEqual(await ops.pruneTmp(),[]);assert.ok(existsSync(TMP+'/aq-stage'))});

test('OPS-18: uploads: a file the agents cannot read is made readable, the rest is left alone',async()=>{
 assert.equal(unreadable(0o600),true);assert.equal(unreadable(0o640),true);assert.equal(unreadable(0o644),false);assert.equal(unreadable(0o664),false);
 if(process.platform==='win32')return;   // no Unix modes here; the decision above is the part that matters
 const {chmodSync,statSync}=await import('node:fs');const HOME=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),DATA=path.join(HOME,'d');mkdirSync(DATA);mkdirSync(HOME+'/uploads');
 writeFileSync(HOME+'/uploads/a.pdf','x');chmodSync(HOME+'/uploads/a.pdf',0o600);writeFileSync(HOME+'/uploads/b.txt','x');chmodSync(HOME+'/uploads/b.txt',0o664);mkdirSync(HOME+'/uploads/sub');
 const ops=createBoxOps({HOME,DATA,HERMES_HOME:HOME});assert.equal(await ops.uploadsReadable(),1);
 assert.equal(statSync(HOME+'/uploads/a.pdf').mode&0o777,0o644);assert.equal(statSync(HOME+'/uploads/b.txt').mode&0o777,0o664);assert.equal(await ops.uploadsReadable(),0)});

/* ---------- OPS-16: the My browser check's workspace folders ---------- */
import {mbLeftovers} from '../app/box-ops.mjs';
test('a check workspace is a leftover when over a day old with no profile and no Linux user',()=>{
 const now=Date.now(),e=(name,days)=>({name,mtimeMs:now-days*864e5});
 const list=[e('mb-abc12',2),e('mb-new01',0.2),e('mb-has01',3),e('mb-usr01',3),e('donna',9),e('mb-toolong1',9),e('.removed',9)];
 assert.deepEqual(mbLeftovers(list,{now,hasProfile:n=>n==='mb-has01',hasUser:n=>n==='mb-usr01'}),['mb-abc12'])});

test('the daily pass moves leftover check workspaces to .removed, keeps real ones, and prunes .removed after 14 days',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),HOME=path.join(root,'home'),DATA=path.join(HOME,'data'),HH=path.join(HOME,'.hermes'),W=HOME+'/workspaces',TMP=path.join(root,'tmp');
 for(const d of [DATA,HH+'/profiles/mb-live1',TMP,W+'/mb-dead1',W+'/mb-live1',W+'/mb-fresh',W+'/donna',W+'/.removed/mb-old01',W+'/.removed/mb-new02'])mkdirSync(d,{recursive:true});
 const age=(f,d)=>{const t=new Date(Date.now()-d*864e5);utimesSync(f,t,t)};
 age(W+'/mb-dead1',3);age(W+'/mb-live1',3);age(W+'/donna',60);age(W+'/.removed/mb-old01',15);age(W+'/.removed/mb-new02',2);
 mkdirSync(W+'/mb-fres2');
 const ops=createBoxOps({HOME,DATA,HERMES_HOME:HH,TMP});await ops.expire();
 assert.ok(!existsSync(W+'/mb-dead1')&&existsSync(W+'/.removed/mb-dead1'),'moved, not deleted');
 assert.ok(existsSync(W+'/mb-live1')&&existsSync(W+'/mb-fres2')&&existsSync(W+'/donna'));
 assert.ok(!existsSync(W+'/.removed/mb-old01')&&existsSync(W+'/.removed/mb-new02'),'.removed keeps 14 days')});

/* ---------- the memory cap is never written before AdsPower's state is known ---------- */
test('limits: nothing is written until the AdsPower state is known, then the 8 GB agent gets its 8 GB',async()=>{
 const HOME=mkdtempSync(path.join(tmpdir(),'aq-boxops-')),DATA=path.join(HOME,'d');mkdirSync(DATA);writeFileSync(HOME+'/.aqeelos-agent-users','continue-threads\nother\n');
 let known=false,keep=false;const ops=createBoxOps({HOME,DATA,HERMES_HOME:HOME,keepOn:a=>keep&&a==='continue-threads',keepKnown:()=>known});
 const f=HOME+'/.aqeelos-agent-limits';
 assert.equal(await ops.writeLimits(),null);assert.ok(!existsSync(f),'no first file with the low value');
 writeFileSync(f,'continue-threads 8192 0 lean\nother 4096 15 lean\n');assert.equal(await ops.writeLimits(),null);assert.match(readFileSync(f,'utf8'),/continue-threads 8192/,'the last written value stays');
 known=true;keep=true;await ops.writeLimits();assert.match(readFileSync(f,'utf8'),/continue-threads 8192 0 lean/);
 keep=false;await ops.writeLimits();assert.match(readFileSync(f,'utf8'),/continue-threads 4096 15/,'once known, the rule applies as before')});
