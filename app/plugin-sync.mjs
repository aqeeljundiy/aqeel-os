// Every copy of an engine plugin this repo ships stays the shipped version (12 Nov 2026). The repo ships plugins in engine/<name>/ (a folder
// with a plugin.yaml). The installer copied one into ~/.hermes/plugins once ("already there") and each agent got its own copy when it was made
// (~/.hermes/profiles/<agent>/plugins/<name>); nothing ever updated a copy. On one install every copy of the Claude sign-in plugin was weeks
// old and lacked a header fix, so an agent fell back to another vendor's model 483 times in a week; the other install had the fix only because
// somebody copied it by hand. Now one mechanism, used by the app (a task of the reconciler: at start, when a plugins folder changed, every 4
// hours), by a deploy (scripts/box-live.sh, after the live test) and by the installer (scripts/install.sh), all through sync() below:
//   - the shipped file list of a plugin is every file under engine/<name>/ except caches, backups and logs (SKIP). A copy's file is compared
//     by content hash (sha256) and replaced only when it differs or is missing: written beside the file, then renamed over it;
//   - nothing else in a copy is ever read, written or deleted: files the copy has that the repo does not ship (assets/ of a hub install, the
//     sidecar bili.json, *.bak* a person left, __pycache__, a file the repo dropped) and everything outside the plugin's own folder
//     (plugins/.install-metadata.json, config.yaml, .env, sign-ins). The shipped plugins write nothing into their own folder when they run;
//   - a home that does not have the plugin does not get it (what an agent opted into stays as it is); `add` names the homes that do (the
//     installer: the engine home, once);
//   - the files a copy had before an update are kept once, in <data>/plugin-sync/prev/<agent>/<plugin>/ (the previous backup of that copy
//     is replaced), and <data>/plugin-sync.json records per copy the plugin, its version and hash, and when it was updated;
//   - a file the app may not write (it belongs to the agent's own Linux user ag-<agent>) is written by that user over ssh, as
//     relay-heal.mjs does; when that fails too the copy is reported as "differs" with the reason, never left silently.
// After an update the engine still runs the old code until it starts again. pending() says for which agents (a shipped file of an enabled
// plugin is newer than the engine process), tick() asks for the reload through the restart that waits for the maintenance window
// (restart-later.mjs), System › Health › Per agent shows "plugin updated, reload pending" until the engine restarted, and one Health item
// lists every copy that still differs, with why. Tested in scripts/plugin-sync.test.mjs.
import {readdir,readFile,writeFile,rename,mkdir,stat,lstat,realpath,rm,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {readStore,saveStore} from './store.mjs';
import {homeOf as agentHome,HERMES_HOME as ENGINE_HOME} from './agentops.mjs';

// never part of a plugin's shipped files, in the repo or in a copy: caches, virtual environments, backups, logs, half-written files
export const SKIP=/(^|\/)(__pycache__|\.pytest_cache|\.venv|node_modules|\.git)(\/|$)|\.(pyc|pyo|log|tmp|orig|rej|prev)$|\.bak([.-]|$)/;
const sha=b=>createHash('sha256').update(b).digest('hex');
const q=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const DENIED=['EACCES','EPERM','EROFS'];
async function walk(dir,rel=''){const out=[];for(const e of (await readdir(path.join(dir,rel),{withFileTypes:true}).catch(()=>[])).sort((a,b)=>a.name<b.name?-1:1)){const r=rel?rel+'/'+e.name:e.name;if(SKIP.test(r))continue;
  if(e.isDirectory())out.push(...await walk(dir,r));else if(e.isFile())out.push(r)}return out}
// the plugins this repo ships: [{name, version, hash, src, files:[{rel, hash, mode}]}]; hash = one hash over every file's name and hash
export async function shipped(engineDir){const out=[];
 for(const e of (await readdir(engineDir,{withFileTypes:true}).catch(()=>[])).sort((a,b)=>a.name<b.name?-1:1)){if(!e.isDirectory())continue;const src=path.join(engineDir,e.name);
  const y=await readFile(path.join(src,'plugin.yaml'),'utf8').catch(()=>null);if(y==null)continue;const files=[];
  for(const rel of await walk(src)){const f=path.join(src,rel);files.push({rel,hash:sha(await readFile(f)),mode:((await stat(f)).mode&0o111?0o775:0o664)})}
  out.push({name:e.name,version:(/^version:\s*["']?([^"'\s]+)/m.exec(y)||[])[1]||'',hash:sha(files.map(f=>f.rel+'\0'+f.hash).join('\n')).slice(0,16),src,files})}
 return out}
// a file as the agent's own Linux user: its content goes over ssh's input (no size limit, no quoting), beside the file, then renamed over it
const sshRun=(args,input)=>new Promise(res=>{let c;try{c=spawn('ssh',args,{stdio:['pipe','ignore','ignore'],timeout:60e3})}catch{return res(false)}c.on('error',()=>res(false));c.on('close',code=>res(code===0));c.stdin.on('error',()=>{});c.stdin.end(input)});

export function createPluginSync({HERMES_HOME=ENGINE_HOME,DATA,engineDir,homes=null,homeOf=agentHome,readConfig=async()=>null,pick=()=>null,
 run=sshRun,io={writeFile,rename,mkdir},enginePid=async()=>0,engineStart=async()=>{const p=await enginePid();return p?(await stat('/proc/'+p)).mtimeMs:0},restartLater=async()=>{},isTest=async()=>false,bottlenecks=null,
 note=(t,d)=>bottlenecks?.event('system',t,d,{topic:'plugin-drift'}),solved=()=>bottlenecks?.resolve('plugin-drift'),nameOf=a=>a,
 holdDir='/tmp/aq-live.lock',windowText=()=>'the maintenance window',again=(fn,ms)=>setTimeout(fn,ms).unref?.(),now=()=>Date.now(),log=()=>{}}){
 const FILE=path.join(DATA,'plugin-sync.json'),PREV=path.join(DATA,'plugin-sync','prev');
 // the homes that hold their own plugins folder: the engine home and every profile; a copy of an agent (a--b) links to its agent's folder and is skipped
 const allHomes=async()=>{const l=homes?await homes():['default',...(await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[])).filter(e=>e.isDirectory()&&!e.name.startsWith('.')).map(e=>e.name)];
  const seen=new Set(),out=[];for(const a of l){const d=path.join(homeOf(a),'plugins');const real=await realpath(d).catch(()=>null);const k=real||d;if(seen.has(k))continue;seen.add(k);
   if(real&&(await lstat(d).catch(()=>null))?.isSymbolicLink())continue;out.push(a)}return out};
 const userOf=async a=>{const c=await readConfig(String(a).split('--')[0]).catch(()=>null)||{};const u=String(pick(c,'terminal.ssh_user')||'');return /^ag-[\w-]+$/.test(u)?u:''};
 // as the app; as the agent's own user when the app is refused. Throws the first refusal when neither may write it.
 async function put(agent,dst,buf,mode){const tmp=dst+'.aq-sync.tmp';
  try{await io.mkdir(path.dirname(dst),{recursive:true});await io.writeFile(tmp,buf,{mode});await io.rename(tmp,dst);return 'app'}
  catch(e){await unlink(tmp).catch(()=>{});if(!DENIED.includes(e.code))throw e;const user=await userOf(agent);
   if(user){const cmd='umask 002; mkdir -p '+q(path.dirname(dst))+' && cat > '+q(tmp)+' && chmod '+mode.toString(8)+' '+q(tmp)+' && mv -f '+q(tmp)+' '+q(dst);
    if(await run(['-i',path.join(HERMES_HOME,'agent-ssh','id_ed25519'),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o','ConnectTimeout=20',user+'@127.0.0.1',cmd],buf))return 'agent'}
   throw e}}
 // which shipped files of one copy differ: [{rel, have: Buffer|null}]
 async function differing(dir,p){const out=[];for(const f of p.files){const have=await readFile(path.join(dir,f.rel)).catch(()=>null);if(have==null||sha(have)!==f.hash)out.push({...f,have})}return out}
 // One pass over every copy. add: homes that get a plugin they do not have ({home: [plugin names]}); check: change nothing, only report.
 // Returns {copies:[{agent, plugin, version, hash, status: same|updated|added|differs, files:[rel], reason?, by?}], updated, differs}
 async function sync({add={},check=false}={}){const plugins=await shipped(engineDir);const copies=[];
  const st=await readStore(FILE,{copies:{}}).catch(()=>({copies:{}}));st.copies||={};
  for(const a of await allHomes())for(const p of plugins){const dir=path.join(homeOf(a),'plugins',p.name),key=a+'/'+p.name;
   const has=await stat(path.join(dir,'plugin.yaml')).then(s=>s.isFile(),()=>false);const adding=!has&&(add[a]||[]).includes(p.name);if(!has&&!adding)continue;
   const diff=await differing(dir,p);const row={agent:a,plugin:p.name,version:p.version,hash:p.hash,status:'same',files:diff.map(f=>f.rel)};copies.push(row);
   if(!diff.length){if(st.copies[key]?.hash!==p.hash||st.copies[key]?.status!=='same')st.copies[key]={...(st.copies[key]||{}),plugin:p.name,version:p.version,hash:p.hash,status:'same',seen:now()};delete st.copies[key].reason;continue}
   if(check){row.status='differs';row.reason='not updated yet';continue}
   // the one backup of this copy: the files as they were, kept before the first of them is replaced
   const keep=path.join(PREV,a,p.name);const old=diff.filter(f=>f.have!=null);
   if(old.length){await rm(keep,{recursive:true,force:true}).catch(()=>{});for(const f of old){await mkdir(path.dirname(path.join(keep,f.rel)),{recursive:true});await writeFile(path.join(keep,f.rel),f.have)}}
   const failed=[];let by='app';
   // plugin.yaml last: a copy that is being added counts as there only once its other files are
   for(const f of [...diff.filter(f=>f.rel!=='plugin.yaml'),...diff.filter(f=>f.rel==='plugin.yaml')]){try{if(await put(a,path.join(dir,f.rel),await readFile(path.join(p.src,f.rel)),f.mode)==='agent')by='agent'}catch(e){failed.push({rel:f.rel,why:DENIED.includes(e.code)?'not writable':String(e.code||e.message)})}}
   if(failed.length){row.status='differs';row.files=failed.map(f=>f.rel);row.reason=[...new Set(failed.map(f=>f.why))].join(', ')+(failed.some(f=>f.why==='not writable')?' ('+(await userOf(a)?'also not as the agent’s own user':'the folder is not the app’s to write')+')':'');
    log('plugin sync: '+key+' still differs, '+failed.length+' file(s): '+row.reason)}
   else{row.status=adding?'added':'updated';row.by=by;log('plugin sync: '+key+' '+row.status+' to '+(p.version||p.hash)+' ('+diff.length+' file(s)'+(by==='agent'?', written as the agent’s own user':'')+')')}
   st.copies[key]={plugin:p.name,version:p.version,hash:row.status==='differs'?(st.copies[key]?.hash||''):p.hash,status:row.status==='differs'?'differs':'same',...(row.reason?{reason:row.reason}:{}),updated:now(),files:diff.length-failed.length,...(old.length?{backup:path.relative(DATA,keep)}:{}),seen:now()}}
  if(!check){for(const k of Object.keys(st.copies))if(!copies.some(c=>c.agent+'/'+c.plugin===k))delete st.copies[k];   // a copy that is gone (an agent removed, a plugin taken out) leaves the record
   st.shipped=Object.fromEntries(plugins.map(p=>[p.name,{version:p.version,hash:p.hash}]));st.at=now();await saveStore(FILE,st)}
  return {copies,updated:copies.filter(c=>c.status==='updated'||c.status==='added'),differs:copies.filter(c=>c.status==='differs')}}
 // Copies the engine has not loaded yet: {agent: [plugin]} where a shipped file of a plugin that is switched on is newer than the engine process
 async function pending(){const t=await engineStart().catch(()=>0);const out={};if(!t)return out;const plugins=await shipped(engineDir);
  for(const a of await allHomes()){const on=[].concat(pick(await readConfig(a).catch(()=>null),'plugins.enabled')||[]).map(String);
   for(const p of plugins){if(!on.includes(p.name))continue;const dir=path.join(homeOf(a),'plugins',p.name);let newest=0;
    for(const f of p.files)if(/\.(py|ya?ml|json)$/.test(f.rel)&&!/^(tests|evals)\//.test(f.rel))newest=Math.max(newest,(await stat(path.join(dir,f.rel)).catch(()=>null))?.mtimeMs||0);
    if(newest>t)(out[a]||=[]).push(p.name)}}
  return out}
 let last={differs:[],pending:{},at:0},told=null,waiting=false;
 // a deploy is between its switch and the end of its live test: it syncs the plugins itself once the new version passed (box-live.sh, H8)
 const held=async()=>{if(!holdDir)return false;const s=await stat(holdDir).catch(()=>null);return !!s&&now()-s.mtimeMs<20*60e3};
 // the app's pass: sync, ask for the reload, keep the Health item true. {skipped:true} while a deploy holds it; it looks again 5 minutes later
 // (a deploy that had nothing to update changes no folder, so nothing else would start the pass before the 4-hour sweep)
 async function tick(){if(await held()){if(!waiting){waiting=true;again(()=>{waiting=false;tick().catch(e=>log('plugin sync: '+e.message))},5*60e3)}return {skipped:true}}const r=await sync();const pend=await pending();last={differs:r.differs,pending:pend,at:now()};
  const real=[];for(const a of Object.keys(pend))if(!await isTest(a).catch(()=>false))real.push(a);
  if(real.length)await restartLater('plugin update ('+[...new Set(real.flatMap(a=>pend[a]))].sort().join(', ')+') for '+real.length+' agent(s)');
  const text=r.differs.length?r.differs.length+' plugin '+(r.differs.length===1?'copy differs':'copies differ')+' from the shipped version':'';
  const detail=r.differs.slice(0,12).map(c=>c.plugin+' of '+nameOf(c.agent)+': '+c.reason+' ('+c.files.slice(0,3).join(', ')+(c.files.length>3?' and '+(c.files.length-3)+' more':'')+')').join('; ')+(r.differs.length>12?'; and '+(r.differs.length-12)+' more':'')+'. The agents keep running the older plugin there. Make the folder writable for the app, then it updates by itself within a few minutes.';
  if(text){if(told!==text+detail){told=text+detail;await note(text,detail)}}else if(told!==''){told='';await solved()}
  return {...r,pending:pend}}
 // System › Health › Per agent: what this agent's row says, or null
 function line(agent){const p=last.pending[agent]||[],d=last.differs.filter(c=>c.agent===agent);if(!p.length&&!d.length)return null;
  return {text:[p.length?'Plugin updated, reload pending: '+p.join(', ')+' (the engine reloads in '+windowText()+')':'',d.length?'Plugin older than shipped: '+d.map(c=>c.plugin+' ('+c.reason+')').join(', '):''].filter(Boolean).join(' · '),warn:!!d.length}}
 return {sync,pending,tick,line,shipped:()=>shipped(engineDir),state:()=>readStore(FILE,{copies:{}})}}
