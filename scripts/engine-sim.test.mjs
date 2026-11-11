// The engine update check in every deploy (ENG-3, scripts/engine-sim.sh): a clean update of the live engine's commit plus
// the patch steps must give the live engine as it is right after the deploy. Runs the real script on a fake engine (a git
// repo) with a stand-in patch step. Linux and macOS only (the script runs on the box).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,cpSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';

const SCRIPT=new URL('./engine-sim.sh',import.meta.url).pathname;
const skip=process.platform==='win32'?'the check runs on the box (bash, git, Linux paths)':false;

// a fake install: HOME/.hermes/hermes-agent (git, files a.py and b.py committed) and an aqeelOS folder whose only patch step
// adds a line to b.py (skipped when it is there already, like the real steps)
function box(){const H=mkdtempSync(path.join(tmpdir(),'engsim-')),E=path.join(H,'.hermes','hermes-agent'),R=path.join(H,'aq');
 mkdirSync(E,{recursive:true});writeFileSync(path.join(E,'a.py'),'a = 1\n');writeFileSync(path.join(E,'b.py'),'b = 1\n');
 const git=(...a)=>execFileSync('git',['-C',E,'-c','user.email=t@t','-c','user.name=t',...a],{stdio:'pipe'});
 git('init','-q');git('add','-A');git('commit','-qm','engine');
 mkdirSync(path.join(R,'scripts'),{recursive:true});mkdirSync(path.join(R,'app'));mkdirSync(path.join(R,'engine','patches'),{recursive:true});
 writeFileSync(path.join(R,'app','install.mjs'),"export const publicUrl=()=>'http://x'\n");
 writeFileSync(path.join(R,'scripts','apply-skill-patches.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';
const f=process.env.HOME+'/.hermes/hermes-agent/b.py';const s=readFileSync(f,'utf8');if(!s.includes('patched'))writeFileSync(f,s+'patched = True\\n');\n`);
 const steps=()=>{const f=path.join(E,'b.py');writeFileSync(f,readFileSync(f,'utf8')+'patched = True\n')};
 const run=()=>{const r=spawnSync('bash',[SCRIPT,R],{env:{...process.env,HOME:H},encoding:'utf8'});return {code:r.status,out:r.stdout+r.stderr}};
 return {H,E,R,steps,run}}

test('the live engine is what an update plus the patch steps gives: passes',{skip},()=>{const b=box();b.steps();
 const r=b.run();assert.equal(r.code,0,r.out);assert.match(r.out,/✓ engine update check/)});

test('a patch step this deploy brings that the live engine lacks yet is no difference',{skip},()=>{const b=box();
 const r=b.run();assert.equal(r.code,0,r.out)});

test('a hand edit on the live engine that no step carries fails, with the file name',{skip},()=>{const b=box();b.steps();
 writeFileSync(path.join(b.E,'a.py'),'a = 2  # fixed by hand\n');
 const r=b.run();assert.equal(r.code,1,r.out);assert.match(r.out,/1 engine file\(s\)/);assert.match(r.out,/^  a\.py$/m);assert.doesNotMatch(r.out,/b\.py/)});

test('a file added by hand on the live engine fails too; a removed one as well',{skip},()=>{const b=box();b.steps();
 mkdirSync(path.join(b.E,'gateway'));writeFileSync(path.join(b.E,'gateway','extra.py'),'x = 1\n');
 let r=b.run();assert.equal(r.code,1,r.out);assert.match(r.out,/gateway\/extra\.py/);
 execFileSync('rm',[path.join(b.E,'gateway','extra.py'),path.join(b.E,'a.py')]);
 r=b.run();assert.equal(r.code,1,r.out);assert.match(r.out,/^  a\.py$/m)});

test('a known difference is reported but passes',{skip},()=>{const b=box();b.steps();
 writeFileSync(path.join(b.E,'a.py'),'a = 2\n');writeFileSync(path.join(b.R,'engine','patches','known-differences.txt'),'# note\na.py  # the repo is newer\n');
 const r=b.run();assert.equal(r.code,0,r.out);assert.match(r.out,/known: a\.py/)});

test('the live engine is never written: only /tmp',{skip},()=>{const b=box();writeFileSync(path.join(b.E,'a.py'),'a = 2\n');
 b.run();assert.equal(readFileSync(path.join(b.E,'b.py'),'utf8'),'b = 1\n');assert.equal(readFileSync(path.join(b.E,'a.py'),'utf8'),'a = 2\n');
 assert.equal(existsSync(path.join(b.H,'.hermes','.aqeelos-patch.lock')),false)});

test('no engine git copy: skipped, never a failure',{skip},()=>{const H=mkdtempSync(path.join(tmpdir(),'engsim-'));
 const r=spawnSync('bash',[SCRIPT,H],{env:{...process.env,HOME:H},encoding:'utf8'});assert.equal(r.status,0);assert.match(r.stdout,/skipped/)});
