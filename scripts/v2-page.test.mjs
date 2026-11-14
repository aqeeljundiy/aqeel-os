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

// the admin kit on /v2 (owner, 14 Nov 2026: "make aqeelOS with the adminkit ui ... improving the UI, not a redesign")
test('/v2 loads the admin kit and aqeelOS theme for it, in order; / loads neither',()=>{
 const h=v2Html(index),at=s=>h.indexOf(s);
 assert.ok(at('/app/pwa.css')<at('/app/vendor/admin-kit/admin-kit.css')&&at('/app/vendor/admin-kit/admin-kit.css')<at('/app/v2-theme.css')&&at('/app/v2-theme.css')<at('/app/v2.css'),'kit css, then the theme, then v2.css');
 assert.ok(at('/app/unified-lists.js')<at('/app/vendor/admin-kit/admin-kit.js')&&at('/app/vendor/admin-kit/admin-kit.js')<at('/app/v2.js'),'kit script after the app scripts, before v2.js');
 assert.ok(!/admin-kit|v2-theme/.test(appPage(index,'/','B1')),'/ got a kit file');
 assert.throws(()=>v2Html(index.replace('<script src="/app/boot.js"></script>','')),/no longer has the lines/)});

test('the kit copy is the released kit, byte for byte (never edited here: change aqeel-admin-kit and re-install)',async()=>{
 const {createHash}=await import('node:crypto');const man=JSON.parse(read('app/vendor/admin-kit/manifest.json'));
 for(const [f,sum] of Object.entries(man.files))assert.equal(createHash('sha256').update(readFileSync(new URL('../app/vendor/admin-kit/'+f,import.meta.url))).digest('hex'),sum,f)});

test('the theme fills every value the kit needs and fetches no font from outside (the CSP allows this site only)',()=>{
 const t=read('app/v2-theme.css');
 for(const v of ['font','text-xs','text-sm','text-md','text-lg','text-title','weight-normal','weight-medium','weight-bold','tracking-title','bg','surface','surface-2','border','border-strong','text','text-muted','accent','accent-text','success','warn','danger','info','radius-control','radius-card','radius-chip','radius-pop','space','control-h','row-h','page-max','page-pad','sidebar-w','dur-fast','dur','dur-slow','ease','shadow-card','shadow-pop','style-nav','style-sidebar','style-stats','style-tabs','style-table','style-head','style-loader'])
  assert.match(t,new RegExp('--ak-'+v+':\\s*[^;\\s][^;]*;'),'--ak-'+v);
 assert.match(t,/--ak-font-numbers:\s*none/);assert.ok(!/@import|https?:\/\//.test(t.replace(/\/\*[\s\S]*?\*\//g,'')))});

test('on /v2 the app hands toasts and confirm boxes to the kit, and Ctrl+K opens one box, the app search',()=>{
 const s=read('app/v2.js');
 assert.match(s,/window\.toast=\(msg,kind\)=>/);assert.match(s,/Oops\.add\('toast'/,'failures still reach "What went wrong"');
 assert.match(s,/window\.confirmBox=\(title,text,okLabel='Delete',danger=true\)=>/);assert.match(s,/\.then\(ok=>!!ok\)/);
 assert.match(s,/addEventListener\('keydown',e=>\{if\(!\(e\.ctrlKey\|\|e\.metaKey\)[^]*?e\.stopPropagation\(\)[^]*?palette\(\)\},true\)/,'Ctrl+K stopped in the capture phase, then the app search')});

// kit 0.27.0 on /v2 (owner, 14 Nov 2026: "Grow the kit"): the app's menus and search drawn by the kit, nothing dropped
test('on /v2 menus are the kit menu, made from the same items, and menus with content of their own stay the app\'s',()=>{
 const s=read('app/v2.js');
 assert.match(s,/window\.menu=\(anchor,items,opt=\{\}\)=>\{if\(opt\.html\|\|!anchor\?\.getBoundingClientRect\)return own\(anchor,items,opt\)/,'opt.html menus (date grid) go to the app');
 for(const k of ['sub:i.sub','checked:!!i.on',"tone:i.bad?'danger'",'disabled:!!i.disabled','kbd:i.kbd','title:i.title','keywords:i.find','run:i.run','header:i.header'])assert.ok(s.includes(k),'menu item field '+k);
 assert.match(s,/search:!!opt\.search/);assert.match(s,/opt\.onClose\?\.\(\)/,'onClose still called');
 assert.match(read('app/vendor/admin-kit/manifest.json'),/"version": "0\.27\.0"/,'needs kit 0.27.0 (AdminKit.menu)')});

test('on /v2 the search is the kit box with the same lists as / (one source) and its live results',()=>{
 const core=read('app/core.js'),s=read('app/v2.js');
 assert.match(core,/^function palette\(listsOnly\)\{/m);assert.match(core,/^async function paletteFind\(q\)\{/m);
 assert.match(core,/const all=\[\.\.\.actions,\.\.\.pages,\.\.\.models,\.\.\.chats\];if\(listsOnly===true\)return all;/,'palette(true) answers the lists, opening nothing');assert.match(core,/const found=await paletteFind\(q\);/,'/ searches with paletteFind');
 assert.match(s,/const ownPalette=palette;/);assert.match(s,/AK\.command\.set\(ownPalette\(true\)\.map\(asItem\)\)/);assert.match(s,/AK\.command\.onQuery\(async q=>\(await paletteFind\(/);
 assert.match(s,/match:'contains'/,'matches like / (words that contain the text)');assert.match(s,/foot:\['↑↓ to move','Enter to open','Esc to close'\]/)});

test('on /v2 Escape closes only the top kit box (not the app drawer under it)',()=>{
 const s=read('app/v2.js');
 assert.match(s,/addEventListener\('keydown',e=>\{if\(e\.key!=='Escape'[^]*?e\.stopPropagation\(\)[^]*?AK\.menu\.close\(\)[^]*?AK\.command\.close\(\)[^]*?\},true\)/)});
