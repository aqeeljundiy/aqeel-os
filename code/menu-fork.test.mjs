// Owner, 15 Nov 2026: a menu opened with the mouse showed its first item ringed and grey ("I don't like it"), and a fork was a plain row
// titled "Fork of …" ("hard to identify what's a fork"). A menu starts on its first item only from the keyboard; a fork sits under its chat.
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const kit=await readFile(new URL('./ui-kit.js',import.meta.url),'utf8'),side=await readFile(new URL('./sidebar.js',import.meta.url),'utf8'),css=await readFile(new URL('./studio.css',import.meta.url),'utf8');
test('a menu lights up its first item only when it was opened from the keyboard; arrows still start at the top or the bottom',()=>{
 assert.doesNotMatch(kit,/\n menu\.querySelector\('\.ctx-item:not\(:disabled\)'\)\?\.focus\(\{preventScroll:true\}\);\n/,'no unconditional focus on the first item');
 assert.match(kit,/if\(byKey\)menu\.querySelector\('\.ctx-item:not\(:disabled\)'\)\?\.focus\(\{preventScroll:true\}\);else menu\.focus\(\{preventScroll:true\}\)/);
 assert.match(kit,/addEventListener\('pointerdown',\(\)=>\{byKey=false\},true\)/);assert.match(kit,/items\[i<0\?\(e\.key==='ArrowDown'\?0:items\.length-1\)/)});
// forkOrder, taken from the sidebar as written, run on plain data
const forkOrder=new Function('return '+/function forkOrder\(chats\)\{[\s\S]*?return out\}/.exec(side)[0])();
test('each fork follows the chat it came from, forks of forks one step deeper; a fork whose chat is not listed keeps its place',()=>{
 const c=(id,forkedFrom)=>({id,title:id,...(forkedFrom?{forkedFrom}:{})});
 const out=forkOrder([c('a'),c('b'),c('f1','a'),c('f2','f1'),c('x','gone'),c('self','self')]);
 assert.deepEqual(out.map(x=>x.id),['a','f1','f2','b','x','self']);
 assert.deepEqual(out.map(x=>x.forkDepth||0),[0,1,2,0,0,0]);assert.equal(out[1].nestedUnder,'a');assert.equal(out[4].nestedUnder,undefined)});
test('a nested fork shows a branch mark and its name without "Fork of"; one not nested says Fork',()=>{
 assert.match(side,/String\(c\.title\)\.replace\(\/\^\(Fork of \)\+\/,''\)/);assert.match(side,/if\(c\.forkedFrom&&!nested\)b\.append\(el\('span','pin','Fork'\)\)/);
 assert.match(css,/\.tree-chat\.fork \.chat-row\{padding-left:calc\(8px \+ 14px \* var\(--fork-depth,1\)\)/)});
