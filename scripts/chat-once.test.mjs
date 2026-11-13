// Opening a chat sent the same two reads twice within a second (local-browser status, live peek): kit render-check
// "loaded-twice", 13 Nov 2026. Chat.once shares one answer between callers close together. node --test scripts/chat-once.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/chat.js',import.meta.url),'utf8');
const m=src.match(/\n once\(k,fn,keep=1500\)\{[\s\S]*?return e\.p\},\n/);
const Once=new Function(`return {${m[0].trim()}}`)();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('both reads go through once()',()=>{
 assert.match(src,/this\.once\('lb:'\+id,\(\)=>UI\('\/ui\/local-browser\/status/);
 assert.match(src,/peek\(id\)\{return this\.once\('peek:'/)});

test('callers at the same time, or just after, share one read; later callers read again',async()=>{
 let n=0;const fn=()=>new Promise(r=>setTimeout(()=>r(++n),20));
 const [a,b]=await Promise.all([Once.once('x',fn,100),Once.once('x',fn,100)]);
 assert.deepEqual([a,b,n],[1,1,1]);
 assert.equal(await Once.once('x',fn,100),1,'a read finished a moment ago is shared');
 await sleep(130);
 assert.equal(await Once.once('x',fn,100),2,'an older answer is read again');
 assert.equal(await Once.once('y',fn,100),3,'another address is its own read')});

test('a failed read is not kept',async()=>{
 let n=0;await assert.rejects(Once.once('z',async()=>{n++;throw new Error('no')},100));
 assert.equal(await Once.once('z',async()=>++n,100),2)});
