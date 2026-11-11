// Which of an ordered list of engine patches are already in an engine checkout (12 Nov 2026). Patches layer: a later one
// can change the same lines as an earlier one (delivery-probe-document on delivery-probe), and then the earlier can no
// longer be reverse-checked on the live files, although it IS in. So the whole list is decided together, newest first, on
// a scratch copy of only the files the patches touch: a patch that reverse-applies is in, and is taken out of the copy
// before the next older one is looked at. Nothing under the engine is written. Used by apply-skill-patches.mjs (17b).
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

// the engine paths a patch touches. Both kinds of patch are in engine/patches: git's (diff --git a/<x> b/<y>, renames count)
// and plain unified diffs (only --- a/<x> and +++ b/<y>; four of the 12 Nov patches are these)
export function patchPaths(text){const s=new Set();
 for(const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)){s.add(m[1]);s.add(m[2])}
 for(const m of text.matchAll(/^(?:---|\+\+\+) [ab]\/([^\t\n]+)/gm))s.add(m[1].trimEnd());
 return [...s]}

// files: absolute patch paths, oldest first. Returns [{file, inPlace}] in the same order.
export function layerState(engine,files){
 const texts=files.map(f=>readFileSync(f,'utf8')),all=new Set(texts.flatMap(patchPaths));
 const S=mkdtempSync(path.join(tmpdir(),'aq-layers-'));
 try{execFileSync('git',['init','-q',S],{stdio:'pipe'});
  for(const p of all){const src=path.join(engine,p);if(!existsSync(src))continue;mkdirSync(path.dirname(path.join(S,p)),{recursive:true});copyFileSync(src,path.join(S,p))}
  const g=a=>execFileSync('git',['-C',S,...a],{stdio:'pipe'});
  const out=files.map(file=>({file,inPlace:false}));
  for(let i=files.length-1;i>=0;i--){
   // a patch that names no file cannot be followed on the scratch copy: it is looked at on the engine itself, as before
   if(!patchPaths(texts[i]).length){try{execFileSync('git',['-C',engine,'apply','--reverse','--check',files[i]],{stdio:'pipe'});out[i].inPlace=true}catch{}continue}
   try{g(['apply','--reverse','--check',files[i]]);g(['apply','--reverse',files[i]]);out[i].inPlace=true}catch{}}
  return out}
 finally{rmSync(S,{recursive:true,force:true})}}

// Brings every patch in: those in place are left, the rest are applied oldest first, each all or nothing.
// Returns {inPlace, applied, misfit} (file names).
export function applyLayers(engine,files){
 const g=a=>execFileSync('git',['-C',engine,...a],{stdio:'pipe'}),r={inPlace:[],applied:[],misfit:[]};
 for(const {file,inPlace} of layerState(engine,files)){const f=path.basename(file);
  if(inPlace){r.inPlace.push(f);continue}
  try{g(['apply','--check',file]);g(['apply',file]);r.applied.push(f)}catch{r.misfit.push(f)}}
 return r}
