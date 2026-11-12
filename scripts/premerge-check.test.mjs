// The pre-merge check (scripts/premerge-check.mjs) finds what it is meant to find, and nothing in the real repo today.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {conflictMarkers,lostBackslash,regexLiterals,strippedPairs,yamlLight,check,MAX_BYTES} from './premerge-check.mjs';
const R=String.raw,O='<'.repeat(7),M='='.repeat(7),C='>'.repeat(7);

test('conflict markers: both ends are found; a lone underline in Markdown is not', () => {
 assert.deepEqual(conflictMarkers(`a\n${O} HEAD\nb\n${M}\nc\n${C} main\n`),[2,4,6]);
 assert.deepEqual(conflictMarkers(`Title\n${M}\ntext\n`),[]);
 assert.deepEqual(conflictMarkers(`x ${O} not at the start\n`),[]);
 assert.deepEqual(conflictMarkers(`${O}\r\nx\r\n${C}\r\n`),[1,3])});

test('lost backslashes: the real case of 12 Nov is caught, the correct form is not', () => {
 const bad="const m=txt.match(/^s*ssh_user:s*['\"]?(ag-[w-]+)/m);";
 const good=R`const m=txt.match(/^\s*ssh_user:\s*['"]?(ag-[\w-]+)/m);`;
 assert.ok(lostBackslash(bad));assert.equal(lostBackslash(good),null);
 for(const l of [R`x.replace(/d+/g,'')`,R`/^s+$/.test(a)`,R`const r=/[w.-]+@[w.-]+/;`,R`if(/key:s*x/.test(a))`])assert.ok(lostBackslash(l),l);
 for(const l of [R`/^(cat|dog)s?$/.test(a)`,R`/\d+/.test(a)`,"const s='/^s*/'","// /^s*/ is a comment",R`a/b/c`,R`x=a/ d+ /b`,R`/[a-z0-9_-]+/i.test(a)`,R`/files?$/`])assert.equal(lostBackslash(l),null,l)});

test('regex literals are found after ( , = : and return, not inside strings or division', () => {
 assert.deepEqual(regexLiterals(R`f(/a\/b/g, 1)`),[R`a\/b`]);
 assert.deepEqual(regexLiterals(R`return /x[/]y/.test(v)`),[R`x[/]y`]);
 assert.deepEqual(regexLiterals(`const s="/no/"`),[]);
 assert.deepEqual(regexLiterals(`const q=a/b+c/d`),[])});

test('the diff rule: an added line equal to a removed line minus its backslashes', () => {
 const d=['+++ b/app/x.mjs','@@ -3,1 +3,1 @@',R`-const m=t.match(/^\s*ssh_user:\s*(ag-[\w-]+)/m);`,'+const m=t.match(/^s*ssh_user:s*(ag-[w-]+)/m);'].join('\n');
 const h=strippedPairs(d);assert.equal(h.length,1);assert.equal(h[0].file,'app/x.mjs');
 assert.deepEqual(strippedPairs(['+++ b/a.mjs','@@ -1 +1 @@','-let a=1;','+let a=2;'].join('\n')),[])});

test('light YAML check', () => {
 assert.deepEqual(yamlLight('a: 1\nb:\n  - x\n  - y: [1, 2]\nc: |\n  [ not checked\n  text\nd: "q"\n'),[]);
 assert.equal(yamlLight('a:\n\tb: 1\n').length,1);assert.equal(yamlLight('a: [1, 2\nb: "x"\n').length,0);assert.equal(yamlLight('a: [1, 2]]\n').length,1)});

function tree(files){const d=mkdtempSync(path.join(os.tmpdir(),'pmc-'));for(const [f,t] of Object.entries(files)){mkdirSync(path.dirname(path.join(d,f)),{recursive:true});writeFileSync(path.join(d,f),t)}return d}
const bashOk=spawnSync('bash',['-c','echo ok'],{encoding:'utf8'}).stdout?.includes('ok');

test('a clean tree passes; each planted problem fails with its file', async () => {
 const clean=tree({'app/a.mjs':'export const a=1;\n','app/b.js':'var b=2;\n','x.json':'{"a":1}','w.yml':'a: 1\nb:\n  - c\n','README.md':'Title\n=======\n\ntext\n'});
 try{const r=await check({root:clean});assert.deepEqual(r.fails,[])}finally{rmSync(clean,{recursive:true,force:true})}
 const files={'app/syntax.mjs':'export const a=;\n','app/ok.js':'var b=2;\n','bad.json':'{"a":1,}','notes.md':`x\n${O} HEAD\ny\n${M}\nz\n${C} other\n`,'app/rx.mjs':"export const r=/^s*a:s*(b)/;\n",'big.txt':'x'.repeat(MAX_BYTES+1),'app/x.orig':'old','bad.yml':'a: [1, 2\nb:\n\t- c\n'};
 if(bashOk)files['s.sh']='if then\n';
 const d=tree(files);
 try{const r=await check({root:d}),by=Object.fromEntries(r.fails.map(f=>[f.file.split(':')[0],f.rule]));
  assert.equal(by['app/syntax.mjs'],'parse');assert.equal(by['bad.json'],'parse');assert.equal(by['notes.md'],'conflict');assert.equal(by['app/rx.mjs'],'backslash');assert.equal(by['big.txt'],'size');assert.equal(by['app/x.orig'],'scratch');assert.equal(by['bad.yml'],'parse');
  if(bashOk)assert.equal(by['s.sh'],'parse');assert.equal(by['app/ok.js'],undefined)}finally{rmSync(d,{recursive:true,force:true})}});

test('this repo passes today (no false positive)', async () => {
 const r=await check({});assert.deepEqual(r.fails.map(f=>f.rule+' '+f.file+' '+f.msg),[])});
