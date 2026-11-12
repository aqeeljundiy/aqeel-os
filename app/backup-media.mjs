// Backups, part 2 (13 Nov 2026): what makes a nightly backup big, and what is done about it. Measured on Elkiya on 12 Nov: 41 GB of files,
// 28.6 GB packed, 32 min to pack and 80 min to upload, every night, though about 3 GB a day is new. The rules, all in this file:
//
// 1. Left out because aqeelOS or the program can make it again (EXCLUDE_MORE below, EXCLUDE in backup.mjs): downloaded browser kernels,
//    browser component caches, aqeelOS's own AdsPower install, and Python virtual environments. A virtual environment is not simply
//    left out: its pyvenv.cfg and the list of packages it holds (name-version, read from its .dist-info folders) go into the manifest,
//    so it can be made again exactly. Nothing a person or an agent made is left out by a name rule.
// 2. Large files that did not change go to a media pack once, not into every night. A file of PACK_MIN bytes or more, not a database, not
//    written in the last PACK_QUIET ms, is packed (gzip level 1, encrypted like the nightly archive) into a media pack in its own Drive
//    folder, and recorded in the index with path, size, mtime and sha-256. Next night, a file with the same path, size and mtime is
//    not packed again: the night's archive has a manifest (backup-manifest.json) that says which pack holds it. Packs are never changed.
//    A pack stays in Drive while any kept night's manifest names it (a pack nothing names any more goes to the Drive bin after a day).
//    Restoring a night = that night's archive + the packs its manifest names; restoreMedia() does the second half, and so does
//    scripts/restore-media.mjs, by hand.
// 3. Files that cannot be read (they belong to a deleted agent's Linux user, or are private) are skipped with a reason and written to one
//    list, DATA/backup-skipped.json. Each night only files that are new on the list are said; the Backups card shows the list.
import {readdir,lstat,readFile,access,constants,mkdir,writeFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {readStore,writeStore} from './store.mjs';

export const PACK_MIN=128*1024;            // below this a file stays in the nightly archive: thousands of tiny entries are not worth tracking
export const PACK_QUIET=3*3600e3;          // a file written in the last 3 hours may still be being written: it stays in the nightly archive
export const PACK_MAX=4e9;                // one media pack holds at most about this much: a pack that is whole is kept even when the night then fails
export const PACK_GRACE=864e5;             // a pack nothing names any more is binned after a day
export const MANIFEST='backup-manifest.json';
export const MEDIA_PREFIX='aqeelos-media-';
export const MEDIA_NAME=/^aqeelos-media-\d{4}-\d\d-\d\d-\d\d-\d\d-[0-9a-f]{4}(-\d+)?\.tar\.gz\.enc$/;
// tar --exclude patterns (tar's own matching: a pattern matches a whole path or what follows any "/", * also crosses "/")
export const EXCLUDE_MORE=[
 // aqeelOS's own copy of the AdsPower desktop app (installed by aqeelOS, like workspaces/.aqeelos-python)
 'workspaces/.aqeelos-adspower',
 // the browser kernels AdsPower downloads into every agent's workspace (about 1 GB each, 9 copies on Elkiya, the same files)
 '*/adspower_global/cwd_global/chrome_*',
 // Chromium's downloaded component, certificate and safe-browsing lists and GPU caches (the profile with its logins stays)
 'component_crx_cache','CertificateRevocation','Safe Browsing','DawnWebGPUCache','DawnGraphiteCache','BrowserMetrics','BrowserMetrics-spare.pma','OptGuideOnDeviceModel','optimization_guide_model_store','Crashpad'];
const DBFILE=/\.(db|sqlite3?)(-wal|-shm|-journal)?$|\.(pid|lock|sock)$/;
const GLOB=/[*?[\]\\\n]/;   // a name with these is never offloaded or excluded by name: tar would read it as a pattern
export const plainName=p=>!GLOB.test(p);
const SPECIAL=new Set('.+?^${}()|[]\\'.split(''));
const esc=s=>[...s].map(c=>SPECIAL.has(c)?'\\'+c:c).join('');
// a test for one relative path against tar --exclude patterns
export function excludeTester(patterns){const res=patterns.map(e=>new RegExp('(^|/)'+esc(e).split('*').join('.*')+'$'));return rel=>res.some(r=>r.test(rel))}

/* One walk over what a backup holds. Folders the patterns exclude are not entered. A folder with a pyvenv.cfg is a Python virtual
   environment: it is not entered either, and is returned in venvs with its configuration and package list. */
export async function scan({root,include,excl}){const files=[],venvs=[];
 const put=(rel,s)=>files.push({rel,size:s.size,mtime:Math.floor(s.mtimeMs),mode:s.mode&0o7777,uid:s.uid});
 async function walk(rel){let names;try{names=await readdir(path.join(root,rel))}catch{return}
  if(rel&&names.includes('pyvenv.cfg')){venvs.push(await venvInfo(root,rel));return}
  const kept=names.map(n=>rel?rel+'/'+n:n).filter(r=>!excl(r));
  const st=await Promise.all(kept.map(r=>lstat(path.join(root,r)).catch(()=>null)));
  for(let i=0;i<kept.length;i++){const s=st[i];if(!s)continue;if(s.isDirectory())await walk(kept[i]);else if(s.isFile())put(kept[i],s)}}
 for(const top of include){const s=await lstat(path.join(root,top)).catch(()=>null);if(!s)continue;if(s.isDirectory())await walk(top);else if(s.isFile())put(top,s)}
 return {files,venvs}}
async function venvInfo(root,rel){const cfg=(await readFile(path.join(root,rel,'pyvenv.cfg'),'utf8').catch(()=>'')).slice(0,2000),packages=[];
 for(const lib of ['lib','lib64'])for(const py of await readdir(path.join(root,rel,lib)).catch(()=>[]))if(/^python/.test(py))
  for(const n of await readdir(path.join(root,rel,lib,py,'site-packages')).catch(()=>[]))if(n.endsWith('.dist-info'))packages.push(n.slice(0,-10));
 return {path:rel,cfg,packages:[...new Set(packages)].sort()}}

// the fresh files in groups of at most max bytes (a file bigger than that is a group of its own)
export function chunkBySize(list,max=PACK_MAX){const out=[];let cur=[],n=0;for(const f of list){if(cur.length&&n+f.size>max){out.push(cur);cur=[];n=0}cur.push(f);n+=f.size}if(cur.length)out.push(cur);return out}
// can this file be kept in a media pack?
// (the index and the manifest copy in the data folder, and their .last-good, stay in the archive: they change every night)
const SELF=/(^|\/)backup-(media|manifest|skipped)\.json(\.last-good)?$/;
export const eligible=(f,{now,min=PACK_MIN,quiet=PACK_QUIET,never=[]})=>f.size>=min&&now-f.mtime>quiet&&plainName(f.rel)&&!DBFILE.test(f.rel)&&!SELF.test(f.rel)&&!never.includes(f.rel);
export const emptyIndex=()=>({v:1,files:{},packs:{},nights:{}});
/* The index (DATA/backup-media.json): files {rel:{size,mtime,sha,pack}}, packs {name:{id,size,at}}, nights {archive name:[pack names]},
   It is rebuilt from nothing when lost (the next night packs everything once more); what it does not know, it never bins (see prunable). */
export const readIndex=file=>readStore(file,emptyIndex);
export const saveIndex=(file,ix)=>writeStore(file,JSON.stringify(ix),{mode:0o600});
// planned from the walk: files already in a pack (same path, size, mtime, and the pack still exists) and files that need packing
export function plan(files,index,o){const reused=[],fresh=[];
 for(const f of files){if(!eligible(f,o))continue;const e=index.files[f.rel];
  if(e&&e.size===f.size&&e.mtime===f.mtime&&index.packs[e.pack])reused.push({...f,sha:e.sha,pack:e.pack});else fresh.push(f)}
 return {reused,fresh}}
// the index after the packs that Drive no longer holds (or holds with another size) are forgotten: their files are packed again
export function forgetMissing(index,have){const gone=[];for(const [n,p] of Object.entries(index.packs))if(have[n]==null||(p.size&&have[n]!==p.size))gone.push(n);
 for(const n of gone)delete index.packs[n];for(const [rel,e] of Object.entries(index.files))if(!index.packs[e.pack])delete index.files[rel];return gone}
// the manifest a night's archive carries: every file kept in a pack, grouped by the pack that holds it, and the virtual environments to make again
export function buildManifest({name,at,entries,venvs,skipped=0}){const packs={};for(const e of entries)(packs[e.pack]||=[]).push([e.rel,e.size,e.mtime,e.sha,e.mode]);
 return {v:1,name,at,packs,venvs,skipped,files:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0)}}
export const manifestPacks=m=>Object.keys(m?.packs||{});
// packs that can go to the Drive bin: named by no kept night, older than PACK_GRACE. kept: [{name, media}] (media: the night was made with a
// manifest, Drive says so). null when that cannot be known safely: a kept night with a manifest that the index has no record of (the index
// was lost) may name packs the index does not know, so nothing is binned until it is gone
export function prunable(index,kept,now){
 if(kept.some(k=>k.media&&!(k.name in index.nights)))return null;
 const used=new Set();for(const k of kept)for(const p of index.nights[k.name]||[])used.add(p);
 return Object.entries(index.packs).filter(([n,p])=>!used.has(n)&&now-(p.at||0)>PACK_GRACE).map(([n])=>n)}
export function dropNights(index,kept){for(const n of Object.keys(index.nights))if(!kept.includes(n))delete index.nights[n]}

export const sha256File=file=>new Promise((res,rej)=>{const h=createHash('sha256');createReadStream(file).on('data',d=>h.update(d)).on('error',rej).on('end',()=>res(h.digest('hex')))});
// the files of a fresh list that are still what they were (size and mtime) after they were read: a changed one is left to the nightly archive
export async function stillSame(root,list){const ok=[],changed=[];
 for(const f of list){const s=await lstat(path.join(root,f.rel)).catch(()=>null);(s&&s.isFile()&&s.size===f.size&&Math.floor(s.mtimeMs)===f.mtime?ok:changed).push(f)}return {ok,changed}}
// readable by this process (an unreadable file is the nightly archive's to report, never packed)
export const readable=async(root,f)=>access(path.join(root,f.rel),constants.R_OK).then(()=>true,()=>false);

/* ---------- skipped files */
// tar's complaints about files it could not read: "tar: <path>: Cannot open: Permission denied" (and stat, read, savedir, opendir)
export function parseSkips(text){const out=[];for(const l of String(text||'').split('\n')){const m=/^tar: (.+?): Cannot (?:open|read|savedir|opendir|stat)(?:: (.*))?$/.exec(l.trim());if(!m)continue;
  if(/No such file/.test(m[2]||''))continue;   // gone before it was read: a file that vanished is not a skipped one
  out.push({path:m[1].replace(/^\.\//,''),why:m[2]||''})}return out}
const TRASH_PLACES=['apps/hermes-ui-data/agent-trash/','workspaces/.removed/'];
// the reason, in words, from the file's owner and mode. users: the uids that still exist (/etc/passwd); a trash folder's files are
// kept when readable and skipped with this reason when not (the rule for deleted agents' files)
export function reasonFor(rel,{uid,mode},users){const gone=uid!=null&&users&&!users.has(uid),trash=TRASH_PLACES.some(p=>rel.startsWith(p));
 if(gone)return trash?'belongs to a deleted agent (its Linux user is gone, so aqeelOS cannot read it); it is in the agent trash':'belongs to a Linux user that no longer exists, so aqeelOS cannot read it';
 return 'a private file of another user'+(mode!=null?' (mode '+(mode&0o777).toString(8)+')':'')+', so aqeelOS cannot read it'}
export const passwdUids=text=>new Set(String(text||'').split('\n').map(l=>l.split(':')[2]).filter(x=>/^\d+$/.test(x)).map(Number));
/* The list: {since, files:{path:{reason,first,last}}}. A file that can be read again leaves it. fresh: the paths new on the list tonight. */
export function mergeSkipped(prev,found,now){const files={};const fresh=[];
 for(const f of found){const o=prev?.files?.[f.path];files[f.path]={reason:f.reason,first:o?.first||now,last:now};if(!o)fresh.push(f.path)}
 return {list:{since:prev?.since||now,files},fresh}}
export const summarizeSkipped=list=>{const a=Object.entries(list?.files||{}),by={};for(const [p,o] of a){const k=o.reason;(by[k]||={n:0,example:p}).n++}
 return {count:a.length,since:list?.since||0,reasons:Object.entries(by).map(([reason,o])=>({reason,n:o.n,example:o.example})).sort((x,y)=>y.n-x.n)}};

/* ---------- restoring the packs of a night */
const run=(cmd,env)=>new Promise((res,rej)=>{const p=spawn('bash',['-c',cmd],{env:{...process.env,...env},stdio:['ignore','ignore','pipe']});let e='';p.stderr.on('data',d=>e+=d);p.on('close',c=>c===0?res():rej(Error(e.trim().split('\n').slice(-2).join(' ')||'exit '+c)))});
const sq=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
/* Puts the files a manifest names back under dir. getPack(name) gives the path of that pack's encrypted file on this box (downloaded by
   the caller), key opens it. only(rel) picks files. Each file is checked (size, then sha-256) once it is out; the result says what was
   restored, what is missing from its pack and what does not match. A pack that cannot be opened is an error. */
export async function restoreMedia({manifest,dir,key,getPack,only=()=>true,onPack=()=>{},verify=true}){
 const out={restored:0,bytes:0,missing:[],bad:[],packs:0};
 for(const [pack,list] of Object.entries(manifest.packs||{})){const want=list.filter(e=>only(e[0]));if(!want.length)continue;
  const enc=await getPack(pack);onPack(pack,want);const lf=path.join(dir,'.media-want-'+process.pid);await mkdir(dir,{recursive:true});await writeFile(lf,want.map(e=>e[0]).join('\0')+'\0');
  try{await run('set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:AQ_BK -in '+sq(enc)+' | tar -xzf - -C '+sq(dir)+' --null -T '+sq(lf)+' --ignore-failed-read',{AQ_BK:key})}
  catch(e){throw Error('The media pack '+pack+' could not be opened: '+e.message)}
  for(const [rel,size,mtime,sha] of want){const f=path.join(dir,rel),s=await lstat(f).catch(()=>null);
   if(!s){out.missing.push(rel);continue}
   if(s.size!==size||verify&&sha&&await sha256File(f)!==sha){out.bad.push(rel);continue}
   out.restored++;out.bytes+=size}
  out.packs++}
 await rm(path.join(dir,'.media-want-'+process.pid),{force:true});return out}
