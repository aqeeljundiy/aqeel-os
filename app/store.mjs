// One way to read and write the JSON files aqeelOS keeps its state in (audit H4 / M4 / M5, 12 Nov 2026).
// Before: about 45 modules did `try{db=JSON.parse(await readFile(FILE))}catch{db={}}` and saved later, so ONE failed read (a hand edit, a
// half-written file, EIO, too many open files) made the module start from nothing and write that over the real file: the people list,
// the accounts, the open issues. Rules here:
// - only "the file does not exist" means new. Any other failure (unreadable, empty, not JSON) marks the file BAD: it is left untouched,
//   the caller gets the last good copy when there is one (else the default) to work with in memory, every save is refused, and one Health
//   item names the file (storeHooks.bad). It heals by itself once the file reads again (someone repaired it, or put the copy back).
// - every write is atomic (own temp name, fsync, rename), one at a time per file, and keeps the version before it as <file>.last-good.
// - two first readers of one file get the same object (the in-flight read is shared), so neither works on a copy the other replaces.
import {readFile,writeFile,rename,mkdir,unlink,link,copyFile,open,readdir,stat} from 'node:fs/promises';
import {readFileSync,openSync,writeSync,fsyncSync,closeSync,renameSync,linkSync,unlinkSync,copyFileSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export const storeHooks={bad:null,good:null};   // bad(file, why), good(file): the server files and clears the Health item
const waiting=[];   // files found bad before the server set the hooks (the first stores are read while it starts)
export function setStoreHooks(h){Object.assign(storeHooks,h);for(const [file,why] of waiting.splice(0)){try{if(storeBad(file))storeHooks.bad?.(file,why)}catch{}}}
const files=new Map();   // absolute path → {bad:why|null, reading:Promise|null, queue:Promise, told:boolean}
const rec=f=>{const k=path.resolve(String(f));let r=files.get(k);if(!r){r={bad:null,reading:null,queue:Promise.resolve(),told:false};files.set(k,r)}return r};
const fresh=d=>typeof d==='function'?d():d&&typeof d==='object'?JSON.parse(JSON.stringify(d)):d;
const parse=t=>{if(!String(t).trim())throw Error('the file is empty');return JSON.parse(t)};
const LAST='.last-good';
const mark=(file,r,e)=>{r.bad=String(e?.message||e).slice(0,200);if(!r.told){r.told=true;console.warn('store: '+file+' cannot be read ('+r.bad+'). It is left as it is and nothing is saved over it.');if(storeHooks.bad){try{storeHooks.bad(file,r.bad)}catch{}}else waiting.push([file,r.bad])}};
const heal=(file,r)=>{if(!r.bad)return;r.bad=null;r.told=false;console.log('store: '+file+' reads again');try{storeHooks.good?.(file)}catch{}};

/* readStore(file, fallback) → the parsed file; fallback (a value, or a function that makes one) when the file does not exist.
   A file that exists but cannot be read or parsed: the last good copy when there is one, else the fallback, and the file is BAD (see above).
   {replace:true} is for state that can be rebuilt: see below. */
export function readStore(file,fallback={},{replace=false}={}){const r=rec(file);
 return r.reading||=(async()=>{try{
   let t;try{t=await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT'){heal(file,r);return fresh(fallback)}throw e}
   const v=parse(t);heal(file,r);return v}
  catch(e){
   // replace: state that can be rebuilt (a cache, a tick's bookkeeping). The unreadable file is put aside as <file>.corrupt-<time> and the
   // module goes on from the last good copy or the default, saving as usual; said in the log, not on Health.
   if(replace){const keep=file+'.corrupt-'+Date.now();await rename(file,keep).catch(()=>{});console.warn('store: '+file+' could not be read ('+String(e.message).slice(0,120)+'); kept as '+path.basename(keep)+', starting again');try{return parse(await readFile(file+LAST,'utf8'))}catch{return fresh(fallback)}}
   mark(file,r,e);try{return parse(await readFile(file+LAST,'utf8'))}catch{return fresh(fallback)}}
  finally{r.reading=null}})()}
export const storeBad=file=>rec(file).bad;
export class StoreRefused extends Error{constructor(file,why){super(path.basename(String(file))+' could not be read ('+why+'), so nothing is saved over it. Repair the file or put back '+path.basename(String(file))+LAST+', then try again.');this.code='STORE_BAD';this.file=file}}

/* writeStore(file, text, {mode}) → writes text atomically; refuses (StoreRefused) while the file is BAD, after looking once more whether it reads now. */
export function writeStore(file,text,{mode}={}){const r=rec(file);
 const p=r.queue.then(async()=>{
  if(r.bad){try{parse(await readFile(file,'utf8'));heal(file,r)}catch(e){if(e.code==='ENOENT')heal(file,r);else throw new StoreRefused(file,r.bad)}}
  await atomicWrite(file,text,{mode,keepLast:true})});
 r.queue=p.catch(()=>{});return p}
// the bare write, for files that are not JSON state too: own temp name, synced, renamed over; the temp file never stays behind
export async function atomicWrite(file,data,{mode,keepLast=false}={}){await mkdir(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';
 try{const h=await open(tmp,'w',mode??0o666);try{await h.writeFile(data);await h.sync()}finally{await h.close()}
  // the version being replaced stays as <file>.last-good: a hard link to it (no copy), made before the rename so the file itself never goes missing
  if(keepLast){const lg=file+LAST;try{await unlink(lg).catch(()=>{});await link(file,lg)}catch(e){if(e.code!=='ENOENT')await copyFile(file,lg).catch(()=>{})}}
  await rename(tmp,file)}
 catch(e){await unlink(tmp).catch(()=>{});throw e}}
// JSON in one call
export const saveStore=(file,value,{pretty=1,mode}={})=>writeStore(file,JSON.stringify(value,null,pretty),{mode});
// read, change, write as one step in the file's queue: fn(data) may return false to save nothing
export function updateStore(file,fallback,fn,o){const r=rec(file);let out;
 const p=r.queue.then(async()=>{const d=await readStore(file,fallback);if(r.bad)throw new StoreRefused(file,r.bad);out=await fn(d);if(out===false)return;await atomicWrite(file,JSON.stringify(d,null,o?.pretty??1),{mode:o?.mode,keepLast:true})}).then(()=>out);
 r.queue=p.catch(()=>{});return p}
/* The same rules for the few modules that must stay synchronous (install.mjs: the address and time zone are asked for in the middle of other code).
   readStoreSync(file, fallback): the file; fallback when it does not exist; when it exists but cannot be read the last good copy (else the fallback) and the
   file is BAD (shared with the async functions above: one Health item, saves refused). It reads again on every call, so a repaired file is picked up.
   saveStoreSync(file, value) / writeStoreSync(file, text): atomic (temp name, fsync, rename, <file>.last-good); throws StoreRefused while the file is BAD. */
export function readStoreSync(file,fallback={}){const r=rec(file);
 let t;try{t=readFileSync(file,'utf8')}catch(e){if(e.code==='ENOENT'){heal(file,r);return fresh(fallback)}mark(file,r,e);return lastGoodSync(file,fallback)}
 try{const v=parse(t);heal(file,r);return v}catch(e){mark(file,r,e);return lastGoodSync(file,fallback)}}
const lastGoodSync=(file,fallback)=>{try{return parse(readFileSync(file+LAST,'utf8'))}catch{return fresh(fallback)}};
export function writeStoreSync(file,text,{mode}={}){const r=rec(file);
 if(r.bad){try{parse(readFileSync(file,'utf8'));heal(file,r)}catch(e){if(e.code==='ENOENT')heal(file,r);else throw new StoreRefused(file,r.bad)}}
 mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp';
 try{const h=openSync(tmp,'w',mode??0o666);try{writeSync(h,text);fsyncSync(h)}finally{closeSync(h)}
  const lg=file+LAST;try{try{unlinkSync(lg)}catch{}linkSync(file,lg)}catch(e){if(e.code!=='ENOENT'){try{copyFileSync(file,lg)}catch{}}}
  renameSync(tmp,file)}
 catch(e){try{unlinkSync(tmp)}catch{}throw e}}
export const saveStoreSync=(file,value,{pretty=1,mode}={})=>writeStoreSync(file,JSON.stringify(value,null,pretty),{mode});
// temp files a killed write left behind (older than an hour) are removed at start
export async function sweepTmp(dir,{olderMs=3600e3,now=Date.now()}={}){let n=0;for(const f of await readdir(dir).catch(()=>[])){if(!/\.tmp$/.test(f))continue;const p=path.join(dir,f),s=await stat(p).catch(()=>null);if(s?.isFile()&&now-s.mtimeMs>olderMs){await unlink(p).catch(()=>{});n++}}return n}
export const _reset=()=>files.clear();   // tests
