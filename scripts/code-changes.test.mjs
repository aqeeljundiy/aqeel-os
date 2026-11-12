// node scripts/code-changes.test.mjs — live code changes git lacks: the deploy's drift guard (box-live.sh), the Health
// list of drift and fixer patches, and the tester webhook the fixer uses instead of asking a person to write from a phone
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,utimes} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodeChanges,patchFiles} from '../app/code-changes.mjs';
import {testWebhook,sign,pickTester,testAgents} from './kirimdev-test-message.mjs';
import {verifySignature,parseInbound} from '../app/kirimdev.mjs';
let n=0;const t=async(name,f)=>{await f();n++;console.log('ok',name)};
const px=p=>process.platform==='win32'?p.replace(/^([A-Za-z]):/,(m,d)=>'/'+d.toLowerCase()).replaceAll('\\','/'):p;   // the bash side wants /c/... paths on Windows
const here=path.dirname(fileURLToPath(import.meta.url));

// the drift function from box-live.sh, run on its own against a fake box
const fn=(await readFile(path.join(here,'box-live.sh'),'utf8')).match(/^aq_drift\(\)\{[\s\S]*?\n rm -f "\$P"; \}$/m)?.[0];
async function box(){const L=await mkdtemp(path.join(tmpdir(),'live-')),D=await mkdtemp(path.join(tmpdir(),'data-')),src=await mkdtemp(path.join(tmpdir(),'src-'));
 for(const [f,x] of [['app/a.mjs','one\n'],['app/b.js','two\n'],['scripts/s.sh','echo\n']]){await mkdir(path.dirname(path.join(src,f)),{recursive:true});await writeFile(path.join(src,f),x)}
 execFileSync('tar',['-czf',px(path.join(L,'.deployed.tgz')),'-C',px(src),'app','scripts']);execFileSync('tar',['-xzf',px(path.join(L,'.deployed.tgz')),'-C',px(L)]);
 await writeFile(path.join(L,'.deployed-commit'),'abc\n');const old=new Date(Date.now()-3600e3);await utimes(path.join(L,'.deployed-commit'),old,old);
 const go=force=>spawnSync('bash',['-c',fn+'\naq_drift'],{env:{...process.env,AQ_LIVE:px(L),AQ_DRIFT_DATA:px(D),BOX_SHA:'abcdef12',SHA:'fedcba98',FORCE:force?'1':'0'},encoding:'utf8'});
 const run=force=>{const r=go(force);assert.ok(r.status===0||r.status===3&&!force,'exit '+r.status+' '+r.stderr);return r.stdout};
 return {L,D,run,go}}

await t('drift guard: a box that runs exactly its commit saves nothing',async()=>{assert.ok(fn,'aq_drift is in box-live.sh');const B=await box();
 assert.match(B.run(),/ran exactly abcdef12/);assert.deepEqual(await readdir(B.D),[])});
await t('drift guard: a changed file, a new file since the deploy, and a removed file are saved and printed; old leftovers and backups are not',async()=>{const B=await box();
 const old=new Date(Date.now()-7200e3);await writeFile(path.join(B.L,'app','left.mjs'),'old leftover\n');await utimes(path.join(B.L,'app','left.mjs'),old,old);
 await writeFile(path.join(B.L,'app','a.mjs'),'one fixed\n');await writeFile(path.join(B.L,'app','a.mjs.bak-20261107-i1-1'),'one\n');
 await writeFile(path.join(B.L,'app','new.mjs'),'brand new\n');execFileSync('rm',[path.join(B.L,'scripts','s.sh')]);
 const out=B.run(true);assert.match(out,/^! drift: .*Saved as drift\/\d{8}-\d{6}\.patch/m);assert.match(out,/changed: app\/a\.mjs/);
 const [f]=await readdir(path.join(B.D,'drift'));const p=await readFile(path.join(B.D,'drift',f),'utf8');
 assert.match(p,/^# Changed on the live box after deploy abcdef12, found by the deploy of fedcba98/);assert.match(p,/-one\n\+one fixed/);
 assert.match(p,/\+\+\+ app\/new\.mjs/);assert.match(p,/Only in scripts: s\.sh/);assert.doesNotMatch(p,/left\.mjs|\.bak-/);
 assert.deepEqual(patchFiles(p),['app/a.mjs','app/new.mjs'])});
await t('drift guard: without FORCE=1 it stops (exit 3) after saving the patch, once per difference; FORCE=1 goes on and keeps the patch',async()=>{const B=await box();
 await writeFile(path.join(B.L,'app','a.mjs'),'one fixed\n');
 const r1=B.go(false);assert.equal(r1.status,3);assert.match(r1.stdout,/changed: app\/a\.mjs/);assert.equal((await readdir(path.join(B.D,'drift'))).length,1);
 assert.equal(B.go(false).status,3);assert.equal((await readdir(path.join(B.D,'drift'))).length,1,'the same difference is not saved again');
 await writeFile(path.join(B.L,'app','b.js'),'two fixed\n');assert.equal(B.go(false).status,3);assert.equal((await readdir(path.join(B.D,'drift'))).length,2);
 const r3=B.go(true);assert.equal(r3.status,0);assert.match(r3.stdout,/FORCE=1: going on/)});
await t('drift becomes one Needs-you item per pending patch, naming the files; filed once; not for fixer patches',async()=>{const D=await mkdtemp(path.join(tmpdir(),'cc-'));
 await mkdir(path.join(D,'drift'));await mkdir(path.join(D,'fixer-patches'));
 await writeFile(path.join(D,'drift','20261111-083106.patch'),'# Changed on the live box\n--- app/k.mjs\t1\n+++ app/k.mjs\t2\n@@ -1 +1 @@\n-a\n+b\n');
 await writeFile(path.join(D,'fixer-patches','i1-try1.patch'),'--- app/x.mjs\n+++ app/x.mjs\n@@ -1 +1 @@\n-a\n+b\n');
 const got=[];const C=createCodeChanges({DATA:D,fileIssue:async o=>{got.push(o)}});
 assert.equal(await C.raise(),1);assert.equal(await C.raise(),0);assert.equal(got.length,1);
 assert.equal(got[0].healthKey,'drift:20261111-083106.patch');assert.match(got[0].missing,/app\/k\.mjs/);assert.ok(got[0].hold&&got[0].source==='health');
 assert.equal(await createCodeChanges({DATA:D}).raise(),0)});
await t('drift guard: no copy of what the box ran yet: it says so and goes on',async()=>{const B=await box();execFileSync('rm',[path.join(B.L,'.deployed.tgz')]);
 assert.match(B.run(),/no copy of what the box ran yet/)});

await t('Health list: drift and fixer patches, newest first, view and "taken into git"',async()=>{const D=await mkdtemp(path.join(tmpdir(),'cc-'));
 await mkdir(path.join(D,'drift'));await mkdir(path.join(D,'fixer-patches'));
 await writeFile(path.join(D,'drift','20261107-100000.patch'),'# Changed on the live box\n--- app/k.mjs\n+++ app/k.mjs\n@@ -1 +1 @@\n-a\n+b\n');
 await new Promise(r=>setTimeout(r,20));await writeFile(path.join(D,'fixer-patches','i5b25e818-try1.patch'),'# aqeelOS fixer, issue i5b25e818\n--- a/app/x.mjs\n+++ b/app/x.mjs\n');
 await writeFile(path.join(D,'drift','notes.txt'),'x');const C=createCodeChanges({DATA:D});
 const l=await C.list();assert.deepEqual(l.map(x=>[x.kind,x.name,x.issue]),[['fixer','i5b25e818-try1.patch','i5b25e818'],['drift','20261107-100000.patch',null]]);
 assert.deepEqual(l[1].files,['app/k.mjs']);assert.match(l[0].note,/issue i5b25e818/);
 assert.match(await C.read('drift','20261107-100000.patch'),/\+b/);await assert.rejects(C.read('drift','../issues.json'),/Unknown patch/);await assert.rejects(C.read('x','a.patch'),/Unknown kind/);
 await C.done('drift','20261107-100000.patch');assert.deepEqual((await C.list()).map(x=>x.kind),['fixer']);assert.deepEqual(await readdir(path.join(D,'drift','done')),['20261107-100000.patch'])});

const LINE={phoneNumberId:'1122',testers:[{who:'Abel',conversationId:'cnv_A'},{who:'Team (3124)',conversationId:'cnv_T',phone:'+62 8000-0000-002'}]};
await t('tester webhook: signed like Kirimdev, read back as that tester on that line',async()=>{const tr=pickTester(LINE);assert.equal(tr.who,'Team (3124)','only a tester with a phone');
 const w=testWebhook({line:LINE,tester:tr,text:'reset',now:1_800_000_000_000,id:'aqtest-1'});
 assert.ok(verifySignature(w.raw,sign(w.raw,'sek',w.ts),['sek'],w.ts));assert.equal(verifySignature(w.raw,sign(w.raw,'other',w.ts),['sek'],w.ts),false);
 const [m]=parseInbound(JSON.parse(w.raw));assert.deepEqual({pid:m.pid,from:m.from,text:m.text,conversationId:m.conversationId,ts:m.ts},{pid:'1122',from:'6280000000002',text:'reset',conversationId:'cnv_T',ts:1_800_000_000});
 assert.throws(()=>pickTester(LINE,'Abel'),/No tester called Abel with a phone/);assert.throws(()=>pickTester({testers:[]}),/no tester with a phone/)});
await t('the tester webhook runs only on test agents (owner, 8 Nov 2026: no live tests on real agents)',async()=>{
 const l=testAgents('# test copies\nmb-z4b1u\n  lt-1  # ladder\n');assert.deepEqual([...l],['mb-z4b1u','lt-1']);assert.equal(l.has('pixel-agent'),false);
 const {execFile}=await import('node:child_process');const home=await mkdtemp(path.join(tmpdir(),'hh-'));await writeFile(path.join(home,'.aqeelos-test-agents'),'mb-z4b1u\n');
 const r=await new Promise(res=>execFile(process.execPath,[new URL('./kirimdev-test-message.mjs',import.meta.url).pathname,'continue-support','hi'],{env:{...process.env,HERMES_HOME:home,UI_DATA_DIR:home}},(e,o,er)=>res({code:e?.code,er})));
 assert.equal(r.code,1);assert.match(r.er,/real agent: no live tests on real agents/)});
console.log(n+' passed');
