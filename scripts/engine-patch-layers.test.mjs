// Layered engine patches (12 Nov 2026): a later patch on the same lines as an earlier one must not make the earlier one
// look "not in this engine version". A throwaway git repo and two patches on the same line; a real misfit still counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyLayers,layerState,patchPaths} from './engine-patch-layers.mjs';

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
