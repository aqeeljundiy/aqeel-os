// Which of an ordered list of engine patches are already in an engine checkout (12 Nov 2026). Patches layer: a later one
// can change the same lines as an earlier one (delivery-probe-document on delivery-probe), and then the earlier can no
// longer be reverse-checked on the live files, although it IS in. So the whole list is decided together, newest first, on
// a scratch copy of only the files the patches touch: a patch that reverse-applies is in, and is taken out of the copy
// before the next older one is looked at. Nothing under the engine is written. Used by apply-skill-patches.mjs (17b).
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readFileSync,rmSync,renameSync} from 'node:fs';
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

// the files a patch creates (git's "new file mode", or a plain diff from /dev/null)
export function newFiles(text){const s=new Set();
 for(const m of text.matchAll(/^diff --git a\/\S+ b\/(\S+)\nnew file mode/gm))s.add(m[1]);
 for(const m of text.matchAll(/^--- \/dev\/null\n\+\+\+ b\/([^\t\n]+)/gm))s.add(m[1].trimEnd());
 return [...s]}

// git apply of a patch that is not in place, all or nothing (21 Nov 2026). An engine update first resets the engine's tracked
// files (git checkout -- .), which leaves the files our patches created; git apply then refused with "already exists in
// working directory", so on Elkiya five patches lost their edits to tracked files and only their new files stayed. A file the
// patch itself creates that is not tracked by the engine is set aside, the patch is checked and applied, and the files come
// back untouched if it still does not fit. Returns true when applied.
export function applyFresh(engine,file,{checkOnly=false}={}){const g=a=>execFileSync('git',['-C',engine,...a],{stdio:'pipe'});
 try{g(['apply','--check',file]);if(!checkOnly)g(['apply',file]);return true}catch{}
 const tracked=p=>{try{g(['ls-files','--error-unmatch','--',p]);return true}catch{return false}};
 const left=newFiles(readFileSync(file,'utf8')).filter(p=>existsSync(path.join(engine,p))&&!tracked(p));if(!left.length)return false;
 const T=mkdtempSync(path.join(tmpdir(),'aq-aside-')),moved=[];
 try{for(const p of left){const to=path.join(T,String(moved.length));renameSync(path.join(engine,p),to);moved.push([p,to])}
  try{g(['apply','--check',file]);if(checkOnly)return true;g(['apply',file]);for(const [,to] of moved)rmSync(to,{force:true});moved.length=0;return true}catch{return false}}
 finally{for(const [p,to] of moved){try{renameSync(to,path.join(engine,p))}catch{copyFileSync(to,path.join(engine,p))}}rmSync(T,{recursive:true,force:true})}}

// Brings every patch in: those in place are left, the rest are applied oldest first, each all or nothing.
// Returns {inPlace, applied, misfit} (file names).
export function applyLayers(engine,files){
 const r={inPlace:[],applied:[],misfit:[]};
 for(const {file,inPlace} of layerState(engine,files)){const f=path.basename(file);
  if(inPlace){r.inPlace.push(f);continue}
  if(applyFresh(engine,file))r.applied.push(f);else r.misfit.push(f)}
 return r}

// Patches for newer engine versions (21 Nov 2026): engine/patches/<engine version>/<same name>.patch is the same fix written for
// that version's code (v0.23.3 rewrote much of what our 22 Oct patches touched). For each patch the original is used when it is
// in place or applies; otherwise the first version-specific copy that is in place or applies (variantsOf lists them, newest
// engine first); otherwise the original, which then reports as a misfit. Returns applyLayers' answer plus `variant`
// ({name: version folder}) for the ones that came from a version folder.
export function applyWithVariants(engine,files,variantsOf=()=>[]){
 const ok=(args,f)=>{try{execFileSync('git',['-C',engine,'apply',...args,f],{stdio:'pipe'});return true}catch{return false}};
 const st=layerState(engine,files),variant={};
 const chosen=files.map((f,i)=>{if(st[i].inPlace||applyFresh(engine,f,{checkOnly:true}))return f;
  // a copy with no diff in it says "upstream does this itself on that version": in place, nothing to apply
  for(const v of variantsOf(f))if(!patchPaths(readFileSync(v,'utf8')).length&&!/^@@/m.test(readFileSync(v,'utf8'))){variant[path.basename(f)]=path.basename(path.dirname(v))+', upstream';return null}
   else if(ok(['--reverse','--check'],v)||applyFresh(engine,v,{checkOnly:true})){variant[path.basename(f)]=path.basename(path.dirname(v));return v}
  return f});
 const r=applyLayers(engine,chosen.filter(Boolean));r.inPlace.push(...files.filter((f,i)=>!chosen[i]).map(f=>path.basename(f)));return {...r,variant}}
