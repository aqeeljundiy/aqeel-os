// The link to aqeelOS. This app runs on the person's own computer and is shown inside aqeelOS (the Code section).
// Pairing: aqeelOS hands this app its own key through the page (no password typed here). The key lets the app's
// runs reach the person's aqeelOS agents with all their abilities (aqeelos-mcp.mjs), and lets the app update itself.
// Only the aqeelOS address this copy came from (aqeelos.json, written by the download) may show the app in a frame.
import {readFile,writeFile,mkdir,access,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {verifyUpdate,repoOk,repoIn} from './update-verify.mjs';   // an update is unpacked only when it is what GitHub's main holds (audit H-7)

// fetch's built-in client cuts a response body that is silent for 5 minutes (a run waiting on an approval, a long
// command): engine streams use a copy of it without that limit (Node's bundled undici, reached through the dispatcher
// fetch has made; none yet, or another Node: the default one, and aqeelOS's keep-alive lines every 20 s keep it open)
let longOne=null;const longDispatcher=()=>{if(longOne)return longOne;const d=globalThis[Symbol.for('undici.globalDispatcher.1')];try{if(d?.constructor)longOne=new d.constructor({bodyTimeout:0})}catch{}return longOne||undefined};
export function createAqeelos({root}){
 const FILE=path.join(root,'data','aqeelos.json');let link=null,install=null;
 // (a file saved by Windows tools may start with a byte-order mark)
 const json=async f=>JSON.parse(String(await readFile(f,'utf8')).replace(/^\uFEFF/,''));
 const load=async()=>{if(!link?.token){try{link=await json(FILE)}catch{link={}}}
  if(!install){try{install=(await json(path.join(root,'aqeelos.json'))).aqeelos||{}}catch{install={}}}return link};
 const clean=u=>{try{return new URL(u).origin}catch{return ''}};
 // the aqeelOS addresses allowed to show and drive this app
 async function origins(){await load();return [...new Set([...(install.origins||[]),install.base,link.base,...String(process.env.AQEELOS_ORIGINS||'').split(',')].map(clean).filter(Boolean))]}
 // the domain Live apps get on this aqeelOS (<name>.<domain>), as aqeelOS reports it; asked again for links made before it was sent
 const cleanDomain=d=>/^[a-z0-9.-]{3,200}$/i.test(String(d||''))?String(d).toLowerCase():'';let askedDomain=0;
 async function liveDomain(){if(link.liveDomain||!link.token||Date.now()-askedDomain<600e3)return link.liveDomain||'';askedDomain=Date.now();
  try{const r=await fetch(link.base+'/ui/code/whoami',{headers:{authorization:'Bearer '+link.token},signal:AbortSignal.timeout(8000)});const d=cleanDomain((await r.json()).liveDomain);if(r.ok&&d){link.liveDomain=d;await writeFile(FILE,JSON.stringify(link,null,1),{mode:0o600}).catch(()=>{})}}catch{}return link.liveDomain||''}
 async function state(){await load();return {paired:!!link.token,base:link.base||install.base||'',user:link.user||'',origins:await origins(),version:install.version||'',liveDomain:await liveDomain()}}
 async function pair(base,token){const o=clean(base);if(!(await origins()).includes(o))throw Error('That aqeelOS address is not allowed for this copy.');
  const r=await fetch(o+'/ui/code/whoami',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not accept the key.');
  link={base:o,token,user:j.name||'',liveDomain:cleanDomain(j.liveDomain),pairedAt:Date.now()};await mkdir(path.dirname(FILE),{recursive:true});await writeFile(FILE,JSON.stringify(link,null,1),{mode:0o600});return state()}
 /* The box's own copy is paired as the owner but used by everyone on Code online: aqeelOS answers its agent list, models,
    runs and publishing only for the person on the short signed note (x-aq-act, nine minutes) it puts on every request.
    The newest note per person is kept here (and in data/acts/, which a run's aqeelOS tools read again on every call),
    so a queued message or a long run keeps acting as that person, never as the owner. Elsewhere there is no note. */
 const acts=new Map(),ACTS=path.join(root,'data','acts');
 const actParts=a=>{const [uid,exp,sg]=String(a||'').split('.');return uid&&/^[\w-]{1,80}$/.test(uid)&&Number(exp)>0&&sg?{uid,exp:Number(exp)}:null};
 function noteAct(a){const p=actParts(a);if(!p||p.exp<Date.now()||p.exp>Date.now()+600e3)return '';const cur=acts.get(p.uid);
  if(!cur||p.exp>cur.exp){acts.set(p.uid,{act:String(a),exp:p.exp});if(!cur||p.exp-(cur.saved||0)>60e3){acts.get(p.uid).saved=p.exp;void mkdir(ACTS,{recursive:true,mode:0o700}).then(()=>writeFile(path.join(ACTS,p.uid),String(a),{mode:0o600})).catch(()=>{})}}return String(a)}
 // the newest note of the person an older note was for ('' when it has run out)
 const freshAct=a=>{const p=actParts(a);if(!p)return '';const cur=acts.get(p.uid),best=cur&&cur.exp>p.exp?cur:{act:String(a),exp:p.exp};return best.exp>Date.now()+5000?best.act:''};
 const actFile=a=>{const p=actParts(a);return p?path.join(ACTS,p.uid):''};
 const anyAct=()=>{let b=null;for(const v of acts.values())if(!b||v.exp>b.exp)b=v;return b&&b.exp>Date.now()+5000?b.act:''};
 const H=(act,more)=>({authorization:'Bearer '+link.token,...(act?{'x-aq-act':freshAct(act)||act}:{}),...more});
 const who=act=>actParts(act)?.uid||'';
 // the person's aqeelOS agents this computer may ask (what Code's picker lists), kept a minute per person
 const agentsBy=new Map();
 async function agents(act){await load();if(!link.token)return [];const k=who(act),hit=agentsBy.get(k);if(hit&&Date.now()-hit.t<60000)return hit.v;let list=hit?.v||[];
  try{const r=await fetch(link.base+'/ui/code/agents',{headers:H(act),signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(r.status===401){link={};await writeFile(FILE,'{}').catch(()=>{});agentsBy.clear();return []}   // aqeelOS no longer knows this key: unpaired, so the page pairs it again
  if(r.ok){list=(j.agents||[]).map(a=>({id:String(a.id),name:String(a.name||a.id),apps:a.apps||[],google:a.google||0}));agentsBy.set(k,{t:Date.now(),v:list})}}catch{}return list}
 // the attached agents' introductions for a run (what each is for, its apps and skills by name, a short digest of its
 // work notes for an agent the person owns), kept a minute per person and list
 const introsBy=new Map();
 async function intros(ids,act){await load();if(!link.token||!ids?.length)return [];const k=who(act)+'|'+ids.join(','),hit=introsBy.get(k);if(hit&&Date.now()-hit.t<60000)return hit.v;
  try{const r=await fetch(link.base+'/ui/code/agents?intro=1&ids='+encodeURIComponent(ids.join(',')),{headers:H(act),signal:AbortSignal.timeout(20000)});if(!r.ok)return [];const v=((await r.json()).agents||[]);introsBy.set(k,{t:Date.now(),v});if(introsBy.size>200)introsBy.delete(introsBy.keys().next().value);return v}catch{return []}}
 // the ticket for one run: aqeelOS signs which agents it may ask (aqeelos_ask asks only those)
 async function ticket(agents,project,act){await load();if(!link.token||!agents?.length)return null;const r=await fetch(link.base+'/ui/code/run-ticket',{method:'POST',headers:H(act,{'content-type':'application/json'}),body:JSON.stringify({agents,project}),signal:AbortSignal.timeout(20000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not accept the attached agents ('+r.status+').');return j}
 // an agent's account and models from aqeelOS › Models (null: not paired, or aqeelOS did not answer). Kept 5 s only, so
 // an account switch there (by hand or automatic) reaches the next run; per person and agent (the answer is that person's)
 const routes=new Map();
 async function agentModel(agent,act){await load();if(!link.token)return null;const a=String(agent||''),k=who(act)+'|'+a,hit=routes.get(k);if(hit&&Date.now()-hit.t<5000)return hit.v;
  let v=null;try{const r=await fetch(link.base+'/ui/code/agent-model?agent='+encodeURIComponent(a),{headers:H(act),signal:AbortSignal.timeout(20000)});if(r.ok)v=await r.json()}catch{}
  routes.set(k,{t:Date.now(),v});if(routes.size>500)routes.delete(routes.keys().next().value);return v}
 // "aqeelOS models": aqeelOS runs one turn for an agent on its engine and streams the events back. On the box's copy act
 // is the short signed note aqeelOS put on the person's request (x-aq-act), so the turn runs as them, not as the owner
 // this copy's key belongs to. A person's computer (25 Oct 2026) has no note: its key is that person's, and the engine
 // reaches the project here through the code bridge (bridge.mjs). The stream has no time limit; signal stops reading it.
 async function engineRun(body,act,signal){await load();if(!link.token)throw Error('This copy of Code is not paired with aqeelOS.');act=freshAct(act);if(!act&&process.env.CBA_ONLINE)throw Error('Open Code from aqeelOS again to run on aqeelOS models (your sign-in note ran out).');
  const r=await fetch(link.base+'/ui/code/engine/run',{method:'POST',headers:H(act,{'content-type':'application/json'}),body:JSON.stringify(body),signal,...(longDispatcher()?{dispatcher:longDispatcher()}:{})});
  if(!r.ok||!r.body){const j=await r.json().catch(()=>({}));throw Error(j.error||'aqeelOS did not start the run ('+r.status+').')}return r}
 // stop or answer an approval of an engine run, by the handle aqeelOS sent first
 async function engine(what,body,act){await load();const r=await fetch(link.base+'/ui/code/engine/'+what,{method:'POST',headers:H(act,{'content-type':'application/json'}),body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS answered '+r.status);return j}
 async function unpair(){link={};await writeFile(FILE,'{}').catch(()=>{});return state()}
 // a run with attached agents gets the aqeelOS tools when this computer is paired: the agents (ids and names), the run's
 // ticket, and the project folder the answers' files are saved in (none in Plan only)
 async function mcp(run){await load();if(!link.token||!run?.ticket)return null;return {name:'aqeelos',command:process.execPath,args:[path.join(root,'aqeelos-mcp.mjs')],env:{...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{}),AQ_BASE:link.base,AQ_TOKEN:link.token,AQ_PROJECT:String(run?.projectId||''),AQ_AGENTS:JSON.stringify(run.agentList||[]),AQ_TICKET:String(run.ticket),AQ_DIR:String(run.projectDir||''),AQ_PLAN:run.mode==='plan'?'1':'',...(run?.act?{AQ_ACT:freshAct(run.act)||run.act,AQ_ACT_FILE:actFile(run.act)}:{})}}}
 // ask aqeelOS every ~25 s for browser jobs for this computer (an agent's computer_browser). Code is one-way
 // (25 Oct 2026): agents never change Code projects, so this computer reports no projects and takes no project work.
 // The other jobs are code bridge calls of a run this computer started itself (bridge.mjs), answered on bridge-done.
 let serving=false;function serve({work}){if(serving||process.env.NODE_TEST_CONTEXT)return;serving=true;const wait=ms=>new Promise(r=>setTimeout(r,ms).unref?.());
  (async()=>{for(;;){await load();if(!link.token){await wait(10000);continue}
   try{const r=await fetch(link.base+'/ui/code/poll',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(40000)});
    if(r.status===401){await wait(60000);continue}const j=await r.json().catch(()=>({}));if(!r.ok){await wait(15000);continue}
    if(j.job){const job=j.job;void (async()=>{let out;try{out=await work(job)}catch(e){out={state:'failed',text:e.message}}
     // (a bridge answer is tried a second time after a short wait: the engine is waiting on it)
     const tell=()=>fetch(link.base+(job.kind==='bridge'?'/ui/code/bridge-done':'/ui/code/done'),{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({id:job.id,...out}),signal:AbortSignal.timeout(30000)});
     await tell().catch(()=>job.kind==='bridge'?wait(2000).then(tell):null).catch(()=>{})})()}}
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
   const files=unzip(buf).filter(([name])=>!/^(data|node_modules|projects|outputs)\//.test(name));
   // nothing is written until every file is confirmed against GitHub (update-verify.mjs); a failed check leaves the app as it is
   // where updates come from is named once (the install's own aqeelos.json, else the first update) and kept in data/, which no update writes
   const PIN=path.join(root,'data','update-source');let repo=(await readFile(PIN,'utf8').catch(()=>'')).trim();if(!repoOk(repo))repo=repoOk(install.repo)?install.repo:repoIn(files);
   await verifyUpdate(files,v.version,link.base,{repo});await mkdir(path.dirname(PIN),{recursive:true});await writeFile(PIN,repo+'\n');
   for(const [name,data] of files){const to=path.join(root,name);await mkdir(path.dirname(to),{recursive:true});await writeFile(to,data);n++}
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
 // Live: send a project (zip) to aqeelOS, which runs it on the server at <slug>.<its Live domain>
 async function publish(zip,{name,slug,repo,db,visibility},act){await load();if(!link.token)throw Error('Connect this app to aqeelOS first (open Code in aqeelOS).');
  const q=new URLSearchParams({name:name||'',slug:slug||'',repo:repo||'',db:db?'1':'',...(visibility?{visibility}:{})});
  const r=await fetch(link.base+'/ui/code/publish?'+q,{method:'POST',headers:H(act,{'content-type':'application/zip'}),body:zip,signal:AbortSignal.timeout(600000)});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not take it ('+r.status+').');return j}
 /* Team folders (Plan 4, 25 Oct 2026): the hub's small calls (share, members, history), and the address and key git uses
    for the team remote. The key goes to git only as a header for that address while Code runs it, never into a file. */
 async function team(route,body){await load();if(!link.token)throw Error('Connect this app to aqeelOS first (open Code in aqeelOS).');
  const r=await fetch(link.base+'/ui/code/team'+route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+link.token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  const j=await r.json().catch(()=>({}));if(!r.ok){const e=Error(j.error||'aqeelOS answered '+r.status);e.status=r.status;throw e}return j}
 async function teamGit(){await load();if(!link.token)throw Error('Connect this app to aqeelOS first (open Code in aqeelOS).');return {base:link.base,token:link.token}}
 // is an address free, and how is a publish going (asked of aqeelOS as this computer's person)
 async function live(what,q,act){await load();if(!link.token)throw Error('Connect this app to aqeelOS first (open Code in aqeelOS).');
  const r=await fetch(link.base+'/ui/code/live-'+what+'?'+new URLSearchParams(q),{headers:H(act),signal:AbortSignal.timeout(20000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not answer ('+r.status+').');return j}
 async function report(r){await load();if(!link.token)return;await fetch(link.base+'/ui/code/report',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({...r,version:install.version||'dev'}),signal:AbortSignal.timeout(15000)}).catch(()=>{})}
 return {origins,state,pair,unpair,mcp,agents,intros,ticket,noteAct,freshAct,anyAct,agentModel,engineRun,engine,serve,checkUpdate,autoUpdate,reportUsage,people,publish,live,report,team,teamGit}}
// the entries of a stored (uncompressed) zip, as aqeelOS makes them
function unzip(buf){const out=[];let i=0;while(i+30<=buf.length&&buf.readUInt32LE(i)===0x04034b50){const size=buf.readUInt32LE(i+18),nl=buf.readUInt16LE(i+26),xl=buf.readUInt16LE(i+28);
  const name=buf.slice(i+30,i+30+nl).toString();const start=i+30+nl+xl;out.push([name,buf.slice(start,start+size)]);i=start+size}return out}
