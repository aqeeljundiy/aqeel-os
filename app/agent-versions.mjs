// Self-repair kit (workstream E, 6 Nov 2026): each agent finds and fixes its own mistakes without asking the main agent.
//
// 1. Versions + undo. Every change an agent makes in its own scope is a version with who, when and why, and can be
//    undone with one click (Edit agent › Changes) or by the agent itself (undo_my_change):
//      instructions  its SOUL (kept by instructions.mjs; listed here and undone through it)
//      schedule      its own schedules (my_schedules: pause, resume, edit, run now, remove): the job before the change
//      setting       its own safe settings (my_settings): the value before
//      skill         its own skills folder: a git history of the folder, taken every few minutes and after every tool
//      webhook       routes it made for itself (create_my_webhook): undo removes the route
// 2. Automatic rollback. After a self-change aqeelOS checks that the agent still starts and answers (a short ping run of
//    its own); when it does not answer twice, the changes it made in the last hour are undone, newest first, the owner
//    is told and an issue is filed. Nothing waits for a person.
// 3. Own-scope tools (aqeelos-notify): my_logs (redacted), my_runs, my_health, my_deliveries (Kirimdev status of its own
//    sends), my_schedules, my_changes, undo_my_change, reconnect_my_connector, create_my_webhook, test_send.
//    Anything outside its own scope is filed for the aqeelOS fixer by itself (issues.mjs), never refused bare.
// 4. "What you can do": a list read from the agent's real config (tools per channel, apps and whether they are signed
//    in, skills, schedules, Kirimdev line, team group, webhooks) written into its context file, which every chat loads
//    at its start, so it never guesses what it has.
// Nothing here restarts the engine: settings take effect at the next reload, which the caller says.
import {readFile,writeFile,mkdir,rename,readdir,stat,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {TOOL_HELP,TOOL_PROPS} from './design-guard.mjs';
import {providerUnavailable,retryAt} from './provider-limits.mjs';

const run=(c,a,{cwd,timeout=60000,env}={})=>new Promise(res=>execFile(c,a,{cwd,timeout,env:env||process.env,maxBuffer:16e6},(e,o,er)=>res({ok:!e,code:e?.code??0,out:String(o||''),err:String(er||e?.message||'')})));
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'…':s};
const HOUR=3600e3;
// own settings an agent may change itself (same list as my_settings)
export const OWN_SETTING=/^(stt|tts)\.[a-z0-9_.]+$|^timezone$|^display\.[a-z0-9_.]+$/;
// redaction for logs an agent reads back: keys, tokens, bearer headers, long opaque strings (phone numbers stay readable: agents need their customers' numbers)
export function redactLog(t){return String(t)
 .replace(/\b(sk|xox[abpr]|ghp|gho|ya29|AIza|rk|pk)[-_A-Za-z0-9.]{8,}/g,'(hidden)')
 .replace(/(Bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/gi,'$1(hidden)')
 .replace(/((?:api[_-]?key|token|secret|password|passwd|authorization|bearer|cookie|signature)["']?\s*[:=]\s*["']?)(?!Bearer\b)[^\s"',;]+/gi,'$1(hidden)')
 .replace(/\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g,'bot(hidden)')
 .replace(/\b[A-Za-z0-9_-]{40,}\b/g,'(hidden)')}

// a provider's own signature on a webhook (Tripay, Xendit, Midtrans…): checked here with the agent's own saved key,
// then signed again for the engine's webhook listener (generic V2: HMAC of "<t>.<body>" with the route secret)
export function verifyProvider(v,headers,raw,key){if(!v||!key)return false;const h=String(headers[String(v.header||'').toLowerCase()]||'');if(!h)return false;
 if(v.scheme==='token')return safeEq(h,key);
 const alg=v.scheme==='hmac-sha512-hex'?'sha512':'sha256';const mac=createHmac(alg,key).update(raw).digest('hex');return safeEq(h.replace(/^sha(256|512)=/,''),mac)}
const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y)};
export function resign(secret,raw,t=Math.floor(Date.now()/1000)){return {'x-webhook-timestamp':String(t),'x-webhook-signature-v2':createHmac('sha256',secret).update(String(t)+'.').update(raw).digest('hex')}}

// which changes an automatic rollback undoes: the agent's own, made in the window, not undone yet, newest first
export function rollbackPlan(items,{since,now=Date.now()}={}){return items.filter(x=>x.at>=since&&x.at<=now&&x.state==='done'&&x.undoable!==false).sort((a,b)=>b.at-a.at||(+b.id)-(+a.id))}

// the "what you can do" list from real config (pure: the caller reads the files)
export function capabilityLines(c){const L=[];const tools=c.toolsByChannel||{};
 L.push('Checked by aqeelOS from your real settings at '+c.at+'. Go by this list, not by guesses; if something here is wrong or missing, call report_bottleneck with system true.');
 const ch=Object.entries(tools).filter(([,v])=>Array.isArray(v)&&v.length);
 if(ch.length)L.push('- Tools on each channel: '+ch.map(([k,v])=>k+': '+v.slice(0,14).join(', ')+(v.length>14?' +'+(v.length-14):'')).join(' · '));
 if(c.off?.length)L.push('- Switched off for you: '+c.off.join(', '));
 const apps=c.apps||[];if(apps.length)L.push('- Apps: '+apps.map(a=>a.name+(a.state==='ready'?'':' ('+a.state+')')).join(', ')+'. One that needs a sign-in: reconnect_my_connector.');
 L.push('- Skills of your own: '+(c.skills??0)+(c.skillNames?.length?' (for example '+c.skillNames.slice(0,8).join(', ')+')':'')+'.');
 L.push('- Schedules in your own list: '+(c.schedules?.length||0)+(c.schedules?.length?' ('+c.schedules.slice(0,8).map(s=>s.name+(s.on?'':' [paused]')).join('; ')+')':'')+'. See, edit, pause, run or remove them with my_schedules.');
 if(c.whatsapp)L.push('- Kirimdev line (customer chats in Kirimdev, the team\'s WhatsApp CRM; not a WhatsApp channel of yours): mode '+c.whatsapp.mode+(c.whatsapp.testers?.length?', testers '+c.whatsapp.testers.join(', '):'')+'. my_deliveries shows the status of your own sends; test_send sends to your own test chat.');
 if(c.team)L.push('- Team group: '+c.team+'.');else L.push('- Team group: none set yet.');
 if(c.webhooks?.length)L.push('- Your webhooks: '+c.webhooks.join(', ')+'. create_my_webhook makes another (for example a payment callback).');else L.push('- Webhooks: none yet. create_my_webhook makes one for you (for example a payment callback that checks the provider\'s signature).');
 L.push('- Run yourself: '+(c.selfRuns?'yes (run_self)':'no')+'. Terminal: '+(c.terminal||'none')+'.');
 L.push('- Fixing yourself: my_logs, my_runs, my_health, my_deliveries, my_changes and undo_my_change show and undo what you did; every change you make is versioned and rolled back by itself if you stop answering. Outside your own files: report_bottleneck with system true (it is fixed by aqeelOS, not by another agent).');
 return L}

// Hook used by agent-access.mjs (one agent changing another): attributes the change to the target agent so it shows
// in its own changes and can be undone. No-op until createAgentVersions has run.
let current=null;
export async function recordAgentChange(e={}){if(!current||!e.agent)return null;
 // by comes as {agent,name,level} from agent-access: keep the name (lists showed "[object Object]"); a setting is
 // stored the way my_settings stores it ({value}) so Undo can put it back; skill/schedule changes made by another
 // agent are listed but not undoable here (their before/after are not the shapes undo restores)
 const by=e.by&&typeof e.by==='object'?String(e.by.name||e.by.agent||'another agent'):String(e.by||'another agent');
 const setting=e.kind==='settings'||e.kind==='setting',kind=setting?'setting':e.kind,target=e.id??e.target??'';
 const what=e.what||(setting?target+': '+JSON.stringify(e.before??null)+' → '+JSON.stringify(e.after??null)+' (by '+by+')':kind+(target?' '+target:'')+' changed by '+by);
 return current(e.agent,{kind,target,what,why:e.why||'',by,before:setting?{value:e.before??null}:e.before,after:setting?{value:e.after??null}:e.after,undoable:setting||kind==='webhook'})}
export function createAgentVersions({guard=()=>null,DATA,HERMES_HOME,DASH,DASH_TOKEN,PUBLIC_URL='',listAgents,nameOf=a=>a,readConfig,setKey,pick,
 instructions=null,kirimdev=null,issues=null,health=null,teamGroups=null,selfRuns=null,bin,python=async()=>null,
 ping=null,tellOwner=async()=>{},quiet=()=>null,log=m=>console.log(m),now=()=>Date.now(),live=false,extraHealth=async()=>[],limits=null,outageAt=null}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const dir=a=>path.join(DATA,'agent-versions',a);
 const api=(p,o={})=>fetch(DASH+'/api'+p,{signal:AbortSignal.timeout(o.timeout||60000),...o,headers:{'x-hermes-session-token':DASH_TOKEN,'content-type':'application/json'}}).then(async r=>{const j=await r.json().catch(()=>null);if(!r.ok)throw Error(j?.detail||'HTTP '+r.status);return j});
 const dbs=new Map(),chains=new Map();
 const lock=(a,fn)=>{const p=(chains.get(a)||Promise.resolve()).then(fn);chains.set(a,p.catch(()=>{}));return p};
 async function load(a){if(dbs.has(a))return dbs.get(a);let d;try{d=JSON.parse(await readFile(path.join(dir(a),'index.json'),'utf8'))}catch{d={}}d.items||=[];d.seq||=0;d.watch||=null;d.events||=[];dbs.set(a,d);return d}
 async function save(a){const d=dbs.get(a);await mkdir(dir(a),{recursive:true});const f=path.join(dir(a),'index.json'),t=f+'.'+randomBytes(3).toString('hex')+'.tmp';await writeFile(t,JSON.stringify(d,null,1));await rename(t,f)}
 const view=x=>({id:x.id,kind:x.kind,target:x.target,what:x.what,why:x.why,by:x.by,at:x.at,state:x.state,undoneAt:x.undoneAt||null,undoneBy:x.undoneBy||null,undoable:x.undoable!==false});

 // ---- recording ----
 async function record(a,{kind,target,what,why='',by,before,after,undoable=true}){return lock(a,async()=>{const d=await load(a);const id=String(++d.seq);
  const x={id,kind,target:String(target||''),what:clip(what,300),why:clip(why,300),by:by||nameOf(a),at:now(),state:'done',undoable,before:before??null,after:after??null};
  d.items.push(x);if(d.items.length>400)d.items=d.items.slice(-400);
  // a self-change starts (or extends) the "does it still answer" watch
  if(by===nameOf(a)||by==='self'){d.watch={since:d.watch?.since&&now()-d.watch.since<HOUR?d.watch.since:x.at,due:now()+3*60e3,fails:0}}
  await save(a);return view(x)})}

 // ---- skills: a git history of the agent's own skills folder ----
 const gitDir=a=>path.join(dir(a),'skills.git'),skillsDir=a=>path.join(home(a),'skills');
 const git=(a,args,o={})=>run('git',['--git-dir='+gitDir(a),'--work-tree='+skillsDir(a),'-c','user.name=aqeelOS','-c','user.email=aqeelos@localhost','-c','core.quotepath=off',...args],{timeout:120000,...o});
 async function skillsInit(a){if(await stat(path.join(gitDir(a),'HEAD')).catch(()=>null))return true;if(!await stat(skillsDir(a)).catch(()=>null))return false;
  await mkdir(gitDir(a),{recursive:true});const r=await run('git',['init','--bare','-q',gitDir(a)]);if(!r.ok)return false;
  await writeFile(path.join(gitDir(a),'info','exclude'),'.usage.json\n__pycache__/\n*.pyc\n.hub/\n*.lock\nnode_modules/\n*.mp4\n*.png\n*.jpg\n*.jpeg\n*.webp\n*.gif\n*.pdf\n*.zip\n');
  await git(a,['config','core.bare','false']);await git(a,['add','-A']);const c=await git(a,['commit','-q','-m','start','--allow-empty']);return c.ok}
 // a snapshot: what changed since the last one becomes one "skill" version per skill folder
 async function skillsSnap(a,{by,why}={}){if(!await skillsInit(a))return [];await git(a,['add','-A']);const st=await git(a,['diff','--cached','--name-status']);if(!st.out.trim())return [];
  const files=st.out.trim().split('\n').map(l=>l.split('\t')).filter(x=>x[1]);const before=(await git(a,['rev-parse','HEAD'])).out.trim();
  const c=await git(a,['commit','-q','-m',clip(why||'changed',200)]);if(!c.ok)return [];const after=(await git(a,['rev-parse','HEAD'])).out.trim();
  const bySkill=new Map();for(const [s,f] of files){const k=f.split('/').slice(0,-1).join('/')||f;const top=k.split('/').slice(0,2).join('/');if(!bySkill.has(top))bySkill.set(top,[]);bySkill.get(top).push((s==='A'?'added ':s==='D'?'removed ':'changed ')+f)}
  // the engine's bundled-skill sync rewrites .bundled_manifest: those files are aqeelOS's, not the agent's self-change, so a rollback must not undo them
  const sync=files.some(x=>x[1]==='.bundled_manifest');
  // a skill added or removed byte-for-byte equal to the shared tier (the main agent's skills, which every agent reads)
  // changes nothing the agent sees: the engine drops such duplicate copies and a sandbox sync can bring them back.
  // Those are aqeelOS's, never a self-change: not undoable and they never arm the "still answers" watch (undoing them
  // put the copies back, the engine dropped them again: a loop every few minutes)
  const shared=path.join(HERMES_HOME,'skills');const blob=async(rev,f)=>{const r=await git(a,['rev-parse','--verify','-q',rev+':'+f]);return r.ok?r.out.trim():null};
  const sameAsShared=async fs=>{if(a==='default'||!fs.length)return false;for(const [s,f] of fs){if(s!=='A'&&s!=='D')return false;
   const h=await git(a,['hash-object','--',path.join(shared,f)]);if(!h.ok||!h.out.trim())return false;if(await blob(s==='D'?before:after,f)!==h.out.trim())return false}return true};
  const out=[];for(const [k,l] of bySkill){const mine=files.filter(x=>x[1].startsWith(k+'/')||x[1]===k);const dup=!sync&&await sameAsShared(mine);const sys=sync||dup;
   out.push(await record(a,{kind:'skill',target:k,what:l.slice(0,6).join('; ')+(l.length>6?' +'+(l.length-6):''),why:sync?'aqeelOS skill sync':dup?'copy of a shared skill (no change in what it sees)':(why||''),by:sync?'aqeelOS (skill sync)':dup?'aqeelOS (shared skill copy)':(by||nameOf(a)),undoable:!sys,before:{commit:before,files:mine.map(x=>x[1])},after:{commit:after}}))}return out}

 // ---- undo ----
 async function undo(a,id,{by='owner'}={}){const d=await load(a);const x=d.items.find(i=>i.id===String(id));if(!x)throw Error('No change '+id+'. my_changes lists yours.');
  if(x.state!=='done')throw Error('Change '+id+' was already undone.');if(x.undoable===false)throw Error('Change '+id+' cannot be undone.');
  if(x.kind==='instructions'){if(!instructions)throw Error('Instructions history is not available.');await instructions.restore(a,x.before.v,by+' (undo)')}
  else if(x.kind==='setting'||x.kind==='settings'){const bv=x.kind==='settings'?x.before:x.before?.value;const r=await setKey(a,x.target,bv==null?'':bv);/* 'settings' = older cross-agent entries (raw before) */if(!r.ok)throw Error('Could not set '+x.target+' back: '+clip(r.out||r.err,200))}
  else if(x.kind==='schedule'){await scheduleRestore(a,x)}
  else if(x.kind==='skill'){const files=x.before.files||[];for(const f of files){const has=(await git(a,['cat-file','-e',x.before.commit+':'+f])).ok;
    if(has){const r=await git(a,['checkout',x.before.commit,'--',f]);if(!r.ok)throw Error('Could not bring back '+f)}else await rm(path.join(skillsDir(a),f),{force:true})}
   await skillsSnap(a,{by,why:'undo of change '+id})}
  else if(x.kind==='webhook'){await webhookRemove(a,x.target)}
  else throw Error('Unknown kind '+x.kind);
  return lock(a,async()=>{const d2=await load(a);const y=d2.items.find(i=>i.id===x.id);y.state='undone';y.undoneAt=now();y.undoneBy=by;await save(a);return view(y)})}

 // ---- schedules (own list only) ----
 const q=a=>'?profile='+encodeURIComponent(a);
 async function myJobs(a){const l=await api('/cron/jobs'+q(a));return (Array.isArray(l)?l:l.jobs||[])}
 const jobView=j=>({id:j.id,name:j.name,schedule:j.schedule_display||j.schedule?.expr||j.schedule?.display,on:j.enabled!==false&&j.state!=='paused',next:j.next_run_at,last:j.last_run_at,status:j.last_status,error:j.last_error?clip(j.last_error,200):null,deliver:j.deliver,script:j.script||null,prompt:j.prompt?clip(j.prompt,400):''});
 const KEEP=['name','prompt','schedule','deliver','skills','model','provider','script','no_agent','workdir','enabled_toolsets','context_from'];
 const snapJob=j=>{const o={};for(const k of KEEP)if(j[k]!==undefined)o[k]=k==='schedule'?(j.schedule?.expr||j.schedule_display||j.schedule):j[k];o.on=j.enabled!==false&&j.state!=='paused';o.id=j.id;return o};
 async function scheduleRestore(a,x){const b=x.before;const jobs=await myJobs(a);const cur=jobs.find(j=>j.id===(x.after?.id||b?.id||x.target));
  if(!b){if(cur)await api('/cron/jobs/'+cur.id+q(a),{method:'DELETE'});return}
  if(!cur){const body={};for(const k of KEEP)if(b[k]!==undefined&&b[k]!==null)body[k]=b[k];body.schedule=String(b.schedule);const r=await api('/cron/jobs'+q(a),{method:'POST',body:JSON.stringify(body)});const nid=(r.job||r).id;if(!b.on)await api('/cron/jobs/'+nid+'/pause'+q(a),{method:'POST'});x.after={...(x.after||{}),id:nid};return}
  const up={};for(const k of ['name','prompt','schedule','deliver'])if(b[k]!==undefined)up[k]=b[k];await api('/cron/jobs/'+cur.id+q(a),{method:'PUT',body:JSON.stringify({updates:up})});
  const on=cur.enabled!==false&&cur.state!=='paused';if(on&&!b.on)await api('/cron/jobs/'+cur.id+'/pause'+q(a),{method:'POST'});if(!on&&b.on)await api('/cron/jobs/'+cur.id+'/resume'+q(a),{method:'POST'})}
 // create and edit go through the design guard first (design-guard.mjs before): it may refuse with the call to make instead, make an event
 // hook with no schedule at all (done), or add fields to the engine call (body) and write the check, the event rule and the reason after it
 async function mySchedules(a,args={},{by}={}){const act=String(args.action||'list');const jobs=await myJobs(a);const G=guard();
  if(act==='list')return {text:(jobs.length?jobs.map(j=>{const v=jobView(j);return '- '+v.id+' '+(v.on?'':'[paused] ')+v.name+' · '+v.schedule+' · next '+(v.next||'-')+' · last '+(v.last||'never')+(v.status?' ('+v.status+')':'')+(v.error?' error: '+v.error:'')+(v.script?' · script '+v.script:'')}).join('\n')+'\n\nThese are only the schedules in your own list. One that runs for you but sits in another agent\'s list: report_bottleneck with system true to have it moved.':'You have no schedules in your own list.')+(G?(await G.listLines(a).catch(()=>[])).join('\n'):'')};
  const id=String(args.id||'');const j=jobs.find(x=>x.id===id);
  if(act==='remove'&&/^hook:[\w-]{1,64}$/.test(id)&&G){const ok=await G.removeHook(a,id.slice(5));if(ok)await record(a,{kind:'schedule',target:id,what:'removed the event hook '+id.slice(5),why:args.why,by,before:null,after:{id:null},undoable:false});return ok?{text:'Removed the event hook '+id.slice(5)+'.'}:{isError:true,text:'No event hook '+id.slice(5)+' of yours. my_schedules action list shows them.'}}
  if(act==='create'){const s=String(args.schedule||'').trim(),name=String(args.name||'').trim();if(!name)return {isError:true,text:'create needs a name.'};
   const g=G?await G.before(a,{...args,action:'create'},null,{tool:'my_schedules',by}):{body:{},after:async()=>[]};if(g.refuse)return {isError:true,text:g.refuse};if(g.done)return {text:g.done};
   if(!s||!(g.body.prompt||args.prompt||'').trim())return {isError:true,text:'create needs name, schedule and prompt.'};
   const r=await api('/cron/jobs'+q(a),{method:'POST',body:JSON.stringify({name,schedule:s,prompt:String(args.prompt||''),deliver:String(args.deliver||'local'),...g.body})});const nj=r.job||r;
   const notes=await g.after(nj).catch(e=>['aqeelOS could not finish setting it up: '+e.message+'. Check it with my_schedules list.']);
   await record(a,{kind:'schedule',target:nj.id,what:'created "'+name+'" ('+s+')',why:args.why,by,before:null,after:{id:nj.id}});return {text:'Created '+nj.id+' "'+name+'", next run '+(nj.next_run_at||'-')+'. It is a version: undo_my_change removes it again.'+(notes.length?'\n\n'+notes.join('\n'):'')}}
  if(!j)return {isError:true,text:'No schedule '+id+' in your own list. my_schedules action list shows yours. A schedule in another agent\'s list is not yours to change: report_bottleneck with system true.',outside:!!id};
  const before=snapJob(j);
  if(act==='pause'||act==='resume'){await api('/cron/jobs/'+id+'/'+act+q(a),{method:'POST'});await record(a,{kind:'schedule',target:id,what:act+'d "'+j.name+'"',why:args.why,by,before,after:{id}});return {text:(act==='pause'?'Paused':'Resumed')+' "'+j.name+'". Undo with undo_my_change.'}}
  if(act==='run_now'){api('/cron/jobs/'+id+'/trigger'+q(a),{method:'POST',body:'{}',timeout:900e3}).catch(e=>log('my_schedules run_now '+a+' '+id+': '+e.message));return {text:'Started "'+j.name+'" now. my_runs shows how it went.'}}
  if(act==='edit'){const up={};for(const k of ['name','prompt','schedule','deliver'])if(args[k]!==undefined&&String(args[k]).trim())up[k]=String(args[k]);
   const g=G?await G.before(a,{...args,action:'edit'},j,{tool:'my_schedules',by}):{body:{},after:async()=>[]};if(g.refuse)return {isError:true,text:g.refuse};Object.assign(up,g.body);
   const design=['script','checks','check_script','on_event'].filter(k=>args[k]!=null&&String(args[k]).trim());if(!Object.keys(up).length&&!design.length)return {isError:true,text:'Give what to change: name, prompt, schedule, deliver, script, checks, check_script or on_event.'};
   if(Object.keys(up).length)await api('/cron/jobs/'+id+q(a),{method:'PUT',body:JSON.stringify({updates:up})});const notes=await g.after({...j,...up}).catch(e=>['aqeelOS could not finish setting it up: '+e.message+'.']);const what=[...new Set([...Object.keys(up),...design])].join(', ');
   await record(a,{kind:'schedule',target:id,what:'changed '+what+' of "'+j.name+'"',why:args.why,by,before,after:{id}});return {text:'Changed '+what+' of "'+j.name+'". Undo with undo_my_change.'+(notes.length?'\n\n'+notes.join('\n'):'')}}
  if(act==='remove'){await api('/cron/jobs/'+id+q(a),{method:'DELETE'});await record(a,{kind:'schedule',target:id,what:'removed "'+j.name+'"',why:args.why,by,before,after:{id:null}});return {text:'Removed "'+j.name+'" (kept as a version: undo_my_change brings it back exactly).'}}
  return {isError:true,text:'action is list, create, edit, pause, resume, run_now or remove.'}}

 // ---- settings ----
 async function mySetting(a,key,value,{by,why}={}){if(!OWN_SETTING.test(key))return {isError:true,outside:true,text:'Not one of your own settings.'};const c=await readConfig(a).catch(()=>null);const before=pick(c,key)??null;
  const r=await setKey(a,key,value===null?'':value).catch(e=>({ok:false,out:e.message}));if(!r.ok)return {isError:true,text:'Could not change it: '+clip(r.out||r.err,300)};
  await record(a,{kind:'setting',target:key,what:key+': '+JSON.stringify(before)+' → '+JSON.stringify(value),why,by,before:{value:before},after:{value}});return {text:'Saved '+key+' = '+JSON.stringify(value)+'. It is a version (undo_my_change).'}}

 // ---- runs, logs, health, deliveries ----
 async function myRuns(a,{limit=10}={}){const jobs=await myJobs(a).catch(()=>[]);const out=[];
  for(const j of jobs.filter(j=>j.last_run_at).sort((x,y)=>String(y.last_run_at).localeCompare(String(x.last_run_at))).slice(0,limit)){
   let r=null;try{const rr=await api('/cron/jobs/'+j.id+'/runs'+q(a)+'&limit=3');r=(rr.runs||rr||[])[0]||null}catch{}
   out.push('- '+j.name+' ('+j.id+'): last '+j.last_run_at+' '+(j.last_status||'')+(j.last_error?' — '+clip(redactLog(j.last_error),200):'')+(j.last_delivery_error?' — delivery: '+clip(j.last_delivery_error,160):'')+(j.failure_streak?' · '+j.failure_streak+' failures in a row':''))}
  const sr=selfRuns?await selfRuns.mine(a).catch(()=>null):null;
  return {text:(out.length?'Your schedules, newest run first:\n'+out.join('\n'):'No schedule runs yet.')+(sr?.runs?.length?'\n\nYour run_self runs: '+sr.runs.slice(0,5).map(r=>r.id+' '+r.state).join(', '):'')}}
 async function myLogs(a,{lines=60,match='',which='errors'}={}){const files={errors:'errors.log',agent:'agent.log',gateway:'gateway.log',tools:'mcp-stderr.log'};const f=path.join(home(a),'logs',files[which]||files.errors);
  const st=await stat(f).catch(()=>null);if(!st)return {text:'No '+which+' log yet.'};const n=Math.min(st.size,400e3);const fh=await (await import('node:fs/promises')).open(f,'r');let t='';
  try{const b=Buffer.alloc(n);await fh.read(b,0,n,st.size-n);t=b.toString('utf8')}finally{await fh.close()}
  let L=t.split('\n').filter(Boolean);if(match){const re=new RegExp(String(match).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');L=L.filter(l=>re.test(l))}
  L=L.slice(-Math.max(1,Math.min(+lines||60,200)));return {text:L.length?'Your '+which+' log (last '+L.length+' lines, keys and numbers hidden):\n'+L.map(l=>clip(redactLog(l),400)).join('\n'):'Nothing'+(match?' matching "'+match+'"':'')+' in your '+which+' log.'}}
 async function myHealth(a){const lines=[];
  try{const v=await health?.view();const r=v?.agents?.find(x=>x.agent===a);if(r){lines.push(r.problems?.length?'Problems aqeelOS sees for you:\n'+r.problems.map(p=>'- '+(p.text||p.title||p.what)+(p.detail?': '+clip(p.detail,200):'')).join('\n'):'aqeelOS sees no problems for you.');if(r.drops)lines.push('Failed messages this week: '+JSON.stringify(r.drops))}}catch(e){lines.push('Health could not be read: '+e.message)}
  try{const l=await issues?.forAgent(a);if(l?.length)lines.push('Your issues with the aqeelOS fixer:\n'+l.slice(0,8).map(i=>'- '+i.id+' '+i.state+': '+clip(i.missing,160)).join('\n'))}catch{}
  const jobs=await myJobs(a).catch(()=>[]);const bad=jobs.filter(j=>j.last_status&&j.last_status!=='ok'||j.failure_streak);if(bad.length)lines.push('Schedules that failed last time: '+bad.map(j=>j.name+' ('+j.id+')').join(', '));
  try{lines.push(...(await extraHealth(a)||[]))}catch{}
  const d=await load(a);if(d.watch)lines.push('aqeelOS is checking you still answer after your last change (rolls back by itself if not).');
  const rb=d.events.filter(e=>e.kind==='rollback').slice(-2);if(rb.length)lines.push('Automatic rollbacks: '+rb.map(e=>new Date(e.at).toISOString()+' '+e.text).join(' | '));
  return {text:lines.join('\n\n')||'Nothing to report.'}}
 async function myDeliveries(a,{limit=30}={}){if(!kirimdev)return {text:'No Kirimdev lines here.'};const lines=await kirimdev.lines().catch(()=>({}));const line=lines[a];if(!line)return {text:'You have no Kirimdev line.'};
  const r=await kirimdev._api(String(line.phoneNumberId)+'/messages?direction=outbound&limit='+Math.max(1,Math.min(+limit||30,100)));const m=(r.data||[]).filter(x=>x.direction==='outbound');
  const by={};for(const x of m)by[x.status]=(by[x.status]||0)+1;const old=m.filter(x=>/pending|queued|accepted|sending/.test(x.status)&&now()-Date.parse(x.created_at)>10*60e3);const failed=m.filter(x=>/fail|undeliver|error/.test(x.status));
  return {text:'Your last '+m.length+' sends on your Kirimdev line: '+Object.entries(by).map(([k,v])=>v+' '+k).join(', ')+'.'+(old.length?'\nStill not delivered after 10 minutes: '+old.map(x=>x.id+' to '+x.to+' at '+x.created_at+' ('+x.status+')').join('; '):'')+(failed.length?'\nFailed: '+failed.map(x=>x.id+' to '+x.to+' at '+x.created_at+' ('+x.status+(x.error?': '+clip(JSON.stringify(x.error),120):'')+')').join('; '):'')
   +'\nNewest: '+m.slice(0,5).map(x=>x.created_at.slice(11,16)+' '+x.to+' '+x.status+' "'+clip(String(x.content||x.type).replace(/\s+/g,' '),50)+'"').join(' | ')}}

 // ---- webhooks of its own ----
 const subsFile=path.join(HERMES_HOME,'webhook_subscriptions.json'),verFile=path.join(DATA,'agent-webhooks.json');
 async function readJson(f,d){try{return JSON.parse(await readFile(f,'utf8'))}catch{return d}}
 async function myWebhooks(a){const s=await readJson(subsFile,{});return Object.entries(s).filter(([,v])=>v?.profile===a).map(([k])=>k)}
 async function createWebhook(a,args,{by}={}){const name=String(args.name||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50);
  if(!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(name))return {isError:true,text:'Give a name: lowercase letters, numbers, - or _.'};const full=a+'-'+name;
  const s=await readJson(subsFile,{});if(s[full])return {isError:true,text:'You already have a webhook '+full+'.'};
  const prompt=String(args.prompt||'').trim();if(!prompt)return {isError:true,text:'Give the prompt: what you do with each call. {field.sub} puts a field of the payload in, {__raw__} the whole payload.'};
  const secret=randomBytes(24).toString('hex');const cli=['-p','default','webhook','subscribe',full,'--route-profile',a,'--secret',secret,'--prompt',prompt,'--description',clip(args.description||('Made by '+nameOf(a)+' for itself'),200)];
  if(args.deliver)cli.push('--deliver',String(args.deliver));if(args.deliver_chat_id)cli.push('--deliver-chat-id',String(args.deliver_chat_id));
  const r=await run(bin,cli,{timeout:90000,env:{...process.env,HOME:path.dirname(HERMES_HOME)}});if(!r.ok||/^Error:/m.test(r.out))return {isError:true,text:'Could not create it: '+clip((r.out+r.err).trim().split('\n').pop(),300)};
  // the provider's own signature (it cannot sign the way the engine checks): checked here with a key the agent saved
  let verify=null;if(args.verify_header){const scheme=['hmac-sha256-hex','hmac-sha512-hex','token'].includes(args.verify_scheme)?args.verify_scheme:'hmac-sha256-hex';const key=String(args.verify_key_name||'').trim().toUpperCase();
   if(!/^[A-Z][A-Z0-9_]{2,60}$/.test(key))return {isError:true,text:'verify_key_name is the name of the key you saved (ask_secret save or request_secret_link), for example TRIPAY_PRIVATE_KEY.'};
   verify={header:String(args.verify_header).toLowerCase(),scheme,key};const v=await readJson(verFile,{});v[full]={agent:a,secret,verify};await writeFile(verFile,JSON.stringify(v,null,1),{mode:0o600})}
  else{const v=await readJson(verFile,{});v[full]={agent:a,secret,verify:null};await writeFile(verFile,JSON.stringify(v,null,1),{mode:0o600})}
  await record(a,{kind:'webhook',target:full,what:'made webhook '+full+(verify?' (checks '+verify.header+' with '+verify.key+')':''),why:args.why,by,before:null,after:{name:full}});
  const url=(PUBLIC_URL||'')+'/webhooks/'+a+'/'+full;
  return {text:'Webhook ready: '+url+'\n'+(verify?'Give the provider this address. aqeelOS checks its '+verify.header+' signature with your key '+verify.key+' (save it with ask_secret or request_secret_link if you have not), then runs your prompt. A call without a valid signature is refused.':'Callers must sign each call: header X-Webhook-Timestamp (unix seconds) and X-Webhook-Signature-V2 = hex HMAC-SHA256 of "<timestamp>.<body>" with the secret aqeelOS keeps for it; for a provider that signs its own way, make it again with verify_header, verify_scheme and verify_key_name.')+'\nIt takes calls at once (no restart). Undo with undo_my_change.'}}
 async function webhookRemove(a,full){const s=await readJson(subsFile,{});if(s[full]&&s[full].profile!==a)throw Error('Not your webhook.');if(s[full]){const r=await run(bin,['-p','default','webhook','remove',full],{timeout:60000,env:{...process.env,HOME:path.dirname(HERMES_HOME)}});if(!r.ok)throw Error('Could not remove it: '+clip(r.out+r.err,200))}
  const v=await readJson(verFile,{});delete v[full];await writeFile(verFile,JSON.stringify(v,null,1),{mode:0o600})}
 // the public /webhooks/<agent>/<name> address: a provider signature is checked and signed again for the engine
 async function hookGate(agent,name,headers,raw){const v=(await readJson(verFile,{}))[name];if(!v||v.agent!==agent||!v.verify)return {pass:true};
  const env=await readFile(path.join(home(agent),'.env'),'utf8').catch(()=>'');const key=(new RegExp('^'+v.verify.key+'=["\']?([^"\'\\n]+)','m').exec(env)||[])[1];
  if(!key)return {pass:false,status:503,error:'The key '+v.verify.key+' is not saved yet.'};if(!verifyProvider(v.verify,headers,raw,key))return {pass:false,status:401,error:'Invalid signature'};
  return {pass:true,headers:resign(v.secret,raw)}}

 // ---- test send to its own test chat ----
 async function testSend(a,{text,channel}={}){text=String(text||'').trim();if(!text)return {isError:true,text:'Write the text.'};
  const lines=kirimdev?await kirimdev.lines().catch(()=>({})):{};const line=lines[a];
  if((channel||(line?'whatsapp':'telegram'))==='whatsapp'){if(!line)return {isError:true,text:'You have no Kirimdev line.'};const t=(line.testers||[]).find(x=>x.phone);if(!t)return {isError:true,text:'Your line has no tester with a number. The owner adds testers for your Kirimdev line (Channels › Kirimdev).'};
   try{const r=await kirimdev.reply(a,t.phone,'[test] '+text);return {text:'Sent to your tester '+t.who+' ('+r.length+' part'+(r.length===1?'':'s')+'). my_deliveries shows when it is delivered.'}}catch(e){return {isError:true,text:'Not sent: '+e.message}}}
  const g=teamGroups?await teamGroups.get(a).catch(()=>null):null;if(!g?.chatId)return {isError:true,text:'No team group is set for you, so there is no test chat. Ask the owner to name one (team_group).'};
  const env=await readFile(path.join(home(a),'.env'),'utf8').catch(()=>'');const tok=(/^TELEGRAM_BOT_TOKEN=["']?([^"'\s]+)/m.exec(env)||[])[1];if(!tok)return {isError:true,text:'You have no Telegram bot.'};
  const thread=g.topics?.own||g.topics?.log||null;const r=await fetch('https://api.telegram.org/bot'+tok+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:g.chatId,...(thread?{message_thread_id:thread}:{}),text:'[test] '+text.slice(0,3900)}),signal:AbortSignal.timeout(30000)}).then(r=>r.json()).catch(e=>({ok:false,description:e.message}));
  return r.ok?{text:'Sent to your own topic in '+(g.name||'your team group')+'.'}:{isError:true,text:'Telegram refused: '+(r.description||'unknown')}}

 // ---- "does it still answer" + automatic rollback ----
 async function watchTick(){if(!live||!ping)return;for(const a of (await listAgents()).filter(x=>x!=='default'&&!x.includes('--'))){const d=await load(a);const w=d.watch;if(!w||w.due>now())continue;
  // a deleted agent (tombstone in profiles/.deleted, its dir may linger) is gone on purpose, not broken: disarm, never roll back
  if(await stat(path.join(HERMES_HOME,'profiles','.deleted',a)).catch(()=>null)){await lock(a,async()=>{const d1=await load(a);if(d1.watch){d1.watch=null;d1.events.push({kind:'ok',at:now(),text:'agent deleted; watch stopped'});await save(a)}});continue}
  // its own chats running right now count as answering; otherwise a short ping run of its own
  let ok=false,why='',unsure=false;try{const r=await ping(a);ok=r.ok===true;unsure=!!r.unsure;why=r.why||''}catch(e){why=e.message}
  // a ping that could not tell (the engine was restarting) is not a "did not answer": try again later, no fail counted
  // the same when the AI provider could not answer (rate limit, account used up, no model reachable): that says nothing about
  // the change, so nothing is undone and no issue is filed; it is asked again after the account's reset time, if known
  const lim=ok?null:providerUnavailable(why,{now:now()});if(lim){limits?.note(why,{now:now()});unsure=true}
  if(unsure){await lock(a,async()=>{const d1=await load(a);if(d1.watch){d1.watch.due=lim?retryAt(lim,{now:now(),fallback:10*60e3}):now()+4*60e3;
   if(lim&&!d1.events.slice(-1).some(e=>e.kind==='unavailable'&&now()-e.at<HOUR))d1.events.push({kind:'unavailable',at:now(),text:'the AI provider is not available ('+lim.kind+'), so nothing was checked: '+clip(lim.why,160)});await save(a)}});continue}
  await lock(a,async()=>{const d2=await load(a);if(!d2.watch)return;
   if(ok){d2.events.push({kind:'ok',at:now(),text:'answered after its changes'});d2.watch=null;await save(a);return}
   d2.watch.fails=(d2.watch.fails||0)+1;d2.watch.due=now()+4*60e3;d2.events.push({kind:'noanswer',at:now(),text:clip(why,200)});await save(a)});
  const d3=await load(a);if(ok||!d3.watch||d3.watch.fails<2)continue;
  const plan=rollbackPlan(d3.items,{since:d3.watch.since-1000});const done=[],failed=[];let instr=null;
  for(const x of plan){try{await undo(a,x.id,{by:'aqeelOS (automatic rollback)'});done.push(x.id+' '+x.what)}catch(e){failed.push(x.id+': '+e.message)}}
  if(instructions){try{const h=await instructions.history(a);const mine=(h.versions||[]).filter(v=>v.at>=d3.watch.since-1000&&v.by===nameOf(a)).sort((x,y)=>x.v-y.v);
   if(mine.length&&mine[0].v>1){instr={to:mine[0].v-1,was:Math.max(...(h.versions||[]).map(v=>v.v))};await instructions.restore(a,mine[0].v-1,'aqeelOS (automatic rollback)');done.push('instructions back to version '+(mine[0].v-1))}}catch(e){failed.push('instructions: '+e.message)}}
  const text=nameOf(a)+' stopped answering after changing itself, so aqeelOS undid '+(done.length?done.length+' change'+(done.length===1?'':'s')+': '+done.join('; '):'nothing it could undo')+(failed.length?'. Could not undo: '+failed.join('; '):'')+'. Last reason: '+clip(why,200);
  await lock(a,async()=>{const d4=await load(a);d4.events.push({kind:'rollback',at:now(),text,ids:plan.map(x=>x.id),why:clip(why,200),...(instr?{instr}:{})});d4.watch=done.length?{since:now(),due:now()+3*60e3,fails:0}:null;await save(a)});
  log('agent-versions: '+text);{const q=quiet(a);if(q)log('agent-versions: not sent to the owner ('+(q==='test'?'test agent':'restart hold')+')');else await tellOwner(text).catch(()=>{})}
  if(issues)await issues.file({agent:a,what:'Automatic rollback',missing:nameOf(a)+' stopped answering after a self-change',evidence:text,proposed_fix:'Check its logs (my_logs) and the undone changes; the agent can make them again correctly.',origin:{}}).catch(()=>{})}}
 // ---- rollbacks made for a reason that was not the agent's (12 Nov 2026) ----
 // Before the provider check, "no answer" because the AI account was used up undid good changes. This finds those rollbacks
 // (an automatic rollback in the last 48 h whose last reason is a provider limit) and puts the changes back: a setting, a skill
 // and the instructions version. Anything else (schedules, webhooks) is only listed. Each rollback is restored once.
 const AUTO='aqeelOS (automatic rollback)',redoable=x=>x.undoable!==false&&(x.kind==='setting'||x.kind==='skill');
 const reasonOf=e=>e.why||/Last reason: (.*)$/.exec(String(e.text||''))?.[1]||'';
 function falseRollbacksOf(d,{since=48*HOUR}={}){return d.events.filter(e=>e.kind==='rollback'&&e.at>=now()-since&&(providerUnavailable(reasonOf(e))||/^it did not answer \(\d+\):?$/.test(reasonOf(e).trim())&&outageAt?.(e.at))).map(e=>{
   const items=d.items.filter(x=>x.state==='undone'&&x.undoneBy===AUTO&&(e.ids?e.ids.includes(x.id):x.undoneAt>=e.at-300e3&&x.undoneAt<=e.at+1000));
   return {at:e.at,reason:clip(reasonOf(e),200),restoredAt:e.restored||null,instructions:e.instr||null,changes:items.map(x=>({id:x.id,kind:x.kind,target:x.target,what:x.what,redoable:redoable(x)}))}})}
 async function falseRollbacks(a,o){return falseRollbacksOf(await load(a),o)}
 async function redo(a,x){if(x.kind==='setting'){const r=await setKey(a,x.target,x.after?.value==null?'':x.after.value);if(!r.ok)throw Error('Could not set '+x.target+' again: '+clip(r.out||r.err,200))}
  else if(x.kind==='skill'){for(const f of x.before.files||[]){const has=(await git(a,['cat-file','-e',x.after.commit+':'+f])).ok;
    if(has){const r=await git(a,['checkout',x.after.commit,'--',f]);if(!r.ok)throw Error('Could not bring back '+f)}else await rm(path.join(skillsDir(a),f),{force:true})}
   await skillsSnap(a,{by:'aqeelOS (false rollback restored)',why:'restored change '+x.id})}
  else throw Error('Cannot be redone: '+x.kind);
  return lock(a,async()=>{const d=await load(a);const y=d.items.find(i=>i.id===x.id);y.state='done';y.restoredAt=now();delete y.undoneAt;delete y.undoneBy;await save(a)})}
 // apply:false only reports what it would put back (the same report that lists what it could not)
 async function restoreFalseRollbacks(a,{apply=true,since}={}){const d=await load(a),out=[];
  for(const f of falseRollbacksOf(d,{since})){const rec={...f,restored:[],left:[]};
   if(!f.restoredAt&&apply){const e=d.events.find(x=>x.kind==='rollback'&&x.at===f.at);
    for(const c of f.changes.slice().reverse()){const x=d.items.find(i=>i.id===c.id);if(!c.redoable||!x){rec.left.push(c.id+' '+c.what);continue}
     try{await redo(a,x);rec.restored.push(c.id+' '+c.what)}catch(er){rec.left.push(c.id+': '+er.message)}}
    if(f.instructions&&instructions){try{await instructions.restore(a,f.instructions.was,'aqeelOS (false rollback restored)');rec.restored.push('instructions back to version '+f.instructions.was)}catch(er){rec.left.push('instructions: '+er.message)}}
    await lock(a,async()=>{const d2=await load(a);const e2=d2.events.find(x=>x.kind==='rollback'&&x.at===f.at);if(e2){e2.restored=now();d2.events.push({kind:'restored',at:now(),text:'put back what a rollback undid only because the AI provider was not available: '+(rec.restored.join('; ')||'nothing')});await save(a)}});
    if(rec.restored.length)log('agent-versions: '+a+': restored '+rec.restored.length+' change(s) a rollback undid only because the AI provider was not available')}
   out.push(rec)}
  return out}
 async function restoreAllFalseRollbacks(o){const out={};for(const a of (await listAgents()).filter(x=>!x.includes('--'))){try{const r=await restoreFalseRollbacks(a,o);if(r.length)out[a]=r}catch(e){log('agent-versions restore '+a+': '+e.message)}}return out}
 async function arm(a){return lock(a,async()=>{const d=await load(a);d.watch={since:d.watch?.since&&now()-d.watch.since<HOUR?d.watch.since:now(),due:now()+3*60e3,fails:0};await save(a)})}
 async function skillsTick(){for(const a of (await listAgents()).filter(x=>x!=='default'&&!x.includes('--'))){try{const v=(await skillsSnap(a,{by:nameOf(a),why:'its own skill change'})).filter(x=>x.undoable);if(v.length)log('agent-versions: '+a+' changed '+v.length+' skill(s)')}catch(e){log('agent-versions skills '+a+': '+e.message)}}}

 // ---- the "what you can do" list ----
 async function capabilities(a){const c=await readConfig(a).catch(()=>null)||{};const pts=pick(c,'platform_toolsets')||{};const toolsByChannel={};
  for(const [k,v] of Object.entries(pts))if(Array.isArray(v)&&!/^(cli|api_server)$/.test(k))toolsByChannel[k]=v.map(String);
  const off=[].concat(pick(c,'agent.disabled_toolsets')||[]).map(String).filter(Boolean);
  const tokDir=path.join(home(a),'mcp-tokens');const toks=await readdir(tokDir).catch(()=>[]);
  const apps=Object.entries(pick(c,'mcp_servers')||{}).filter(([,v])=>v&&typeof v==='object').map(([n,v])=>{const disabled=/^(false|0|no|off)$/i.test(String(v.enabled??''));const oauth=String(v.auth||'').toLowerCase()==='oauth'||(!v.headers&&!v.command&&/^https:/.test(String(v.url||''))&&!/127\.0\.0\.1|localhost/.test(String(v.url||'')));
   const signed=toks.some(f=>f===n+'.json'||f.startsWith(n+'.')&&!f.includes('client'));return {name:n,state:disabled?'off':oauth&&!signed?'needs a sign-in':'ready'}}).filter(x=>!/^aqeelos-/.test(x.name));
  let skillNames=[];try{skillNames=(await readdir(skillsDir(a),{withFileTypes:true})).filter(d=>d.isDirectory()&&!d.name.startsWith('.')).map(d=>d.name)}catch{}
  let skills=0;for(const cat of skillNames){const s=await readdir(path.join(skillsDir(a),cat),{withFileTypes:true}).catch(()=>[]);const n=s.filter(d=>d.isDirectory()).length;skills+=n||1}
  const jobs=await myJobs(a).catch(()=>[]);const lines=kirimdev?await kirimdev.lines().catch(()=>({})):{};const wl=lines[a];
  const g=teamGroups?await teamGroups.get(a).catch(()=>null):null;
  return capabilityLines({at:new Date(now()).toISOString().slice(0,16).replace('T',' ')+' UTC',toolsByChannel,off,apps,skills,skillNames,schedules:jobs.filter(j=>j.state!=='completed').map(j=>({name:j.name,on:j.enabled!==false&&j.state!=='paused'})),
   whatsapp:wl?{mode:wl.mode||'test',testers:(wl.testers||[]).map(t=>t.who)}:null,team:g?.chatId?(g.name||g.chatId):null,webhooks:await myWebhooks(a),selfRuns:pick(c,'terminal.backend')==='ssh',terminal:off.includes('terminal')?'off':pick(c,'terminal.backend')==='ssh'?'its own Linux user':pick(c,'terminal.backend')||'local'})}

 async function changes(a,{limit=30}={}){const d=await load(a);let inst=[];
  if(instructions){try{const h=await instructions.history(a);inst=(h.versions||[]).slice(0,10).map(v=>({id:'i'+v.v,kind:'instructions',target:'SOUL',what:'version '+v.v+' ('+(v.added??'?')+' added, '+(v.removed??'?')+' removed)',why:v.why||'',by:v.by||'',at:v.at,state:'done',undoable:v.v>1}))}catch{}}
  const all=[...d.items.map(view),...inst].sort((x,y)=>y.at-x.at||(+String(y.id).replace(/\D/g,''))-(+String(x.id).replace(/\D/g,''))).slice(0,limit);return {items:all,watch:d.watch,events:d.events.slice(-10).reverse()}}
 async function undoAny(a,id,{by}={}){if(/^i\d+$/.test(String(id))){const v=+String(id).slice(1);if(!instructions||v<2)throw Error('That instructions version has nothing before it.');await instructions.restore(a,v-1,by||'undo');return {kind:'instructions',v:v-1}}return undo(a,id,{by})}

 current=record; // module-level hook for agent-access.mjs (recordAgentChange)
 return {myJobs,updateJob:(a,id,up)=>api('/cron/jobs/'+encodeURIComponent(id)+q(a),{method:'PUT',body:JSON.stringify({updates:up})}),arm,record,undo:undoAny,changes,mySchedules,mySetting,myRuns,myLogs,myHealth,myDeliveries,createWebhook,hookGate,testSend,capabilities,skillsSnap,watchTick,skillsTick,load,falseRollbacks,restoreFalseRollbacks,restoreAllFalseRollbacks,
  noteSelfChange:async(a,{kind,what,why,by,before,after,undoable})=>record(a,{kind,target:kind,what,why,by:by||nameOf(a),before,after,undoable})}}

// tool list for aqeelos-notify (shown to every agent except the main one, which already changes everything)
export const VERSION_TOOLS=[
 {name:'my_changes',description:'Your own changes (instructions, skills, schedules, settings, webhooks), newest first, each with an id you can undo, plus whether aqeelOS is still checking that you answer after them. Use it before undo_my_change.',inputSchema:{type:'object',properties:{limit:{type:'number'}}},annotations:{readOnlyHint:true}},
 {name:'undo_my_change',description:'Undo one of your own changes by its id from my_changes (a SOUL version is "i<number>"). The undo is a change too and shows in the history.',inputSchema:{type:'object',properties:{id:{type:'string'},why:{type:'string'}},required:['id']}},
 {name:'my_logs',description:'Read your own logs (errors, agent, gateway or tools), newest lines last, with keys, tokens and phone numbers hidden. Use match to filter, e.g. a job id or an error word.',inputSchema:{type:'object',properties:{which:{type:'string',enum:['errors','agent','gateway','tools']},match:{type:'string'},lines:{type:'number'}}},annotations:{readOnlyHint:true}},
 {name:'my_runs',description:'How your own schedules ran (last run, status, error, delivery problems) and your run_self runs.',inputSchema:{type:'object',properties:{limit:{type:'number'}}},annotations:{readOnlyHint:true}},
 {name:'my_health',description:'What aqeelOS sees wrong with you: problems on System › Health, failed messages, schedules that failed, your open issues with the fixer, automatic rollbacks.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
 {name:'my_deliveries',description:'Status of your own sends on your Kirimdev line (sent, delivered, read, failed, still pending after 10 minutes). Use it to find messages that did not arrive and follow up.',inputSchema:{type:'object',properties:{limit:{type:'number'}}},annotations:{readOnlyHint:true}},
 {name:'my_schedules',description:'Your own schedule list: list, create, edit (name, prompt, schedule, deliver, and how it starts), pause, resume, run_now or remove. Every change is a version you can undo. Use this to fix duplicate or broken schedules of your own; prefer pause over remove.'+TOOL_HELP,inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','create','edit','pause','resume','run_now','remove']},id:{type:'string'},name:{type:'string'},prompt:{type:'string',description:'what the AI does each run; leave out for a script-only schedule'},schedule:{type:'string',description:'cron like "0 9 * * 1-5" or "every 2h"'},deliver:{type:'string'},...TOOL_PROPS,why:{type:'string',description:'create: one sentence on what starts this work and why you chose that; shown on the schedule'}},required:['action']}},
 {name:'reconnect_my_connector',description:'Sign in again to one of your own apps (an MCP tool such as notion or slack) or restart one of your own channels (whatsapp, telegram…). For an app you get the steps to send the person.',inputSchema:{type:'object',properties:{name:{type:'string',description:'the app name from your list, or a channel: whatsapp, telegram, slack'}},required:['name']}},
 {name:'create_my_webhook',description:'Make a webhook address of your own, for example a payment provider\'s "paid" callback: each call runs your prompt with the payload. For a provider that signs its calls its own way (Tripay X-Callback-Signature, Xendit x-callback-token…), give verify_header, verify_scheme and the name of the key you saved; calls without a valid signature are refused.',inputSchema:{type:'object',properties:{name:{type:'string'},prompt:{type:'string',description:'what to do with each call; {field.sub} inserts a payload field, {__raw__} the whole payload'},description:{type:'string'},deliver:{type:'string',description:'where your answer goes: log (default), telegram…'},deliver_chat_id:{type:'string'},verify_header:{type:'string'},verify_scheme:{type:'string',enum:['hmac-sha256-hex','hmac-sha512-hex','token']},verify_key_name:{type:'string'},why:{type:'string'}},required:['name','prompt']}},
 {name:'test_send',description:'Send a test message to your own test chat only: your Kirimdev line\'s tester (channel whatsapp), or your own topic in your team group. Never to customers.',inputSchema:{type:'object',properties:{text:{type:'string'},channel:{type:'string',enum:['whatsapp','telegram']}},required:['text']}}];
