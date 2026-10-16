// Draws the app icon (Elkiya diamond mark on the brand blue) as PNG files, with no image libraries.
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
const crc=buf=>{let c=0xffffffff;for(const b of buf)c=crcTable[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0};
const chunk=(type,data)=>{const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum])};

function draw(size){const S=4,px=Buffer.alloc(size*size*4);const top=[0x2f,0x7b,0xff],bottom=[0x01,0x58,0xcb];
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let r=0,g=0,b=0,a=0;
  for(let sy=0;sy<S;sy++)for(let sx=0;sx<S;sx++){const u=(x+(sx+.5)/S)/size*2-1,v=(y+(sy+.5)/S)/size*2-1;const t=(v+1)/2;
   let col=[top[0]+(bottom[0]-top[0])*t,top[1]+(bottom[1]-top[1])*t,top[2]+(bottom[2]-top[2])*t];
   const d=Math.abs(u)+Math.abs(v);if((d<=0.62&&d>=0.48)||d<=0.2)col=[255,255,255]; // outlined diamond + centre diamond
   r+=col[0];g+=col[1];b+=col[2];a+=255}
  const i=(y*size+x)*4,n=S*S;px[i]=r/n;px[i+1]=g/n;px[i+2]=b/n;px[i+3]=a/n}
 const rows=[];for(let y=0;y<size;y++)rows.push(Buffer.from([0]),px.subarray(y*size*4,(y+1)*size*4));
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))])}

const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','assets');
for(const size of [180,512])writeFileSync(path.join(dir,`icon-${size}.png`),draw(size));console.log('icons written');
