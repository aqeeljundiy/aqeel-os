// Bottlenecks: everything that is stuck until a person acts, each with a way to fix it. Two sources:
//   - what aqeelOS notices itself: a sign-in that is due, an AI account signed out, a schedule that failed, an invite that expired, a
//     channel that logged out, the server having been off;
//   - what an agent reports with its report_bottleneck tool when it cannot go on: access it is missing, a sign-in,
//     a permission, something only the person can give.
// Reports of the same thing merge; items leave when fixed (system ones disappear by themselves, reports are marked
// fixed); "Not now" hides an item for a day (for everyone when an admin says it, else just for that person).
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

// 7 Nov 2026 (owner: "all the bottlenecks that don't rely on me get auto fixed"): the Bottlenecks popup shows only
// what truly needs a person: money, a login only they have, adding a bot to a group, a decision only they can make.
// Everything else (a skill missing a file, a schedule that failed, a check that broke…) stays on System › Health and
// goes into the ladder there (agent-health.mjs: the agent tries first, then the fixer, then proof), silently.
// personNeed(item) → what the person must do, in one plain sentence, or null when it is not for a person.
const PERSON_TEXT=/\b(pay|paid|payment|invoice|top ?up|billing|credit card|out of credit|subscription|purchase|api key|new key|password|log[ -]?in|sign[ -]?in|oauth|qr|scan|add (the )?bot|add .{0,30}back|removed from (the )?(telegram )?group|bot is left|kicked|invite|decid|decision|choose|which one|approve the new instructions)/i;
const NOT_PERSON=/\b(tester (phone|number)|test (phone|number))\b|planned (ladder )?test|dummy test|no action needed/i;
const APPS=['notion','slack','google','gmail','github','linear','figma','airtable','hubspot','shopify','meta','facebook','instagram','tiktok','canva','xendit'];
export const appsIn=t=>APPS.filter(a=>new RegExp('\\b'+a+'\\b','i').test(String(t||'')));
export const groupReport=t=>/removed from (the )?(telegram )?group|bot is left|kicked from/i.test(String(t||''));
export function personNeed(x){const k=x?.kind,t=[x?.title,x?.missing,x?.text].filter(Boolean).join(' ');
 switch(k){
  case 'signin':return 'Sign in. Only you have this login.';
  case 'account':return x.account?.state==='credit'?'Top up this account, or switch the agents to another model.':x.account?.state==='rejected'?'Put in a working key for this account (the old one was rejected).':'Sign in to this account again. Only you have this login.';
  case 'invite':return 'If they still need to join, make a new invite link and send it to them.';
  case 'access':return 'Decide: allow or decline.';
  // a conflict (rule-conflicts.mjs): two sides or more, the agent never picks; the strictest side applies until you choose
  case 'conflict':return 'Choose one. Until you do, the strictest side applies.';
  case 'instructions':return 'Read the new instructions and approve or decline them.';
  // the fixer's fixes wait as branches until it has a GitHub token (issues.mjs, fixer-git.mjs)
  case 'github_token':return 'Make a GitHub token for the fixer (aqeel-os only: pull requests and contents on branches, no admin) and set it as AQEELOS_FIXER_GITHUB_TOKEN on the server.';
  case 'ticket':return 'Answer the waiting help tickets.';
  case 'accounts':return 'Keep it if you meant it; otherwise disconnect it.';
  // a message for the owner that landed here with no channel set: only one that needs them (the fixer's "needs a person")
  case 'alerts':{const m=/What is needed(?: from you)?: ([^\n]+)/i.exec(String(x.text||''));return /needs a person|What is needed|could not fix this by itself/i.test(t)?(m?m[1].trim():'Do what the message asks.'):null}
  case 'channel':return x.channel?.needs_link?'Link WhatsApp again: scan the QR code with the phone of that number.':null;
  case 'group':return 'Add the bot back to this Telegram group (a bot cannot add itself). If the agent no longer works there, remove the group from its settings.';
  // an agent's system report is an issue for the fixer at once (server.mjs): if it needs a person, the fixer sends
  // the one message. A report about the agent's own work counts when what it is missing is a person's thing.
  case 'system':return null;
  case 'report':{const m=String(x.missing||x.title||'');if(NOT_PERSON.test(t)||!PERSON_TEXT.test(m))return null;
   if(groupReport(t))return 'Add the bot back to the Telegram group (a bot cannot add itself).';
   const apps=appsIn(t);if(apps.length&&/sign[ -]?in|oauth|log ?in|token/i.test(t))return 'Sign in to '+list(apps.map(cap))+' on Connected apps, or switch '+(apps.length>1?'them':'it')+' off for the agents that do not need '+(apps.length>1?'them':'it')+'.';
   const fix=String(x.text||'').replace(/^Would fix it: /,'').trim();return fix||(x.agentName||'The agent')+' needs this from you: '+String(x.missing||x.title||'').slice(0,240)}
  default:return null}}
const cap=s=>s[0].toUpperCase()+s.slice(1);
const list=a=>a.length>1?a.slice(0,-1).join(', ')+' and '+a.at(-1):a[0]||'';
// what a member (not an admin) can act on: their agent being blocked (they ask it to try again once they gave it what it
// needs) and new instructions for an agent they own. Not access requests (an admin decides), not help tickets, not app
// sign-ins on Connected apps, not sign-ins, accounts, channels or groups (admin pages).
export const memberCan=x=>x?.kind==='report'||x?.kind==='instructions'||x?.kind==='conflict';
// the same need shown once: a group by its chat, an app sign-in by its apps (across agents), a report by what is missing
export function popupKey(x){const t=[x.title,x.missing].filter(Boolean).join(' ');
 if(x.kind==='group')return 'group|'+String(x.topic||x.title).replace(/^health\|[^|]+\|/,'');
 if((x.kind==='report'||x.kind==='system')){if(groupReport(t))return 'group-report|'+x.agent;const apps=appsIn(t);if(apps.length&&/sign[ -]?in|oauth|log ?in|token/i.test(t))return 'apps|'+apps.sort().join(',');
  return 'report|'+String(x.missing||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,80)}
 return x.id}
// the popup list: person needs only, each once, with what to do; merged items keep every id (also) so Done clears all
export function forPopup(items){const out=[],by=new Map(),groupAgents=new Set(items.filter(x=>x.kind==='group'&&x.agent).map(x=>x.agent));
 // an app that already has its own sign-in item (with the button that opens that sign-in) takes the agents' reports about it
 const signinFor=a=>out.find(y=>y.kind==='signin'&&new RegExp('\\b'+a+'\\b','i').test([y.title,y.signin?.name,y.signin?.app,y.signin?.label].join(' ')));
 for(const x of items){const ask=personNeed(x);if(!ask)continue;const t=[x.title,x.missing].filter(Boolean).join(' ');
  if((x.kind==='report'||x.kind==='system')&&groupReport(t)&&groupAgents.has(x.agent)){const g=out.find(y=>y.kind==='group'&&y.agent===x.agent);if(g){g.also.push(x.id);continue}}
  const k=popupKey(x);if(k.startsWith('apps|')){const s=k.slice(5).split(',').map(signinFor);if(s.every(Boolean)){s[0].also.push(x.id);continue}}
  const have=by.get(k);
  if(have){have.also.push(x.id);have.count=(have.count||1)+(x.count||1);if(x.agentName&&!have.agentNames.includes(x.agentName))have.agentNames.push(x.agentName);continue}
  const y={...x,ask,also:[],agentNames:x.agentName?[x.agentName]:[]};
  if(k.startsWith('apps|')){y.kind='apps';y.title=list(k.slice(5).split(',').map(cap))+' need'+(k.includes(',')?'':'s')+' a sign-in';y.text=''}
  by.set(k,y);out.push(y)}
 for(const y of out)if(y.agentNames.length>1){y.text=(y.text?y.text+' ':'')+'Asked by '+list(y.agentNames)+'.';if(y.kind==='report'||y.kind==='system')y.title=y.title.replace(/^.*? (is blocked|reported a system problem): /,'')}
 return out}

export function createBottlenecks({DATA,dash,listAgents,names,onInfo=async()=>{}}){
 const FILE=path.join(DATA,'bottlenecks.json');let db=null;
 const load=async()=>{if(!db){try{db=JSON.parse(await readFile(FILE,'utf8'))}catch{db={}}db.reports||=[];db.snooze||={};db.fixed||={};db.events||=[]}return db};
 const save=async()=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(db,null,1));await rename(FILE+'.tmp',FILE)};
 const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,120);
 // an agent reports what blocks it (merged with an open report about the same missing thing)
 async function report(agent,{what,missing,fix,from,system}){await load();const m=String(missing||'').trim().slice(0,400);if(!m)throw Error('Say what is missing.');
  const key=agent+'|'+norm(m);let r=db.reports.find(x=>x.key===key&&!x.fixed);
  if(r){r.count=(r.count||1)+1;r.updated=Date.now();if(system)r.system=true;if(what)r.what=String(what).slice(0,400);if(fix)r.fix=String(fix).slice(0,400);if(from)r.from=from}
  else{r={id:'r'+randomBytes(6).toString('hex'),key,agent,what:String(what||'').slice(0,400),missing:m,fix:String(fix||'').slice(0,400),created:Date.now(),updated:Date.now(),count:1,from:from||null,...(system?{system:true}:{})};db.reports.unshift(r);db.reports=db.reports.slice(0,200)}
  await save();return r}
 // something aqeelOS itself noticed (the server was off, a backup failed, a tool server broke): shown until it is solved
 // or dismissed (31 Oct 2026, the owner: "if it's solved we shouldn't still show it"). topic: the problem it is about; a
 // newer event on the same topic replaces the older one, and resolve(topic) takes it away once it works again. info:
 // "it works again" news, which goes to the bell's list instead (onInfo, news.mjs) and never sits here. Nothing stays longer than 7 days
 const KEEP_MS={down:2*24*3600e3},WEEK=7*24*3600e3;
 const prune=()=>{const now=Date.now();db.events=db.events.filter(e=>now-e.created<(KEEP_MS[e.kind]||WEEK))};
 async function event(kind,text,detail,{topic,info,agent,told,data}={}){await load();if(info){await onInfo(kind,text,detail);return}if(topic)db.events=db.events.filter(e=>e.topic!==topic);
  db.events.unshift({id:'e'+randomBytes(6).toString('hex'),kind,text,detail,created:Date.now(),...(topic?{topic}:{}),...(agent?{agent}:{}),...(told?{told:true}:{}),...(data?{data}:{})});prune();db.events=db.events.slice(0,20);await save()}
 async function resolve(topic){await load();const n=db.events.length;const t=String(topic||'');if(!t)return 0;db.events=db.events.filter(e=>!(e.topic===t||e.topic?.startsWith(t+'|')||(!e.topic&&e.kind===t)));
  if(db.events.length!==n)await save();return n-db.events.length}
 let sched={at:0,items:[]};
 async function failedSchedules(){if(Date.now()-sched.at<120000)return sched.items;const out=[];
  for(const a of await listAgents().catch(()=>[])){let l;try{l=await dash('/cron/jobs?profile='+encodeURIComponent(a))}catch{continue}
   // a run that failed, or one that ran but could not deliver its result in the last day (1 Nov 2026: that one was in no list)
   for(const j of (Array.isArray(l)?l:l?.jobs||[])){if(j.enabled===false)continue;const bad=j.last_status&&!/^(ok|success|completed?)$/i.test(j.last_status),undel=!bad&&j.last_delivery_error&&j.last_run_at&&Date.now()-new Date(j.last_run_at)<864e5;
    if(bad||undel)out.push({agent:a,id:j.id,name:j.name||j.prompt?.slice(0,60)||'A schedule',status:bad?j.last_status:'not delivered',error:String(bad?j.last_error||'':'It ran, but the result could not be delivered: '+j.last_delivery_error).slice(0,300),at:j.last_run_at})}}
  sched={at:Date.now(),items:out};return out}
 // the list for one person: system items (admins) and reports from the agents they may use
 async function list({admin,mayUse,signins,invites,uid,accounts,channels}){await load();const now=Date.now();const hid=k=>(db.snooze[k]||0)>now||uid&&(db.snooze[uid+'#'+k]||0)>now||db.fixed[k];const out=[];
  if(admin){for(const s of signins||[]){const k='signin|'+s.agent+'|'+s.name;if(!hid(k))out.push({id:k,kind:'signin',agent:s.agent,agentName:s.agentName,title:(s.account?.workspace?(s.app||s.label||s.name)+' ('+s.account.workspace+')':(s.label||s.name))+' needs signing in',text:s.agentName+' can’t '+(s.does||'use it')+' until then.',purpose:s.origin?.purpose||'',from:s.origin?.from||null,signin:s})}
   for(const j of await failedSchedules()){const k='sched|'+j.agent+'|'+j.id+'|'+j.at;if(!hid(k))out.push({id:k,kind:'schedule',agent:j.agent,agentName:names(j.agent),title:'A schedule failed: '+j.name,text:(j.error||j.status).slice(0,200),job:j})}
   for(const i of invites||[]){const k='invite|'+i.code;if(!hid(k))out.push({id:k,kind:'invite',title:'The invite for '+(i.name||'someone')+' expired',text:'They can’t join with the old link.',invite:i})}
   // an AI account that signed out (accounts.mjs keeps one per account until it works again; the time keeps a
   // "Not now" to that one time, so a later sign-out shows again)
   for(const a of accounts||[]){const k='account|'+a.key+'|'+a.since;if(!hid(k))out.push({id:k,kind:'account',title:a.name+(a.state==='rejected'?': key rejected':a.state==='credit'?': out of credit':': needs sign-in'),text:'Agents that use it can’t answer with it until it is reconnected.',account:a,at:a.since})}
   // a channel that logged out or keeps failing (server.mjs channelAttention, 1 Nov 2026: here only, not in the bell)
   // the key holds the time it went wrong, so a later drop of the same channel shows again after Clear all
   for(const c of channels||[]){const k='channel|'+c.agent+'|'+c.id+'|'+(c.since||0);if(!hid(k))out.push({id:k,kind:'channel',agent:c.base||c.agent,agentName:names(c.base||c.agent),title:(/^whatsapp/.test(c.id)?'WhatsApp channel':(c.name||c.id))+(c.needs_link?' logged out':' is not connected')+' on '+names(c.base||c.agent)+(String(c.agent).includes('--')?' (extra number)':''),text:c.needs_link?'Link it again, or remove it if it is no longer used.':'Open Channels to check it.',channel:{agent:c.agent,id:c.id,needs_link:c.needs_link}})}
   prune();for(const e of db.events){const k='event|'+e.id;if(!hid(k))out.push({id:k,kind:e.kind,title:e.text,text:e.detail||'',...(e.topic?{topic:e.topic}:{}),...(e.agent?{agent:e.agent,agentName:names(e.agent)}:{}),...(e.told?{told:true}:{}),...(e.data?{data:e.data}:{}),at:e.created})}}
  for(const r of db.reports){if(r.fixed||!mayUse(r.agent)||hid('report|'+r.id))continue;out.push({id:'report|'+r.id,kind:r.system?'system':'report',missing:r.missing,agent:r.agent,agentName:names(r.agent),title:r.system?names(r.agent)+' reported a system problem: '+r.missing:names(r.agent)+' is blocked: '+r.missing,text:r.fix?'Would fix it: '+r.fix:'',purpose:r.what?r.what.replace(/^to /i,''):'',from:r.from||null,count:r.count,at:r.updated})}
  return out}
 async function done(id){await load();if(id.startsWith('report|')){const r=db.reports.find(x=>'report|'+x.id===id);if(r){r.fixed=Date.now()}}else db.fixed[id]=Date.now();await save()}
 // uid: a member's "Not now" hides it only for them; snoozes that ran out are dropped so the map stays small
 async function later(id,uid){await load();const now=Date.now();for(const [k,t] of Object.entries(db.snooze))if(t<now)delete db.snooze[k];db.snooze[uid?uid+'#'+id:id]=now+24*3600e3;await save()}
 // the open report behind a "report|<id>", so the caller can check who may act on it
 async function find(id){await load();return db.reports.find(x=>'report|'+x.id===id&&!x.fixed)||null}
 // the open Health events as they are (the morning line, morning.mjs)
 async function events(){await load();return db.events.map(e=>({...e}))}
 return {report,event,resolve,list,done,later,find,failedSchedules,events}}
