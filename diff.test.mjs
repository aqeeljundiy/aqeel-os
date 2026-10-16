import test from 'node:test';
import assert from 'node:assert/strict';
import {diffLines,hunks,stats} from './diff.mjs';
const apply=(lines)=>({before:lines.filter(l=>l.type!=='add').map(l=>l.text).join('\n'),after:lines.filter(l=>l.type!=='del').map(l=>l.text).join('\n')});
test('diff reproduces both sides and counts changes',()=>{
 const before='a\nb\nc\nd\ne',after='a\nB\nc\nd\nf\ng';const d=diffLines(before,after);const back=apply(d);
 assert.equal(back.before,before);assert.equal(back.after,after);assert.deepEqual(stats(d),{added:3,removed:2});
});
test('added and deleted files, identical files and context collapsing',()=>{
 assert.deepEqual(stats(diffLines(null,'x\ny')),{added:2,removed:0});assert.deepEqual(stats(diffLines('x',null)),{added:0,removed:1});
 assert.deepEqual(stats(diffLines('same\ntext','same\ntext')),{added:0,removed:0});
 const long=Array.from({length:40},(_,i)=>'line '+i);const changed=[...long];changed[20]='CHANGED';
 const h=hunks(diffLines(long.join('\n'),changed.join('\n')),2);assert.equal(h.filter(r=>r.type==='skip').length,2);assert.equal(h.find(r=>r.type==='add').new,21);
});
test('random edits always round-trip',()=>{
 for(let t=0;t<200;t++){const gen=()=>Array.from({length:Math.floor(Math.random()*12)},()=>'abc'[Math.floor(Math.random()*3)]).join('\n');const a=gen(),b=gen();const back=apply(diffLines(a,b));assert.equal(back.before,a);assert.equal(back.after,b)}
});

test('blocks can be reverted one at a time',async()=>{const {markBlocks,blockText,revertBlock}=await import('./diff.mjs');
 const before='a\nb\nc\nd\ne',after='a\nB\nc\nd\nE\nf';const lines=diffLines(before,after);assert.equal(markBlocks(lines),2);
 assert.equal(revertBlock(lines,0),'a\nb\nc\nd\nE\nf');assert.equal(revertBlock(lines,1),'a\nB\nc\nd\ne');
 assert.equal(blockText(lines,0),'-b\n+B');});
