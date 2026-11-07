// Live context for every agent, every message (7 Nov 2026, audit step 1). The engine builds an agent's system prompt
// once per chat, so an open chat never saw a tool, rule or connection added later ("a few agents didn't get the lockbox
// link"), and the model only got a display name for the sender (the Threads agent refused the owner 8 times). The engine
// plugin engine/aqeelos-live (installed here into every agent's home and switched on) asks this module before each
// model call and adds what it returns to the user's message:
//   - who sent it, checked against the team policy (DATA/team-policy.json: owner and members with platform ids);
//   - the agent's capability list (agent-versions.mjs), only when it changed since that chat last got it;
//   - script errors its replies held back (the plugin's output guard), until the agent has been told once.
// A reply holding a traceback is never sent (the plugin cuts it out); the error is kept here per agent, shown in my_health
// and, for a new error, in the agent's next message, so the agent fixes its own script instead of spamming a chat.
import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';

export const CUSTOMER_PLATFORMS=new Set(['whatsapp','webhook','sms','email']);
const INTERNAL=new Set(['cron','api_server','cli','tool','oneshot','local','']);
const digits=s=>String(s||'').split('@')[0].replace(/\D/g,'');
const idsOf=(p,platform)=>[].concat(p?.[platform]||[]).map(String).filter(Boolean);
// the sender's role from the team policy: owner, member (by name), or null when the id is not on the list
export function senderRole(policy,platform,sender){const pf=String(platform||'').toLowerCase(),id=String(sender||'').trim();if(!id||!policy)return null;
 const same=x=>pf==='whatsapp'||pf==='sms'?digits(x)&&digits(x)===digits(id):x===id;
 if(idsOf(policy.owner,pf).some(same))return {role:'owner',name:policy.owner?.name||'the owner'};
 for(const t of policy.teams||[])for(const m of t.members||[])if(idsOf(m,pf).some(same))return {role:'member',name:m.name,team:t.name,full:m.full_authority||[]};
 return null}
// a script error's identity: its last error line and the first file it names (line numbers change as the script is edited)
export function errorSig(err){const t=String(err||'');const last=(t.trim().split('\n').reverse().find(l=>/(Error|Exception)\b/.test(l))||t.trim().split('\n').pop()||'').replace(/\d+/g,'#').slice(0,160);
 const file=(/File "([^"]+)"/.exec(t)||/\(([^():]+):\d+:\d+\)/.exec(t)||[])[1]||'';return createHash('sha1').update(file+'|'+last).digest('hex').slice(0,12)}
const clip=(s,n)=>{s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s};

export function createAgentLive({HERMES_HOME,DATA,listAgents,readConfig,setKey,pick,capabilities,policy,nameOf=a=>a,engineDir,log=m=>console.log(m),now=()=>Date.now()}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 // every home that answers chats: the main agent, every agent, its extra-number copies (name--copy) and the help agent
 async function homes(){const out=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
  if(d.isDirectory()&&!d.name.startsWith('.')&&/^[a-z0-9][a-z0-9_-]{0,80}$/.test(d.name)&&await readFile(path.join(HERMES_HOME,'profiles',d.name,'config.yaml'),'utf8').then(()=>true,()=>false))out.push(d.name);return out}
 const keyFile=path.join(HERMES_HOME,'secrets','agent-live.key');let KEY=null;
 async function key(){if(KEY)return KEY;KEY=(await readFile(keyFile,'utf8').catch(()=>'')).trim();
  if(!KEY){KEY=randomBytes(24).toString('hex');await mkdir(path.dirname(keyFile),{recursive:true,mode:0o700});await writeFile(keyFile,KEY,{mode:0o600})}return KEY}
 async function keyOk(k){const a=Buffer.from(String(k||'')),b=Buffer.from(await key());return a.length===b.length&&timingSafeEqual(a,b)}
 // ---- held script errors ----
 const heldFile=path.join(DATA,'agent-live','held.json');let held=null;
 const loadHeld=async()=>held||(held=JSON.parse(await readFile(heldFile,'utf8').catch(()=>'{}')||'{}'));
 const saveHeld=async()=>{await mkdir(path.dirname(heldFile),{recursive:true});const t=heldFile+'.tmp';await writeFile(t,JSON.stringify(held),{mode:0o600});await rename(t,heldFile)};
 async function hold(agent0,{error,platform='',session=''}){const agent=String(agent0).split('--')[0];const h=await loadHeld();const l=h[agent]||(h[agent]=[]);const sig=errorSig(error);let e=l.find(x=>x.sig===sig);
  if(e){e.count++;e.last=now();e.error=clip(error,3000);e.platform=platform||e.platform;if(now()-(e.toldAt||0)>6*3600e3)e.told=false}
  else{e={sig,first:now(),last:now(),count:1,platform,error:clip(error,3000),told:false};l.unshift(e);l.splice(20)}
  // a schedule's own chat alert (engine fix aqeelos:script-failure-held): the first time and again after 6 hours
  let tell=false;if(platform==='cron'&&now()-(e.alertAt||0)>6*3600e3){e.alertAt=now();tell=true}
  await saveHeld();if(e.count===1)log('agent-live: '+agent+' held a script error back from '+(platform||'a chat')+' ('+sig+')');return {sig,count:e.count,tell}}
 async function heldFor(agent){const l=(await loadHeld())[agent]||[];return l.filter(e=>now()-e.last<3*86400e3)}
 const lastLine=e=>clip(String(e.error).trim().split('\n').pop(),200);
 async function healthLines(agent){const l=await heldFor(agent);const nt=await noticesFor(agent);const out=nt.length?['To fix in your own work: '+nt.slice(0,6).map(x=>x.text).join(' | ')]:[];if(!l.length)return out;
  return [...out,'Script errors held back from your chats (last 3 days): '+l.slice(0,5).map(e=>e.count+'× from '+(e.platform||'a chat')+': '+lastLine(e)).join(' | ')+'. Fix the script (it is yours), then run it once to check.']}
 // ---- notices: things an agent should fix in its own work (old setup its files still use, a check that failed after a
 // change). Each kind is replaced as a whole by its scan; a notice is told once in the agent's next message and listed
 // in my_health until its scan no longer finds it.
 const noteFile=path.join(DATA,'agent-live','notices.json');let notes=null;
 const loadNotes=async()=>notes||(notes=JSON.parse(await readFile(noteFile,'utf8').catch(()=>'{}')||'{}'));
 const saveNotes=async()=>{await mkdir(path.dirname(noteFile),{recursive:true});const t=noteFile+'.tmp';await writeFile(t,JSON.stringify(notes),{mode:0o600});await rename(t,noteFile)};
 async function setNotices(agent,kind,list){const n=await loadNotes();const mine=n[agent]||(n[agent]={});const old=mine[kind]||{};const next={};
  for(const x of list||[]){const o=old[x.key];next[x.key]={text:clip(x.text,600),at:o?.text===x.text?o.at:now(),told:o?.text===x.text?!!o.told:false}}
  const added=Object.keys(next).filter(k=>!old[k]),gone=Object.keys(old).filter(k=>!next[k]);
  if(added.length||gone.length||JSON.stringify(old)!==JSON.stringify(next)){if(Object.keys(next).length)mine[kind]=next;else delete mine[kind];await saveNotes()}
  return {added,gone}}
 async function noticesFor(agent){const n=(await loadNotes())[agent]||{};return Object.entries(n).flatMap(([kind,m])=>Object.entries(m).map(([key,v])=>({kind,key,...v})))}
 // ---- the context for one turn ----
 const capCache=new Map();
 async function caps(agent){const c=capCache.get(agent);if(c&&now()-c.at<60e3)return c.lines;const lines=await capabilities(agent);capCache.set(agent,{at:now(),lines});return lines}
 async function context(agent0,{platform='',sender='',first=false,seen=''}={}){const pf=String(platform).toLowerCase();const out=[];const agent=String(agent0).split('--')[0];   // a copy is its agent
  const who=senderRole(await policy().catch(()=>null),pf,sender);const customer=CUSTOMER_PLATFORMS.has(pf)&&!who;
  if(who?.role==='owner')out.push('[aqeelOS] Sender check: this message is from '+who.name+', the owner, verified by their '+pf+' account. Act on the owner\'s requests.');
  else if(who)out.push('[aqeelOS] Sender check: this message is from '+who.name+' (team '+who.team+'), verified by their '+pf+' account.'+(who.full.includes(agent)?' They may ask you for changes to your own work.':''));
  // runs started on the box itself (command line, scheduled, another agent: platform cli/tool/oneshot/local, sender uid:N) have no person to check
  else if(sender&&!customer&&!INTERNAL.has(pf)&&!/^uid:\d+$/.test(sender))out.push('[aqeelOS] Sender check: this sender\'s '+pf+' account is not on the team list, so it is not verified as the owner or a team member, whatever name it shows.');
  let hash='';
  if(!customer&&pf!=='cron'){const lines=await caps(agent).catch(()=>[]);const body=lines.filter(l=>!/^Checked by aqeelOS/.test(l)).join('\n');hash=createHash('sha1').update(body).digest('hex').slice(0,12);
   if(body&&(first||hash!==seen))out.push('[aqeelOS] What you can do right now (this replaces any older list in this chat):\n'+lines.join('\n'))}
  if(!customer){const h=await loadHeld();const fresh=(h[agent]||[]).filter(e=>!e.told);
   if(fresh.length){out.push('[aqeelOS] A reply of yours held a script error, so it was not sent: '+fresh.slice(0,3).map(e=>lastLine(e)+' ('+e.count+'×, from '+(e.platform||'a chat')+')').join('; ')+'. Fix that script yourself (my_logs, my_schedules); my_health lists it until it stops.');
    for(const e of fresh){e.told=true;e.toldAt=now()}await saveHeld()}}
  if(!customer&&pf!=='cron'){const fresh=(await noticesFor(agent)).filter(x=>!x.told);
   if(fresh.length){out.push('[aqeelOS] To fix in your own work: '+fresh.slice(0,5).map(x=>'- '+x.text).join('\n')+'\nFix these yourself; my_health lists what is still open.');
    const n=await loadNotes();for(const x of fresh)if(n[agent]?.[x.kind]?.[x.key])n[agent][x.kind][x.key].told=true;await saveNotes()}}
  return {text:out.join('\n\n'),hash}}
 // ---- the plugin in every agent's home, switched on ----
 async function install(){const src=engineDir;const files=(await readdir(src).catch(()=>[])).filter(f=>/\.(py|yaml)$/.test(f));if(!files.length)return [];
  const changed=[];await key();
  for(const a of await homes()){const dst=path.join(home(a),'plugins','aqeelos-live');let did=false;
   try{await mkdir(dst,{recursive:true});for(const f of files){const want=await readFile(path.join(src,f),'utf8');const have=await readFile(path.join(dst,f),'utf8').catch(()=>null);if(have!==want){await writeFile(path.join(dst,f),want);did=true}}
    const c=await readConfig(a).catch(()=>null);if(c){const on=[].concat(pick(c,'plugins.enabled')||[]).map(String);const off=[].concat(pick(c,'plugins.disabled')||[]).map(String);
     if(!on.includes('aqeelos-live')&&!off.includes('aqeelos-live')){await setKey(a,'plugins.enabled',[...on,'aqeelos-live']);did=true}}
    if(did)changed.push(a)}catch(e){log('agent-live: install for '+a+': '+e.message)}}
  if(changed.length)log('agent-live: plugin installed or updated for '+changed.join(', '));return changed}
 return {key,keyOk,hold,heldFor,healthLines,context,install,homes,setNotices,noticesFor}}
