// "Run myself" (5 Nov 2026): an agent starts a fresh run of itself in the background (run_self), to test or re-run its
// own work. aqeelOS starts it as `aqeelos -p <agent> chat --query-file <prompt> -Q --source run_self`: the agent's own
// profile, so its commands, files and code run as its own Linux user (ag-<agent>) inside its own workspace, with its
// own .env and secrets, exactly like its other chats. The agent never names a profile: aqeelOS takes it from the
// signed address of the tool server (aqeelos-self), and the main agent, its extra-number copies and the help agent
// never get it.
// Who may start one is decided from the chat the call came from, never from the agent's words: the engine saves each
// tool call before running it, so aqeelOS reads the waiting call in the agent's own chat database and judges that chat
// (judge below): the aqeelOS chat of someone who may edit the agent, the agent's own schedules, or a person on the
// Trusted people list (added in aqeelOS: they send a one-time code to any agent). WhatsApp and Telegram strangers,
// webhooks (Kirimdev), runs started from another agent's terminal and run_self runs themselves are refused.
// Limits: 2 at once per agent, 25 minutes each, a daily cap (40 by default, set per agent). The cap, or 3 failed runs
// in a row, pause the agent's self-runs and the owner is told on Telegram. Every run and every refusal is in the audit
// (Automations › Runs itself), and the owner gets a daily summary. Everything here is a setting on that page.
import {readFile,writeFile,rename,mkdir,rm,realpath,lstat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

export const MAX_MIN=25,DEFAULT_MIN=10,DEFAULT_CAP=40,MAX_AT_ONCE=2,FAILS_TO_PAUSE=3,LOCK_WAIT=600,CODE_LIFE=15*60e3;
// a pause for failures lasts this long, then ONE run is let through to see if the cause is gone (10 Nov 2026: three runs that
// failed within a minute because the AI models did not answer paused Continue Threads for good, so it could not repair itself)
export const PAUSE_COOL_MS=60*60e3;
export const AGENT=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// channels where people talk to an agent; whatsapp is judged like the rest (only trusted people), webhooks never
const MESSAGING=new Set(['telegram','whatsapp','slack','discord','signal','matrix','mattermost','email','sms','line']);
const CUSTOMER=new Set(['webhook']);
export const PRETTY={telegram:'Telegram',whatsapp:'WhatsApp',slack:'Slack',discord:'Discord',signal:'Signal',matrix:'Matrix',mattermost:'Mattermost',email:'Email',sms:'SMS',line:'LINE',api_server:'aqeelOS chat',cron:'schedule',webhook:'webhook'};
// a person's id on a channel, the same whatever form the engine wrote it in (WhatsApp: phone, jid or LID, the + off)
export const normId=(platform,v)=>{const s=String(v??'').trim();return platform==='whatsapp'?s.replace('+','').split(':')[0].split('@')[0]:s};
// one call's arguments as a fixed string (keys sorted, plain values as text: a number sent as "3" still matches)
export const fp=a=>{if(!a||typeof a!=='object')return '';return Object.keys(a).sort().filter(k=>a[k]!==undefined&&a[k]!==null&&a[k]!=='').map(k=>k+'='+(typeof a[k]==='object'?JSON.stringify(a[k]):String(a[k]))).join('\u0001')};
const clip=(s,n)=>String(s??'').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,' ').slice(0,n);

/* Who started the chat a call came from. chain: the calling chat first, then the chats that started it (a helper the
   agent started itself is judged by the chat that started it). o: {settings, trusted, sessionUser(id) -> {name, ok}|null}.
   Returns {ok, by:{kind, platform, who, uid, chat, thread, session}, why} */
export function judge(chain,o){const set=o.settings||{};
 if(!Array.isArray(chain)||!chain.length)return {ok:false,why:'aqeelOS could not find the chat this call came from, so it is refused.'};
 // a run_self run is a "tool" chat (the engine's label for a chat a program started, not a person)
 if(chain.some(s=>s.source==='run_self'||s.source==='tool'))return {ok:false,why:'A run started with run_self cannot start another one.'};
 const root=chain[chain.length-1],pf=String(root.platform||root.source||'');
 const by={kind:root.source,platform:pf,session:chain[0].id,root:root.id,chat:root.chat_id||null,thread:root.thread_id||null,uid:root.user_id||null,who:root.user_name||root.display_name||null};
 if(root.source==='cron'){if(set.cron===false)return {ok:false,by,why:'Runs from your schedules are switched off for this agent in aqeelOS (Automations › Runs itself).'};return {ok:true,by:{...by,who:'schedule'+(root.title?': '+clip(root.title,60):'')}}}
 if(root.source==='api_server'){if(set.chat===false)return {ok:false,by,why:'Runs from the aqeelOS chat are switched off for this agent in aqeelOS (Automations › Runs itself).'};
  const u=o.sessionUser?.(root.id);if(!u)return {ok:false,by,why:'This aqeelOS chat has no known owner, so it is refused.'};if(!u.ok)return {ok:false,by,why:(u.name||'This person')+' may not edit this agent, so they cannot make it run itself.'};return {ok:true,by:{...by,who:u.name}}}
 if(CUSTOMER.has(root.source)||CUSTOMER.has(pf))return {ok:false,by,why:'This chat came in through a webhook (customers, bridges such as Kirimdev), so it is refused.'};
 if(MESSAGING.has(root.source)||MESSAGING.has(pf)){const p=MESSAGING.has(root.source)?root.source:pf,id=normId(p,root.user_id);
  const t=(o.trusted||[]).find(x=>x.platform===p&&x.uid===id);if(!id||!t)return {ok:false,by,why:'Only trusted people may make an agent run itself, and the person in this '+(PRETTY[p]||p)+' chat is not on the list. An admin adds them in aqeelOS (Automations › Runs itself › Trusted people).'};
  return {ok:true,by:{...by,platform:p,who:t.name||by.who}}}
 return {ok:false,by,why:'Runs can only be started from the aqeelOS chat, your own schedules, or a trusted person\'s chat (this one came from "'+clip(root.source||'unknown',30)+'").'}}

// the lock: a path in the agent's own workspace, never through a shortcut out of it; returns the full path
export async function safeLock(ws,p){p=String(p||'').trim();if(!p)return null;if(p.length>300||/[\u0000-\u001f]/.test(p))throw Error('Give the lock as a path in your workspace, like .tools/browser.lock.');
 const root=await realpath(ws),full=path.resolve(root,p.startsWith('~/')?p.slice(2):p),rel=path.relative(root,full);
 if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('The lock must be a file inside your own workspace ('+root+').');
 const dir=await realpath(path.dirname(full)).catch(()=>null);if(!dir)throw Error('The lock\'s folder does not exist: '+path.dirname(rel)+'.');
 if(dir!==root&&!dir.startsWith(root+path.sep))throw Error('The lock must be a file inside your own workspace.');
 const st=await lstat(full).catch(()=>null);if(st&&!st.isFile())throw Error('The lock must be a plain file (not a folder or a shortcut).');
 return path.join(dir,path.basename(full))}

export function createSelfRuns({DATA,now=()=>Date.now(),day=t=>new Date(t).toISOString().slice(0,10),hour=t=>new Date(t).getUTCHours(),nameOf=a=>a,
 launch=async()=>{throw Error('no runner')},alive=async()=>false,kill=async()=>{},readExit=async()=>null,readOut=async()=>'',
 notify=async()=>{},tellOwner=async()=>{},bell=async()=>{},random=n=>randomBytes(n)}){
 const FILE=path.join(DATA,'self-runs.json'),DIR=path.join(DATA,'self-runs');let db=null,loading=null,chain=Promise.resolve();
 const load=()=>db?Promise.resolve(db):loading||=(async()=>{let d={};try{d=JSON.parse(await readFile(FILE,'utf8'))}catch{}
  d.settings||={};d.trusted||=[];d.codes||=[];d.runs||={};d.paused||={};d.fails||={};d.audit||=[];d.summary||={};db=d;return d})();
 const write=async()=>{await mkdir(DATA,{recursive:true});const tmp=FILE+'.'+process.pid+'.'+random(4).toString('hex')+'.tmp';await writeFile(tmp,JSON.stringify(db,null,1),{mode:0o600});await rename(tmp,FILE)};
 const queue=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p};
 const audit=(e)=>{db.audit.unshift({at:now(),...e});db.audit.length=Math.min(db.audit.length,500)};
 const settingsOf=a=>({on:true,cap:DEFAULT_CAP,cron:true,chat:true,...(db.settings[a]||{})});
 const today=()=>day(now());
 const startedToday=a=>Object.values(db.runs).filter(r=>r.agent===a&&day(r.at)===today()).length;
 const active=a=>Object.values(db.runs).filter(r=>r.agent===a&&(r.state==='waiting'||r.state==='running'));
 // a cap pause ends by itself the next day; a pause for failures ends after PAUSE_COOL_MS and lets one run through: the failure
 // count stays one short of the limit, so that run failing again pauses it at once for another hour, and one that works clears it
 const pausedOf=a=>{const p=db.paused[a];if(!p)return null;if(p.why==='cap'&&p.day!==today()){delete db.paused[a];return null}
  if(p.why==='failures'&&now()-p.at>=PAUSE_COOL_MS){delete db.paused[a];db.fails[a]=Math.min(db.fails[a]||0,FAILS_TO_PAUSE-1);audit({event:'resumed',agent:a,by:{who:'aqeelOS (cool-down)'}});write().catch(()=>{});return null}return p};
 const view=r=>({id:r.id,agent:r.agent,agentName:nameOf(r.agent),by:r.by,at:r.at,started:r.started||null,done:r.done||null,state:r.state,reason:r.reason,prompt:r.prompt,minutes:r.minutes,lock:r.lockRel||null,exit:r.exit??null,secs:r.done&&(r.started||r.at)?Math.round((r.done-(r.started||r.at))/1000):null,stoppedBy:r.stoppedBy||null});

 // the agent's request: o = {agent, args, origin (from judge)}
 const start=({agent,args={},origin,ws,lockPath})=>queue(async()=>{await load();
  const s=settingsOf(agent),refuse=why=>{audit({event:'refused',agent,by:origin?.by||null,reason:clip(args.reason,200),prompt:clip(args.prompt,200),why});return write().catch(()=>{}).then(()=>{throw Error(why)})};
  if(!origin?.ok)return refuse(origin?.why||'Refused.');
  if(!s.on)return refuse('Running itself is switched off for this agent in aqeelOS (Automations › Runs itself).');
  const pz=pausedOf(agent);if(pz)return refuse(pz.why==='cap'?'You reached today\'s limit of '+s.cap+' runs. Self-runs start again tomorrow, or when an admin raises the limit in aqeelOS.':'Self-runs are paused after '+FAILS_TO_PAUSE+' failed runs in a row. They try again by themselves after an hour, or an admin resumes them in aqeelOS (Automations › Runs itself).');
  const prompt=String(args.prompt??'').trim(),reason=String(args.reason??'').trim();
  if(!prompt)return refuse('Give the prompt for the run.');if(prompt.length>20000)return refuse('The prompt is too long (20,000 characters at most). Put the details in a file in your workspace and point to it.');
  if(!reason)return refuse('Say in a few words why you run yourself (reason).');
  let min=args.timeout_minutes==null||args.timeout_minutes===''?DEFAULT_MIN:Math.round(Number(args.timeout_minutes));if(!Number.isFinite(min)||min<1)min=DEFAULT_MIN;min=Math.min(MAX_MIN,min);
  if(active(agent).length>=MAX_AT_ONCE)return refuse('You already have '+MAX_AT_ONCE+' runs going. Wait for one to finish (run_self_list shows them).');
  if(startedToday(agent)>=s.cap){db.paused[agent]={why:'cap',day:today(),at:now()};audit({event:'paused',agent,why:'cap'});
   tellOwner(nameOf(agent)+' reached its limit of '+s.cap+' self-runs today, so they are paused until tomorrow. Raise the limit in aqeelOS (Automations › Runs itself) if it needs more.').catch(()=>{});
   return refuse('You reached today\'s limit of '+s.cap+' runs. Self-runs start again tomorrow, or when an admin raises the limit in aqeelOS.')}
  const id=random(6).toString('base64url').replace(/[-_]/g,'x'),t=now();
  const rec={id,agent,by:origin.by,at:t,state:lockPath?'waiting':'running',reason:clip(reason,200),prompt:clip(prompt,200),minutes:min,lockRel:lockPath?clip(args.lock,200):null};
  db.runs[id]=rec;audit({event:'started',run:id,agent,by:origin.by,reason:rec.reason,prompt:rec.prompt,minutes:min});
  try{const dir=path.join(DIR,id);await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,'prompt.txt'),prompt,{mode:0o600});
   const r=await launch({id,agent,dir,minutes:min,lockPath,ws});rec.pid=r.pid;if(!lockPath)rec.started=t}
  catch(e){rec.state='failed';rec.done=now();rec.exit=-1;rec.error=clip(e.message,200);audit({event:'failed',run:id,agent,why:'could not start: '+rec.error});await write().catch(()=>{});throw Error('The run could not be started: '+rec.error)}
  await write();
  // the run that reaches the cap is the last one today: the owner hears it now
  if(startedToday(agent)>=s.cap){db.paused[agent]={why:'cap',day:today(),at:now()};audit({event:'paused',agent,why:'cap'});await write().catch(()=>{});
   tellOwner(nameOf(agent)+' reached its limit of '+s.cap+' self-runs today, so they are paused until tomorrow. Raise the limit in aqeelOS (Automations › Runs itself) if it needs more.').catch(()=>{})}
  return view(rec)});

 // every few seconds: started, finished, over time, or gone (aqeelOS restarted meanwhile: a run still going is kept)
 const check=()=>queue(async()=>{await load();let changed=false;const t=now();
  for(const r of Object.values(db.runs)){if(r.state!=='waiting'&&r.state!=='running')continue;
   const ex=await readExit(r).catch(()=>null);
   if(ex&&ex.started&&r.state==='waiting'){r.state='running';r.started=ex.started;changed=true}
   if(ex&&ex.code!=null){await finish(r,ex.code);changed=true;continue}
   const up=r.pid&&await alive(r).catch(()=>false);
   // killed by Stop or for running over its time: the wrapper had no chance to write its exit code
   if(!up&&(r.stoppedBy||r.overtime)){await finish(r,r.overtime?124:143);changed=true;continue}
   if(!up){r.state='interrupted';r.done=t;r.exit=null;audit({event:'interrupted',run:r.id,agent:r.agent});notify(view(r),'').catch(()=>{});changed=true;continue}
   const limit=r.state==='waiting'?r.at+(LOCK_WAIT+90)*1000:(r.started||r.at)+(r.minutes*60+90)*1000;
   if(t>limit&&!r.killing){r.killing=t;r.overtime=true;await kill(r).catch(()=>{});changed=true}}
  // finished runs' files go after 7 days, their records after 30 (the audit keeps the last 500 events)
  for(const [id,r] of Object.entries(db.runs))if(r.done&&t-r.done>7*864e5&&!r.filesGone){await rm(path.join(DIR,id),{recursive:true,force:true}).catch(()=>{});r.filesGone=true;changed=true;if(t-r.done>30*864e5)delete db.runs[id]}
  for(const c of db.codes)if(!c.done&&t>c.exp){c.done='expired';changed=true}
  const before=db.codes.length;db.codes=db.codes.filter(c=>!c.done||t-c.exp<864e5);if(db.codes.length!==before)changed=true;
  if(changed)await write().catch(()=>{})});
 async function finish(r,code){const t=now();r.exit=code;r.done=t;
  r.state=r.stoppedBy?'stopped':code===0?'ok':code===124||code===137||r.overtime?'timeout':code===75&&!r.started?'failed':'failed';
  if(code===75&&!r.started)r.error='The lock stayed taken for '+LOCK_WAIT/60+' minutes.';
  const tail=await readOut(r).catch(()=>'');r.answer=clip(tail,4000);r.session=(/session_id:\s*(\S+)/.exec(tail)||[])[1]||null;
  audit({event:r.state,run:r.id,agent:r.agent,exit:code,secs:Math.round((t-(r.started||r.at))/1000)});
  if(r.state==='ok')db.fails[r.agent]=0;
  else if(r.state==='failed'||r.state==='timeout'){db.fails[r.agent]=(db.fails[r.agent]||0)+1;
   if(db.fails[r.agent]>=FAILS_TO_PAUSE&&!db.paused[r.agent]){db.paused[r.agent]={why:'failures',at:t};audit({event:'paused',agent:r.agent,why:'failures'});
    tellOwner(nameOf(r.agent)+'\'s self-runs are paused: its last '+FAILS_TO_PAUSE+' runs failed. Look at them and resume in aqeelOS (Automations › Runs itself).').catch(()=>{})}}
  notify(view(r),r.answer).catch(()=>{})}

 async function status(agent,id){await load();const r=db.runs[String(id||'')];if(!r||r.agent!==agent)return null;return {...view(r),answer:r.answer||'',error:r.error||null}}
 async function wait(agent,id,ms=240e3){const end=now()+ms;let r=await status(agent,id);while(r&&(r.state==='waiting'||r.state==='running')&&now()<end){await new Promise(z=>setTimeout(z,3000));await check();r=await status(agent,id)}return r}
 async function mine(agent){await load();const s=settingsOf(agent);return {runs:Object.values(db.runs).filter(r=>r.agent===agent).sort((a,b)=>b.at-a.at).slice(0,20).map(view),today:startedToday(agent),cap:s.cap,on:s.on,paused:pausedOf(agent),atOnce:MAX_AT_ONCE}}

 /* the page */
 async function overview(agents){await load();return {agents:agents.map(a=>({agent:a,agentName:nameOf(a),...settingsOf(a),today:startedToday(a),paused:pausedOf(a),fails:db.fails[a]||0,running:active(a).map(view)})),
  trusted:db.trusted,codes:db.codes.filter(c=>!c.done).map(c=>({code:c.code,name:c.name,exp:c.exp})),recent:Object.values(db.runs).sort((a,b)=>b.at-a.at).slice(0,40).map(view),
  refused:db.audit.filter(e=>e.event==='refused').slice(0,15).map(e=>({...e,agentName:nameOf(e.agent)}))}}
 async function detail(id){await load();const r=db.runs[String(id||'')];if(!r)return null;return {...view(r),answer:r.answer||'',error:r.error||null}}
 const setSettings=(agent,b,by)=>queue(async()=>{await load();const cur=settingsOf(agent),next={...cur};
  if(typeof b.on==='boolean')next.on=b.on;if(typeof b.cron==='boolean')next.cron=b.cron;if(typeof b.chat==='boolean')next.chat=b.chat;
  if(b.cap!==undefined){const c=Math.round(Number(b.cap));if(!Number.isFinite(c)||c<1||c>500)throw Error('The daily limit is a number from 1 to 500.');next.cap=c}
  db.settings[agent]={on:next.on,cap:next.cap,cron:next.cron,chat:next.chat};
  if(next.cap>cur.cap&&db.paused[agent]?.why==='cap')delete db.paused[agent];
  audit({event:'settings',agent,by:{who:by},what:Object.keys(b).filter(k=>['on','cap','cron','chat'].includes(k)).map(k=>k+'='+next[k]).join(', ')});await write();return settingsOf(agent)});
 const resume=(agent,by)=>queue(async()=>{await load();delete db.paused[agent];db.fails[agent]=0;audit({event:'resumed',agent,by:{who:by}});await write();return true});
 const stop=(id,by)=>queue(async()=>{await load();const r=db.runs[String(id||'')];if(!r||(r.state!=='waiting'&&r.state!=='running'))return false;r.stoppedBy=by;audit({event:'stop',run:r.id,agent:r.agent,by:{who:by}});await write();await kill(r).catch(()=>{});return true});
 // trusted people: a one-time code the person sends to any agent from their own chat (found by findCode in server.mjs)
 const ALPHA='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
 const newCode=({name,by})=>queue(async()=>{await load();const b=random(8);let c='';for(let i=0;i<8;i++)c+=ALPHA[b[i]%ALPHA.length];
  const code='TRUST-'+c.slice(0,4)+'-'+c.slice(4),rec={code,name:clip(String(name||'').trim(),60),by,at:now(),exp:now()+CODE_LIFE};db.codes.push(rec);await write();return rec});
 const pendingCodes=async()=>{await load();const t=now();return db.codes.filter(c=>!c.done&&t<c.exp)};
 // a code arrived: {code, platform, uid, name, agent}
 const codeSeen=hit=>queue(async()=>{await load();const c=db.codes.find(x=>x.code===hit.code&&!x.done&&now()<x.exp);if(!c)return null;
  const platform=String(hit.platform||''),uid=normId(platform,hit.uid);
  // typed into the aqeelOS chat or a schedule: not a channel identity, the code stays open; sent through a webhook: used up
  if(!MESSAGING.has(platform)&&!CUSTOMER.has(platform))return null;if(!MESSAGING.has(platform)||!uid){c.done='refused';await write();return null}
  c.done='used';let t=db.trusted.find(x=>x.platform===platform&&x.uid===uid);
  if(!t){t={id:random(5).toString('hex'),platform,uid,name:c.name||clip(hit.name,60)||uid,at:now(),by:c.by,via:hit.agent};db.trusted.push(t)}
  audit({event:'trusted',by:{who:c.by},who:t.name,platform,agent:hit.agent});await write();
  bell(t.name+' is now a trusted person on '+(PRETTY[platform]||platform),'They sent the code to '+nameOf(hit.agent)+'. Agents may now run themselves when they ask.').catch(()=>{});return t});
 const untrust=(id,by)=>queue(async()=>{await load();const t=db.trusted.find(x=>x.id===id);if(!t)return false;db.trusted=db.trusted.filter(x=>x.id!==id);audit({event:'untrusted',by:{who:by},who:t.name,platform:t.platform});await write();return true});
 const cancelCode=code=>queue(async()=>{await load();const c=db.codes.find(x=>x.code===code&&!x.done);if(c){c.done='cancelled';await write()}return !!c});
 async function settings(a){await load();return settingsOf(a)}
 async function trusted(){await load();return db.trusted}
 async function hasTrusted(platform){await load();return db.trusted.some(t=>t.platform===platform)}

 // the daily summary (from `hourAt` local time, once a day): yesterday's runs per agent, what needs action first
 const summary=(hourAt=8)=>queue(async()=>{await load();const t=now();if(hour(t)<hourAt||db.summary.last===day(t))return null;
  db.summary.last=day(t);const y=day(t-864e5),runs=Object.values(db.runs).filter(r=>day(r.at)===y);await write().catch(()=>{});
  const agents=[...new Set([...runs.map(r=>r.agent),...Object.keys(db.paused)])];if(!agents.length)return null;
  const need=[],lines=[];
  for(const a of agents){const rs=runs.filter(r=>r.agent===a),ok=rs.filter(r=>r.state==='ok').length,bad=rs.filter(r=>r.state==='failed'||r.state==='timeout').length,p=db.paused[a]?.why==='failures'?db.paused[a]:pausedOf(a);   // a pause for failures counts until a run has gone through again
   if(p)need.push(nameOf(a)+': paused ('+(p.why==='cap'?'daily limit reached':FAILS_TO_PAUSE+' failed runs in a row')+')');
   else if(bad)need.push(nameOf(a)+': '+bad+' failed run'+(bad>1?'s':''));
   if(rs.length)lines.push(nameOf(a)+': '+rs.length+' run'+(rs.length>1?'s':'')+', '+ok+' ok'+(bad?', '+bad+' failed':''))}
  const text='Self-runs yesterday'+(need.length?'\nNeeds a look:\n'+need.map(x=>'- '+x).join('\n'):'')+(lines.length?'\n'+lines.join('\n'):'')+'\nDetails: aqeelOS › Automations › Runs itself';
  await tellOwner(text,{quiet:!need.length}).catch(()=>{});return text});

 return {start,check,status,wait,mine,overview,detail,setSettings,resume,stop,newCode,pendingCodes,codeSeen,untrust,cancelCode,settings,trusted,hasTrusted,summary,
  active:async a=>{await load();return active(a).length},_db:async()=>{await load();return db}}}
