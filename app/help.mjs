// Help (24 Oct 2026): a chat at the bottom of the menu that explains how aqeelOS works and finds out what went wrong.
// It belongs to the person, not to an agent: one conversation each (New conversation starts another), the same
// whichever agent they look at, private to them (admins can't open it: the proxy refuses Help's profile to everyone,
// only these routes reach it, and only for the chat's owner). It never changes anything:
//  - its engine profile (HELP_AGENT) has every tool group off and no connected apps or skills; each message checks
//    that first and refuses to run when it isn't so (the live app locks it again by itself);
//  - what it knows comes in a short context block per message, built here from what that person may see (their role,
//    the page, their recent errors in this tab, their agents, channels, sign-ins, accounts, the engine's state, the
//    few feature-list entries that match the question), never anyone else's data;
//  - a ticket is the one thing it may cause: a marker at the end of its reply ([[ticket]]{...}[[/ticket]]) that this
//    server reads, rate-limits (TICKETS_PER_DAY) and dedupes. Admins get it in Bottlenecks; resolving it puts a notice
//    in the person's Help chat.
// One model for everyone (System › Settings › Help, admins), its own daily message limit; members' model lists and
// chat limits don't apply. Its usage shows as its own "Help" line on System › Usage.
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {HELP_AGENT,LIVE_APP,isAgent,setKey,homeOf} from './agentops.mjs';
import {CAPS} from './users.mjs';

// decide-later (owner, 24 Oct): the name people see, who gets tickets ('admins' = the owner and every admin), the limits
// tool groups that can't act on anything: speech-to-text only turns a voice message into text, and the engine keeps it on
const HARMLESS=new Set(['stt']);
export const HELP_NAME='Help';
const TICKETS_TO='admins';
const LIMIT_DEFAULT=40,LIMITS=[20,40,80,150],TICKETS_PER_DAY=5;
const CTX_OPEN='<aqeelos-help-context>',CTX_CLOSE='</aqeelos-help-context>';
const TICKET_RE=/\[\[ticket\]\]([\s\S]*?)\[\[\/ticket\]\]/i;

// What System › Guide used to say (moved here when Help replaced it), and the map of the menu
const GUIDE=`How aqeelOS works:
- Chatting: pick an agent at the bottom left and write. It keeps working on the AI box when the tab closes. Ask me, Smart and Allow all (above the message box) decide which commands wait for the person's OK. / opens chat commands; Esc stops a reply.
- Agents: Agents › Agents lists everyone the person may use. Each agent has its own name, personality, model, skills, memory and chats. Edit one from its ⋯ menu; Sharing decides which people may chat with it or change it.
- Connected apps and owners: every connection (Slack, Notion, n8n, a Google account, a plugin, a key) has one owner, the agent where it was signed in. Who can use gives other agents the same connection without signing in again; Owned by moves it. A notice says when a sign-in runs out, with what to do.
- Channels: Channels › Connections links WhatsApp, Telegram and Slack; each has an owner agent that answers it. Who can message lists the people waiting for an OK and the people already allowed.
- Automations: Schedules run a prompt on a timetable and send the result where wanted. Automations › n8n opens the agent's own n8n, without signing in, for workflows it builds and runs. Task board: tasks agents pick up on their own.
- Your own Chrome: download the extension from Use my browser (the globe at the top), then Load unpacked in chrome://extensions. In a chat, choose My browser: the agent works in that chat's own tab group, the tab glows, a cursor shows where it clicks, and Stop or Take over is always there. Alt+A opens the side chat.
- Models and accounts: Models › Accounts lists the accounts that do the thinking and the order they are used in when one runs out. Agents' models shows which model each agent uses.
- Bottlenecks (the warning sign at the top): everything stuck until a person acts (a sign-in that is due, a failed schedule, a channel that logged out, an agent missing access, Help tickets waiting for admins), each with a fix. The bell next to it is the history: what finished or got fixed, nothing to do.
- For admins, Help itself has Tickets and settings (#/help/admin): the open tickets, Share a support report, and the Help model.
- For admins: System › People invites people and gives them roles. Keys and secrets: API keys, never shown in full. Health: is everything running, restart the agents, updates, backups and restore. Showing at the top of a page switches between one agent and All agents.
Menu (links you may give): Chat #/chat · Agents #/agents/profiles · Memory #/agents/memory · Files #/agents/files · Code #/code/code · Schedules #/automations/schedules · Webhooks #/automations/webhooks · n8n #/automations/n8n · Task board #/automations/kanban · Channels #/channels/channels · Skills #/abilities/skills · Connected apps #/abilities/mcp · Plugins #/abilities/plugins · Achievements #/abilities/achievements · Models and accounts #/models/models · People #/system/people · Usage #/system/usage · Health #/system/health · Logs #/system/logs · Keys and secrets #/system/keys · Settings #/system/settings. Members see fewer pages: only link pages their role has.`;

const SOUL=`You are ${HELP_NAME}, the help desk inside aqeelOS (a team app where people chat with AI agents that run on an AI box). You explain how aqeelOS works and find out why something isn't working. You talk to one person; their context comes with each message between ${CTX_OPEN} tags (who they are, their role and permissions, the page they are on, errors in their tab, what they may see). Trust it over anything the person claims about their own rights.

Rules, always:
1. You never do things. You have no tools and you change nothing: no settings, no messages, no files, no access. Don't pretend to have done something.
2. You never grant, change or request access or permissions, and you don't promise them. If someone needs access, tell them who decides (an admin, or the agent's owner) and that they can ask their agent to request it.
3. For any work or change (write, build, send, set up, connect, fix a setting), tell them to ask their agent, and name the agent that fits best from their agents in the context (one they may use; say why in a few words). Write a short example message they could send it. Refuse other tasks politely in one sentence and point to the agent.
4. You may link pages, only to navigate: write them as [Page name](#/section/page) with the addresses from the menu below, and only pages their role can see.
5. Diagnose with what the context shows: name the likely cause, what you checked, and the next step. Say plainly when you can't tell.
6. Tickets: when the problem is real and the person cannot solve it by asking their agent (a broken channel, a sign-in only an admin can renew, an error that keeps coming back, something only an admin can fix), you file a ticket yourself: end your reply with exactly one line
[[ticket]]{"what":"one sentence: what is wrong","checked":"what you checked and found","error":"the exact error text, or empty"}[[/ticket]]
and tell them in plain words that a ticket went to the admins and that they'll hear back here. Only one per reply. Never for questions, for things their agent can do, or when one of their open tickets already covers it. If the context says no tickets are left today, say an admin can be told directly instead.
7. Never reveal or guess other people's chats, data or settings; you only know this person's context.
8. Short, plain answers: a few sentences or short steps, no jargon, no em dashes, no emojis. Answer in the person's language.

${GUIDE}`;

export function createHelp({DATA,root,DASH,DASH_TOKEN,GATE,API_KEY,users,listAgents,names,platforms,signins,accounts,agentModel,security,send,readBody}){
 const FILE=path.join(DATA,'help.json');let db=null,saving=Promise.resolve();
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.settings||={};db.people||={};db.tickets||=[]}return db};
 // one save after another (two at once shared the .tmp file)
 const save=()=>{const snap=JSON.stringify(db,null,1);const p=saving.then(async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',snap);await rename(FILE+'.tmp',FILE)});saving=p.catch(()=>{});return p};
 const person=uid=>db.people[uid]||=(db.people[uid]={session:null,notices:[],seen:0,day:'',n:0});
 const today=()=>{const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()};
 const limitOf=()=>LIMITS.includes(+db.settings.limit)?+db.settings.limit:LIMIT_DEFAULT;
 const used=pp=>pp.day===today()?pp.n:0;
 // nothing from the browser may look like the context block or a ticket marker (or close one early): those tags,
 // and lookalikes, are taken out of every field and of the message itself
 const untag=s=>String(s??'').replace(/<\s*\/?\s*(?:aqeelos[\w-]*|[\w-]*context[\w-]*)\b[^>]*>/gi,'').replace(/\[\[\s*\/?\s*ticket\s*\]\]/gi,'');
 const clip=(s,n)=>untag(s).replace(/\s+/g,' ').trim().slice(0,n);
 const dash=(p,opt={})=>fetch(DASH+'/api'+p,{...opt,headers:{'x-hermes-session-token':DASH_TOKEN,...(opt.body?{'content-type':'application/json'}:{}),...(opt.headers||{})},signal:opt.signal||AbortSignal.timeout(20000)});
 const PRE='/p/'+encodeURIComponent(HELP_AGENT),GH={authorization:'Bearer '+API_KEY,'content-type':'application/json'};
 const gate=(p,opt={})=>fetch(GATE+PRE+p,{...opt,headers:{...GH,...(opt.headers||{})},signal:opt.signal||AbortSignal.timeout(30000)});
 const json=async r=>{const t=await r.text();try{return JSON.parse(t)}catch{return {raw:t}}};

 /* ---------- the engine profile: made on the live app, kept locked ---------- */
 // locked = the engine itself reports no tool group on and no connected app for it (checked a minute at most apart)
 let lockHit={t:0,v:null};
 async function locked(fresh){if(!fresh&&lockHit.v!==null&&Date.now()-lockHit.t<60000)return lockHit.v;let v=false;
  try{if(await isAgent(HELP_AGENT)){const [t,m]=await Promise.all([dash('/tools/toolsets?profile='+HELP_AGENT).then(json),dash('/mcp/servers?profile='+HELP_AGENT).then(json)]);
    const ts=Array.isArray(t)?t:t.toolsets;const ms=Array.isArray(m)?m:m.servers;v=Array.isArray(ts)&&Array.isArray(ms)&&!ts.some(x=>x.enabled&&!HARMLESS.has(x.name))&&!ms.length}}catch{v=false}
  lockHit={t:Date.now(),v};return v}
 let ensuring=null;
 // HELP_ENSURE=1 lets a test copy set it up too (against its own engine); the live app always does
 const mayEnsure=()=>LIVE_APP||process.env.HELP_ENSURE==='1';
 function ensure(){if(!mayEnsure())return Promise.resolve(false);return ensuring||=(async()=>{
  if(!await isAgent(HELP_AGENT)){const r=await dash('/profiles',{method:'POST',body:JSON.stringify({name:HELP_AGENT,description:HELP_NAME+' for aqeelOS (no tools)',clone_from_default:false,no_skills:true}),signal:AbortSignal.timeout(120000)});
   if(!r.ok)throw Error('the engine did not make Help’s profile ('+r.status+'): '+clip((await json(r)).detail||'',200));console.log('help: made its engine profile',HELP_AGENT)}
  // the gateway serves a profile only with the key aqeelOS uses for it (as every agent's .env has)
  const envF=path.join(homeOf(HELP_AGENT),'.env'),e=await readFile(envF,'utf8').catch(()=>'');
  if(API_KEY&&!/^API_SERVER_KEY=/m.test(e))await writeFile(envF,(e&&!e.endsWith('\n')?e+'\n':e)+'API_SERVER_KEY='+API_KEY+'\n',{mode:0o600});
  // every tool group off and no connected apps: what the engine lists for it, switched off by name
  if(!await locked(true)){const t=await dash('/tools/toolsets?profile='+HELP_AGENT).then(json).catch(()=>[]);const all=(Array.isArray(t)?t:t.toolsets||[]).map(x=>x.name).filter(Boolean);
   if(all.length){const r=await setKey(HELP_AGENT,'agent.disabled_toolsets',all);if(!r.ok)throw Error('could not switch its tools off: '+r.err)}
   const m=await dash('/mcp/servers?profile='+HELP_AGENT).then(json).catch(()=>({}));for(const s of (Array.isArray(m)?m:m.servers||[]))await dash('/mcp/servers/'+encodeURIComponent(s.name)+'?profile='+HELP_AGENT,{method:'DELETE'}).catch(()=>{});
   if(!await locked(true))throw Error('its tools are still on after switching them off');console.log('help: tools switched off')}
  // its standing instructions are aqeelOS's (written again whenever they differ, e.g. after an update of this file)
  const cur=await dash('/profiles/'+HELP_AGENT+'/soul').then(json).catch(()=>({}));
  if(cur.content!==SOUL){const r=await dash('/profiles/'+HELP_AGENT+'/soul',{method:'PUT',body:JSON.stringify({content:SOUL})});if(!r.ok)throw Error('could not write its instructions ('+r.status+')');console.log('help: instructions written')}
  await load();if(db.settings.model)await applyModel().catch(()=>{});return true})().catch(e=>{console.warn('help:',e.message);return false}).finally(()=>{ensuring=null})}
 // the picked model as the profile's own default too (each message also names it, so this is only for consistency)
 const applyModel=async()=>{if(!mayEnsure()||!db.settings.model)return;await setKey(HELP_AGENT,'model.default',db.settings.model);if(db.settings.provider)await setKey(HELP_AGENT,'model.provider',db.settings.provider)};

 /* ---------- what Help knows about this person, per message ---------- */
 // the feature list, read once; code-audit findings (AUDIT-…) are notes for whoever builds aqeelOS, not how it works
 let feats=null;
 async function features(){if(feats)return feats;
  try{const m=await import(path.join(root,'scripts','features.mjs'));const de=s=>String(s||'').replace(/Hermes Agent/g,'the engine').replace(/\bHermes\b/g,'the engine');
   feats=(m.FEATURES||[]).filter(f=>!/^AUDIT-/.test(f[0])).map(([id,title,,,status,notes])=>({id,title:de(title),status,notes:de(notes),words:new Set((de(title)+' '+de(notes)).toLowerCase().match(/[a-z0-9]{3,}/g)||[]),tw:new Set(de(title).toLowerCase().match(/[a-z0-9]{3,}/g)||[])}))}catch(e){console.warn('help: feature list',e.message);feats=[]}return feats}
 const STOP=new Set('the and for with that this what how why can not you your are was does did have has from when where which who into about they them their there then than just like get got its out our all any one but been will would could should please help aqeelos agent agents'.split(' '));
 // the entries that match the question and the page best (title words count three times)
 async function relevant(q){const w=[...new Set(String(q).toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(x=>!STOP.has(x));if(!w.length)return [];
  return (await features()).map(f=>({f,s:w.reduce((a,x)=>a+(f.tw.has(x)?3:f.words.has(x)?1:0),0)})).filter(x=>x.s>=2).sort((a,b)=>b.s-a.s).slice(0,6).map(x=>x.f)}
 const agentDesc=async a=>{const y=await readFile(path.join(homeOf(a),'profile.yaml'),'utf8').catch(()=>'');return clip((/^description:\s*["']?([^"'\n]+)/m.exec(y)||[])[1]||'',90)};
 let eng={t:0,v:''};
 const engine=async()=>{if(Date.now()-eng.t<15000)return eng.v;let v;try{const s=await dash('/status',{signal:AbortSignal.timeout(6000)}).then(json);v=s.gateway_heartbeat_stale_s!=null?'running but not checking in for '+Math.round(s.gateway_heartbeat_stale_s)+' s':(s.gateway_state||(s.gateway_running?'running':'stopped'))+(s.multiplex_standalone_reason?' (only one agent is answering)':'')}catch{v='not answering'}eng={t:Date.now(),v};return v};
 async function context(u,b,pp){const admin=users.isAdmin(u),L=[];
  L.push('Person: '+clip(u.name,60)+' · '+(u.role==='owner'?'owner of aqeelOS (may do everything)':admin?'admin (may do everything)':'member'));
  if(!admin){const c=Object.entries(CAPS).filter(([k])=>users.can(u,k)).map(([,v])=>v);L.push('May also: '+(c.length?c.join('; '):'only chat with agents shared with them and use their own files'))}
  L.push('Now: '+new Date().toString().slice(0,24));
  L.push('Page: '+clip(b.page,100)+(b.pageName?' ('+clip(b.pageName,60)+')':''));
  const all=await listAgents().catch(()=>[]),mine=all.filter(a=>users.level(u,a));
  const lv={owner:'owns it',edit:'can change it',chat:'can chat'};
  if(b.agent&&mine.includes(b.agent))L.push('Looking at agent (a hint only): '+names(b.agent)+' ['+b.agent+']');
  L.push('Their agents: '+(mine.length?(await Promise.all(mine.slice(0,16).map(async a=>{const d=await agentDesc(a);return names(a)+' ['+a+', '+lv[users.level(u,a)]+']'+(d?': '+d:'')}))).join('; '):'none shared with them yet'));
  L.push('Engine: '+await engine());
  // channels and sign-ins of the agents they may change (admins: every agent but private ones)
  const edits=mine.filter(a=>users.atLeast(u,a,'edit')).slice(0,8),ch=[];
  for(const a of edits){const d=await Promise.race([platforms(a).catch(()=>null),new Promise(r=>setTimeout(()=>r(null),4000))]);for(const c of d?.platforms||[])if(c.configured)ch.push(names(a)+' '+clip(c.name||c.id,20)+': '+(c.enabled===false?'off':clip(c.state||'unknown',20))+(c.error_message?' ('+clip(c.error_message,120)+')':''))}
  if(ch.length)L.push('Channels: '+ch.join('; '));
  const si=(signins()||[]).filter(s=>edits.includes(s.agent)).map(s=>clip(s.label||s.name,40)+' on '+names(s.agent)+': '+clip(s.why,40));
  if(si.length)L.push('Sign-ins that need renewing (admins renew them in Bottlenecks; whoever may change the agent can sign in again on Connected apps): '+si.join('; '));
  if(users.can(u,'usage')){try{const d=await Promise.race([accounts(u),new Promise(r=>setTimeout(()=>r(null),5000))]);const ac=(d?.accounts||[]).map(x=>clip(x.label,30)+': '+(x.signedIn?'signed in'+(x.usage?.session?', session '+x.usage.session.used+'% used':'')+(x.usage?.week?', week '+x.usage.week.used+'%':''):'signed out'));if(ac.length)L.push('Accounts: '+ac.join('; '))}catch{}}
  const errs=(Array.isArray(b.errors)?b.errors:[]).slice(-8).map(e=>'['+clip(e?.at,8)+' '+clip(e?.kind,10)+(e?.page?' on '+clip(e.page,40):'')+'] '+clip(e?.text,220)).filter(x=>x.length>6);
  L.push('Recent errors in their tab (reported by the browser, not checked here): '+(errs.length?errs.join(' | '):'none'));
  const open=db.tickets.filter(t=>t.uid===u.id&&t.status==='open');
  L.push('Their open tickets: '+(open.length?open.map(t=>'"'+clip(t.what,100)+'"').join('; '):'none')+' · tickets left today: '+Math.max(0,TICKETS_PER_DAY-ticketsToday(u.id)));
  const fs=await relevant(String(b.text||'')+' '+String(b.pageName||''));if(fs.length)L.push('Feature list entries that may matter:\n'+fs.map(f=>'- '+f.id+' '+f.title+' ['+f.status+']: '+clip(f.notes,260)).join('\n'));
  // the same context as last time is said in one line (keeps long conversations short)
  const text=L.join('\n'),h=createHash('sha1').update(text.replace(/^Now: .*$/m,'')).digest('hex').slice(0,12);
  if(pp.ctx===h&&pp.ctxSession===pp.session)return CTX_OPEN+'Same as the last message (now: '+new Date().toString().slice(0,24)+').'+CTX_CLOSE;
  pp.ctxNext={h,session:pp.session};return CTX_OPEN+'\n'+text+'\n'+CTX_CLOSE}   // remembered only once the engine took the message

 /* ---------- tickets ---------- */
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,160);
 const ticketsToday=uid=>{const d=new Date();d.setHours(0,0,0,0);return db.tickets.filter(t=>t.uid===uid&&t.at>=d.getTime()).length};
 async function file(u,raw,b){let x={};try{x=JSON.parse(String(raw).trim())}catch{return {error:'unreadable'}}
  const what=clip(x.what,300);if(!what)return {error:'unreadable'};const error=clip(x.error,400),browser=clip((Array.isArray(b.errors)?b.errors:[]).slice(-1)[0]?.text,400);
  const key=u.id+'|'+norm(what)+'|'+norm(error||browser);const same=db.tickets.find(t=>t.key===key&&t.status==='open');
  if(same){same.count=(same.count||1)+1;same.updated=Date.now();await save();return {ticket:pub(same),dup:true}}
  if(ticketsToday(u.id)>=TICKETS_PER_DAY)return {error:'limit'};
  const t={id:'t'+randomBytes(6).toString('hex'),key,uid:u.id,who:clip(u.name,60),role:u.role,what,checked:clip(x.checked,400),error,browser,said:clip(b.text,300),page:clip(b.page,100),pageName:clip(b.pageName,60),at:Date.now(),updated:Date.now(),status:'open',count:1};
  db.tickets.unshift(t);db.tickets=db.tickets.slice(0,500);await save();console.log('help: ticket from',u.name||u.id+':',what.slice(0,80));return {ticket:pub(t)}}
 const pub=t=>({id:t.id,what:t.what,status:t.status,at:t.at,resolvedAt:t.resolvedAt||null,count:t.count||1});
 // Help › Tickets for admins (TICKETS_TO, 1 Nov 2026; were in Bottlenecks): every open ticket, the ones put off with Not now last
 async function tickets(u){await load();if(TICKETS_TO==='admins'&&!users.isAdmin(u))return [];const now=Date.now();
  // "Reported via Help": the person's own words, what Help checked and the browser's error text, each said apart
  return db.tickets.filter(t=>t.status==='open').map(t=>({id:'ticket|'+t.id,kind:'ticket',title:'Reported via Help by '+t.who+': '+t.what,
   text:[t.said&&t.who+' wrote: “'+t.said+'”',t.checked&&'Help checked: '+t.checked,t.error&&'Error Help found: '+t.error,t.browser&&'Error reported by the browser: '+t.browser,'Page: '+(t.pageName||t.page||'unknown'),new Date(t.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})].filter(Boolean).join(' · '),
   who:t.who,what:t.what,said:t.said||'',checked:t.checked||'',error:t.error||t.browser||'',page:t.pageName||t.page||'',count:t.count,at:t.updated,later:(t.snooze||0)>now})).sort((a,b)=>a.later-b.later)}
 // Bottlenecks keeps one pointer while tickets wait (not put off): Open Help tickets
 async function items(u){const l=(await tickets(u)).filter(t=>!t.later);if(!l.length)return [];
  return [{id:'ticket|waiting',kind:'ticket',title:l.length===1?'A Help ticket is waiting: '+l[0].what:l.length+' Help tickets are waiting',text:l.length===1?'From '+l[0].who+'. Read it and resolve it on Help › Tickets.':'The newest from '+l[0].who+'. Read and resolve them on Help › Tickets.',at:l[0].at}]}
 async function decide(id,how,u){await load();if(!users.isAdmin(u))throw Object.assign(Error('Only admins.'),{status:403});const t=db.tickets.find(x=>'ticket|'+x.id===id);if(!t||t.status!=='open')throw Object.assign(Error('That one is already gone.'),{status:404});
  if(how==='later')t.snooze=Date.now()+24*3600e3;
  else{t.status='resolved';t.resolvedAt=Date.now();t.by=u.name||u.id;person(t.uid).notices.push({at:Date.now(),ticket:t.id,text:'An admin resolved your ticket: “'+t.what+'”. If it still isn’t working, tell me what you see now.'});const pp=person(t.uid);pp.notices=pp.notices.slice(-30)}
  await save();return {ok:true}}

 /* ---------- the conversation ---------- */
 const contentText=c=>typeof c==='string'?c:Array.isArray(c)?c.filter(x=>x&&x.type==='text').map(x=>x.text).join('\n'):'';
 const clean=(role,t)=>role==='user'?String(t).replace(new RegExp(CTX_OPEN+'[\\s\\S]*?'+CTX_CLOSE+'\\s*'),'').trim():String(t).replace(TICKET_RE,'').trim();
 async function history(sid){if(!sid)return [];const r=await dash('/sessions/'+encodeURIComponent(sid)+'/messages?limit=150&order=latest&profile='+HELP_AGENT).catch(()=>null);if(!r?.ok)return [];
  const d=await json(r);return (d.messages||[]).filter(m=>m.role==='user'||m.role==='assistant').map(m=>({role:m.role==='user'?'user':'ai',text:clean(m.role,contentText(m.content)),at:m.timestamp||0})).filter(m=>m.text)}
 async function newSession(u){const r=await gate('/api/sessions',{method:'POST',body:'{}'});const d=await json(r);const sid=String(d.session?.id||d.id||d.session_id||'');if(!r.ok||!sid)throw Error('The engine could not start a Help chat ('+r.status+').');await users.own(sid,u);return sid}
 const runs=new Map();   // person → the reply running now {runId, stop}
 async function model(){await load();if(db.settings.model)return {model:db.settings.model,provider:db.settings.provider||''};const d=await agentModel('default').catch(()=>({}));return {model:d.model||'',provider:d.provider||''}}
 async function options(){const r=await gate('/api/model/options').catch(()=>null);const d=r?.ok?await json(r):await fetch(GATE+'/api/model/options',{headers:GH,signal:AbortSignal.timeout(20000)}).then(json).catch(()=>({}));
  return (d.providers||[]).filter(p=>p.authenticated&&(p.models||[]).length&&!/nous/i.test((p.slug||'')+' '+(p.name||''))).map(p=>({slug:p.slug,name:p.name||p.slug,models:p.models}))}
 const notReady=()=>mayEnsure()?'Help is getting ready. Try again in a minute.':'Help runs on the live aqeelOS only.';

 async function handle(req,res,u,url){const p=url.pathname,M=req.method;await load();const pp=person(u.id);
  const body=async(n=65536)=>{try{return JSON.parse(await readBody(req,n))}catch{return {}}};
  if(p==='/ui/help/peek'&&M==='GET')return send(res,200,{unseen:pp.notices.filter(x=>x.at>(pp.seen||0)).length,open:db.tickets.filter(t=>t.uid===u.id&&t.status==='open').length});
  if(p==='/ui/help/state'&&M==='GET'){const ready=await isAgent(HELP_AGENT)&&await locked();if(!ready)ensure();
   // the chat must still be theirs (it always is: only these routes make Help chats)
   const sid=pp.session&&users.ownerOf(pp.session)===u.id?pp.session:null;const turns=ready?await history(sid):[];
   const out={name:HELP_NAME,ready,why:ready?'':notReady(),session:sid,turns,notices:pp.notices,seenBefore:pp.seen||0,tickets:db.tickets.filter(t=>t.uid===u.id).slice(0,20).map(pub),left:Math.max(0,limitOf()-used(pp)),limit:limitOf(),running:runs.has(u.id)};
   if(pp.notices.some(x=>x.at>(pp.seen||0))){pp.seen=Date.now();await save()}return send(res,200,out)}
  if(p==='/ui/help/new'&&M==='POST'){if(runs.has(u.id))return send(res,409,{error:'Wait for the answer to finish, or stop it first.'});pp.session=null;pp.ctx=null;await save();return send(res,200,{ok:true})}
  if(p==='/ui/help/stop'&&M==='POST'){const r=runs.get(u.id);if(!r)return send(res,200,{ok:true});r.stop=true;if(r.runId)await gate('/v1/runs/'+encodeURIComponent(r.runId)+'/stop',{method:'POST',body:'{}'}).catch(()=>{});return send(res,200,{ok:true})}
  if(p==='/ui/help/tickets'&&M==='GET'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});return send(res,200,{items:await tickets(u)})}
  if(p==='/ui/help/tickets/decide'&&M==='POST'){const b=await body(4096);try{return send(res,200,await decide(String(b.id||''),b.how==='later'?'later':'done',u))}catch(e){return send(res,e.status||400,{error:e.message})}}
  if(p==='/ui/help/settings'){if(!users.isAdmin(u))return send(res,403,{error:'Only admins.'});
   if(M==='GET'){let opts=[];try{opts=await options()}catch{}return send(res,200,{model:db.settings.model||'',provider:db.settings.provider||'',fallback:await model(),limit:limitOf(),limits:LIMITS,providers:opts})}
   if(M==='PUT'){const b=await body(4096);
    if(b.model!==undefined){const m=String(b.model||''),pv=String(b.provider||'');if(m){const ok=(await options()).some(x=>x.slug===pv&&x.models.includes(m));if(!ok)return send(res,400,{error:'Pick one of the models the engine offers.'})}db.settings.model=m;db.settings.provider=m?pv:'';applyModel().catch(e=>console.warn('help model',e.message))}
    if(b.limit!==undefined){if(!LIMITS.includes(+b.limit))return send(res,400,{error:'Pick one of the limits shown.'});db.settings.limit=+b.limit}
    await save();console.log('help: settings changed by',u.name||u.id);return send(res,200,{ok:true,model:db.settings.model||'',provider:db.settings.provider||'',limit:limitOf()})}}
  if(p==='/ui/help/send'&&M==='POST'){const b=await body();const text=untag(String(b.text||'')).trim().slice(0,8000);if(!text)return send(res,400,{error:'Write your question first.'});
   b.page=clip(b.page,100);b.agent=/^[\w-]{1,64}$/.test(String(b.agent||''))?String(b.agent):'';b.errors=(Array.isArray(b.errors)?b.errors:[]).slice(-8);b.text=text;
   if(runs.has(u.id))return send(res,409,{error:'Help is still answering. Wait a moment or press Stop.'});
   if(used(pp)>=limitOf())return send(res,429,{error:'You used today’s '+limitOf()+' Help messages. Help is back tomorrow; for anything urgent, ask your agent or an admin.',limit:true});
   // taken before any wait, so two messages sent at once can't both pass the one-at-a-time rule or the daily limit
   const run={runId:'',stop:false};runs.set(u.id,run);const was={day:pp.day,n:pp.n};pp.day===today()?pp.n++:(pp.day=today(),pp.n=1);let sent=false;
   try{if(!await isAgent(HELP_AGENT)||!await locked()){ensure();return send(res,503,{error:notReady()})}
    let sid=pp.session&&users.ownerOf(pp.session)===u.id?pp.session:null;
    const start=async()=>{if(!sid){sid=await newSession(u);pp.session=sid;pp.ctx=null}
     const ctx=await context(u,b,pp),m=await model(),msg={message:ctx+'\n\n'+text};if(m.model){msg.model=m.model;if(m.provider)msg.provider=m.provider;msg.require_model_lock=true}
     return gate('/api/sessions/'+encodeURIComponent(sid)+'/chat/stream',{method:'POST',headers:{accept:'text/event-stream'},body:JSON.stringify(msg),signal:AbortSignal.timeout(900000)}).catch(e=>({ok:false,status:502,text:async()=>e.message}))};
    let up=await start();
    // a Help chat that is gone from the engine (deleted, or the engine reset): a fresh one, once
    if(up.status===404&&sid){sid=null;up=await start()}
    if(!up.ok||!up.body){const t=await up.text().catch(()=>'');let said=t;try{const j=JSON.parse(t);said=j.error?.message||j.error||j.detail||t}catch{}return send(res,up.status===429?429:502,{error:'Help couldn’t answer right now ('+up.status+')'+(said?': '+clip(said,160):'')+'. Try again in a moment.'})}
    sent=true;if(pp.ctxNext){pp.ctx=pp.ctxNext.h;pp.ctxSession=pp.ctxNext.session;pp.ctxNext=null}await save();
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','x-accel-buffering':'no',...security});res.socket?.setNoDelay(true);
    const out=s=>{if(!res.writableEnded&&!res.destroyed)res.write(s)};
    out('event: aqeelos.help\ndata: '+JSON.stringify({type:'aqeelos.help',session:sid,left:Math.max(0,limitOf()-used(pp))})+'\n\n');
    // read to the end even when the tab goes away: the ticket in the reply is still filed
    let buf='',said='',done='';const dec=new TextDecoder();
    try{for await(const c of up.body){const s=dec.decode(c,{stream:true});out(s);buf+=s;let i;
      while((i=buf.search(/\r?\n\r?\n/))>=0){const raw=buf.slice(0,i);buf=buf.slice(i).replace(/^\r?\n\r?\n/,'');let data='';for(const l of raw.split(/\r?\n/))if(l.startsWith('data:'))data+=l.slice(5).trimStart();if(!data)continue;let e;try{e=JSON.parse(data)}catch{continue}
       if(e.type==='run.started'&&e.run_id){run.runId=e.run_id;if(run.stop)gate('/v1/runs/'+encodeURIComponent(e.run_id)+'/stop',{method:'POST',body:'{}'}).catch(()=>{})}
       else if(e.type==='assistant.delta')said+=e.delta||e.text||'';else if(e.type==='assistant.completed')done=contentText(e.content||'')||done}}}catch{}
    const m=TICKET_RE.exec(done||said);if(m){const r=await file(u,m[1],b).catch(e=>({error:e.message}));out('event: aqeelos.ticket\ndata: '+JSON.stringify({type:'aqeelos.ticket',...r})+'\n\n')}
    if(!res.writableEnded)res.end()}
   catch(e){if(!res.headersSent)return send(res,502,{error:e.message});if(!res.writableEnded)res.end()}
   finally{runs.delete(u.id);pp.ctxNext=null;if(!sent){pp.day=was.day;pp.n=was.n}}return}
  return send(res,404,{error:'Not found'})}
 if(mayEnsure())setTimeout(()=>ensure(),15000).unref?.();
 return {handle,items,decide,ensure,HELP_AGENT,NAME:HELP_NAME}}
