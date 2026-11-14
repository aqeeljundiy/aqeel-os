// /v2 (13 Nov 2026): the same app with the v2 layer. Since 14 Nov 2026 (owner: "so make v2 the new UI") every address
// gets it and the first version is kept, as it was, at /v1. node --test scripts/v2-page.test.mjs
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {isV2,isV1,v2Html,appPage} from '../app/v2-page.mjs';
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

test('v2 is the UI at / and every address; /v1 is the first version, exactly as it was',()=>{
 assert.ok(!/v2(\.css|\.js|-boot)/.test(index),'index.html itself stays the first version');
 assert.match(read('app/server.mjs'),/appPage\(await readFile\(path\.join\(root,'app','index\.html'\),'utf8'\),p,BUILD\)/);
 for(const p of ['/v1','/v1/'])assert.equal(isV1(p),true,p);for(const p of ['/','/v2','/v1x','/chat','/V1'])assert.equal(isV1(p),false,p);
 for(const p of ['/','/v2','/chat/abc','/reset'])assert.ok(appPage(index,p,'B1').includes('/app/v2.js?v=B1'),p+' has no v2 layer');
 const one=appPage(index,'/v1','B1');
 assert.ok(!/v2(\.css|\.js|-boot)|admin-kit/.test(one),'/v1 got a v2 file');
 assert.ok(one.includes('/app/theme-boot.js?v=B1')&&one.includes('<meta name="build" content="B1">'));
 assert.match(read('app/v2.js'),/a\.href='\/v1'\+location\.hash/,'the v2 mark leads to the first version')});

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
 assert.ok(!/admin-kit|v2-theme/.test(appPage(index,'/v1','B1')),'/v1 got a kit file');assert.ok(/admin-kit/.test(appPage(index,'/','B1')),'/ has no kit');
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

// Schedules (owner, 14 Nov 2026: "Yes, Schedules next"): the editor's day picker is the kit's calendar from the same button
test('on /v2 the day picker of date fields is the kit calendar, and Escape closes it first',()=>{
 const s=read('app/v2.js');
 assert.match(s,/window\.datePop=\(anchor,cur,pick\)=>\{AK\.datePick\(anchor,cur\|\|'',\{label:'Pick a day'\}\)\.then\(v=>\{anchor\.classList\?\.remove\('open'\);if\(v\)pick\(v\)\}\)\}/);
 assert.match(s,/if\(AK\.datePick\?\.isOpen\)return AK\.datePick\.close\(\)/);
 assert.match(read('app/v2.css'),/html\.v2 \.switch::after\{top:-10px;left:-1px;width:44px;height:44px/,'switches keep a 44px tap area on phones')});

// side panels on every page (owner, 14 Nov 2026: "Do all first"): the app's panel inside the kit's sheet, its guard kept
test('on /v2 the app\'s side panels sit in the kit sheet, non-modal, and a person\'s close asks the app first',()=>{
 const s=read('app/v2.js'),c=read('app/v2.css');
 assert.match(s,/const d=ownDrawer\(title,body,foot,opt\)/,'the app still builds the panel');
 assert.match(s,/kd\.setAttribute\('modal','false'\)/);assert.match(s,/kd\.addEventListener\('beforeclose',e=>\{e\.preventDefault\(\);if\(typeof askClose==='function'\)askClose\(\)/);
 assert.match(s,/d\.remove=\(\)=>\{if\(out\)return;out=true;kd\.hide\(\)/,'the sheet goes out when the app removes the panel');
 assert.match(s,/if\(document\.querySelector\('\.drawer\.stack:not\(\.closing\),\.menu:not\(\.closing\)'\)\)return;/,'a question on top answers its own Escape');
 assert.match(c,/html\.v2 \.scrim\.stack\{z-index:85\}/,'questions sit above the sheet');
 assert.match(read('app/vendor/admin-kit/admin-kit.js'),/beforeclose/,'kit with beforeclose')});
