// Pictures for agents and people, checked the same way on both routes: the type comes from the file's first bytes
// (never the header the browser sent), one size cap, and the emoji slugs from assets/emoji/list.json (Fluent Emoji 3D, MIT).
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const LIST=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','assets','emoji','list.json');
export const AVATAR_MAX=1e6;   // the browser crops to 256x256 WebP first, so a real upload is ~10 to 60 KB
export const AVATAR_TYPES={png:'image/png',jpg:'image/jpeg',webp:'image/webp'};
// png, jpg or webp from the magic bytes, else null
export function imgKind(b){if(!b||b.length<12)return null;
 if(b[0]===0x89&&b.toString('latin1',1,4)==='PNG'&&b[4]===0x0d&&b[5]===0x0a)return 'png';
 if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'jpg';
 if(b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP')return 'webp';
 return null}
// read a picture upload: {buf,ext} or {error,status}
export async function readPicture(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>AVATAR_MAX)return {status:413,error:'Pictures must be under 1 MB.'};chunks.push(c)}
 const buf=Buffer.concat(chunks),ext=imgKind(buf);return ext?{buf,ext}:{status:415,error:'Use a JPG, PNG or WebP picture.'}}
let slugs=null;
export async function emojiSlugs(){if(!slugs){try{slugs=JSON.parse(await readFile(LIST,'utf8')).map(e=>e.slug)}catch{return []}}return slugs}
// the automatic emoji for an id: the same FNV-1a hash as emojiAuto in core.js, so server and browser agree
export function emojiAuto(id,l){if(!l.length)return '';let h=2166136261;for(const c of String(id))h=Math.imul(h^c.charCodeAt(0),16777619);return l[(h>>>0)%l.length]}
