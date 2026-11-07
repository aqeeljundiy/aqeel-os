// Draws the app icon (the plain aqeelOS mark: a lowercase a on a dark rounded square, as in assets/aqeelos-mark.svg)
// as PNG files and assets/icon.ico, with no image libraries. Run: node scripts/make-icons.mjs
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum])};

// the mark on a 64-unit grid: rounded square (radius 14), a ring (centre 29,35, radius 10.5) and a stem (x 39.5, y 22 to 46), 5.5 wide
const MARGIN=4;   // units of transparent edge, so the icon sits like other apps' icons in the Dock and taskbar
function inside(u,v){const g=64-2*MARGIN,x=(u-MARGIN)*64/g,y=(v-MARGIN)*64/g;if(x<0||y<0||x>64||y>64)return 0;
 const r=14,cx=Math.min(Math.max(x,r),64-r),cy=Math.min(Math.max(y,r),64-r);if(Math.hypot(x-cx,y-cy)>r)return 0;
 const ring=Math.abs(Math.hypot(x-29,y-35)-10.5)<=2.75,stem=Math.hypot(x-39.5,y-Math.min(Math.max(y,22),46))<=2.75;return ring||stem?2:1}
function draw(size){const S=4,px=Buffer.alloc(size*size*4),bg=[0x11,0x18,0x27];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){const k=inside((x+(sx+.5)/S)/size*64,(y+(sy+.5)/S)/size*64);if(!k)continue;const c=k===2?[255,255,255]:bg;r+=c[0];g+=c[1];b+=c[2];a+=255}
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
writeFileSync(path.join(dir,'icon.ico'),ico([16,24,32,48,64,128,256]));console.log('icons written');
