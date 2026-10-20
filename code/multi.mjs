// Several AIs on one request.
//  Compare: each model works in its own draft copy of the project; the user previews both and keeps one.
//  Team: planner (read-only plan) → builder (implements in the real project) → reviewer (read-only review).
import {cp,rm,mkdir,readFile,readdir,stat,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {isImage,validateFile} from './workspace.mjs';

const SKIP=new Set(['node_modules','.git','dist','.next','.astro','.turbo','.cache']);
const label=p=>p==='claude'?'Claude':p==='gemini'?'Gemini':'GPT';

// a file's contents to compare by: the text itself, or a fingerprint for images, other binary and large files
const sha=b=>createHash('sha1').update(b).digest('hex');
async function sig(full,rel){const b=await readFile(full);return isImage(rel)||b.length>300000||b.includes(0)?'bin:'+sha(b):b.toString('utf8')}
const textFile=n=>{if(isImage(n))return false;try{validateFile(n);return true}catch{return false}};
async function listText(root){const out={};async function walk(dir,prefix=''){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name.startsWith('.')||SKIP.has(item.name)||item.isSymbolicLink())continue;const rel=prefix+item.name,full=path.join(dir,item.name);
 if(item.isDirectory())await walk(full,rel+'/');else{try{if((await stat(full)).size<=50*1024*1024)out[rel]=await sig(full,rel)}catch{}}if(Object.keys(out).length>400)return}}await walk(root);return out}

export function createMulti({store,startAgent,canStart=()=>true,root}){
 const drafts=path.join(root,'data','drafts'),compares=new Map();

 async function compare({projectId,chatId,prompt,variants,mode}){
  if(!canStart(variants.length))throw Error('Too many AI runs are already working for a comparison. Wait for one to finish.');
  const id=randomUUID(),source=await store.folder(projectId),before=await listText(source),chat=store.chat(projectId,chatId);
  const job={id,projectId,chatId,prompt,state:'running',variants:[]};compares.set(id,job);
  // if one variant can't start, the ones already running stop and the drafts go, so nothing is left half-started
  try{for(const [i,v] of variants.entries()){const key=String.fromCharCode(97+i),dir=path.join(drafts,id,key);await mkdir(dir,{recursive:true});
   await cp(source,dir,{recursive:true,filter:src=>!SKIP.has(path.basename(src))||src===source});
   const run=startAgent({projectId,chatId,provider:v.provider,model:v.model||'',effort:v.effort||'',mode:mode==='plan'?'plan':mode==='full'?'full':'auto',prompt,cwd:dir,silent:true,
    fullPrompt:'You are one of two AI models answering the same request in parallel, each in a separate draft copy of the project. Work only in the current folder. Do not stop to ask the user questions: choose sensible defaults, finish the change, and mention your assumptions in the summary.\n\nUser request: '+prompt});
   job.variants.push({key,provider:v.provider,model:v.model||'',effort:v.effort||'',runId:run.id,dir,run})}}
  catch(e){compares.delete(id);for(const v of job.variants){try{await v.run.stop?.()}catch{}}Promise.all(job.variants.map(v=>v.run.finished)).catch(()=>{}).then(()=>rm(path.join(drafts,id),{recursive:true,force:true})).catch(()=>{});throw e}
  // when both finish, record what each draft changed and post one comparison message
  Promise.all(job.variants.map(v=>v.run.finished)).then(async()=>{
   for(const v of job.variants){const after=await listText(v.dir);v.files=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(n=>before[n]!==after[n]).sort();v.deleted=v.files.filter(n=>after[n]===undefined);v.base=Object.fromEntries(v.files.map(n=>[n,before[n]===undefined?null:sha(before[n])]));v.text=v.run.result?.text||v.run.error||'';v.state=v.run.state;delete v.run}
   job.state='complete';
   await store.serialize(async()=>{chat.messages.push({role:'assistant',compare:{id,prompt,variants:job.variants.map(({key,provider,model,effort,files,deleted,base,text,state,runId})=>({key,provider,model,effort,files,deleted,base,text,state,runId}))},text:'Compared '+job.variants.map(v=>label(v.provider)).join(' and ')+'.',time:Date.now()});await store.persist()});
  });
  return {id,runs:job.variants.map(v=>({id:v.runId,provider:v.provider,key:v.key}))};
 }

 async function keep({projectId,chatId,compareId,key,force}){
  const chat=store.chat(projectId,chatId),msg=chat.messages.find(m=>m.compare?.id===compareId);if(!msg)throw Error('Comparison not found.');if(msg.compare.chosen)throw Error('A version was already kept.');
  const v=msg.compare.variants.find(x=>x.key===key);if(!v)throw Error('Unknown version.');const dir=path.join(drafts,compareId,key),root=await store.folder(projectId);
  const inProject=name=>{const t=path.resolve(root,...name.split('/'));if(!t.startsWith(path.resolve(root)+path.sep))throw Error('Not found.');return t};
  // files changed in the project since the comparison started are not overwritten without asking
  if(v.base&&!force){const moved=[];for(const name of v.files){let now=null;try{now=sha(await sig(inProject(name),name))}catch{}if(now!==(v.base[name]??null))moved.push(name)}
   if(moved.length)throw Error((moved.length===1?moved[0]+' has':moved.length+' files have')+' changed since the comparison started. Keep this version anyway?')}
  // text files go in as one version (undo from Changes), deletions too; images and other files are copied as they are
  const files=[],copies=[];for(const name of v.files.filter(n=>!v.deleted.includes(n))){const buf=await readFile(path.join(dir,name));if(textFile(name)&&!buf.includes(0))files.push({path:name,content:buf.toString('utf8')});else copies.push([name,buf])}
  for(const name of v.deleted.filter(textFile)){try{await stat(inProject(name));files.push({path:name,content:''})}catch{}}
  const version=files.length?await store.serialize(()=>store.apply(projectId,files,'Kept '+label(v.provider)+' version: '+msg.compare.prompt.slice(0,50),{limit:false})):null;
  for(const [name,buf] of copies){const to=inProject(name);await mkdir(path.dirname(to),{recursive:true});await writeFile(to,buf)}
  for(const name of v.deleted){try{await unlink(inProject(name))}catch{}}
  await store.serialize(async()=>{msg.compare.chosen=key;msg.versionId=version?.id||null;msg.files=v.files;await store.persist()});
  await rm(path.join(drafts,compareId),{recursive:true,force:true}).catch(()=>{});return {kept:key,versionId:version?.id||null}}

 async function draftFile(compareId,key,name){if(!/^[0-9a-f-]{36}$/.test(compareId)||!/^[a-z]$/.test(key))throw Error('Not found.');const base=path.join(drafts,compareId,key),target=path.resolve(base,name);
  if(!target.startsWith(path.resolve(base)+path.sep))throw Error('Not found.');return readFile(target)}

 // Team: plan → build → review, chained as ordinary visible runs in the chat.
 function team({projectId,chatId,prompt,planner,builder,mode}){
  const t={id:randomUUID(),request:prompt};
  const stage=(name,who,opts)=>startAgent({projectId,chatId,provider:who.provider,model:who.model||'',effort:who.effort||'',team:{id:t.id,stage:name},...opts});
  const plan=stage('plan',planner,{mode:'plan',prompt:'Team plan for: '+prompt,fullPrompt:'You are the PLANNER in a team of AI models. Another model will build from your plan, then you will review its work.\nWrite a precise, numbered implementation plan (files, steps, acceptance checks). Do not change files.\n\nUser request: '+prompt});
  plan.finished.then(()=>{if(plan.state!=='complete')return;const planText=plan.result?.text||'';
   const build=stage('build',builder,{mode:mode==='plan'?'ask':mode,prompt:'Team build for: '+prompt,fullPrompt:'You are the BUILDER in a team of AI models. Implement this plan from the planner exactly, then summarise what you changed. Do not stop to ask questions; use sensible defaults and note them.\n\nPLAN:\n'+planText+'\n\nOriginal user request: '+prompt});
   build.finished.then(()=>{if(build.state!=='complete')return;
    stage('review',planner,{mode:'plan',prompt:'Team review for: '+prompt,fullPrompt:'You are the REVIEWER in a team of AI models. The builder just implemented your plan in this project. Inspect the current files (read-only) and report: what matches the plan, any bugs or gaps, and concrete fixes. Do not change files.\n\nYour plan was:\n'+planText+'\n\nBuilder summary:\n'+(build.result?.text||'')+'\n\nOriginal user request: '+prompt})})});
  return {id:t.id,runs:[{id:plan.id,provider:planner.provider,stage:'plan'}]};
 }

 return {compare,keep,draftFile,team};
}
