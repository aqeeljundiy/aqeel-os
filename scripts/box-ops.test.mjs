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
