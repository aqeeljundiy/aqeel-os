// The box launcher in git (scripts/services.sh, 12 Nov 2026) and its installer (scripts/services-install.sh). The launcher runs with
// a stand-in tmux that only records the sessions it is asked to start. Needs bash, so it runs on Linux/macOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,chmodSync,copyFileSync,statSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';

const skip=process.platform==='win32'?'bash scripts, run on the box':false;
const SCR=new URL('.',import.meta.url).pathname;
const sh=f=>path.join(SCR,f);
// install names the launcher must never carry; the values are built here, so this file stays clean
const PRIVATE_NAMES=new RegExp(['elk'+'iya','pixel'+'and'+'profits'].join('|'),'i');

// a fake home: stand-ins for tmux (has-session says no, new-session is recorded), Xvfb, pgrep and sleep
function home({tmuxFails=false}={}){const H=mkdtempSync(path.join(tmpdir(),'svc-')),bin=path.join(H,'bin'),log=path.join(H,'tmux.log');
 mkdirSync(bin);mkdirSync(path.join(H,'.hermes'));mkdirSync(path.join(H,'apps','hermes-ui-data'),{recursive:true});writeFileSync(path.join(H,'.hermes','.env'),'API_SERVER_KEY=secret-value\n');
 writeFileSync(path.join(H,'apps','hermes-ui.env'),'UI_PORT=4400\nCODE_HOST=code.example.test\nCODE_PREVIEW_HOST="code-preview.example.test"\n');
 const stub=(n,b)=>{writeFileSync(path.join(bin,n),'#!/bin/bash\n'+b+'\n');chmodSync(path.join(bin,n),0o755)};
 stub('tmux',`case "$1" in has-session) exit 1;; new-session) echo "$4|$5" >> ${log}; ${tmuxFails?'exit 1':'exit 0'};; esac`);stub('Xvfb','exit 0');stub('pgrep','exit 0');stub('sleep','exit 0');
 const sessions=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(l=>l.split('|')[0]):[];
 const cmd=n=>(readFileSync(log,'utf8').split('\n').find(l=>l.startsWith(n+'|'))||'').slice(n.length+1);
 const run=(extra={})=>{const r=spawnSync('bash',[sh('services.sh')],{env:{PATH:bin+':'+process.env.PATH,HOME:H,...extra},encoding:'utf8'});return {code:r.status,out:r.stdout+r.stderr}};
 return {H,data:path.join(H,'apps','hermes-ui-data'),sessions,cmd,run}}

test('services.sh parses and ends in exit 0, with no set -e and no optional start left as a bare "test && start"',{skip},()=>{
 assert.equal(spawnSync('bash',['-n',sh('services.sh')]).status,0);const s=readFileSync(sh('services.sh'),'utf8');
 assert.match(s.trimEnd().split('\n').pop(),/^exit 0$/);assert.doesNotMatch(s,/^\s*set -e/m);assert.doesNotMatch(s,/^\s*\[ .* \] && start /m)});

test('a plain box: the core sessions only, nothing optional',{skip},()=>{const h=home();const r=h.run();
 assert.equal(r.code,0,r.out);assert.deepEqual(h.sessions(),['xvfb','wm','vnc','novnc','gateway','dashboard','ui']);
 assert.match(h.cmd('ui'),/hermes-ui\/app\/server\.mjs/);assert.match(h.cmd('gateway'),/env -u DISPLAY hermes -p default gateway/)});

test('detected per install: own-AdsPower agents give the bridge, a nightly script the nightly restart, online Code only its marker',{skip},()=>{const h=home();
 writeFileSync(path.join(h.data,'agent-adspower.json'),'{}');writeFileSync(path.join(h.H,'nightly-engine-restart.sh'),'#!/bin/bash\n');chmodSync(path.join(h.H,'nightly-engine-restart.sh'),0o755);
 let r=h.run();assert.equal(r.code,0,r.out);assert.deepEqual(h.sessions(),['xvfb','wm','vnc','novnc','adspower-bridge','gateway','dashboard','ui','nightly']);
 const h2=home();writeFileSync(path.join(h2.H,'.aqeelos-online-code'),'on\n');r=h2.run();assert.equal(r.code,0,r.out);assert.ok(h2.sessions().includes('code'));
 assert.match(h2.cmd('code'),/CBA_PUBLIC_APP=https:\/\/code\.example\.test CBA_PUBLIC_PREVIEW=https:\/\/code-preview\.example\.test node --max-old-space-size=2048 server\.mjs/);
 assert.match(h2.cmd('code'),/env -i HOME=\$HOME PATH=/,'a clean environment: the box secrets stay out');assert.ok(!h2.sessions().includes('nightly'))});

test('services.conf decides over detection, in both directions',{skip},()=>{const h=home();
 writeFileSync(path.join(h.data,'agent-adspower.json'),'{}');writeFileSync(path.join(h.data,'services.conf'),'adspower-bridge=off\nnightly=on\n');
 const r=h.run();assert.equal(r.code,0,r.out);const s=h.sessions();assert.ok(!s.includes('adspower-bridge'));assert.ok(s.includes('nightly'))});

test('the code hosts are only ever host names: a bad value falls back and never reaches the command line',{skip},()=>{const h=home();
 writeFileSync(path.join(h.H,'apps','hermes-ui.env'),'CODE_HOST=x.test;rm -rf ~\nCODE_PREVIEW_HOST=\n');writeFileSync(path.join(h.H,'.aqeelos-online-code'),'on\n');
 const r=h.run();assert.equal(r.code,0,r.out);assert.match(h.cmd('code'),/CBA_PUBLIC_APP=https:\/\/code\.localhost CBA_PUBLIC_PREVIEW=https:\/\/code-preview\.localhost /)});

test('no optional line can make it exit non-zero: tmux failing, no engine env, no data folder, no hermes-ui.env, a broken .env',{skip},()=>{
 const h=home({tmuxFails:true});let r=h.run();assert.equal(r.code,0,r.out);assert.match(r.out,/could not start ui/);
 const g=home();rmSync(path.join(g.H,'.hermes','.env'),{force:true});rmSync(path.join(g.H,'apps','hermes-ui.env'),{force:true});
 r=g.run({UI_DATA_DIR:path.join(g.H,'nowhere')});assert.equal(r.code,0,r.out);assert.ok(g.sessions().includes('ui'));
 const k=home();writeFileSync(path.join(k.H,'.aqeelos-online-code'),'on\n');writeFileSync(path.join(k.H,'.hermes','.env'),'BAD LINE (\n');r=k.run();assert.equal(r.code,0,r.out)});

test('the launcher holds no secret value and no install-specific name (they live in the env files and the data folder)',()=>{const s=readFileSync(sh('services.sh'),'utf8');
 assert.doesNotMatch(s,/(KEY|TOKEN|SECRET|PASSWORD)=[^$\s\\"]/);assert.doesNotMatch(s+readFileSync(sh('services-legacy.sha256'),'utf8'),PRIVATE_NAMES)});

// ---- the installer
const sha=t=>createHash('sha256').update(t).digest('hex');
const NEW='#!/bin/bash\n# v2\nexit 0\n';
function box(){const H=mkdtempSync(path.join(tmpdir(),'svci-')),A=path.join(H,'apps','hermes-ui'),D=path.join(H,'apps','hermes-ui-data');mkdirSync(path.join(A,'scripts'),{recursive:true});mkdirSync(D,{recursive:true});
 copyFileSync(sh('services-install.sh'),path.join(A,'scripts','services-install.sh'));writeFileSync(path.join(A,'scripts','services-legacy.sha256'),'# note\n');
 const put=(f,t)=>writeFileSync(path.join(A,'scripts',f),t);put('services.sh',NEW);
 const run=(env={})=>{const r=spawnSync('bash',[path.join(A,'scripts','services-install.sh')],{env:{...process.env,HOME:H,...env},encoding:'utf8'});return {code:r.status,out:r.stdout+r.stderr}};
 const mine=()=>readFileSync(path.join(H,'services.sh'),'utf8'),baks=()=>readdirSync(H).filter(f=>f.startsWith('services.sh.bak-'));
 return {H,A,D,put,run,mine,baks,shipped:()=>readFileSync(path.join(D,'services.shipped'),'utf8')}}

test('installer: no launcher on the box yet: installed, executable, recorded as shipped',{skip},()=>{const b=box();const r=b.run();
 assert.equal(r.code,0,r.out);assert.equal(b.mine(),NEW);assert.ok(statSync(path.join(b.H,'services.sh')).mode&0o100);assert.equal(b.shipped(),NEW)});

test('installer: the same file: nothing to do',{skip},()=>{const b=box();writeFileSync(path.join(b.H,'services.sh'),NEW);const r=b.run();
 assert.equal(r.code,0);assert.match(r.out,/is the shipped one/);assert.deepEqual(b.baks(),[])});

test('installer: the previously shipped version is replaced, with the diff in the log and a backup',{skip},()=>{const b=box();const old='#!/bin/bash\n# v1\nexit 0\n';
 writeFileSync(path.join(b.H,'services.sh'),old);writeFileSync(path.join(b.D,'services.shipped'),old);const r=b.run();
 assert.equal(r.code,0,r.out);assert.equal(b.mine(),NEW);assert.match(r.out,/previously shipped version/);assert.match(r.out,/-# v1/);assert.match(r.out,/\+# v2/);assert.equal(b.baks().length,1);assert.equal(b.shipped(),NEW)});

test('installer: one of the listed hand-edited originals is replaced and said so',{skip},()=>{const b=box();const orig='#!/bin/bash\n# hand edit\n';
 writeFileSync(path.join(b.A,'scripts','services-legacy.sha256'),'# note\n'+sha(orig)+'  server 1\n');writeFileSync(path.join(b.H,'services.sh'),orig);const r=b.run();
 assert.equal(r.code,0,r.out);assert.equal(b.mine(),NEW);assert.match(r.out,/original hand-edited version/)});

test('installer: a box-specific edit is never overwritten (drift, the diff, exit 0); SERVICES_ADOPT=1 replaces it after showing it',{skip},()=>{const b=box();const edit='#!/bin/bash\n# my own line\nexit 0\n';
 writeFileSync(path.join(b.H,'services.sh'),edit);writeFileSync(path.join(b.D,'services.shipped'),'#!/bin/bash\n# v1\n');let r=b.run();
 assert.equal(r.code,0,r.out);assert.equal(b.mine(),edit);assert.match(r.out,/services\.sh drift/);assert.match(r.out,/-# my own line/);assert.match(r.out,/SERVICES_ADOPT=1/);assert.deepEqual(b.baks(),[]);
 r=b.run({SERVICES_ADOPT:'1'});assert.equal(r.code,0,r.out);assert.equal(b.mine(),NEW);assert.match(r.out,/drift/);assert.match(r.out,/replaced after showing the diff/);assert.equal(readFileSync(path.join(b.H,b.baks()[0]),'utf8'),edit)});

test('installer: a shipped launcher that does not parse leaves the box alone and still exits 0',{skip},()=>{const b=box();b.put('services.sh','if then fi (\n');writeFileSync(path.join(b.H,'services.sh'),'old\n');
 const r=b.run();assert.equal(r.code,0);assert.equal(b.mine(),'old\n');assert.match(r.out,/does not parse/)});

test('the two servers\' original launchers are listed by hash',()=>{const l=readFileSync(sh('services-legacy.sha256'),'utf8');
 assert.equal(l.split('\n').filter(x=>/^[0-9a-f]{64} /.test(x)).length,2)});
