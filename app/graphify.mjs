// graphify (https://github.com/Graphify-Labs/graphify, Apache-2.0) for every agent (owner, 11 Nov 2026: "put graphify on
// aqeelOS too"): it maps a folder of code and documents into a graph the agent queries instead of reading every file.
// The pinned package goes into the agents' shared Python (~/workspaces/.aqeelos-python, made by agent-defaults.mjs and on
// every agent user's PATH) with its own pip call, so a failed download never holds up the Google libraries there; the
// main user gets the same program in ~/.local/bin. Its skill is written into the main agent's skills by graphify's own
// `install --platform hermes` and moved under a category, where agent-defaults copies it to every agent.
import {readFile,writeFile,stat,readdir,symlink,unlink,lstat,readlink,mkdir,rm,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {homedir} from 'node:os';

export const GRAPHIFY_VERSION='0.9.106';
const RETRY_MS=60*60e3;

export function createGraphify({HERMES_HOME,home0=homedir(),log=m=>console.log(m),run=null,now=()=>Date.now(),version=GRAPHIFY_VERSION}){
 const PY=path.join(home0,'workspaces','.aqeelos-python'),bin=path.join(PY,'bin','graphify');
 // graphify writes skills/graphify; the agents' copy step reads skills/<category>/<skill>, so it moves into a category
 const wrote=path.join(home0,'.hermes','skills','graphify'),skill=path.join(home0,'.hermes','skills','software-development','graphify'),mark=path.join(skill,'.aqeelos-version');
 const exec=run||((cmd,args,opts)=>new Promise((res,rej)=>execFile(cmd,args,opts,(e,o,er)=>e?rej(new Error(String(er||e.message).trim().split('\n').slice(-2).join(' '))):res(String(o)))));
 const has=p=>stat(p).then(()=>true,()=>false);
 let lastFail=-Infinity;
 // 11 Nov 2026 (owner: efficient on every agent): the skill's own description says to use it for any question about a
 // codebase or project, and its 50 KB body loads each time. Agents now have a small search tool for that (agent-graph.mjs),
 // so the description points there and the skill stays for building a map by hand. Only graphify's own text is replaced.
 const SLIM='description: "Only for building or refreshing a map by hand. To look something up, use the graphify search tool (query_graph) instead of this skill."';
 const slim=async f=>{const t=await readFile(f,'utf8').catch(()=>null);if(t===null)return false;const m=/^description: ".*"$/m.exec(t);if(!m||m[0]===SLIM||!/knowledge graph/.test(m[0]))return false;await writeFile(f,t.replace(m[0],()=>SLIM));return true};
 // the main agent's skill and every agent's copy of it (agent-defaults copied the long one before); true when one changed
 const slimAll=async()=>{let n=await slim(path.join(skill,'SKILL.md'));
  for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))if(d.isDirectory()&&!d.name.startsWith('.'))n=await slim(path.join(HERMES_HOME,'profiles',d.name,'skills','software-development','graphify','SKILL.md'))||n;return n};
 const hasMcp=()=>exec(path.join(PY,'bin','python'),['-c','import mcp'],{timeout:30e3}).then(()=>true,()=>false);
 const installedVersion=async()=>(/graphify\s+([\d.]+)/.exec(await exec(bin,['--version'],{timeout:30e3}).catch(()=>''))||[])[1]||null;
 // returns true when the skill was (re)written, so the caller knows something changed
 async function ensure(){if(!await has(path.join(PY,'bin','pip')))return false;   // the shared Python is made by agent-defaults first
  if(now()-lastFail<RETRY_MS)return false;
  try{if(await installedVersion()!==version||!await hasMcp()){
    // [mcp]: the extra the search tool's server needs (not in the plain package)
    await exec(path.join(PY,'bin','pip'),['install','-q','--disable-pip-version-check','graphifyy[mcp]=='+version],{timeout:15*60e3,maxBuffer:8e6});
    await exec('chmod',['-R','a+rX',PY],{timeout:120e3});
    if(await installedVersion()!==version)throw new Error('graphify '+version+' did not install');log('graphify: '+version+' installed in the agents\' shared Python')}
   // the main user's own `graphify`
   const link=path.join(home0,'.local','bin','graphify');
   if(await readlink(link).catch(()=>null)!==bin)try{await mkdir(path.dirname(link),{recursive:true});if(await lstat(link).catch(()=>null))await unlink(link);await symlink(bin,link)}catch(e){log('graphify: no link in ~/.local/bin: '+e.message)}
   if((await readFile(mark,'utf8').catch(()=>'')).trim()===version)return slimAll();   // the short description, once, for copies made before it
   await exec(bin,['install','--platform','hermes'],{timeout:120e3,env:{...process.env,HOME:home0},cwd:home0});
   if(!await has(path.join(wrote,'SKILL.md')))throw new Error('graphify wrote no skill to '+wrote);
   await rm(skill,{recursive:true,force:true});await mkdir(path.dirname(skill),{recursive:true});await rename(wrote,skill);
   await slimAll();await writeFile(mark,version+'\n');log('graphify: '+version+' skill installed for the main agent (copied to every agent)');return true}
  catch(e){lastFail=now();log('graphify: '+e.message+' (next try in an hour)');return false}}
 // for the Usage page: is it ready, and how many agents have the skill
 async function status(){const ready=(await readFile(mark,'utf8').catch(()=>'')).trim()===version&&await has(bin);let agents=await has(path.join(skill,'SKILL.md'))?1:0;
  for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
   if(d.isDirectory()&&!d.name.startsWith('.')&&await has(path.join(HERMES_HOME,'profiles',d.name,'skills','software-development','graphify','SKILL.md')))agents++;
  return {state:ready?'on':'installing',version,agents}}
 return {ensure,status,bin,skill}}
