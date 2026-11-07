// Built in or added on this OS (7 Nov 2026, owner: skills and plugins in two groups, ready for open source).
// Built in: what ships with aqeelOS (this repo's skills/ and engine/ plugins) or with the engine itself. On for every
// agent by default, with a per-agent off switch; not edited or deleted in the app, updated with aqeelOS.
// Added on this OS: everything else, made on this install. Editable, deletable, and never in the git repo.
// The repo's skills are copied into the main agent's skills folder (every agent reads it), only where no skill of that
// name is there yet, or where the copy is still aqeelOS's own (a marker file with the version it came from).
import {readdir,readFile,writeFile,mkdir,cp,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const MARK='.aqeelos-builtin';
const exists=p=>stat(p).then(()=>true,()=>false);
async function skillDirs(root){const out=[];let l=[];try{l=await readdir(root,{recursive:true})}catch{return out}
 for(const f of l)if(/(^|\/)SKILL\.md$/.test(f)&&!/(^|\/)\./.test(f)){const rel=path.dirname(f);out.push({name:path.basename(rel),rel,dir:path.join(root,rel)})}
 return out.sort((a,b)=>a.rel.localeCompare(b.rel))}
// a skill folder's fingerprint: every file but references/local.md (the install's own details) and the marker
async function hashDir(dir){const h=createHash('sha256');let l=[];try{l=(await readdir(dir,{recursive:true})).sort()}catch{return ''}
 for(const f of l){if(f===MARK||/(^|\/)references\/local\.md$/.test(f)||/__pycache__|\.pyc$/.test(f))continue;const p=path.join(dir,f);if(!(await stat(p)).isFile())continue;h.update(f+'\0');h.update(await readFile(p))}
 return h.digest('hex').slice(0,16)}

export function createBuiltinSkills({root,HERMES_HOME,DATA}){
 const REPO=path.join(root,'skills'),ENGINE=path.join(HERMES_HOME,'hermes-agent');
 let cache=null,at=0;
 // the names that are Built in: this repo's skills and plugins, and the ones the engine itself ships
 async function names(){if(cache&&Date.now()-at<60000)return cache;
  const repo=(await skillDirs(REPO)).map(s=>s.name);
  const eng=[...(await skillDirs(path.join(ENGINE,'skills'))),...(await skillDirs(path.join(ENGINE,'optional-skills')))].map(s=>s.name);
  const plug=new Set();for(const d of [path.join(ENGINE,'plugins'),path.join(root,'engine')])for(const e of await readdir(d,{withFileTypes:true}).catch(()=>[]))
   if(e.isDirectory()&&e.name!=='patches'&&!e.name.startsWith('_')&&(await exists(path.join(d,e.name,'plugin.yaml'))||await exists(path.join(d,e.name,'__init__.py'))))plug.add(e.name);
  // the engine's plugin groups hold plugins one level down (plugins/platforms/telegram)
  for(const g of ['platforms','model-providers','memory','image_gen','video_gen','browser','web','context_engine','cron_providers','dashboard_auth'])
   for(const e of await readdir(path.join(ENGINE,'plugins',g),{withFileTypes:true}).catch(()=>[]))if(e.isDirectory()&&!e.name.startsWith('_'))plug.add(e.name);
  cache={skills:[...new Set([...repo,...eng])].sort(),repoSkills:repo.sort(),plugins:[...plug].sort()};at=Date.now();return cache}
 // whether aqeelOS puts its own skills in: a fresh install does; an existing one only after the owner switched it on
 async function wanted(){try{return JSON.parse(await readFile(path.join(DATA,'builtin-skills.json'),'utf8')).install===true}catch{return !await exists(path.join(DATA,'users.json'))}}
 async function setWanted(on){await mkdir(DATA,{recursive:true});await writeFile(path.join(DATA,'builtin-skills.json'),JSON.stringify({install:!!on,at:new Date().toISOString()}))}
 // copy the repo's skills into the main agent's skills folder; never over a skill someone made or changed there
 async function install({log=()=>{},force=false}={}){if(!force&&!await wanted())return {skipped:'off'};
  const dest=path.join(HERMES_HOME,'skills'),have=await skillDirs(dest),out={added:[],updated:[],kept:[]};
  for(const s of await skillDirs(REPO)){const want=await hashDir(s.dir);const cur=have.find(h=>h.name===s.name);
   if(cur){let m=null;try{m=JSON.parse(await readFile(path.join(cur.dir,MARK),'utf8'))}catch{}
    if(!m){out.kept.push(s.name);continue}                                          // someone's own skill of that name
    if(m.hash===want)continue;if(await hashDir(cur.dir)!==m.hash){out.kept.push(s.name);continue}   // changed on this OS: kept
    const local=await readFile(path.join(cur.dir,'references','local.md'),'utf8').catch(()=>null);
    await rm(cur.dir,{recursive:true,force:true});await cp(s.dir,cur.dir,{recursive:true});if(local!=null){await mkdir(path.join(cur.dir,'references'),{recursive:true});await writeFile(path.join(cur.dir,'references','local.md'),local)}
    await writeFile(path.join(cur.dir,MARK),JSON.stringify({hash:want,at:new Date().toISOString()}));out.updated.push(s.name);continue}
   const to=path.join(dest,s.rel);await mkdir(path.dirname(to),{recursive:true});await cp(s.dir,to,{recursive:true});await writeFile(path.join(to,MARK),JSON.stringify({hash:want,at:new Date().toISOString()}));out.added.push(s.name)}
  if(out.added.length||out.updated.length)log('built-in skills: added '+(out.added.join(', ')||'none')+'; updated '+(out.updated.join(', ')||'none'));cache=null;return out}
 return {names,install,wanted,setWanted,_hash:hashDir}}
