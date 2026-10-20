// A plain zip (stored, no compression) of a folder, for Download as zip. Skips dependencies, git history and hidden files.
import {readdir,stat,readFile} from 'node:fs/promises';
import path from 'node:path';
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return b=>{let c=0xFFFFFFFF;for(const x of b)c=t[(c^x)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}})();
const SKIP=/^(node_modules|\.git|\.next|dist|\.cache|__pycache__)$/;
async function walk(dir,base,out,budget){for(const f of await readdir(dir).catch(()=>[])){if(SKIP.test(f)||f.startsWith('.'))continue;const p=path.join(dir,f),rel=base?base+'/'+f:f;const s=await stat(p).catch(()=>null);if(!s)continue;
 if(s.isDirectory())await walk(p,rel,out,budget);else{budget.n+=s.size;if(budget.n>400e6)throw Error('This folder is over 400 MB; download it in parts from Files.');out.push([rel,await readFile(p)])}}return out}
export async function zipFolder(dir,prefix){const files=await walk(dir,'',[],{n:0});const parts=[],central=[];let off=0;
 for(const [n,data] of files){const nb=Buffer.from((prefix?prefix+'/':'')+n);const crc=CRC(data);const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(20,4);lh.writeUInt16LE(0x0800,6);lh.writeUInt32LE(crc,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);lh.writeUInt16LE(nb.length,26);
  parts.push(lh,nb,data);const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);ch.writeUInt16LE(0x0800,8);ch.writeUInt32LE(crc,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(data.length,24);ch.writeUInt16LE(nb.length,28);ch.writeUInt32LE(off,42);central.push(ch,nb);off+=30+nb.length+data.length}
 const cd=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);return Buffer.concat([...parts,cd,end])}
