// Draws the extension's round white icon (dark brand mark) as PNGs, with no image package: shapes are
// sampled 4×4 per pixel and written as a plain PNG. Run: node scripts/ext-icons.mjs
import {deflateSync} from 'node:zlib';
import {writeFileSync} from 'node:fs';

const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=0xFFFFFFFF;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}})();
const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(CRC(td));return Buffer.concat([len,td,crc])};
function png(w,h,rgba){const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4)}
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}

// in a 32-unit box: white disc with a faint edge, a diamond ring and a small solid diamond in the middle
function sample(x,y){const dx=x-16,dy=y-16,r=Math.hypot(dx,dy),d=Math.abs(dx)+Math.abs(dy);
 if(r>15.5)return null;
 if((d<=10.4&&d>=7.6)||d<=3.6)return [17,17,17];
 if(r>14.7)return [214,217,224];
 return [255,255,255]}
function draw(size){const buf=Buffer.alloc(size*size*4),N=4;
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){let R=0,G=0,B=0,A=0;
  for(let sy=0;sy<N;sy++)for(let sx=0;sx<N;sx++){const c=sample((px+(sx+.5)/N)*32/size,(py+(sy+.5)/N)*32/size);if(c){R+=c[0];G+=c[1];B+=c[2];A++}}
  const i=(py*size+px)*4;if(A){buf[i]=R/A;buf[i+1]=G/A;buf[i+2]=B/A;buf[i+3]=Math.round(255*A/(N*N))}}
 return png(size,size,buf)}
for(const s of [16,32,48,128])writeFileSync(new URL('../extension/icon-'+s+'.png',import.meta.url),draw(s));
console.log('extension icons written: 16, 32, 48, 128');
