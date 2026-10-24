// The link to aqeelOS. This app runs on the person's own computer and is shown inside aqeelOS (the Code section).
// Pairing: aqeelOS hands this app its own key through the page (no password typed here). The key lets the app's
// runs reach the person's aqeelOS agents with all their abilities (aqeelos-mcp.mjs), and lets the app update itself.
// Only the aqeelOS address this copy came from (aqeelos.json, written by the download) may show the app in a frame.
import {readFile,writeFile,mkdir,access,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

export function createAqeelos({root}){
 const FILE=path.join(root,'data','aqeelos.json');let link=null,install=null;
 // (a file saved by Windows tools may start with a byte-order mark)
 const json=async f=>JSON.parse(String(await readFile(f,'utf8')).replace(/^\uFEFF/,''));
 const load=async()=>{if(!link?.token){try{link=await json(FILE)}catch{link={}}}
  if(!install){try{install=(await json(path.join(root,'aqeelos.json'))).aqeelos||{}}catch{install={}}}return link};
 const clean=u=>{try{return new URL(u).origin}catch{return ''}};
 // the aqeelOS addresses allowed to show and drive this app
 async function origins(){await load();return [...new Set([...(install.origins||[]),install.base,link.base,...String(process.env.AQEELOS_ORIGINS||'https://ai.elkiya.com').split(',')].map(clean).filter(Boolean))]}
 async function state(){await load();return {paired:!!link.token,base:link.base||install.base||'',user:link.user||'',origins:await origins(),version:install.version||''}}
 async function pair(base,token){const o=clean(base);if(!(await origins()).includes(o))throw Error('That aqeelOS address is not allowed for this copy.');
  const r=await fetch(o+'/ui/code/whoami',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not accept the key.');
  link={base:o,token,user:j.name||'',pairedAt:Date.now()};await mkdir(path.dirname(FILE),{recursive:true});await writeFile(FILE,JSON.stringify(link,null,1),{mode:0o600});return state()}
 // the person's aqeelOS agents this computer may ask (what Code's picker lists)
 let agentsAt=0,agentsList=[];
 async function agents(){await load();if(!link.token)return [];if(Date.now()-agentsAt<60000)return agentsList;
  try{const r=await fetch(link.base+'/ui/code/agents',{headers:{authorization:'Bearer '+link.token},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(r.status===401){link={};await writeFile(FILE,'{}').catch(()=>{});agentsList=[];return []}   // aqeelOS no longer knows this key: unpaired, so the page pairs it again
  if(r.ok){agentsList=(j.agents||[]).map(a=>({id:String(a.id),name:String(a.name||a.id),apps:a.apps||[],google:a.google||0}));agentsAt=Date.now()}}catch{}return agentsList}
 // an agent's account and models from aqeelOS › Models (null: not paired, or aqeelOS did not answer). Kept 5 s only, so
 // an account switch there (by hand or automatic) reaches the next run
 const routes=new Map();
 async function agentModel(agent){await load();if(!link.token)return null;const k=String(agent||''),hit=routes.get(k);if(hit&&Date.now()-hit.t<5000)return hit.v;
  let v=null;try{const r=await fetch(link.base+'/ui/code/agent-model?agent='+encodeURIComponent(k),{headers:{authorization:'Bearer '+link.token},signal:AbortSignal.timeout(20000)});if(r.ok)v=await r.json()}catch{}
  routes.set(k,{t:Date.now(),v});return v}
 async function unpair(){link={};await writeFile(FILE,'{}').catch(()=>{});return state()}
 // every run gets the aqeelOS tools when this computer is paired
 async function mcp(run){await load();if(!link.token)return null;return {name:'aqeelos',command:process.execPath,args:[path.join(root,'aqeelos-mcp.mjs')],env:{...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{}),AQ_BASE:link.base,AQ_TOKEN:link.token,AQ_PROJECT:String(run?.projectId||''),AQ_AGENT:String(run?.agent||'')}}}
 // ask aqeelOS for work for this computer's projects (agents' code_work), every ~25 s while paired
 let serving=false;function serve({projects,work}){if(serving||process.env.NODE_TEST_CONTEXT)return;serving=true;const wait=ms=>new Promise(r=>setTimeout(r,ms).unref?.());
  (async()=>{for(;;){await load();if(!link.token){await wait(10000);continue}
   try{const r=await fetch(link.base+'/ui/code/poll',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({projects:await projects()}),signal:AbortSignal.timeout(40000)});
    if(r.status===401){await wait(60000);continue}const j=await r.json().catch(()=>({}));if(!r.ok){await wait(15000);continue}
    if(j.job){const job=j.job;void (async()=>{let out;try{out=await work(job)}catch(e){out={state:'failed',text:e.message}}
     await fetch(link.base+'/ui/code/done',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({id:job.id,...out})}).catch(()=>{})})()}}
   catch{await wait(15000)}}})()}
 /* Self-update (an installed app only, never a developer's git checkout): every 30 minutes it asks aqeelOS for the
    current version; when it differs and no AI run is working, it fetches the new files, keeps its data, installs new
    dependencies if the list changed, and exits; the starter (Windows) or launchd (Mac) brings it back up at once. */
 let updating=false,busyNow=()=>false;
 // dependencies an update needs: installed before it counts as done; a failed install is tried again on the next check
 const PENDING=path.join(root,'data','.deps-pending'),has=f=>access(f).then(()=>true,()=>false);
 const npmInstall=()=>new Promise(res=>{const p=spawn(process.platform==='win32'?'npm.cmd':'npm',['install','--no-audit','--no-fund','--loglevel=error'],{cwd:root,shell:process.platform==='win32',stdio:'ignore'});p.on('exit',c=>res(c));p.on('error',()=>res(-1))});
 async function checkUpdate(busy=busyNow){await load();if(updating||!link.token||!install.version||process.env.CBA_NO_UPDATE)return {state:'off'};if(await access(path.join(root,'.git')).then(()=>true,()=>false)||await access(path.join(root,'..','.git')).then(()=>true,()=>false))return {state:'dev'};
  if(await has(PENDING)&&!busy()){updating=true;try{if(await npmInstall()===0)await unlink(PENDING).catch(()=>{})}finally{updating=false}}
  const h={authorization:'Bearer '+link.token};const v=await fetch(link.base+'/ui/code/version',{headers:h,signal:AbortSignal.timeout(15000)}).then(r=>r.json()).catch(()=>({}));
  if(!v.version||v.version===install.version)return {state:'current',version:install.version};if(busy())return {state:'waiting',version:v.version};
  updating=true;try{const r=await fetch(link.base+'/ui/code/update',{headers:h,signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error('aqeelOS answered '+r.status);const buf=Buffer.from(await r.arrayBuffer());
   const before=await readFile(path.join(root,'package.json'),'utf8').catch(()=>'');let n=0;
   for(const [name,data] of unzip(buf)){if(/^(data|node_modules|projects|outputs)\//.test(name)||name.includes('..'))continue;const to=path.join(root,name);await mkdir(path.dirname(to),{recursive:true});await writeFile(to,data);n++}
   const after=await readFile(path.join(root,'package.json'),'utf8').catch(()=>'');const deps=s=>{try{const j=JSON.parse(s);return JSON.stringify([j.dependencies,j.optionalDependencies])}catch{return ''}};
   if(deps(before)!==deps(after)||await has(PENDING)){await mkdir(path.dirname(PENDING),{recursive:true});await writeFile(PENDING,v.version);const code=await npmInstall();if(code!==0)throw Error('installing what the update needs failed (npm exit '+code+'); it is tried again on the next check');await unlink(PENDING).catch(()=>{})}
   // work started during the download is not cut off: the restart waits until nothing is running
   console.log('aqeelOS Code updated to '+v.version+' ('+n+' files); restarting when idle');void (async()=>{while(busy())await new Promise(r=>setTimeout(r,15000));setTimeout(()=>process.exit(0),500)})();return {state:'updated',version:v.version}}
  catch(e){updating=false;console.warn('update failed:',e.message);return {state:'failed',error:e.message}}}
 function autoUpdate(busy){busyNow=busy;if(process.env.NODE_TEST_CONTEXT)return;const tick=()=>checkUpdate(busy).catch(()=>{});setTimeout(tick,120000).unref?.();setInterval(tick,1800000).unref?.()}
 // each finished run's tokens go to aqeelOS (System › Usage: Code by person, agent and project)
 async function reportUsage(line){await load();if(!link.token)return;await fetch(link.base+'/ui/code/run-usage',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify(line),signal:AbortSignal.timeout(15000)}).catch(()=>{})}
 let peopleList=[],peopleAt=0;
 async function people(){await load();if(!link.token)return [];if(Date.now()-peopleAt<60000)return peopleList;
  try{const r=await fetch(link.base+'/ui/code/people',{headers:{authorization:'Bearer '+link.token},signal:AbortSignal.timeout(10000)});if(r.ok){peopleList=(await r.json()).people||[];peopleAt=Date.now()}}catch{}return peopleList}
 // Live: send a project (zip) to aqeelOS, which runs it on the server at <slug>.app.elkiya.com
 async function publish(zip,{name,slug,repo,db}){await load();if(!link.token)throw Error('Connect this app to aqeelOS first (open Code in aqeelOS).');
  const q=new URLSearchParams({name:name||'',slug:slug||'',repo:repo||'',db:db?'1':''});
  const r=await fetch(link.base+'/ui/code/publish?'+q,{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/zip'},body:zip,signal:AbortSignal.timeout(600000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not take it ('+r.status+').');return j}
 async function report(r){await load();if(!link.token)return;await fetch(link.base+'/ui/code/report',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({...r,version:install.version||'dev'}),signal:AbortSignal.timeout(15000)}).catch(()=>{})}
 return {origins,state,pair,unpair,mcp,agents,agentModel,serve,checkUpdate,autoUpdate,reportUsage,people,publish,report}}
// the entries of a stored (uncompressed) zip, as aqeelOS makes them
function unzip(buf){const out=[];let i=0;while(i+30<=buf.length&&buf.readUInt32LE(i)===0x04034b50){const size=buf.readUInt32LE(i+18),nl=buf.readUInt16LE(i+26),xl=buf.readUInt16LE(i+28);
  const name=buf.slice(i+30,i+30+nl).toString();const start=i+30+nl+xl;out.push([name,buf.slice(start,start+size)]);i=start+size}return out}
