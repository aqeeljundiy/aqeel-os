// A skill the main agent gave to an agent follows the main agent's copy while the agent has not changed its own (SV-6, 19 Nov 2026).
// giveSkills (accounts.mjs) copied a skill once and never again, so a fix to the main agent's copy never reached the agents: on one install
// a skill named a reference file that was gone, the Fixer fixed the main copy, and the ten agent copies kept pointing at the missing file.
// Now each give records the folder's fingerprint; when the agent's copy still has exactly that fingerprint (nobody edited it) and the main
// copy changed, the agent gets the new copy. A copy the agent or a person changed is its own and is never overwritten.
import {readdir,readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// every file under dir (relative path, size, time); the content is read only when that list changed since last time
const memo=new Map();
async function files(dir,rel=''){const out=[];for(const e of await readdir(path.join(dir,rel),{withFileTypes:true}).catch(()=>null)??[]){if(e.name==='__pycache__'||e.name==='.usage.json')continue;
 const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())out.push(...await files(dir,r));else if(e.isFile()){const s=await stat(path.join(dir,r)).catch(()=>null);if(s)out.push([r,s.size,Math.round(s.mtimeMs)])}}return out}
export async function folderSig(dir){const l=(await files(dir)).sort((a,b)=>a[0]<b[0]?-1:1);if(!l.length)return null;const k=JSON.stringify(l),m=memo.get(dir);if(m&&m.k===k)return m.v;
 const h=createHash('sha1');for(const [r] of l){h.update(r+'\0');h.update(await readFile(path.join(dir,r)).catch(()=>Buffer.alloc(0)));h.update('\0')}
 const v=h.digest('hex').slice(0,16);memo.set(dir,{k,v});return v}
// was: the fingerprint recorded when the agent last got this skill (undefined for skills given before 19 Nov 2026).
// Returns {copy: give the main copy again, sig: what to record now (undefined = leave the record as it is)}
export async function follow({src,dst,was}){const s=await folderSig(src),d=await folderSig(dst);if(!s||!d)return {copy:false,sig:was};
 if(s===d)return {copy:false,sig:s};                // same as the main copy: that is the baseline from now on
 if(was&&was===d)return {copy:true,sig:s};          // untouched since it was given, and the main copy changed
 return {copy:false,sig:was}}                       // changed by the agent or a person (or unknown): it is theirs
