// Home-screen app (PWA) tests: the icon set drawn from a real mark, the manifest, the head tags on every served page, the zip step for
// published apps and the "no real mark" rules (12 Nov 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {encodePng,decodePng,pngInfo} from '../app/png.mjs';
import {buildIcons,contrast,toRgb,RADIUS} from '../app/icons.mjs';
import {createPwa,shortName} from '../app/pwa.mjs';
import {createBrand} from '../app/brand.mjs';
import {readZip,writeZip,dataOf,brandApp} from '../app/pwa-zip.mjs';
import {src} from './lib/source.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'..');
const R=f=>readFileSync(path.join(root,f));
// the real P&P logo (a plain SVG of four stroked squares, dark on nothing) and the two marks this repo ships
const PNP=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="57 57 366 366"><g transform="translate(-317.5 -292.5)" fill="none" stroke="#111111" stroke-width="36" stroke-linejoin="round"><rect x="395" y="420" width="133" height="137" rx="12"/><rect x="395" y="557" width="133" height="137" rx="12"/><rect x="528" y="557" width="144" height="137" rx="12"/><rect x="585" y="371" width="135" height="134" rx="12"/></g></svg>');
const cand=(file,data,type='image/svg+xml',alt)=>({file,type,data,alt});
const AQ={...cand('assets/aqeelos-mark.svg',R('assets/aqeelos-mark-render.png'),'image/png'),bg:'#111827',note:'its "a" rendered once'};
const ELK=cand('assets/elkiya-mark.svg',R('assets/elkiya-mark.svg'));
const spec=(o={})=>({name:'aqeelOS',colour:'',defaultColour:'',accent:'',mono:false,custom:null,markCands:[cand('brand-logo.svg',PNP)],v:1,...o});
const px=(png)=>decodePng(png);
const at=(img,x,y)=>{const i=(y*img.w+x)*4;return [...img.data.slice(i,i+4)]};

test('png: encode and decode round-trip, opaque writes no alpha channel',()=>{
 const d=new Uint8Array(4*4*4);for(let i=0;i<d.length;i+=4){d[i]=10;d[i+1]=20;d[i+2]=30;d[i+3]=255}
 const a=encodePng(4,4,d),b=encodePng(4,4,d,{opaque:true});assert.equal(pngInfo(a).type,6);assert.equal(pngInfo(b).type,2);
 assert.deepEqual(at(px(a),1,1),[10,20,30,255]);assert.deepEqual(at(px(b),3,3),[10,20,30,255])});

test('icon set: every size, an opaque iPhone icon, rounded and maskable ones',()=>{
 const r=buildIcons(spec());const dims={'apple-touch-icon.png':180,'icon-192.png':192,'icon-512.png':512,'icon-maskable-192.png':192,'icon-maskable-512.png':512,'favicon-16.png':16,'favicon-32.png':32,'favicon-48.png':48,'icon-mono-512.png':512};
 for(const [f,s] of Object.entries(dims)){const i=pngInfo(r.files[f].data);assert.ok(i,f);assert.equal(i.w,s,f);assert.equal(i.h,s,f)}
 // apple: no alpha channel at all, brand colour in the corners (iOS rounds it itself)
 assert.equal(pngInfo(r.files['apple-touch-icon.png'].data).type,2);const ap=px(r.files['apple-touch-icon.png'].data),bg=toRgb(r.colour);assert.deepEqual(at(ap,0,0).slice(0,3),bg);assert.deepEqual(at(ap,179,179).slice(0,3),bg);
 // rounded 'any' icon: transparent corners, opaque centre of the edge
 const any=px(r.files['icon-512.png'].data);assert.equal(at(any,0,0)[3],0);assert.equal(at(any,256,2)[3],255);assert.ok(RADIUS>.2&&RADIUS<.25);
 // maskable: full-bleed (no transparent pixel) and the mark stays inside the centre 80% (a circle of radius 40%)
 const mk=px(r.files['icon-maskable-512.png'].data);assert.equal(pngInfo(r.files['icon-maskable-512.png'].data).type,2);let out=0,mark=0;
 for(let y=0;y<512;y++)for(let x=0;x<512;x++){const p=at(mk,x,y);if(p[0]!==bg[0]||p[1]!==bg[1]||p[2]!==bg[2]){mark++;if(Math.hypot(x+.5-256,y+.5-256)>512*.4)out++}}
 assert.ok(mark>2000,'the mark is drawn');assert.equal(out,0,'nothing of the mark outside the safe zone');
 // monochrome: black shape with alpha only
 const mo=px(r.files['icon-mono-512.png'].data);assert.equal(at(mo,0,0)[3],0);let dark=0;for(let i=0;i<mo.data.length;i+=4)if(mo.data[i+3]>0){assert.equal(mo.data[i],0);dark++}assert.ok(dark>2000);
 assert.match(r.files['favicon.svg'].data.toString(),/<svg[^>]*viewBox="0 0 64 64"[\s\S]*rx=/);assert.equal(r.files['favicon.ico'].data.readUInt16LE(2),1);assert.equal(r.files['favicon.ico'].data.readUInt16LE(4),3)});

test('icon set: made from the real mark, says where it came from, keeps its colours when they read',()=>{
 const r=buildIcons(spec({markCands:[ELK]}));assert.equal(r.source.file,'assets/elkiya-mark.svg');assert.equal(r.source.kind,'svg');assert.equal(r.hasMark,true);
 // the mark is dark ink: the tile is chosen so that it reads (white), the ink colour is kept
 assert.equal(r.colour,'#ffffff');const c=px(r.files['icon-512.png'].data);let ink=0;for(let i=0;i<c.data.length;i+=4)if(c.data[i+3]>250&&c.data[i]<60&&c.data[i+1]<60)ink++;assert.ok(ink>3000,'the original dark ink is drawn');
 // aqeelOS's own mark: its SVG has text, so its "a" is one stored render (Plus Jakarta Sans 700) on the SVG's own tile colour
 const a=buildIcons(spec({markCands:[AQ]}));assert.equal(a.source.file,'assets/aqeelos-mark.svg');assert.match(a.source.note,/rendered/);assert.equal(a.colour,'#111827')});

test('icon set: a mark that cannot be read on the colour is recoloured, never lost; an accent is used when set',()=>{
 const dark=buildIcons(spec({colour:'#111111'}));assert.match(dark.source.recoloured,/does not read|recoloured/);const c=px(dark.files['icon-512.png'].data);let light=0;for(let i=0;i<c.data.length;i+=4)if(c.data[i+3]>250&&c.data[i]>200)light++;assert.ok(light>3000);
 const acc=buildIcons(spec({colour:'#111111',accent:'#83b271'}));assert.ok(contrast(toRgb('#83b271'),toRgb('#111111'))>3);assert.match(acc.source.recoloured,/#83b271/)});

test('no real mark: the plain colour tile with nothing on it, never an invented letter; the letter only when chosen',()=>{
 const n=buildIcons(spec({markCands:[],colour:'#336699'}));assert.equal(n.needsLogo,true);assert.equal(n.hasMark,false);assert.equal(n.source.kind,'none');
 const t=px(n.files['icon-512.png'].data);for(const [x,y] of [[256,256],[200,300],[300,200],[256,100]])assert.deepEqual(at(t,x,y),[0x33,0x66,0x99,255]);assert.ok(!n.files['icon-mono-512.png']);
 // an unreadable source (a gradient) is not guessed at either
 const g=buildIcons(spec({markCands:[cand('x.svg',Buffer.from('<svg viewBox="0 0 10 10"><defs><linearGradient id="a"/></defs><rect width="5" height="5" fill="url(#a)"/></svg>'))],colour:'#336699'}));assert.equal(g.needsLogo,true);assert.match(g.source.why,/gradient|linearGradient/);
 // a PNG that is too small to scale up cleanly is refused too
 const small=encodePng(100,100,new Uint8Array(100*100*4).map((_,i)=>i%4===3?((i>>2)%7?255:0):0));assert.equal(buildIcons(spec({markCands:[cand('s.png',small,'image/png')]})).needsLogo,true);
 const l=buildIcons(spec({markCands:[],colour:'#336699',mono:true,name:'Zed'}));assert.equal(l.needsLogo,false);assert.equal(l.source.kind,'letter');assert.ok(l.files['icon-mono-512.png'])});

test('own icon upload replaces the drawn one, used as it is',()=>{
 const sq=new Uint8Array(600*600*4);for(let i=0;i<sq.length;i+=4){sq[i]=200;sq[i+1]=30;sq[i+2]=30;sq[i+3]=255}
 const r=buildIcons(spec({custom:{type:'image/png',data:encodePng(600,600,sq)}}));assert.equal(r.source.kind,'upload');const a=px(r.files['apple-touch-icon.png'].data);assert.deepEqual(at(a,90,90),[200,30,30,255]);assert.equal(pngInfo(r.files['apple-touch-icon.png'].data).type,2);
 assert.equal(at(px(r.files['icon-192.png'].data),0,0)[3],0)});

test('manifest: installable fields, 12-letter short name, any + maskable (+ monochrome) icons, Chat and Health shortcuts',async()=>{
 const brand={iconSpec:async()=>spec({name:'Pixel and Profits Operating System',colour:'#111111',accent:'#83b271'})};const p=createPwa({brand});const {set,spec:s}=await p.current();const m=p.manifest(set,s);
 assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');assert.ok(m.short_name.length<=12,m.short_name);assert.equal(shortName('aqeelOS'),'aqeelOS');
 assert.equal(m.background_color,'#111111');assert.equal(m.theme_color,'#111111');assert.equal(m.orientation,'any');assert.ok(m.categories.length);
 const pur=m.icons.map(i=>i.purpose+i.sizes);for(const x of ['any192x192','any512x512','maskable192x192','maskable512x512','monochrome512x512'])assert.ok(pur.includes(x),x);
 assert.deepEqual(m.shortcuts.map(x=>x.name),['Chat','Health']);for(const i of m.icons)assert.match(i.src,/^\/pwa\/[0-9a-f]{10}\/icon-/);
 assert.equal(p.manifest(set,s,{name:'X Code',shortcuts:false}).shortcuts,undefined)});

test('versioned: a brand change gives new icon addresses, the same brand the same ones',async()=>{
 const a=buildIcons(spec()).v,b=buildIcons(spec()).v,c=buildIcons(spec({colour:'#ff0000'})).v;assert.equal(a,b);assert.notEqual(a,c)});

// ---- head tags on every page the server serves ----
const REQUIRED=[/rel="icon"[^>]*image\/svg\+xml/,/rel="icon"[^>]*image\/png/,/rel="apple-touch-icon"/,/rel="manifest"/,/name="theme-color"[^>]*prefers-color-scheme: light/,/name="theme-color"[^>]*prefers-color-scheme: dark/,/name="mobile-web-app-capable"/,/name="apple-mobile-web-app-capable"/,/name="apple-mobile-web-app-title"/,/name="apple-mobile-web-app-status-bar-style"/];
const pages=()=>{const out=['app/index.html','backlog/index.html','code/studio.html','code/index.html','code/usage.html',...readdirSync(path.join(root,'assets')).filter(f=>f.endsWith('.html')).map(f=>'assets/'+f)];return out};
test('head tags: every page the server serves gets icon, apple-touch-icon, manifest, theme colours and the app meta',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pwa-')),brand=createBrand({DATA:dir,fallbackMarks:async()=>[AQ]}),p=createPwa({brand});await p.current();
 const srv=http.createServer(async(req,res)=>{p.hook(req,res);const u=new URL(req.url,'http://x');if(p.isPwaPath(u.pathname)&&await p.serve(req,res,u.pathname))return;
  if(u.pathname==='/mini'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Result</title><p>ok</p>')}   // a small result page written as a string, no <head>
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-length':99999});res.end(readFileSync(path.join(root,u.searchParams.get('f'))))});
 await new Promise(r=>srv.listen(0,r));const base='http://127.0.0.1:'+srv.address().port;
 try{for(const f of [...pages(),'MINI']){const html=await (await fetch(f==='MINI'?base+'/mini':base+'/?f='+f)).text();for(const re of REQUIRED)assert.match(html,re,f+' lacks '+re);
   if(/<meta[^>]*name="viewport"/.test(html))assert.match(html,/viewport-fit=cover/,f+' viewport');assert.equal((html.match(/rel="manifest"/g)||[]).length,1,f+' manifest once')}
  // the addresses the tags name answer, with the right types, public
  const html=await (await fetch(base+'/?f=app/index.html')).text();for(const u of [...html.matchAll(/href="(\/[^"]+)"/g)].map(m=>m[1]).filter(h=>/^\/(pwa\/|favicon|manifest|apple-touch)/.test(h))){const r=await fetch(base+u);assert.equal(r.status,200,u)}
  assert.match((await fetch(base+'/manifest.webmanifest')).headers.get('content-type'),/manifest\+json/);assert.equal((await fetch(base+'/favicon.ico')).status,200);assert.equal((await fetch(base+'/apple-touch-icon.png')).status,200);
  const sw=await fetch(base+'/sw.js');assert.equal(sw.status,200);const swt=await sw.text();assert.doesNotMatch(swt,/cache\.put|caches\.open|addAll/);assert.match(swt,/skipWaiting/)}
 finally{srv.closeAllConnections?.();srv.close()}});

test('the real server wires it first: hook before any route, icons public, index.html carries the markers',()=>{
 const s=src('app/server.mjs'),h=s.indexOf('pwa.hook(req,res)');assert.ok(h>0);assert.ok(h<s.indexOf('codeOnline.handle(req,res))return;'),'before Code online');assert.ok(h<s.indexOf("p==='/install-ping'"));
 assert.ok(s.indexOf('pwa.isPwaPath(p)')<s.indexOf('codeOnline.handle(req,res))return;'),'icons answer before sign-in');
 const ix=readFileSync(path.join(root,'app/index.html'),'utf8');assert.match(ix,/<!--pwa-->[\s\S]*rel="manifest"[\s\S]*<!--\/pwa-->/);assert.match(ix,/viewport-fit=cover/);assert.match(ix,/pwa\.css/);
 assert.match(readFileSync(path.join(root,'app/pwa.css'),'utf8'),/safe-area-inset-top/)});

// ---- published apps ----
const zipOf=files=>writeZip(Object.entries(files).map(([name,d])=>({name,data:Buffer.from(d),method:8,dir:false})));
const names=z=>readZip(z).map(e=>e.name);
test('Live: a project with a logo and no icons gets the set, drawn from its own logo, and the head tags',()=>{
 const z=zipOf({'package.json':'{}','public/index.html':'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shop</title></head><body></body></html>','public/logo.svg':PNP.toString()});
 const r=brandApp(z,{name:'Shop'});assert.equal(r.needsLogo,false);assert.match(r.source,/public\/logo\.svg/);const n=names(r.zip);
 for(const f of ['public/favicon.svg','public/favicon.ico','public/apple-touch-icon.png','public/icon-192.png','public/icon-maskable-512.png','public/manifest.webmanifest'])assert.ok(n.includes(f),f);
 const e=readZip(r.zip),html=dataOf(e.find(x=>x.name==='public/index.html')).toString();assert.match(html,/rel="manifest"/);assert.match(html,/rel="apple-touch-icon"/);assert.match(html,/viewport-fit=cover/);
 assert.equal(pngInfo(dataOf(e.find(x=>x.name==='public/apple-touch-icon.png'))).w,180);const mf=JSON.parse(dataOf(e.find(x=>x.name==='public/manifest.webmanifest')));assert.equal(mf.name,'Shop');assert.equal(mf.display,'standalone');
 assert.equal(dataOf(e.find(x=>x.name==='public/logo.svg')).toString(),PNP.toString(),'its own files are untouched')});
test('Live: an app that already has its own manifest and icons is left exactly as it is',()=>{
 const z=zipOf({'package.json':'{}','public/index.html':'<!doctype html><head><link rel="icon" href="/f.png"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/a.png"></head>','public/manifest.webmanifest':'{"icons":[]}','public/favicon.png':'x','public/apple-touch-icon.png':'y'});
 const r=brandApp(z,{name:'Own'});assert.equal(r.zip,z);assert.deepEqual(r.kept,['manifest','favicon','apple-touch-icon']);assert.equal(r.added.length,0)});
test('Live: its own manifest icon is the real mark; an inline SVG logo in the page is used when nothing else exists',()=>{
 const inline=zipOf({'index.html':'<!doctype html><html><head><title>A</title></head><body><header><a class="logo"><svg viewBox="0 0 10 10"><path d="M1 1h8v8H1z" fill="#d33"/></svg></a></header></body></html>'});
 const r=brandApp(inline,{name:'Inline'});assert.match(r.source,/inline SVG logo/);assert.equal(r.needsLogo,false);
 const none=zipOf({'index.html':'<!doctype html><html><head><title>A</title></head><body>hi</body></html>'});const q=brandApp(none,{name:'Plain'});assert.equal(q.needsLogo,true);assert.equal(q.source,'');assert.ok(names(q.zip).includes('favicon.svg'),'still gets the plain tile as a temporary icon');
 const mono=brandApp(none,{name:'Plain',mono:true});assert.equal(mono.needsLogo,false)});
test('Live: a damaged or unusual zip comes back untouched',()=>{const junk=Buffer.from('not a zip at all');assert.equal(brandApp(junk,{name:'x'}).zip,junk)});
