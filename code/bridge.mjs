// Every aqeelOS model for projects on this computer (25 Oct 2026). Such a turn runs on the aqeelOS engine for the agent
// (engine.mjs), and the engine reaches this project only through aqeelOS's code bridge (project_* tools), whose calls
// aqeelOS relays here over the link this app already keeps (aqeelos.mjs). Each call is done here, in the folder of the
// run that opened the bridge, with that run's permission mode: Plan only reads; Ask before changes asks the person about
// every file change and command; Auto changes files and asks about commands; Full access asks nothing. A call for a run
// that is not going on here is refused, and paths stay inside the project (no "..", no link out of it).
import {readFile,writeFile,readdir,stat,lstat,realpath,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {shell,killTree} from './platform.mjs';

const READ=new Set(['project_read','project_list','project_search']);
// folders that are named in a listing but not opened or searched
const SKIP=/^(node_modules|\.git|dist|build|\.next|\.cache|\.venv|venv|__pycache__|\.turbo)$/;
const MAX_READ=250e3,MAX_WRITE=8e6,MAX_OUT=60e3,MAX_LIST=600,MAX_HITS=200;
// a prompt left unanswered is declined before the engine's own 5 minute limit on a tool call
const ASK_MS=270e3;

// a path the model gives, as a real path inside the project (root: the project folder). A file that is not there yet
// counts by the nearest folder above it that is. Throws for anything outside, also through a link.
export async function inside(root,p){const s=String(p??'').trim()||'.';if(s.includes('\0'))throw Error('That path is not valid.');
 // (an absolute path may name the project by its real path or by the one it was opened with)
 const top=await realpath(root),abs=path.resolve(root,s),out=r=>r.startsWith('..')||path.isAbsolute(r),rel=[path.relative(path.resolve(root),abs),path.relative(top,abs)].find(r=>!out(r));
 if(rel==='')return top;if(rel===undefined)throw Error('That path is outside the project. Use a path inside it, relative to its folder.');
 let at=abs,rest=[];for(;;){try{const real=await realpath(at);if(real!==top&&!real.startsWith(top+path.sep))throw Error('That path leads outside the project (through a link).');return path.join(real,...rest)}
  catch(e){if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;rest.unshift(path.basename(at));const up=path.dirname(at);if(up===at)throw Error('That path is not valid.');at=up}}}
const show=(root,real)=>path.relative(root,real).split(path.sep).join('/')||'.';
const isText=b=>!b.subarray(0,8000).includes(0);
const clip=(s,n)=>s.length>n?s.slice(0,n)+'\n… (cut at '+n+' characters)':s;
const glob=g=>{if(!g)return null;const r=String(g).replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*\/?/g,'\u0000').replace(/\*/g,'[^/]*').replace(/\?/g,'.').replace(/\u0000/g,'.*');return RegExp('(^|/)'+r+'$','i')};

export function createBridge(){
 const runs=new Map();
 // a run on aqeelOS models for a project here opens the bridge (its id goes to aqeelOS with the run) and closes it at the end
 function open(run){const id=randomBytes(12).toString('hex');runs.set(id,{run,always:{},kids:new Set()});return id}
 function close(id){const b=runs.get(id);if(!b)return;runs.delete(id);for(const k of b.kids)killTree(k)}
 // may this change or command go ahead? '' yes, else why not
 async function allow(b,kind,title,detail){const run=b.run,m=run.mode||'ask';
  if(m==='plan')return 'Plan only: nothing is changed or run in this turn. Propose it in your plan instead.';
  if(m==='full'||kind==='file'&&m==='auto'||b.always[kind])return '';
  const d=await new Promise(res=>{const ev=run.ask(kind,title,detail,res);const t=setTimeout(()=>{try{run.decide(ev.key,'decline')}catch{}},ASK_MS);t.unref?.()});
  if(d==='acceptForSession')b.always[kind]=true;return d==='accept'||d==='acceptForSession'?'':'The person declined this. Do not try it another way; say what you wanted to do.'}
 async function walk(top,dir,depth,out,each){let list=[];try{list=await readdir(dir,{withFileTypes:true})}catch{return}list.sort((x,y)=>x.name.localeCompare(y.name));
  for(const e of list){if(out.stop)return;const fp=path.join(dir,e.name);if(e.isSymbolicLink())continue;await each(e,fp);if(e.isDirectory()&&!SKIP.test(e.name)&&depth>1)await walk(top,fp,depth-1,out,each)}}
 const tools={
  async project_read(b,a,top){const f=await inside(top,a.path),st=await stat(f);if(st.isDirectory())throw Error(show(top,f)+' is a folder. Use project_list.');
   const buf=await readFile(f);if(!isText(buf))return show(top,f)+' is not a text file ('+st.size+' bytes).';const lines=buf.toString('utf8').split('\n');
   const from=Math.max(1,Math.floor(+a.offset||1)),n=Math.max(1,Math.floor(+a.limit||lines.length));b.run.emit({type:'tool',name:'Read',detail:show(top,f),status:'completed'});
   return clip(lines.slice(from-1,from-1+n).map((l,i)=>String(from+i).padStart(5)+'\t'+l).join('\n'),MAX_READ)+(from-1+n<lines.length?'\n… ('+lines.length+' lines in all)':'')},
  async project_list(b,a,top){const f=await inside(top,a.path||'.'),depth=Math.min(4,Math.max(1,Math.floor(+a.depth||2))),out=[],box={};
   await walk(top,f,depth,box,async(e,fp)=>{if(out.length>=MAX_LIST){box.stop=true;return}const r=show(top,fp);if(e.isDirectory())out.push(r+'/'+(SKIP.test(e.name)?' (not opened)':''));else if(e.isFile()){const st=await stat(fp).catch(()=>null);out.push(r+' ('+(st?st.size:0)+' bytes)')}});
   b.run.emit({type:'tool',name:'List',detail:show(top,f),status:'completed'});return (out.join('\n')||'(empty)')+(box.stop?'\n… (more not listed)':'')},
  async project_search(b,a,top){const f=await inside(top,a.path||'.'),pat=String(a.pattern||'');if(!pat)throw Error('Say what to search for.');let re;try{re=a.regex?RegExp(pat,'i'):RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i')}catch(e){throw Error('That pattern is not a valid regular expression: '+e.message)}
   const g=glob(a.glob),hits=[],box={},t0=Date.now();
   const look=async fp=>{const st=await stat(fp).catch(()=>null);if(!st||st.size>2e6)return;const buf=await readFile(fp).catch(()=>null);if(!buf||!isText(buf))return;const ls=buf.toString('utf8').split('\n');
    for(let i=0;i<ls.length;i++)if(re.test(ls[i])){hits.push(show(top,fp)+':'+(i+1)+': '+ls[i].trim().slice(0,240));if(hits.length>=MAX_HITS){box.stop=true;return}}};
   if((await stat(f)).isFile())await look(f);else await walk(top,f,12,box,async(e,fp)=>{if(Date.now()-t0>20000)box.stop=true;if(e.isFile()&&(!g||g.test(show(top,fp))))await look(fp)});
   b.run.emit({type:'tool',name:'Search',detail:pat.slice(0,120),status:'completed'});return (hits.join('\n')||'No matches.')+(box.stop?'\n… (stopped early)':'')},
  async project_write(b,a,top){const f=await inside(top,a.path),r=show(top,f),c=String(a.content??'');if(Buffer.byteLength(c)>MAX_WRITE)throw Error('That file is too big to write this way.');
   if((await lstat(f).catch(()=>null))?.isDirectory())throw Error(r+' is a folder.');const no=await allow(b,'file','Allow this file change?','Write '+r);if(no)return {refused:no};
   const ev=b.run.emit({type:'file',paths:[r],status:'running'});try{await mkdir(path.dirname(f),{recursive:true});await inside(top,path.relative(top,path.dirname(f)));await writeFile(f,c);b.run.update(ev,{status:'completed'})}catch(e){b.run.update(ev,{status:'failed'});throw e}
   return 'Wrote '+r+' ('+Buffer.byteLength(c)+' bytes).'},
  async project_edit(b,a,top){const f=await inside(top,a.path),r=show(top,f),old=String(a.old_text??''),neu=String(a.new_text??'');if(!old)throw Error('old_text is empty.');
   const t=(await readFile(f)).toString('utf8'),n=t.split(old).length-1;if(!n)throw Error('old_text is not in '+r+'. Read the file again and copy the text exactly.');if(n>1&&!a.replace_all)throw Error('old_text is in '+r+' '+n+' times. Give more of the text around it, or set replace_all.');
   const no=await allow(b,'file','Allow this file change?','Edit '+r);if(no)return {refused:no};const ev=b.run.emit({type:'file',paths:[r],status:'running'});
   try{await writeFile(f,a.replace_all?t.split(old).join(neu):t.replace(old,()=>neu));b.run.update(ev,{status:'completed'})}catch(e){b.run.update(ev,{status:'failed'});throw e}return 'Changed '+r+(n>1?' ('+n+' places)':'')+'.'},
  async project_run(b,a,top){const cmd=String(a.command||'').trim();if(!cmd)throw Error('Say what command to run.');const no=await allow(b,'command','Run this command on your computer?',cmd);if(no)return {refused:no};
   const ms=Math.min(270,Math.max(1,+a.timeout_s||120))*1000,{exe,args}=shell(cmd),ev=b.run.emit({type:'command',command:cmd,status:'running',output:''});
   return await new Promise(res=>{let out='',child;try{child=spawn(exe,args,{cwd:top,env:process.env,windowsHide:true})}catch(e){b.run.update(ev,{status:'failed',output:e.message});return res(e.message)}b.kids.add(child);
    const take=d=>{out=(out+d).slice(-MAX_OUT);b.run.update(ev,{output:out})};child.stdout.on('data',take);child.stderr.on('data',take);
    const t=setTimeout(()=>{killTree(child);out+='\nStopped after '+ms/1000+' seconds.'},ms);
    const end=code=>{clearTimeout(t);b.kids.delete(child);b.run.update(ev,{status:code===0?'completed':'failed',exitCode:code,output:out});res((out.trim()||'(no output)')+'\n(exit code '+code+')')};
    child.on('error',e=>{out+=e.message;end(-1)});child.on('close',c=>end(c??-1))})}};
 // one call from aqeelOS: {run, tool, args}; the answer is {state:'done'|'failed', text}
 async function job(j){const b=runs.get(String(j.run||''));if(!b)return {state:'failed',text:'That Code run is not going on on this computer any more.'};
  const f=tools[j.tool];if(!f)return {state:'failed',text:'Unknown tool.'};let top='';try{top=await realpath(b.run.projectDir||'')}catch{}if(!top)return {state:'failed',text:'This run has no project folder.'};
  if(!READ.has(j.tool)&&b.run.mode==='plan')return {state:'failed',text:'Plan only: nothing is changed or run in this turn. Propose it in your plan instead.'};
  try{const r=await f(b,j.args&&typeof j.args==='object'?j.args:{},top);if(!runs.has(String(j.run)))return {state:'failed',text:'The run was stopped.'};return r?.refused?{state:'failed',text:r.refused}:{state:'done',text:String(r)}}
  catch(e){return {state:'failed',text:e.code==='ENOENT'?'There is no such file or folder in the project.':e.message}}}
 return {open,close,job,active:()=>runs.size}}
