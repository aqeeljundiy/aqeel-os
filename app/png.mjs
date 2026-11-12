// Tiny PNG / ICO toolkit with no dependencies (node:zlib only): encode, decode, resize and the .ico wrapper. It is what lets
// every install draw its own icons at runtime without sharp, a headless browser or any outside service (12 Nov 2026).
import zlib from 'node:zlib';

const T=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
export const crc32=b=>{let c=~0;for(let i=0;i<b.length;i++)c=T[(c^b[i])&255]^(c>>>8);return ~c>>>0};
const chunk=(t,d)=>{const b=Buffer.alloc(12+d.length);b.writeUInt32BE(d.length,0);b.write(t,4,'latin1');d.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,8+d.length)),8+d.length);return b};
export const PNG_SIG=Buffer.from([137,80,78,71,13,10,26,10]);

// rgba: w*h*4 bytes. opaque:true writes an RGB image with no alpha channel at all (what an iOS home-screen icon needs).
export function encodePng(w,h,rgba,{opaque=false}={}){
 const ch=opaque?3:4,stride=w*ch+1,raw=Buffer.alloc(stride*h);
 for(let y=0;y<h;y++){const o=y*stride;raw[o]=0;if(opaque)for(let x=0;x<w;x++){const s=(y*w+x)*4,d=o+1+x*3;raw[d]=rgba[s];raw[d+1]=rgba[s+1];raw[d+2]=rgba[s+2]}else Buffer.from(rgba.buffer,rgba.byteOffset+y*w*4,w*4).copy(raw,o+1)}
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=opaque?2:6;
 return Buffer.concat([PNG_SIG,chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])}

// width, height and colour type without decoding the pixels (null when it is not a PNG)
export function pngInfo(buf){if(!Buffer.isBuffer(buf)||buf.length<33||!buf.subarray(0,8).equals(PNG_SIG)||buf.toString('latin1',12,16)!=='IHDR')return null;
 return {w:buf.readUInt32BE(16),h:buf.readUInt32BE(20),depth:buf[24],type:buf[25],interlaced:buf[28]===1}}

// full decode to straight RGBA (8, 16, and 1-4 bit palettes; not interlaced)
export function decodePng(buf){const info=pngInfo(buf);if(!info)throw Error('Not a PNG image.');if(info.interlaced)throw Error('Interlaced PNGs are not supported. Re-save it without interlacing.');
 const {w,h,depth,type}=info;if(!w||!h||w>8192||h>8192||w*h>4096*4096)throw Error('That image is too large.');   // 16 million pixels at most (audit M21: 8192×8192 took 1.1 GB)
 let p=8,idat=[],plte=null,trns=null;while(p+8<=buf.length){const n=buf.readUInt32BE(p),t=buf.toString('latin1',p+4,p+8),d=buf.subarray(p+8,p+8+n);if(t==='IDAT')idat.push(d);else if(t==='PLTE')plte=d;else if(t==='tRNS')trns=d;else if(t==='IEND')break;p+=12+n}
 const ch={0:1,2:3,3:1,4:2,6:4}[type];if(!ch)throw Error('Unsupported PNG type.');
 const bpp=Math.max(1,ch*depth>>3),rowBytes=Math.ceil(w*ch*depth/8);let raw;try{raw=zlib.inflateSync(Buffer.concat(idat),{maxOutputLength:(rowBytes+1)*h+65536})}catch{throw Error('This PNG is damaged.')}   // never more than its own size says (a small file that unpacks to gigabytes)
 if(raw.length<(rowBytes+1)*h)throw Error('This PNG is damaged.');
 const px=Buffer.alloc(rowBytes*h);
 for(let y=0;y<h;y++){const f=raw[y*(rowBytes+1)],s=y*(rowBytes+1)+1,d=y*rowBytes;
  for(let i=0;i<rowBytes;i++){const a=i>=bpp?px[d+i-bpp]:0,b=y?px[d-rowBytes+i]:0,c=i>=bpp&&y?px[d-rowBytes+i-bpp]:0;let v=raw[s+i];
   if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const pp=a+b-c,pa=Math.abs(pp-a),pb=Math.abs(pp-b),pc=Math.abs(pp-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c}px[d+i]=v&255}}
 const out=new Uint8Array(w*h*4);
 const sample=(row,idx)=>{ // idx-th sample of a row, scaled to 0-255 (palette types keep the raw index)
  if(depth===8)return px[row+idx];if(depth===16)return px[row+idx*2];const per=8/depth,byte=px[row+Math.floor(idx/per)],sh=8-depth*(idx%per+1),v=(byte>>sh)&((1<<depth)-1);return type===3?v:Math.round(v*255/((1<<depth)-1))};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const row=y*rowBytes,o=(y*w+x)*4;let r,g,b,a=255;
  if(type===3){const i=sample(row,x);r=plte?.[i*3]??0;g=plte?.[i*3+1]??0;b=plte?.[i*3+2]??0;a=trns&&i<trns.length?trns[i]:255}
  else if(type===0){r=g=b=sample(row,x)}
  else if(type===4){r=g=b=sample(row,x*2);a=sample(row,x*2+1)}
  else{r=sample(row,x*ch);g=sample(row,x*ch+1);b=sample(row,x*ch+2);if(type===6)a=sample(row,x*ch+3)}
  out[o]=r;out[o+1]=g;out[o+2]=b;out[o+3]=a}
 return {w,h,data:out}}

// area-average resize of straight RGBA (premultiplied while mixing, so transparent edges do not turn dark)
export function resize(src,sw,sh,dw,dh){const out=new Uint8Array(dw*dh*4),fx=sw/dw,fy=sh/dh;
 for(let y=0;y<dh;y++){const y0=y*fy,y1=Math.min(sh,(y+1)*fy);for(let x=0;x<dw;x++){const x0=x*fx,x1=Math.min(sw,(x+1)*fx);let r=0,g=0,b=0,a=0,wt=0;
  for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++){const wy=Math.min(sy+1,y1)-Math.max(sy,y0);for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){const wx=Math.min(sx+1,x1)-Math.max(sx,x0),ww=wx*wy,i=(sy*sw+sx)*4,al=src[i+3]*ww;r+=src[i]*al;g+=src[i+1]*al;b+=src[i+2]*al;a+=al;wt+=ww}}
  const o=(y*dw+x)*4;if(a>0){out[o]=Math.round(r/a);out[o+1]=Math.round(g/a);out[o+2]=Math.round(b/a);out[o+3]=Math.round(a/wt)}}}
 return out}

// .ico holding PNG images (every browser since IE9 reads them)
export function encodeIco(images){const n=images.length,head=Buffer.alloc(6+16*n);head.writeUInt16LE(1,2);head.writeUInt16LE(n,4);let off=head.length;
 images.forEach(({size,png},i)=>{const o=6+16*i;head[o]=size>=256?0:size;head[o+1]=size>=256?0:size;head.writeUInt16LE(1,o+4);head.writeUInt16LE(32,o+6);head.writeUInt32LE(png.length,o+8);head.writeUInt32LE(off,o+12);off+=png.length});
 return Buffer.concat([head,...images.map(i=>i.png)])}
