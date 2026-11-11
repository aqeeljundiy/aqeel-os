// Home-screen app (PWA) for every page this install serves (12 Nov 2026, owner: "everything needs a customised, neat, rounded
// favicon so it looks good if I add it as a PWA on mobile"). One place makes: the icon set from the brand's real mark (icons.mjs),
// the manifest, the head tags, the minimal service worker and the routes that serve them. Icons live at /pwa/<version>/<file>
// (the version changes with the brand, so phones fetch new ones) plus the unversioned addresses browsers look for by themselves.
import {buildIcons,GEN} from './icons.mjs';

const esc=s=>String(s).replace(/[<>&"]/g,c=>'&#'+c.charCodeAt(0)+';');
export const shortName=n=>{n=String(n||'App').trim();if(n.length<=12)return n;const w=n.split(/\s+/)[0];return (w.length>=3&&w.length<=12?w:n.slice(0,12)).trim()};
const DARK_BG='#12151c',LIGHT_BG='#ffffff';

export function createPwa({brand,build=()=>String(Date.now()),onSet=()=>{}}){
 const sets=new Map();let latest=null,spec=null,key='',pending=null;
 const keyOf=s=>[s.v,s.name,s.colour,s.accent,s.mono,!!s.custom,s.markCands.map(c=>c.file+':'+(c.data?.length||0)).join(',')].join('|');
 // the current set; rebuilt only when the brand changed
 async function current(){const s=await brand.iconSpec(),k=keyOf(s);if(latest&&k===key)return {set:latest,spec};
  if(pending&&pending.k===k)return pending.p;
  const p=(async()=>{const set=buildIcons(s);sets.set(set.v,set);if(sets.size>6)sets.delete(sets.keys().next().value);latest=set;spec=s;key=k;tagsNow=tags(set,s);onSet(set,s);return {set,spec:s}})();pending={k,p};try{return await p}finally{pending=null}}
 const iconsOf=(set,base)=>{const u=f=>base+'/pwa/'+set.v+'/'+f,o=[{src:u('icon-192.png'),sizes:'192x192',type:'image/png',purpose:'any'},{src:u('icon-512.png'),sizes:'512x512',type:'image/png',purpose:'any'},
  {src:u('icon-maskable-192.png'),sizes:'192x192',type:'image/png',purpose:'maskable'},{src:u('icon-maskable-512.png'),sizes:'512x512',type:'image/png',purpose:'maskable'}];
  if(set.files['icon-mono-512.png'])o.push({src:u('icon-mono-512.png'),sizes:'512x512',type:'image/png',purpose:'monochrome'});return o};
 function manifest(set,s,{base='',name,startUrl='/',shortcuts=true}={}){const n=name||s.name;
  return {id:'/',name:n,short_name:shortName(n),description:name?n+': build websites and apps with Claude, GPT and Gemini.':n+': your AI agents, their channels and schedules in one place.',start_url:startUrl,scope:'/',display:'standalone',orientation:'any',
   background_color:set.colour,theme_color:set.colour,categories:['productivity','business'],lang:'en',icons:iconsOf(set,base),
   ...(shortcuts?{shortcuts:[{name:'Chat',short_name:'Chat',url:'/#/chat',icons:[{src:base+'/pwa/'+set.v+'/icon-192.png',sizes:'192x192',type:'image/png'}]},{name:'Health',short_name:'Health',url:'/#/health',icons:[{src:base+'/pwa/'+set.v+'/icon-192.png',sizes:'192x192',type:'image/png'}]}]}:{})}}
 // the head tags every page gets (also written by hand into index.html between the same markers, so it works without the server's help)
 function tags(set,s,{base='',v=set?.v}={}){const u=f=>base+'/pwa/'+v+'/'+f,n=esc(s?.name||'aqeelOS');
  return `<!--pwa--><link rel="icon" type="image/svg+xml" href="${u('favicon.svg')}"><link rel="icon" type="image/png" sizes="32x32" href="${u('favicon-32.png')}"><link rel="icon" type="image/png" sizes="16x16" href="${u('favicon-16.png')}"><link rel="shortcut icon" href="${base}/favicon.ico?v=${v}">`
   +`<link rel="apple-touch-icon" sizes="180x180" href="${u('apple-touch-icon.png')}"><link rel="manifest" href="${base}/manifest.webmanifest?v=${v}">`
   +`<meta name="theme-color" content="${LIGHT_BG}" media="(prefers-color-scheme: light)"><meta name="theme-color" content="${DARK_BG}" media="(prefers-color-scheme: dark)">`
   +`<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><meta name="apple-mobile-web-app-title" content="${n}"><meta name="application-name" content="${n}"><meta name="format-detection" content="telephone=no"><!--/pwa-->`}
 // put the tags into a page: replaces the marked block, else goes in after <head> (or after the doctype for pages without one); a page that
 // already has its own manifest link keeps it. Also makes sure the viewport covers the notch (viewport-fit=cover)
 function inject(html,t){let h=String(html);if(/<!--pwa-->[\s\S]*?<!--\/pwa-->/.test(h))h=h.replace(/<!--pwa-->[\s\S]*?<!--\/pwa-->/,()=>t);
  else if(/rel=["']?manifest/i.test(h))return h;else if(/<head[^>]*>/i.test(h))h=h.replace(/<head[^>]*>/i,m=>m+t);else if(/<!doctype[^>]*>/i.test(h))h=h.replace(/<!doctype[^>]*>/i,m=>m+t);else h=t+h;
  return h.replace(/(<meta[^>]*name=["']?viewport["']?[^>]*content=["'])([^"']*)/i,(m,a,c)=>/viewport-fit/.test(c)?m:a+c+',viewport-fit=cover')}
 let tagsNow=null;const tagsSync=()=>tagsNow||tags({v:'0',files:{}},{name:globalThis.AQ_BRAND||'aqeelOS'},{});
 const swText=()=>`// ${esc(build())} (the build id: a new deploy is a new file, so an installed app never keeps an old shell)
const V='${build()}';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.clients.claim()})())});
// nothing is cached: the page and the API always come from the network. Only a page that cannot load at all gets a short offline note.
self.addEventListener('fetch',e=>{const r=e.request;if(r.mode!=='navigate')return;e.respondWith(fetch(r).catch(()=>new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;text-align:center;color:#555;margin:0;padding:0 24px"><p>You are offline. Open the app again when you have a connection.</p>',{status:503,headers:{'content-type':'text/html; charset=utf-8'}})))});
`;
 // wraps one response: an HTML page (200s, not compressed, not a HEAD) is held back until it ends, gets the tags, and goes out with the right length
 function hook(req,res){const wh=res.writeHead,en=res.end,wr=res.write;let held=null,buf=null;
  res.writeHead=function(code,msg,h){if(typeof msg!=='string'){h=msg;msg=undefined}const hh=h&&!Array.isArray(h)?{...h}:h||null;
   const get=k=>hh&&!Array.isArray(hh)?Object.entries(hh).find(([x])=>x.toLowerCase()===k)?.[1]:res.getHeader(k);
   if(/text\/html/i.test(String(get('content-type')||''))&&!get('content-encoding')&&code>=200&&code<300&&code!==204&&req.method!=='HEAD'&&!held){held=[code,msg,hh];buf=[];return res}
   return msg===undefined?wh.call(res,code,hh||undefined):wh.call(res,code,msg,hh||undefined)};
  res.write=function(c,...a){if(buf){buf.push(Buffer.from(c));return true}return wr.call(res,c,...a)};
  res.end=function(c,...a){if(!buf)return en.call(res,c,...a);if(c&&typeof c!=='function')buf.push(Buffer.from(c));const html=Buffer.from(inject(Buffer.concat(buf).toString('utf8'),headSync())),[code,msg,hh]=held;buf=null;held=null;
   const o=hh&&!Array.isArray(hh)?Object.fromEntries(Object.entries(hh).filter(([k])=>k.toLowerCase()!=='content-length')):{};res.removeHeader('content-length');o['content-length']=html.length;
   msg===undefined?wh.call(res,code,o):wh.call(res,code,msg,o);return en.call(res,html)}}
 const IMM='public, max-age=31536000, immutable';
 // GET of a PWA address; true when answered
 async function serve(req,res,p,{head=false,code=false}={}){
  const send=(code,type,body,extra={})=>{res.writeHead(code,{'content-type':type,'x-content-type-options':'nosniff',...extra});res.end(head?undefined:body);return true};
  let m;
  if(p==='/manifest.webmanifest'){const {set,spec:s}=await current();return send(200,'application/manifest+json; charset=utf-8',JSON.stringify(code?manifest(set,s,{name:s.name+' Code',shortcuts:false}):manifest(set,s)),{'cache-control':'no-cache'})}
  if(p==='/sw.js')return send(200,'text/javascript; charset=utf-8',swText(),{'cache-control':'no-cache, max-age=0','service-worker-allowed':'/'});
  if(m=/^\/pwa\/([0-9a-f]{10})\/([\w.-]+)$/.exec(p)){await current();const set=sets.get(m[1])||latest,f=set.files[m[2]];if(!f)return send(404,'text/plain','Not found');return send(200,f.type,f.data,{'cache-control':set.v===m[1]?IMM:'public, max-age=300'})}
  const alias={'/favicon.ico':'favicon.ico','/favicon.svg':'favicon.svg','/apple-touch-icon.png':'apple-touch-icon.png','/apple-touch-icon-precomposed.png':'apple-touch-icon.png','/apple-touch-icon-180x180.png':'apple-touch-icon.png'}[p];
  if(alias){const {set}=await current(),f=set.files[alias];return send(200,f.type,f.data,{'cache-control':'public, max-age=3600'})}
  return false}
 const isPwaPath=p=>p==='/manifest.webmanifest'||p==='/sw.js'||p==='/favicon.ico'||p==='/favicon.svg'||/^\/apple-touch-icon(-precomposed|-180x180)?\.png$/.test(p)||/^\/pwa\/[0-9a-f]{10}\/[\w.-]+$/.test(p);
 // head tags for the current brand (async: builds the icons on first use)
 async function headTags(){const {set,spec:s}=await current();tagsNow=tags(set,s);return tagsNow}
 async function page(html){return inject(html,await headTags())}
 // the last tags built, for pages written as strings (never waits; before the first build the unversioned addresses answer the same icons)
 const headSync=()=>tagsNow||tagsSync();
 // for Settings: the set's description (where its mark came from, the colours) and the versioned address of each file
 async function info(){const {set,spec:s}=await current();return {v:set.v,gen:GEN,colour:set.colour,hasMark:set.hasMark,needsLogo:set.needsLogo,source:set.source,mono:!!s.mono,
  files:Object.fromEntries(Object.keys(set.files).map(f=>[f,'/pwa/'+set.v+'/'+f])),sourceImage:set.files['source.png']?'/pwa/'+set.v+'/source.png':null}}
 return {hook,current,manifest,tags,inject,serve,isPwaPath,headTags,page,headSync,info,swText}}
