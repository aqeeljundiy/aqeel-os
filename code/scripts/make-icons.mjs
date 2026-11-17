// Draws the aqeelOS mark (the orbit: a ring, the O of OS, with a dot moving round it, on a dark rounded square, as in assets/aqeelos-mark.svg;
// chosen by the owner 17 Nov 2026, replacing the typed "a") as PNG files and assets/icon.ico, with no image libraries. Run: node scripts/make-icons.mjs
// It writes every copy: Code and the desktop app (code/assets), the web app (assets/icon-*.png, and assets/aqeelos-mark-render.png, the mark
// alone in white that the home-screen icons are drawn from) and the Chrome extension (extension/icon-*.png).
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum])};

// the mark on a 64-unit grid: rounded square (radius 14), a ring (centre 32,32, radius 10 to 16) with a round cut (radius 7.5) round
// the dot (centre 43,21, radius 4.5) at its top right. Keep it in step with assets/aqeelos-mark.svg (scripts/aqeelos-mark.test.mjs checks both).
const MARGIN=4;   // units of transparent edge, so the icon sits like other apps' icons in the Dock and taskbar
function inside(u,v){const g=64-2*MARGIN,x=(u-MARGIN)*64/g,y=(v-MARGIN)*64/g;if(x<0||y<0||x>64||y>64)return 0;
 const r=14,cx=Math.min(Math.max(x,r),64-r),cy=Math.min(Math.max(y,r),64-r);if(Math.hypot(x-cx,y-cy)>r)return 0;
 return orbit(x,y)?2:1}
function orbit(x,y){const r=Math.hypot(x-32,y-32),d=Math.hypot(x-43,y-21);return (r>=10&&r<=16&&d>7.5)||d<=4.5}
// the mark alone, white on transparent, filling the square (assets/aqeelos-mark-render.png: what the web app's home-screen icons are drawn from)
function drawMark(size){return png(size,(u,v)=>orbit(u,v)?[255,255,255,255]:null)}
function draw(size){const bg=[0x11,0x18,0x27];return png(size,(u,v)=>{const k=inside(u,v);return k?(k===2?[255,255,255,255]:[...bg,255]):null})}
// a PNG of size x size, each pixel sampled 4 x 4 times on the 64-unit grid
function png(size,at){const S=4,px=Buffer.alloc(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){const c=at((x+(sx+.5)/S)/size*64,(y+(sy+.5)/S)/size*64);if(!c)continue;r+=c[0];g+=c[1];b+=c[2];a+=255}
  const i=(y*size+x)*4,n=S*S,cov=a/255;px[i]=cov?r/cov:0;px[i+1]=cov?g/cov:0;px[i+2]=cov?b/cov:0;px[i+3]=a/n}
 const rows=[];for(let y=0;y<size;y++)rows.push(Buffer.from([0]),px.subarray(y*size*4,(y+1)*size*4));
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))])}
// an .ico holding PNG images (Windows Vista and later read these at every size)
function ico(sizes){const imgs=sizes.map(draw),head=Buffer.alloc(6);head.writeUInt16LE(1,2);head.writeUInt16LE(sizes.length,4);let off=6+16*sizes.length;
 const dir=sizes.map((s,i)=>{const e=Buffer.alloc(16);e[0]=s>=256?0:s;e[1]=s>=256?0:s;e.writeUInt16LE(1,4);e.writeUInt16LE(32,6);e.writeUInt32LE(imgs[i].length,8);e.writeUInt32LE(off,12);off+=imgs[i].length;return e});
 return Buffer.concat([head,...dir,...imgs])}

const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','assets');
for(const size of [180,512])writeFileSync(path.join(dir,`icon-${size}.png`),draw(size));
writeFileSync(path.join(dir,'icon.ico'),ico([16,24,32,48,64,128,256]));
const top=path.join(dir,'..','..');
for(const size of [180,512])writeFileSync(path.join(top,'assets',`icon-${size}.png`),draw(size));
writeFileSync(path.join(top,'assets','aqeelos-mark-render.png'),drawMark(2048));
for(const size of [16,32,48,128])writeFileSync(path.join(top,'extension',`icon-${size}.png`),draw(size));
console.log('icons written');
