// Hand edits on the live box (GIT-2, 12 Nov 2026): no model, no deploy needed. Every file of the live app folder is compared
// with the commit the box says it runs (.deployed-commit, read from the deploys' git checkout). A file that differs, one
// that is gone, or a new one made since the deploy is a hand edit: the next deploy would put the old file back, and nobody
// reviewed it. The result is one Health item (System › Health › Fixes waiting for review); it clears itself once the folder
// matches the commit again. A deploy unpacks file by file, so a difference only counts once it has lasted `settle`.
import {writeStore} from './store.mjs';
import {readFile,writeFile,readdir,stat,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import path from 'node:path';

// the same folders and leftovers as the deploy's drift guard (scripts/box-live.sh)
export const DIRS=['app','assets','backlog','engine','extension','scripts','code-installer'];
export const SKIP=/\.bak|\.prev$|\.orig$|\.tmp$|\.rej$|\.pyc$|(^|\/)(node_modules|__pycache__)\/|(^|\/)features\.mjs$/;
export const blobId=buf=>createHash('sha1').update('blob '+buf.length+'\0').update(buf).digest('hex');
const gitOut=(args,cwd)=>new Promise(res=>execFile('git',args,{cwd,timeout:60e3,maxBuffer:64e6},(e,o)=>res(e?null:String(o))));
async function walk(dir,rel,out){for(const d of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const r=rel+'/'+d.name;
 if(d.isDirectory()){if(d.name!=='node_modules'&&d.name!=='__pycache__')await walk(path.join(dir,d.name),r,out)}else if(d.isFile())out.push(r)}return out}

// → {ok, commit, changed:[], removed:[], added:[]} or {ok:false, why}
export async function liveDrift({live,repo,git=gitOut}){
 const commit=(await readFile(path.join(live,'.deployed-commit'),'utf8').catch(()=>'')).trim();if(!/^[0-9a-f]{7,40}$/.test(commit))return {ok:false,why:'the box does not say which commit it runs'};
 const tree=await git(['ls-tree','-r','-z',commit,'--',...DIRS],repo);if(tree==null)return {ok:false,why:'the checkout does not have '+commit.slice(0,8)};
 const known=new Map(),changed=[],removed=[],added=[];
 for(const e of tree.split('\0')){const m=/^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(e);if(!m||m[1]==='120000'||SKIP.test(m[3]))continue;known.set(m[3],m[2])}
 for(const [f,id] of known){const b=await readFile(path.join(live,f)).catch(()=>null);if(!b)removed.push(f);else if(blobId(b)!==id)changed.push(f)}
 // a file only on the box counts when it is newer than the deploy (older ones are leftovers)
 const since=(await stat(path.join(live,'.deployed-commit')).catch(()=>null))?.mtimeMs||0;
 for(const d of DIRS)for(const r of await walk(path.join(live,d),d,[])){if(known.has(r)||SKIP.test(r))continue;const s=await stat(path.join(live,r)).catch(()=>null);if(s&&s.mtimeMs>since+1000)added.push(r)}
 return {ok:true,commit,changed:changed.sort(),removed:removed.sort(),added:added.sort()}}

export function createLiveDrift({DATA,live,repo,settle=10*60e3,now=()=>Date.now(),git}){const F=path.join(DATA,'live-drift.json');
 const read=async()=>{try{return JSON.parse(await readFile(F,'utf8'))}catch{return {}}};
 const write=async d=>{await mkdir(DATA,{recursive:true});await writeStore(F,JSON.stringify(d,null,1))};
 async function check(){const r=await liveDrift({live,repo,git});if(!r.ok)return r;const prev=await read();
  const files=[...r.changed,...r.removed.map(f=>f+' (removed)'),...r.added.map(f=>f+' (new)')];
  // the clock restarts when the commit changes (a deploy) or the box was clean in between
  const since=files.length?(prev.commit===r.commit&&prev.files?.length?prev.since:now()):0;
  await write({commit:r.commit,at:now(),since,files:files.slice(0,200),count:files.length});return {...r,files}}
 // the one Health item, or null
 async function item(){const s=await read();if(!s.files?.length||now()-s.since<settle)return null;
  return {commit:s.commit,since:s.since,at:s.at,count:s.count||s.files.length,files:s.files.slice(0,50)}}
 return {check,item}}
