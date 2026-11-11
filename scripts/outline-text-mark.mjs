// One-off: turns the single letter of assets/aqeelos-mark.svg (system-ui bold, which no pixel renderer can draw without a font)
// into real outlines taken from a TrueType font file, written to assets/aqeelos-mark-outline.svg. app/icons.mjs draws that file
// whenever the source mark has text. Run: node scripts/outline-text-mark.mjs "C:/Windows/Fonts/segoeuib.ttf"
import {readFileSync,writeFileSync} from 'node:fs';
const f=readFileSync(process.argv[2]||'C:/Windows/Fonts/segoeuib.ttf'),svgPath=new URL('../assets/aqeelos-mark.svg',import.meta.url);
const svg=readFileSync(svgPath,'utf8'),tm=/<text[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)<\/text>/.exec(svg);
const [,tx,ty,fs,ch]=tm;const tbl={};for(let i=0;i<f.readUInt16BE(4);i++){const o=12+i*16;tbl[f.toString('latin1',o,o+4)]=f.readUInt32BE(o+8)}
const upem=f.readUInt16BE(tbl.head+18),locFmt=f.readInt16BE(tbl.head+50),nH=f.readUInt16BE(tbl.hhea+34);
// cmap format 4
let cm=tbl.cmap,n=f.readUInt16BE(cm+2),sub=0;for(let i=0;i<n;i++){const pid=f.readUInt16BE(cm+4+i*8),eid=f.readUInt16BE(cm+6+i*8);if(pid===3&&eid===1)sub=cm+f.readUInt32BE(cm+8+i*8)}
const segX2=f.readUInt16BE(sub+6),segs=segX2/2,code=ch.codePointAt(0);let gid=0;
for(let s=0;s<segs;s++){const end=f.readUInt16BE(sub+14+s*2),st=f.readUInt16BE(sub+16+segX2+s*2),dl=f.readInt16BE(sub+16+segX2*2+s*2),roO=sub+16+segX2*3+s*2,ro=f.readUInt16BE(roO);
 if(code<=end&&code>=st){gid=ro?f.readUInt16BE(roO+ro+(code-st)*2):0;if(gid)gid=(gid+dl)&0xffff;else gid=(code+dl)&0xffff;break}}
const loc=g=>locFmt?f.readUInt32BE(tbl.loca+g*4):f.readUInt16BE(tbl.loca+g*2)*2,go=tbl.glyf+loc(gid),nc=f.readInt16BE(go);if(nc<0)throw Error('composite glyph');
const ends=[];let p=go+10;for(let i=0;i<nc;i++,p+=2)ends.push(f.readUInt16BE(p));const np=ends.at(-1)+1,il=f.readUInt16BE(p);p+=2+il;
const fl=[];while(fl.length<np){const v=f[p++];fl.push(v);if(v&8){let r=f[p++];while(r--)fl.push(v)}}
const rd=(sh,same)=>{const o=[];let v=0;for(let i=0;i<np;i++){const x=fl[i];if(x&sh){const d=f[p++];v+=x&same?d:-d}else if(!(x&same)){v+=f.readInt16BE(p);p+=2}o.push(v)}return o},X=rd(2,16),Y=rd(4,32);
const adv=f.readUInt16BE(tbl.hmtx+Math.min(gid,nH-1)*4),k=fs/upem,ox=tx-adv*k/2,P=(i)=>[+(ox+X[i]*k).toFixed(2),+(ty-Y[i]*k).toFixed(2)],on=i=>fl[i]&1;let d='',s0=0;
for(const e of ends){const idx=[];for(let i=s0;i<=e;i++)idx.push(i);s0=e+1;const pts=idx.map(i=>({p:P(i),on:on(i)}));
 // start at an on-curve point (or the midpoint of two off-curve ones)
 let st=pts.findIndex(q=>q.on),seq;if(st<0){const a=pts[0].p,b=pts[1].p;seq=[{p:[(a[0]+b[0])/2,(a[1]+b[1])/2],on:true},...pts.slice(1),pts[0]]}else seq=[...pts.slice(st),...pts.slice(0,st)];
 d+='M'+seq[0].p.join(' ');let i=1;const m=seq.length;const q=j=>seq[j%m];
 while(i<=m){const c=q(i);if(c.on||i===m){d+='L'+(i===m?seq[0].p:c.p).join(' ');i++}else{const nx=q(i+1);const end=nx.on?nx.p:[(c.p[0]+nx.p[0])/2,(c.p[1]+nx.p[1])/2];d+='Q'+c.p.join(' ')+' '+end.join(' ');i+=nx.on?2:1}}d+='Z'}
const out=svg.replace(tm[0],`<path fill="${/fill="(#[0-9a-fA-F]+)"[^>]*text-anchor/.exec(svg)?.[1]||'#fff'}" fill-rule="nonzero" d="${d}"/>`);
writeFileSync(new URL('../assets/aqeelos-mark-outline.svg',import.meta.url),out.replace('<svg ','<!-- the letter of aqeelos-mark.svg as outlines (scripts/outline-text-mark.mjs, from Segoe UI Bold) --><svg '));console.log(out.length)
