const fs=require('fs');const p='scripts/engine-patch-layers.mjs';let s=fs.readFileSync(p,'utf8');
const rep=(a,b)=>{if(s.split(a).length!==2)throw Error('nu '+a.slice(0,50));s=s.replace(a,()=>b)};
rep(`// the engine paths a patch touches (diff --git a/<x> b/<y>: both sides, so renames count)
export function patchPaths(text){const s=new Set();
 for(const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)){s.add(m[1]);s.add(m[2])}
 return [...s]}`,`// the engine paths a patch touches. Both kinds of patch are in engine/patches: git's (diff --git a/<x> b/<y>, renames count)
// and plain unified diffs (only --- a/<x> and +++ b/<y>; four of the 12 Nov patches are these)
export function patchPaths(text){const s=new Set();
 for(const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)){s.add(m[1]);s.add(m[2])}
 for(const m of text.matchAll(/^(?:---|\+\+\+) [ab]\/([^\t\n]+)/gm))s.add(m[1].trimEnd());
 return [...s]}`);
rep(`   try{g(['apply','--reverse','--check',files[i]]);g(['apply','--reverse',files[i]]);out[i].inPlace=true}catch{}}`,
`   // a patch that names no file cannot be followed on the scratch copy: it is looked at on the engine itself, as before
   if(!patchPaths(texts[i]).length){try{execFileSync('git',['-C',engine,'apply','--reverse','--check',files[i]],{stdio:'pipe'});out[i].inPlace=true}catch{}continue}
   try{g(['apply','--reverse','--check',files[i]]);g(['apply','--reverse',files[i]]);out[i].inPlace=true}catch{}}`);
fs.writeFileSync(p,s);
let t=fs.readFileSync('scripts/engine-patch-layers.test.mjs','utf8');
t=t.replace("test('patchPaths lists the files a patch touches',()=>{const s=setup();\n assert.deepEqual(patchPaths(readFileSync(s.p1,'utf8')),['f.py']);s.done()});",
"test('patchPaths lists the files a patch touches, for git patches and for plain unified diffs',()=>{const s=setup();\n assert.deepEqual(patchPaths(readFileSync(s.p1,'utf8')),['f.py']);\n assert.deepEqual(patchPaths('--- a/tools/x.py\t2026-11-12\n+++ b/tools/x.py\n@@ -1 +1 @@\n-a\n+b\n').sort(),['tools/x.py']);\n assert.deepEqual(patchPaths('--- /dev/null\n+++ b/new.py\n').sort(),['new.py']);s.done()});");
// plain-diff variant of the layered test
t+=`
test('plain unified diffs (no diff --git line) layer the same way: in place is decided for the list',()=>{const s=setup();
 const plain=f=>{const x=readFileSync(f,'utf8').split('\n').filter(l=>!/^(diff --git|index )/.test(l)).join('\n');writeFileSync(f,x)};plain(s.p1);plain(s.p2);
 writeFileSync(path.join(s.E,'f.py'),LAYERED);
 assert.deepEqual(layerState(s.E,[s.p1,s.p2]).map(x=>x.inPlace),[true,true]);
 writeFileSync(path.join(s.E,'f.py'),BASE);const r=applyLayers(s.E,[s.p1,s.p2]);assert.deepEqual(r.applied,['2026-11-11-a.patch','2026-11-12-b.patch']);assert.equal(s.f(),LAYERED);s.done()});
`;
fs.writeFileSync('scripts/engine-patch-layers.test.mjs',t);
