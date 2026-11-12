// Branding for this install (System › Branding): the name (aqeelOS by default), a logo (SVG or PNG) and who to contact
// about it (shown on the terms, privacy and about pages). Kept in DATA/brand.json and DATA/brand-logo.<ext>, so updates
// never reset them. The look stays ours: the font is Plus Jakarta Sans and the logo is shown in black and white (a
// colourful SVG is refused; any logo is drawn in greyscale). The page was removed on 24 Oct 2026 and brought back on
// 7 Nov 2026 so a new owner can set it in the app instead of in a file.
import {readStore,writeStore} from './store.mjs';
import {readFile,writeFile,unlink,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT='aqeelOS';
// does an SVG use colour? Only black, white and greys are allowed (and none/currentColor/transparent)
export function colourful(svg){const s=String(svg);const hex=[...s.matchAll(/#([0-9a-f]{3,8})\b/gi)].map(m=>m[1]);const rgb=[...s.matchAll(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/gi)].map(m=>[+m[1],+m[2],+m[3]]);
 const toRgb=h=>{h=h.length<=4?h.slice(0,3).split('').map(c=>c+c).join(''):h.slice(0,6);return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
 const sat=([r,g,b])=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b);return mx?((mx-mn)/mx):0};
 const named=/\b(fill|stroke|stop-color|color)\s*[:=]\s*["']?(red|blue|green|yellow|orange|purple|pink|cyan|magenta|lime|teal|navy|maroon|olive|aqua|fuchsia|gold|brown|violet|indigo)\b/i.test(s);
 return named||[...hex.map(toRgb),...rgb].some(c=>sat(c)>.12)}

export function createBrand({DATA,contactFallback='',fallbackMarks=async()=>[],colourDefault='',accentDefault=''}){
 const FILE=path.join(DATA,'brand.json');let b=null;
 const load=async()=>{if(!b){b=await readStore(FILE)}return b};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeStore(FILE,JSON.stringify(b,null,1))};
 const publish=()=>{globalThis.AQ_BRAND=b.name||DEFAULT;globalThis.AQ_CONTACT=b.contact||''};
 async function get(){await load();publish();return {name:b.name||DEFAULT,logo:b.logo?'/ui/brand/logo?v='+(b.v||0):null,custom:!!(b.name&&b.name!==DEFAULT)||!!b.logo||!!b.icon,contact:b.contact||'',contactDefault:contactFallback,...(b.colour?{colour:b.colour}:{}),...(b.accent?{accent:b.accent}:{}),...(b.mono?{mono:true}:{}),...(b.icon?{icon:true}:{})}}
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
 // the icon (home screen, browser tab, Android): colours of its tile and mark, an uploaded square image that replaces the drawn one,
 // and the explicit "use a letter" choice. Changing any of them changes the version, so phones fetch the new icons.
 const hexOf=v=>{v=String(v||'').trim().replace('#','');if(/^[0-9a-f]{3}$/i.test(v))v=v.split('').map(c=>c+c).join('');return /^[0-9a-f]{6}$/i.test(v)?'#'+v.toLowerCase():null};
 async function setColours({colour,accent}){await load();for(const [k,v] of [['colour',colour],['accent',accent]]){if(v===undefined)continue;if(v===''||v===null){delete b[k];continue}const h=hexOf(v);if(!h)throw Error('Use a colour like #1a2b3c.');b[k]=h}b.v=Date.now();await save();return get()}
 async function setMono(on){await load();if(on)b.mono=true;else delete b.mono;b.v=Date.now();await save();return get()}
 async function setIcon(buf,type){await load();const png=buf.slice(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),svg=/svg/.test(type)||/^\s*(<\?xml|<svg)/.test(buf.slice(0,200).toString());
  if(!buf?.length)throw Error('Choose an image.');if(buf.length>3*1024*1024)throw Error('Use an image under 3 MB.');
  if(!png&&!svg){if(buf.slice(0,3).equals(Buffer.from([255,216,255]))||buf.slice(0,4).toString('latin1')==='RIFF')throw Error('Send a PNG or SVG (the page converts JPG and WebP for you).');throw Error('Use a PNG or SVG image.')}
  if(svg){const t=buf.toString('utf8');if(/<script|on\w+\s*=|javascript:|<foreignObject/i.test(t))throw Error('This SVG has scripts or links in it. Save it as a plain SVG.');const m=/viewBox\s*=\s*"([^"]+)"/i.exec(t)?.[1]?.split(/[\s,]+/).map(Number);if(!m||m.length!==4||Math.abs(m[2]-m[3])>m[2]*.02)throw Error('The SVG must be square (its viewBox needs the same width and height).')}
  else{const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20);if(w!==h)throw Error('Use a square image. This one is '+w+' x '+h+'.');if(w<512)throw Error('Use at least 512 x 512 pixels. This one is '+w+' x '+h+'.');if(buf[28]===1)throw Error('Save the PNG without interlacing.')}
  for(const e of ['svg','png'])await unlink(path.join(DATA,'brand-icon.'+e)).catch(()=>{});b.icon=svg?'svg':'png';b.v=Date.now();await mkdir(DATA,{recursive:true});await writeFile(path.join(DATA,'brand-icon.'+b.icon),buf);await save();return get()}
 async function clearIcon(){await load();for(const e of ['svg','png'])await unlink(path.join(DATA,'brand-icon.'+e)).catch(()=>{});delete b.icon;b.v=Date.now();await save();return get()}
 // everything buildIcons needs: the name, colours, the uploaded icon, and the real marks to look at in order (the uploaded logo, then this install's built-in ones)
 let specAt=null;   // every change above bumps b.v, so the files are read again only then
 async function iconSpec(){await load();if(specAt&&specAt.v===(b.v||0))return specAt.spec;const l=await logo();const cands=[];if(l)cands.push({file:'brand-logo.'+b.logo+' (the logo uploaded in System › Branding)',type:l.type,data:l.data});cands.push(...await fallbackMarks({custom:!!(b.name&&b.name!==DEFAULT)||!!b.logo}).catch(()=>[]));
  let custom=null;if(b.icon){try{custom={type:b.icon==='svg'?'image/svg+xml':'image/png',data:await readFile(path.join(DATA,'brand-icon.'+b.icon))}}catch{}}
  const spec={name:b.name||DEFAULT,colour:b.colour||'',defaultColour:colourDefault,accent:b.accent||accentDefault||'',mono:!!b.mono,custom,markCands:cands,v:b.v||0};specAt={v:b.v||0,spec};return spec}
 const name=async()=>(await load(),publish(),b.name||DEFAULT);
 return {get,setName,setContact,setLogo,clearLogo,logo,name,setColours,setMono,setIcon,clearIcon,iconSpec}}
