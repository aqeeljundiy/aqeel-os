// Code changes made on the live box that git does not have yet (7 Nov 2026: the fixer patched app code on the box, the
// next deploy put the old file back, and the problem came back). Two folders, both shown on System › Health:
//   DATA/drift/<time>.patch          the deploy found the live files differ from the commit the box said it ran, saved
//                                    the difference before unpacking (scripts/box-live.sh), and printed it
//   DATA/fixer-patches/<issue>-try<n>.patch   a proven fixer change to aqeelOS's own code (issues.mjs)
// GIT-2 (12 Nov 2026): the fixer no longer edits live code. Two more kinds are listed here, from other places:
//   pr     a fixer branch (fix/<issue>) committed in the box's own checkout; its pull request link once opened, or "waits for a
//          GitHub token" while there is none (issues.mjs reviews(), fixer-git.mjs)
//   hand   one item: files of the live app folder that differ from the deployed commit (live-drift.mjs)
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

export function createCodeChanges({DATA,fixes=async()=>[],hand=async()=>null,diff=async()=>''}){
 const dirOf=k=>{if(!KINDS[k])throw Error('Unknown kind.');return path.join(DATA,KINDS[k])};
 const safe=n=>{if(!NAME.test(String(n||'')))throw Error('Unknown patch.');return n};
 async function list(){const out=[];for(const k of Object.keys(KINDS)){const d=dirOf(k);
   for(const n of (await readdir(d).catch(()=>[])).filter(n=>NAME.test(n))){const f=path.join(d,n);const s=await stat(f).catch(()=>null);if(!s?.isFile())continue;
    const t=await readFile(f,'utf8').catch(()=>'');out.push({kind:k,name:n,at:s.mtimeMs,size:s.size,files:patchFiles(t).slice(0,30),note:patchNote(t).slice(0,400),issue:k==='fixer'?n.replace(/-try\d+\.patch$/,''):null})}}
  for(const x of await fixes().catch(()=>[]))out.push({kind:'pr',name:x.branch,at:x.at,size:0,files:(x.files||[]).slice(0,30),note:String(x.note||'').slice(0,400),issue:x.issue,pr:x.url||null,number:x.number||null,state:x.state,why:x.why||null});
  const h=await hand().catch(()=>null);if(h)out.push({kind:'hand',name:'live-edits',at:h.at,size:0,files:h.files,note:'Files in the live app folder differ from the deployed commit '+String(h.commit).slice(0,8)+' ('+h.count+').',issue:null});
  return out.sort((a,b)=>b.at-a.at)}
 const read=async(k,n)=>{if(k==='pr')return diff(String(n||'').replace(/^fix\//,''));if(k==='hand'){const h=await hand();return h?h.files.join('\n'):''}
 const t=await readFile(path.join(dirOf(k),safe(n)),'utf8');return t.length>400e3?t.slice(0,400e3)+'\n… (cut; the whole file is on the box)':t};
 async function done(k,n){const d=dirOf(k);await mkdir(path.join(d,'done'),{recursive:true});await rename(path.join(d,safe(n)),path.join(d,'done',n));return true}
 return {list,read,done}}
