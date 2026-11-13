// /v2 (13 Nov 2026): the same app with the v2 layer; / must stay exactly as it is. node --test scripts/v2-page.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {isV2,v2Html,appPage} from '../app/v2-page.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const index=read('app/index.html');

test('/v2 and /v2/ are the v2 page; / and every other address are not',()=>{
 for(const p of ['/v2','/v2/'])assert.equal(isV2(p),true,p);
 for(const p of ['/','/v2x','/v2/app','/app/v2.css','/chat','/V2'])assert.equal(isV2(p),false,p)});

test('the v2 page is the app page plus the three v2 files, in the right places',()=>{
 const h=v2Html(index);
 assert.ok(h.includes('<script src="/app/v2-boot.js"></script>'));
 assert.ok(!h.includes('/app/theme-boot.js'),'v2-boot.js replaces theme-boot.js (both would fight over dark)');
 assert.ok(h.indexOf('/app/v2.css')>h.indexOf('/app/app.css'),'v2.css comes after the app styles');
 assert.ok(h.indexOf('/app/v2.js')<h.indexOf('/app/boot.js')&&h.indexOf('/app/v2.js')>h.indexOf('/app/unified-lists.js'),'v2.js after the app scripts, before boot.js');
 // nothing of the app is dropped: every script and stylesheet of / is still there
 for(const m of index.matchAll(/(?:src|href)="(\/app\/[\w.-]+\.(?:js|css))"/g))if(m[1]!=='/app/theme-boot.js')assert.ok(h.includes(m[1]),m[1])});

test('/ is untouched: index.html itself names no v2 file, and the server only adds them for /v2',()=>{
 assert.ok(!/v2(\.css|\.js|-boot)/.test(index));
 assert.match(read('app/server.mjs'),/appPage\(await readFile\(path\.join\(root,'app','index\.html'\),'utf8'\),p,BUILD\)/);
 const one=appPage(index,'/','B1'),two=appPage(index,'/v2','B1');
 assert.ok(!/v2(\.css|\.js|-boot)/.test(one),'/ got a v2 file');
 assert.ok(one.includes('/app/theme-boot.js?v=B1')&&one.includes('<meta name="build" content="B1">'));
 assert.ok(two.includes('/app/v2.css?v=B1')&&two.includes('/app/v2.js?v=B1')&&two.includes('/app/v2-boot.js?v=B1'))});

test('v2Html refuses an index.html that lost its anchors (it would serve v1 as /v2 without saying so)',()=>{
 assert.throws(()=>v2Html('<html></html>'),/no longer has the lines/)});

test('the v2 scripts add no global names (every browser script shares one scope)',()=>{
 for(const f of ['app/v2.js','app/v2-boot.js']){const s=read(f);
  assert.equal([...s.matchAll(/^(?:const|let|var|class|function|async function)\s/gm)].length,0,f+' declares a top-level name')}});

test('every v2 rule is scoped to html.v2, so the stylesheet cannot change / even if it were loaded there',()=>{
 const css=read('app/v2.css').replace(/\/\*[\s\S]*?\*\//g,'');
 const bad=[];for(const m of css.matchAll(/(^|})\s*([^@{}\s][^{}]*)\{/g)){const sel=m[2].trim();if(/^(from|to|\d+%)$/.test(sel))continue;for(const one of sel.split(','))if(!/^(html\.v2|body\.dragging)/.test(one.trim()))bad.push(one.trim())}
 assert.deepEqual(bad,[])});

test('motion in the v2 layer uses the app timing tokens and honours reduce motion',()=>{
 const css=read('app/v2.css').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.ok(!/transition:[^;}]*\b\d+m?s\b/.test(css),'a literal duration in a transition');
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(read('app/v2.js'),/prefers-reduced-motion: reduce/)});
