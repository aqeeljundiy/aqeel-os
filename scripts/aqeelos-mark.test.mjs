// The aqeelOS mark (the orbit, chosen by the owner 17 Nov 2026): one drawing everywhere. assets/aqeelos-mark.svg (web app, sign-in, home-screen
// icons) and code/assets/aqeelos-mark.svg (Code, the desktop app) are the same file, drawn with shapes and no text (a typed "a" was the mark before),
// and the PNGs code/scripts/make-icons.mjs writes (desktop, web app, Chrome extension, the 2048 render) show that same drawing.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {renderSvg} from '../app/raster.mjs';import {decodePng} from '../app/png.mjs';
const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..'),rd=f=>readFileSync(path.join(ROOT,f));
const svg=rd('assets/aqeelos-mark.svg').toString('utf8');
// the orbit on its 64-unit grid, as make-icons.mjs draws it: a ring (radius 10 to 16) cut round the dot at the top right
const orbit=(x,y)=>{const r=Math.hypot(x-32,y-32),d=Math.hypot(x-43,y-21);return (r>=10&&r<=16&&d>7.5)||d<=4.5};
test('Code and the web app carry the same drawn mark, with no text in it',()=>{
 assert.equal(rd('code/assets/aqeelos-mark.svg').toString('utf8'),svg);assert.doesNotMatch(svg,/<text\b/i);assert.match(svg,/fill="#111827"/)});
test('the SVG draws exactly the orbit make-icons.mjs draws',()=>{
 const S=128,px=renderSvg(svg,S);let off=0,n=0;
 for(let y=0;y<S;y+=2)for(let x=0;x<S;x+=2){const u=(x+.5)/S*64,v=(y+.5)/S*64;if(Math.hypot(u-32,v-32)>17.5&&Math.hypot(u-43,v-21)>9)continue;   // the mark's area
  const i=(y*S+x)*4,white=px[i]>200&&px[i+1]>200,want=orbit(u,v);const edge=Math.abs(Math.hypot(u-32,v-32)-10)<.6||Math.abs(Math.hypot(u-32,v-32)-16)<.6||Math.abs(Math.hypot(u-43,v-21)-7.5)<.6||Math.abs(Math.hypot(u-43,v-21)-4.5)<.6;
  if(edge)continue;n++;if(white!==want)off++}
 assert.ok(n>500);assert.ok(off/n<.01,off+' of '+n+' pixels differ')});
test('every icon file shows the orbit: dot and ring white, the middle and the cut dark',()=>{
 for(const [f,margin] of [['assets/icon-512.png',4],['assets/icon-180.png',4],['code/assets/icon-512.png',4],['extension/icon-128.png',4],['assets/aqeelos-mark-render.png',0]]){
  const img=decodePng(rd(f)),at=(u,v)=>{const g=64-2*margin,x=Math.floor((margin+u*g/64)/64*img.w),y=Math.floor((margin+v*g/64)/64*img.h),i=(y*img.w+x)*4;return [...img.data.slice(i,i+4)]};
  const white=c=>c[3]>200&&c[0]>200,notWhite=c=>!white(c);
  assert.ok(white(at(43,21)),f+': the dot');assert.ok(white(at(32,45)),f+': the ring');assert.ok(white(at(19,32)),f+': the ring');
  assert.ok(notWhite(at(32,32)),f+': the middle');assert.ok(notWhite(at(37.6,22.4)),f+': the cut round the dot')}});
// light mode (owner, 17 Nov 2026): the same drawing on a light tile, shown when the page is light; the navy one when it is dark. Neither is inverted.
test('the light drawing is the same shapes, navy on a light tile, in both places',()=>{
 const light=rd('assets/aqeelos-mark-light.svg').toString('utf8');assert.equal(rd('code/assets/aqeelos-mark-light.svg').toString('utf8'),light);
 const shapes=s=>s.replace(/fill="#[0-9a-f]+"/gi,'fill=""');assert.equal(shapes(light),shapes(svg));
 assert.match(light,/<rect[^>]*fill="#edeef2"/);assert.doesNotMatch(light,/fill="#fff"/);
 const px=renderSvg(light,64),at=(x,y)=>[...px.slice((y*64+x)*4,(y*64+x)*4+3)];assert.ok(at(43,21).every(v=>v<60),'navy dot');assert.ok(at(32,32).every(v=>v>220),'light middle')});
test('every page that shows the aqeelOS mark has both drawings, and CSS shows one per theme with no filter',()=>{
 const pair=/<img class="(mark )?aq-mark aq-dark" src="\/assets\/aqeelos-mark\.svg" alt=""><img class="(mark )?aq-mark aq-light" src="\/assets\/aqeelos-mark-light\.svg" alt="">/;
 for(const f of ['code/studio.html','code/index.html','code/usage.html','code/development.html','backlog/index.html']){const t=rd(f).toString('utf8');assert.match(t,pair,f);assert.doesNotMatch(t,/<img (class="mark" )?src="\/assets\/aqeelos-mark\.svg"/,f+' still has a single mark')}
 const rule=/\.dark img\.aq-light,:root:not\(\.dark\) img\.aq-dark\{display:none\}/;
 for(const f of ['app/app.css','code/theme.css','code/studio.css','backlog/index.html'])assert.match(rd(f).toString('utf8'),rule,f);
 assert.match(rd('code/server.mjs').toString('utf8'),/aqeelos-mark\(-light\)\?\\.svg\)\$\//,'Code serves the light drawing before sign-in')});
test('the web app shows both drawings only for the aqeelOS mark: an uploaded logo or another install mark stays one image',()=>{
 const src=rd('app/lang.js').toString('utf8'),m=/ markImg\(\)\{return ([^\n]*)\},\n/.exec(src);assert.ok(m,'markImg');
 const markImg=new Function('return '+m[1]);const B=o=>({mark(){return this.logo||'/ui/brand/logo'},...o});
 assert.match(markImg.call(B({logo:null,aq:true})),/aq-dark[\s\S]*aq-light/);
 assert.equal(markImg.call(B({logo:'/ui/brand/logo?v=1',aq:true})),'<img class="mark" src="/ui/brand/logo?v=1" alt="">');
 assert.equal(markImg.call(B({logo:null,aq:false})),'<img class="mark" src="/ui/brand/logo" alt="">');
 for(const f of ['app/core.js','app/people.js','app/account-setup.js'])assert.doesNotMatch(rd(f).toString('utf8'),/<img class="mark" src="\$\{Brand\.mark\(\)\}"/,f);
 assert.match(rd('app/server.mjs').toString('utf8'),/aq:\/aqeelos-mark\/\.test\(env\.BRAND_LOGO_FALLBACK\|\|'aqeelos-mark'\)/)});
