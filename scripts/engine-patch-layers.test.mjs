// Layered engine patches (12 Nov 2026): a later patch on the same lines as an earlier one must not make the earlier one
// look "not in this engine version". A throwaway git repo and two patches on the same line; a real misfit still counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyLayers,layerState,patchPaths,newFiles,applyFresh,applyWithVariants} from './engine-patch-layers.mjs';

process.env.GIT_CONFIG_COUNT='1';process.env.GIT_CONFIG_KEY_0='core.autocrlf';process.env.GIT_CONFIG_VALUE_0='false';   // a Windows git would write CRLF
const GIT=['-c','core.autocrlf=false','-c','user.email=t@t','-c','user.name=t'];
const BASE='one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
// a clean engine (f.py) and two layered patches: p1 turns "three" into "THREE" and adds a line; p2 turns "THREE" into "3"
function setup(){const T=mkdtempSync(path.join(tmpdir(),'layers-')),E=path.join(T,'engine'),P=path.join(T,'patches');mkdirSync(E);mkdirSync(P);
 const git=(...a)=>execFileSync('git',['-C',E,...GIT,...a],{stdio:'pipe',encoding:'utf8'});
 git('init','-q');writeFileSync(path.join(E,'f.py'),BASE);writeFileSync(path.join(E,'g.py'),'g\n');git('add','-A');git('commit','-qm','engine');
 const mk=(name,edit)=>{writeFileSync(path.join(E,'f.py'),edit(readFileSync(path.join(E,'f.py'),'utf8')));writeFileSync(path.join(P,name),git('diff'));git('commit','-qam',name);return path.join(P,name)};
 const p1=mk('2026-11-11-a.patch',s=>s.replace('three','THREE').replace('seven','seven\nextra'));
 const p2=mk('2026-11-12-b.patch',s=>s.replace('THREE','3'));
 git('reset','-q','--hard','HEAD~2');
 return {T,E,P,p1,p2,git,f:()=>readFileSync(path.join(E,'f.py'),'utf8'),done:()=>rmSync(T,{recursive:true,force:true})}}
const LAYERED=BASE.replace('three','3').replace('seven','seven\nextra');

test('patchPaths lists the files a patch touches',()=>{const s=setup();
 assert.deepEqual(patchPaths(readFileSync(s.p1,'utf8')),['f.py']);s.done()});

test('both layers in: both are in place, nothing is applied or changed (the 11 Nov false warning)',()=>{const s=setup();
 writeFileSync(path.join(s.E,'f.py'),LAYERED);
 assert.deepEqual(layerState(s.E,[s.p1,s.p2]).map(x=>x.inPlace),[true,true]);
 const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r,{inPlace:['2026-11-11-a.patch','2026-11-12-b.patch'],applied:[],misfit:[]});
 assert.equal(s.f(),LAYERED);s.done()});

test('a clean engine gets both, oldest first',()=>{const s=setup();
 const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r.applied,['2026-11-11-a.patch','2026-11-12-b.patch']);assert.deepEqual(r.misfit,[]);
 assert.equal(s.f(),LAYERED);s.done()});

test('only the older layer in: the newer one is applied on top',()=>{const s=setup();
 execFileSync('git',['-C',s.E,'-c','core.autocrlf=false','apply',s.p1]);
 const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r,{inPlace:['2026-11-11-a.patch'],applied:['2026-11-12-b.patch'],misfit:[]});
 assert.equal(s.f(),LAYERED);s.done()});

test('a second run changes nothing',()=>{const s=setup();applyLayers(s.E,[s.p1,s.p2]);
 const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r.applied,[]);assert.deepEqual(r.misfit,[]);assert.equal(r.inPlace.length,2);s.done()});

test('a real misfit still counts: upstream changed the lines, nothing is half applied',()=>{const s=setup();
 writeFileSync(path.join(s.E,'f.py'),BASE.replace('three','tres'));
 const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r.applied,[]);assert.deepEqual(r.misfit,['2026-11-11-a.patch','2026-11-12-b.patch']);
 assert.equal(s.f(),BASE.replace('three','tres'));s.done()});

test('the engine is only read while deciding',()=>{const s=setup();writeFileSync(path.join(s.E,'f.py'),LAYERED);
 layerState(s.E,[s.p1,s.p2]);assert.equal(s.f(),LAYERED);assert.equal(s.git('status','--porcelain').trim(),'M f.py');s.done()});

test('plain unified diffs (no diff --git line) layer the same way: in place is decided for the list',()=>{const s=setup();
 const plain=f=>{const x=readFileSync(f,'utf8').split('\n').filter(l=>!/^(diff --git|index )/.test(l)).join('\n');writeFileSync(f,x)};plain(s.p1);plain(s.p2);
 assert.deepEqual(patchPaths(readFileSync(s.p1,'utf8')),['f.py']);assert.deepEqual(patchPaths('--- a/tools/x.py\t2026-11-12\n+++ b/tools/x.py\n').sort(),['tools/x.py']);assert.deepEqual(patchPaths('--- /dev/null\n+++ b/new.py\n'),['new.py']);
 writeFileSync(path.join(s.E,'f.py'),LAYERED);
 assert.deepEqual(layerState(s.E,[s.p1,s.p2]).map(x=>x.inPlace),[true,true]);
 writeFileSync(path.join(s.E,'f.py'),BASE);const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r.applied,['2026-11-11-a.patch','2026-11-12-b.patch']);assert.equal(s.f(),LAYERED);s.done()});

test('a newer engine: the version folder copy is used when the original no longer fits, and the original when it does',async()=>{
 const {applyWithVariants}=await import('./engine-patch-layers.mjs');const s=setup();
 // the "new engine" rewrote line three, so p1 no longer applies; its copy for v9.9.9 targets the new text
 writeFileSync(path.join(s.E,'f.py'),BASE.replace('three','tres'));s.git('commit','-qam','new engine');
 const V=path.join(s.P,'v9.9.9');mkdirSync(V);writeFileSync(path.join(s.E,'f.py'),BASE.replace('three','TRES'));writeFileSync(path.join(V,path.basename(s.p1)),s.git('diff'));s.git('checkout','-q','f.py');
 const r=applyWithVariants(s.E,[s.p1],f=>[path.join(V,path.basename(f))]);
 assert.deepEqual(r.applied,[path.basename(s.p1)]);assert.deepEqual(r.misfit,[]);assert.equal(r.variant[path.basename(s.p1)],'v9.9.9');assert.match(s.f(),/TRES/);
 const again=applyWithVariants(s.E,[s.p1],f=>[path.join(V,path.basename(f))]);assert.deepEqual([again.applied,again.misfit],[[],[]],'in place the second time');
 s.done()});

test('the original wins on the engine it was written for; no copy fits means a misfit',async()=>{
 const {applyWithVariants}=await import('./engine-patch-layers.mjs');const s=setup();
 const r=applyWithVariants(s.E,[s.p1],()=>[s.p2]);assert.deepEqual(r.variant,{});assert.deepEqual(r.applied,[path.basename(s.p1)]);s.done();
 const t=setup();writeFileSync(path.join(t.E,'f.py'),'all\nnew\n');t.git('commit','-qam','x');
 const m=applyWithVariants(t.E,[t.p1],()=>[t.p2]);assert.deepEqual(m.misfit,[path.basename(t.p1)]);t.done()});

test('an empty copy for a version means upstream does it there: in place, nothing applied',async()=>{
 const {applyWithVariants}=await import('./engine-patch-layers.mjs');const s=setup();
 writeFileSync(path.join(s.E,'f.py'),'all\nnew\n');s.git('commit','-qam','x');const V=path.join(s.P,'v9.9.9');mkdirSync(V);writeFileSync(path.join(V,path.basename(s.p1)),'# upstream does this since v9.9.9\n');
 const r=applyWithVariants(s.E,[s.p1],f=>[path.join(V,path.basename(f))]);assert.deepEqual([r.applied,r.misfit,r.inPlace],[[],[],[path.basename(s.p1)]]);assert.equal(s.f(),'all\nnew\n');s.done()});

// 21 Nov 2026 (Elkiya): an engine update reset the tracked files (git checkout -- .) and left the patch's own new file, so
// git apply said "already exists" and the patch's edits to tracked files never came back
test('a patch whose new file was left behind by a reset is applied again; a real misfit keeps the file',()=>{
 const T=mkdtempSync(path.join(tmpdir(),'fresh-')),E=path.join(T,'engine');mkdirSync(E);
 const git=(...a)=>execFileSync('git',['-C',E,...GIT,...a],{stdio:'pipe',encoding:'utf8'});
 try{git('init','-q');writeFileSync(path.join(E,'f.py'),BASE);git('add','-A');git('commit','-qm','engine');
  writeFileSync(path.join(E,'f.py'),BASE.replace('three','THREE'));writeFileSync(path.join(E,'new.py'),'added\n');git('add','-A');
  const P=path.join(T,'2026-11-11-x.patch');writeFileSync(P,git('diff','--cached'));git('reset','-q');
  assert.deepEqual(newFiles(readFileSync(P,'utf8')),['new.py']);
  git('checkout','--','.');   // the reset: f.py back to clean, new.py stays
  assert.equal(readFileSync(path.join(E,'f.py'),'utf8'),BASE);
  const r=applyWithVariants(E,[P]);assert.deepEqual(r.applied,['2026-11-11-x.patch'],JSON.stringify(r));
  assert.match(readFileSync(path.join(E,'f.py'),'utf8'),/THREE/);assert.equal(readFileSync(path.join(E,'new.py'),'utf8'),'added\n');
  // a real misfit: f.py changed upstream; the left file is put back untouched
  git('checkout','--','.');writeFileSync(path.join(E,'f.py'),'other\n');writeFileSync(path.join(E,'new.py'),'mine\n');
  assert.equal(applyFresh(E,P),false);assert.equal(readFileSync(path.join(E,'new.py'),'utf8'),'mine\n');
 }finally{rmSync(T,{recursive:true,force:true})}});

test('a left-behind file that later layers also changed gets every layer back',()=>{
 const T=mkdtempSync(path.join(tmpdir(),'fresh2-')),E=path.join(T,'engine');mkdirSync(E);
 const git=(...a)=>execFileSync('git',['-C',E,...GIT,...a],{stdio:'pipe',encoding:'utf8'});
 try{git('init','-q');writeFileSync(path.join(E,'f.py'),BASE);git('add','-A');git('commit','-qm','engine');
  const mk=(name,fn)=>{fn();git('add','-A');const P=path.join(T,name);writeFileSync(P,git('diff','--cached'));git('commit','-qm',name);return P};
  const p1=mk('2026-11-11-a.patch',()=>{writeFileSync(path.join(E,'f.py'),BASE.replace('two','TWO'));writeFileSync(path.join(E,'w.js'),'a\nb\nc\n')});
  const p2=mk('2026-11-12-b.patch',()=>writeFileSync(path.join(E,'w.js'),'a\nB\nc\n'));
  const fin=readFileSync(path.join(E,'w.js'),'utf8');
  git('checkout','-q','HEAD~2','--','f.py');git('rm','-q','--cached','w.js');git('commit','-qm','back to clean');   // the clean engine, w.js left untracked
  assert.equal(readFileSync(path.join(E,'w.js'),'utf8'),fin);
  const r=applyLayers(E,[p1,p2]);assert.deepEqual(r.applied,['2026-11-11-a.patch','2026-11-12-b.patch'],JSON.stringify(r));
  assert.equal(readFileSync(path.join(E,'w.js'),'utf8'),fin);assert.match(readFileSync(path.join(E,'f.py'),'utf8'),/TWO/);
 }finally{rmSync(T,{recursive:true,force:true})}});
