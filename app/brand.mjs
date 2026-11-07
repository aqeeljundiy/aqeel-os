// Branding for this install (System › Branding): the name (aqeelOS by default), a logo (SVG or PNG) and who to contact
// about it (shown on the terms, privacy and about pages). Kept in DATA/brand.json and DATA/brand-logo.<ext>, so updates
// never reset them. The look stays ours: the font is Plus Jakarta Sans and the logo is shown in black and white (a
// colourful SVG is refused; any logo is drawn in greyscale). The page was removed on 24 Oct 2026 and brought back on
// 7 Nov 2026 so a new owner can set it in the app instead of in a file.
import {readFile,writeFile,unlink,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT='aqeelOS';
// does an SVG use colour? Only black, white and greys are allowed (and none/currentColor/transparent)
export function colourful(svg){const s=String(svg);const hex=[...s.matchAll(/#([0-9a-f]{3,8})\b/gi)].map(m=>m[1]);const rgb=[...s.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/gi)].map(m=>[+m[1],+m[2],+m[3]]);
 const toRgb=h=>{h=h.length<=4?h.slice(0,3).split('').map(c=>c+c).join(''):h.slice(0,6);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
 const sat=([r,g,b])=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b);return mx?((mx-mn)/mx):0};
 const named=/\b(fill|stroke|stop-color|color)\s*[:=]\s*["']?(red|blue|green|yellow|orange|purple|pink|cyan|magenta|lime|teal|navy|maroon|olive|aqua|fuchsia|gold|brown|violet|indigo)\b/i.test(s);
 return named||[...hex.map(toRgb),...rgb].some(c=>sat(c)>.12)}

export function createBrand({DATA,contactFallback=''}){
 const FILE=path.join(DATA,'brand.json');let b=null;
 const load=async()=>{if(!b){try{b=JSON.parse(await readFile(FILE,'utf8'))}catch{b={}}}return b};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(b,null,1));await rename(FILE+'.tmp',FILE)};
 const publish=()=>{globalThis.AQ_BRAND=b.name||DEFAULT;globalThis.AQ_CONTACT=b.contact||''};
 async function get(){await load();publish();return {name:b.name||DEFAULT,logo:b.logo?'/ui/brand/logo?v='+(b.v||0):null,custom:!!(b.name&&b.name!==DEFAULT)||!!b.logo,contact:b.contact||'',contactDefault:contactFallback}}
 async function setName(name){await load();const n=String(name||'').replace(/[<>"`]/g,'').trim().slice(0,24);if(n&&!/^[\p{L}\p{N} ._-]{2,24}$/u.test(n))throw Error('Use 2 to 24 letters, numbers or spaces.');b.name=n||'';b.v=Date.now();await save();return get()}
 // plain words only (a name, an email, a phone): it goes into public pages
 async function setContact(c){await load();const t=String(c||'').replace(/[<>"`]/g,'').replace(/\s+/g,' ').trim();if(t.length>120)throw Error('Keep it under 120 characters.');b.contact=t;await save();return get()}
 async function setLogo(buf,type){await load();if(!buf?.length)throw Error('Choose a logo file.');if(buf.length>512*1024)throw Error('Use a logo under 512 KB.');
  const svg=/svg/.test(type)||/^\s*(<\?xml|<svg)/.test(buf.slice(0,200).toString());const png=buf.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!svg&&!png)throw Error('Use an SVG or PNG logo.');
  if(svg){const t=buf.toString('utf8');if(/<script|on\w+\s*=|javascript:|<foreignObject/i.test(t))throw Error('This SVG has scripts or links in it. Save it as a plain SVG.');if(colourful(t))throw Error('Keep the logo black and white (greys are fine): this SVG uses colour.')}
  for(const e of ['svg','png'])await unlink(path.join(DATA,'brand-logo.'+e)).catch(()=>{});
  b.logo=svg?'svg':'png';b.v=Date.now();await mkdir(DATA,{recursive:true});await writeFile(path.join(DATA,'brand-logo.'+b.logo),buf);await save();return get()}
 async function clearLogo(){await load();for(const e of ['svg','png'])await unlink(path.join(DATA,'brand-logo.'+e)).catch(()=>{});delete b.logo;b.v=Date.now();await save();return get()}
 async function logo(){await load();if(!b.logo)return null;try{return {type:b.logo==='svg'?'image/svg+xml':'image/png',data:await readFile(path.join(DATA,'brand-logo.'+b.logo))}}catch{return null}}
 const name=async()=>(await load(),publish(),b.name||DEFAULT);
 return {get,setName,setContact,setLogo,clearLogo,logo,name}}
