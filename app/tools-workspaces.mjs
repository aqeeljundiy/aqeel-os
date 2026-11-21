// The engine runs an agent's terminal with HOME set to its tools' home (~/.hermes/home for the main agent, ~/.hermes/profiles/<a>/home
// for the others). So "~/workspaces/default/x.pdf" in a terminal command is <tools home>/workspaces/..., while the agent names the file
// by its real place, /home/<user>/workspaces/..., in its reply. On 21 Nov 2026 Donna made the owner's October partner report as a PDF
// with `cd ~/workspaces/default/reports`, attached it as /home/claude/workspaces/default/reports/..., and the engine skipped the
// attachment three times ("Skipping MEDIA directive path (not found on this host)") while she said "Here is the PDF".
// Long-term fix: <tools home>/workspaces is a link to the real workspaces folder, so both names are the same files. A folder already
// there is merged into the real one first: a file the real folder lacks is moved, an identical one is dropped, and one that differs is
// never written over the real one: it is kept aside in <tools home>/workspaces-leftovers-<date>/ (on Elkiya the shadow folders held
// 10 Nov copies of each AGENTS.md, older than the real ones). A big folder (over MAX_FILES) is only reported, never moved by itself.
import {lstat,readdir,readlink,mkdir,rename,rm,rmdir,symlink,stat,readFile} from 'node:fs/promises';
import path from 'node:path';

export const MAX_FILES=500;

async function files(dir,out=[],rel=''){for(const d of await readdir(path.join(dir,rel),{withFileTypes:true})){const r=path.join(rel,d.name);
  if(d.isDirectory())await files(dir,out,r);else out.push({rel:r,link:d.isSymbolicLink()});if(out.length>MAX_FILES)return out}return out}
const same=async(a,b)=>{try{const [x,y]=await Promise.all([stat(a),stat(b)]);if(x.size!==y.size)return false;return (await readFile(a)).equals(await readFile(b))}catch{return false}};
async function pruneEmpty(dir){let n=0;for(const d of await readdir(dir,{withFileTypes:true}).catch(()=>[]))if(d.isDirectory())n+=await pruneEmpty(path.join(dir,d.name))?1:0;else n++;   // a folder counts only while something is left in it
 if(n===0)await rmdir(dir).catch(()=>{});return n>0}

// one tools home: {state:'linked'|'made'|'merged'|'conflict'|'too-big'|'other', moved, dropped, kept:[rel], aside}
export async function linkToolsWorkspaces(home,work,{now=new Date()}={}){const p=path.join(home,'workspaces');const st=await lstat(p).catch(()=>null);const r={state:'linked',moved:0,dropped:0,kept:[]};const aside=path.join(home,'workspaces-leftovers-'+now.toISOString().slice(0,10));
 if(st?.isSymbolicLink()){const to=path.resolve(home,await readlink(p));if(to===path.resolve(work))return r;return {...r,state:'other',to}}   // a link someone made on purpose: left alone
 await mkdir(work,{recursive:true});
 if(!st){await mkdir(home,{recursive:true});await symlink(work,p);return {...r,state:'made'}}
 if(!st.isDirectory())return {...r,state:'other'};
 const list=await files(p);if(list.length>MAX_FILES)return {...r,state:'too-big'};
 for(const f of list){const from=path.join(p,f.rel),to=path.join(work,f.rel);const there=await lstat(to).catch(()=>null);
  if(!there){await mkdir(path.dirname(to),{recursive:true});await rename(from,to);r.moved++}
  else if(!f.link&&there.isFile()&&await same(from,to)){await rm(from);r.dropped++}
  else{const k=path.join(aside,f.rel);if(await lstat(k).catch(()=>null)){r.conflict=f.rel;return {...r,state:'conflict'}}   // never written over either
   await mkdir(path.dirname(k),{recursive:true});await rename(from,k);r.kept.push(f.rel)}}
 await pruneEmpty(p);if(await lstat(p).catch(()=>null))return {...r,state:'conflict'};
 await symlink(work,p);return {...r,state:'merged',...(r.kept.length?{aside}:{})}}

// every tools home: the main agent's and each profile's
export async function linkAll({HERMES_HOME,WORK,log=m=>console.log(m)}){const homes=[path.join(HERMES_HOME,'home')];
 for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!d.name.startsWith('.'))homes.push(path.join(HERMES_HOME,'profiles',d.name,'home'));
 const out={};for(const h of homes){if(!(await lstat(h).catch(()=>null)))continue;try{const r=await linkToolsWorkspaces(h,WORK);out[h]=r;
   if(r.state==='merged'||r.state==='made')log('tools workspaces: '+h+'/workspaces now points at '+WORK+(r.moved||r.dropped||r.kept.length?' ('+r.moved+' moved, '+r.dropped+' identical dropped, '+r.kept.length+' differing kept in '+r.aside+')':''));
   else if(r.state==='conflict'||r.state==='too-big')log('tools workspaces: '+h+'/workspaces left as it is ('+(r.state==='too-big'?'more than '+MAX_FILES+' files':'could not set '+(r.conflict||'a file')+' aside')+'); files saved there are not where the agent names them')}
  catch(e){out[h]={state:'error',error:e.message};log('tools workspaces: '+h+': '+e.message)}}
 return out}
