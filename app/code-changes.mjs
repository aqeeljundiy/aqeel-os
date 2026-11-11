// Code changes made on the live box that git does not have yet (7 Nov 2026: the fixer patched app code on the box, the
// next deploy put the old file back, and the problem came back). Two folders, both shown on System › Health:
//   DATA/drift/<time>.patch          the deploy found the live files differ from the commit the box said it ran, saved
//                                    the difference before unpacking (scripts/box-live.sh), and printed it
//   DATA/fixer-patches/<issue>-try<n>.patch   a proven fixer change to aqeelOS's own code (issues.mjs)
// "Taken into git" moves a patch to <folder>/done/, so the list only holds what still needs a coding session.
import {readFile,readdir,stat,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export const KINDS={drift:'drift',fixer:'fixer-patches'};
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.patch$/;
// the files a patch touches (its +++ lines), without the a/ b/ prefix
export function patchFiles(text){const out=[];for(const m of String(text||'').matchAll(/^\+\+\+ (?:b\/)?([^\t\n]+)/gm)){const f=m[1].trim();if(f!=='/dev/null'&&!out.includes(f))out.push(f)}
 for(const m of String(text||'').matchAll(/^--- (?:a\/)?([^\t\n]+)\t?.*\n\+\+\+ \/dev\/null/gm)){const f=m[1].trim();if(!out.includes(f))out.push(f+' (removed)')}return out}
// the "# " lines at the top: what made it and why
export const patchNote=text=>String(text||'').split('\n').filter(l=>l.startsWith('# ')).slice(0,4).map(l=>l.slice(2)).join(' ');

// one Health "Needs you" item for the drift patches that wait (12 Nov 2026: three fixes sat in DATA/drift for days while the same bugs came back
// after every deploy). The key is the patch name, so a restart never files it twice; "taken into git" (done) lets the item go.
export const driftItem=p=>({agent:'default',affects:['aqeelos'],source:'health',healthKey:'drift:'+p.name,what:'Live code changes are not in git',
 missing:('The box had changes git does not have ('+p.name+'): '+p.files.join(', ')).slice(0,480),
 hold:'Take '+p.name+' into git, or drop it. Each deploy puts the git files back, so a fix that is only on the box comes back as the old bug. Open System › Health › Code changes, read the patch, port what is still right.',
 evidence:(p.note+'\nFiles: '+p.files.join(', ')).slice(0,1800)});
export function createCodeChanges({DATA,fileIssue=null}){
 const dirOf=k=>{if(!KINDS[k])throw Error('Unknown kind.');return path.join(DATA,KINDS[k])};
 const safe=n=>{if(!NAME.test(String(n||'')))throw Error('Unknown patch.');return n};
 async function list(){const out=[];for(const k of Object.keys(KINDS)){const d=dirOf(k);
   for(const n of (await readdir(d).catch(()=>[])).filter(n=>NAME.test(n))){const f=path.join(d,n);const s=await stat(f).catch(()=>null);if(!s?.isFile())continue;
    const t=await readFile(f,'utf8').catch(()=>'');out.push({kind:k,name:n,at:s.mtimeMs,size:s.size,files:patchFiles(t).slice(0,30),note:patchNote(t).slice(0,400),issue:k==='fixer'?n.replace(/-try\d+\.patch$/,''):null})}}
  return out.sort((a,b)=>b.at-a.at)}
 const read=async(k,n)=>{const t=await readFile(path.join(dirOf(k),safe(n)),'utf8');return t.length>400e3?t.slice(0,400e3)+'\n… (cut; the whole file is on the box)':t};
 async function done(k,n){const d=dirOf(k);await mkdir(path.join(d,'done'),{recursive:true});await rename(path.join(d,safe(n)),path.join(d,'done',n));return true}
  // files an item for every drift patch that has none yet; safe to run at every start and every hour
 const filed=new Set();
 async function raise(){if(!fileIssue)return 0;let n=0;for(const p of (await list()).filter(x=>x.kind==='drift')){if(filed.has(p.name))continue;
   try{await fileIssue(driftItem(p));filed.add(p.name);n++}catch(e){console.warn('code changes: could not file '+p.name+': '+e.message)}}return n}
 return {list,read,done,raise}}
