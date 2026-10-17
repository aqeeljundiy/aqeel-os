// Schedules that explain themselves: a folder, a plain description and what each run cost, for every schedule.
// Folders come from the [Bracket] in a title, or are picked by the helper model; anything set by hand wins.
// Descriptions are written once per prompt by the engine's small helper model (the one that describes agents),
// reading the runbook file a prompt points to, so nobody has to open a .md they cannot see.
import {readFile,writeFile,rename} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {homedir} from 'node:os';

export function createSchedules({DATA,DASH,TOKEN,HERMES_HOME,listAgents,python,root,live}){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const FILE=path.join(DATA,'schedule-meta.json');let db=null;
 const load=async()=>{if(db)return db;try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.jobs??={};db.folds??={};return db};
 const save=async()=>{const t=FILE+'.tmp';await writeFile(t,JSON.stringify(db,null,1));await rename(t,FILE)};
 const api=(p,o={})=>fetch(DASH+'/api'+p,{signal:AbortSignal.timeout(o.timeout||60000),...o,headers:{'x-hermes-session-token':TOKEN,'content-type':'application/json',...(o.headers||{})}}).then(async r=>{const j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.detail||'HTTP '+r.status);return j});
 const key=(profile,id)=>(profile||'default')+'|'+id;
 const hash=s=>createHash('sha1').update(String(s||'')).digest('hex').slice(0,12);
 const bracket=name=>(/^\s*\[([^\]]{1,40})\]/.exec(name||'')||[])[1]?.trim()||'';
 const HOME=homedir();

 async function jobs(){const l=await api('/cron/jobs?profile=all');return Array.isArray(l)?l:l.jobs||[]}

 // the files a prompt tells the agent to follow (only from the box's home folder, never secrets)
 async function runbooks(prompt,agent){const out=[];const own=path.join(HOME,'workspaces',String(agent||'default').split('--')[0])+'/';
  for(const m of String(prompt||'').matchAll(/(\/home\/[\w.-]+\/[^\s"'`)\]]+\.(?:md|txt))/g)){const p=path.resolve(m[1]);if(!p.startsWith(own)||/\/\.(env|secrets)|credential|token/i.test(p))continue;
   const text=await readFile(p,'utf8').catch(()=>null);if(text!=null&&!out.some(x=>x.path===p))out.push({path:p,text:text.slice(0,20000)})}
  return out}

 function aux(system,user,max=500){return new Promise(async res=>{const py=await python();if(!py)return res('');
  const c=execFile(py,[path.join(root,'scripts','aux-llm.py'),'.'],{timeout:120000,maxBuffer:2e6,cwd:'/tmp'},(e,o)=>res(e?'':String(o||'').trim()));c.stdin.end(JSON.stringify({system,user,max_tokens:max}))})}

 // one schedule described: what it does, the steps, a clearer title if the current one is a puzzle, and a folder
 async function describe(j,folders){const books=await runbooks(j.prompt,j.profile);
  const sys='You explain an automated, scheduled task to a busy non-technical business owner. Where the result goes is given below (Delivers to); never name a different app than that. Answer with JSON only: {"summary":"one plain sentence (max 22 words): what it does and why it is useful","steps":["2 to 5 very short steps it takes"],"title":"a clear title of max 6 words, or empty if the current title is already clear","folder":"the project or area it belongs to"}. For folder, reuse one of these if it fits: '+(folders.join(', ')||'(none yet)')+'. Otherwise give a short new one (1-2 words, e.g. the client or project name), or "General". Never mention files, skills, tools or code.';
  const user='Title: '+(j.name||'')+'\nRuns: '+(j.schedule?.display||j.schedule_display||'')+'\nDelivers to: '+(j.deliver||'this app')+'\n\nInstructions:\n'+String(j.prompt||'').slice(0,4000)+books.map(b=>'\n\nRunbook it follows ('+path.basename(b.path)+'):\n'+b.text.slice(0,6000)).join('');
  const raw=await aux(sys,user,600);const m=/\{[\s\S]*\}/.exec(raw);if(!m)return null;
  try{const v=JSON.parse(m[0]);return {summary:String(v.summary||'').slice(0,240),steps:(Array.isArray(v.steps)?v.steps:[]).map(s=>String(s).slice(0,120)).slice(0,5),title:String(v.title||'').slice(0,60),folder:String(v.folder||'').replace(/[\[\]]/g,'').trim().slice(0,30)}}catch{return null}}

 let busy=false;
 // keep every schedule described (new ones, and ones whose instructions changed); one at a time, in the background
 async function tick(){if(busy||!live())return;busy=true;try{await load();const all=await jobs();
   const folders=()=>[...new Set([...all.map(j=>bracket(j.name)),...Object.values(db.jobs).map(m=>m.folder)].filter(Boolean))];
   for(const j of all){const k=key(j.profile,j.id),m=db.jobs[k]||{};const h=hash((j.name||'')+'\n'+(j.prompt||'')+'\n'+(j.deliver||''));
    if(!m.folder&&bracket(j.name)){m.folder=bracket(j.name);m.folderAuto=true;db.jobs[k]=m;await save()}
    if(m.h===h&&m.summary!=null)continue;if(m.failH===h&&(m.tries>=3||Date.now()-(m.failAt||0)<(m.tries>1?6:1)*3600e3))continue;const d=await describe(j,folders());if(!d){m.failH=h;m.tries=(m.failH===h?(m.tries||0):0)+1;m.failAt=Date.now();db.jobs[k]=m;await save();continue}delete m.failH;delete m.tries;delete m.failAt;
    Object.assign(m,{h,summary:m.summaryManual?m.summary:d.summary,steps:d.steps,suggest:d.title&&d.title.toLowerCase()!==String(j.name||'').replace(/^\s*\[[^\]]*\]\s*/,'').toLowerCase()?d.title:''});
    if(!m.folder||m.folderAuto&&!bracket(j.name)){m.folder=bracket(j.name)||d.folder||'General';m.folderAuto=true}
    db.jobs[k]=m;await save()}
   // forget schedules that are gone
   const keep=new Set(all.map(j=>key(j.profile,j.id)));let gone=false;for(const k of Object.keys(db.jobs))if(!keep.has(k)){delete db.jobs[k];gone=true}if(gone)await save()}
  catch(e){console.warn('schedule descriptions:',e.message)}finally{busy=false}}

 // the runs of each schedule this month: tokens, estimated cost, how long, which model
 async function runs(agents){const out={};const since=Date.now()/1000-31*86400;
  await Promise.all(agents.map(async a=>{let s=[];for(let off=0;off<500;off+=100){let page=[];try{page=(await api('/sessions?sources=cron&limit=100&offset='+off+'&profile='+encodeURIComponent(a))).sessions||[]}catch{break}s.push(...page);if(page.length<100||page.some(x=>(x.started_at||0)<since))break}
   for(const x of s){const m=/^cron_([0-9a-f]+)_/.exec(x.id||'');if(!m||(x.started_at||0)<since)continue;const k=key(a,m[1]);const r=out[k]??={runs:[],tokens:0,cost:0};
    const tok=(x.input_tokens||0)+(x.output_tokens||0)+(x.reasoning_tokens||0)+(x.cache_read_tokens||0)+(x.cache_write_tokens||0);const cost=x.actual_cost_usd??x.estimated_cost_usd??0;
    r.tokens+=tok;r.cost+=cost||0;r.sub=r.sub||/subscription/.test(x.billing_provider||'');
    if(r.runs.length<12)r.runs.push({id:x.id,t:x.started_at,secs:x.ended_at?Math.round(x.ended_at-x.started_at):null,tokens:tok,cost,model:x.model,active:!!x.is_active,end:x.end_reason||'',sub:/subscription/.test(x.billing_provider||'')})}}))
  return out}

 // who a delivery goes to, by name ("whatsapp:263…@lid" → "Aqeel on WhatsApp")
 // WhatsApp addresses chats by a hidden ID (…@lid); the session keeps which phone number each one is
 async function names(agents,all){const out={},byPhone={};for(const a of agents){try{const p=await api('/pairing?profile='+encodeURIComponent(a));for(const x of p.approved||[])if(x.user_name){out[x.platform+':'+x.user_id]=x.user_name;byPhone[x.platform+':'+String(x.user_id).replace(/\D/g,'')]=x.user_name}}catch{}}
  for(const j of all){const m=/^whatsapp:(\d+)@lid$/.exec(j.deliver||'');if(!m||out[j.deliver])continue;
   for(const a of [j.profile||'default',...agents]){const ph=await readFile(path.join(homeOf(a),'platforms','whatsapp','session','lid-mapping-'+m[1]+'_reverse.json'),'utf8').then(t=>JSON.parse(t)).catch(()=>null);
    if(ph){const n=String(ph).replace(/\D/g,'');out[j.deliver]=byPhone['whatsapp:'+n]||'+'+n;break}}}
  return out}

 let infoCache=null;
 async function info(){await load();if(!infoCache||Date.now()-infoCache.t>60000){const agents=await listAgents();const all=await jobs().catch(()=>[]);const [r,n]=await Promise.all([runs(agents),names(agents,all)]);infoCache={t:Date.now(),runs:r,names:n}}return {meta:db.jobs,folds:db.folds,runs:infoCache.runs,names:infoCache.names}}
 async function setMeta(profile,id,b){await load();const k=key(profile,id);const m=db.jobs[k]??={};
  if(b.folder!==undefined){m.folder=String(b.folder||'').replace(/[\[\]]/g,'').trim().slice(0,30)||'General';m.folderAuto=false}
  if(b.summary!==undefined){m.summary=String(b.summary||'').slice(0,240);m.summaryManual=true}
  if(b.dismissSuggest)m.suggest='';await save();return m}
 async function folderOp(b){await load();const from=String(b.from||''),to=String(b.to||'').replace(/[\[\]]/g,'').trim().slice(0,30);
  if(b.fold!==undefined){db.folds[from]=!!b.fold;await save();return {ok:true}}
  if(!from||!to)throw new Error('Give the folder and its new name');for(const m of Object.values(db.jobs))if(m.folder===from){m.folder=to;m.folderAuto=false}await save();return {ok:true}}
 async function detail(profile,id){const all=await jobs();const j=all.find(x=>x.id===id&&(x.profile||'default')===(profile||'default'));if(!j)throw new Error('No such schedule');
  const books=(await runbooks(j.prompt,profile)).map(b=>({name:path.basename(b.path),path:b.path,text:b.text}));
  let last='';try{const s=(await api('/sessions?sources=cron&limit=40&order=recent&profile='+encodeURIComponent(profile||'default'))).sessions||[];const x=s.find(x=>String(x.id).startsWith('cron_'+id+'_')&&!x.is_active);
   if(x){const m=await api('/sessions/'+encodeURIComponent(x.id)+'/messages?limit=6&order=latest');const ms=(m.messages||m||[]).filter(y=>y.role==='assistant'&&typeof y.content==='string'&&y.content.trim());last=(ms[0]||ms[ms.length-1])?.content||'';last={session:x.id,text:String(last).slice(0,4000),at:x.ended_at||x.started_at}}}catch{}
  return {books,last}}
 // an agent files and describes what it made (the aqeelos-notify tool organize_schedule)
 async function organize(agent,a){const all=await jobs();const j=all.find(x=>x.id===String(a.job_id||'')&&(x.profile||'default')===agent)||all.find(x=>(x.profile||'default')===agent&&String(x.name||'').toLowerCase()===String(a.job_id||'').toLowerCase());
  if(!j)return {isError:true,text:'No schedule with that ID on this agent. List your schedules (cronjob list) and use its id.'};
  if(a.title){const t=String(a.title).trim().slice(0,80);await api('/cron/jobs/'+encodeURIComponent(j.id)+'?profile='+encodeURIComponent(agent),{method:'PUT',body:JSON.stringify({updates:{name:t}})})}
  await setMeta(agent,j.id,{...(a.folder?{folder:a.folder}:{}),...(a.description?{summary:a.description}:{})});
  return {text:'Filed "'+(a.title||j.name)+'"'+(a.folder?' in the folder '+a.folder:'')+(a.description?' with its description':'')+'. The person sees it on the Schedules page.'}}
 return {info,setMeta,folderOp,detail,organize,tick,load}}
