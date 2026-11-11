// What every agent gets from aqeelOS itself (decided 20 Oct 2026), not from each agent's own settings:
//  - every tool bundle on every channel: its own screen and browser (logins through the lock box, downloads), web,
//    files, terminal, code, images, voice, schedules; and the skills (all but a few for specific agents, skills-policy.mjs);
//  - its own Linux user (every agent but the main one, now and any made later; decided 20 Oct 2026): its commands, files and code then run as that
//    user over SSH to the box itself, so it can only reach its own folder (~/workspaces/<agent>), never the owner's
//    sign-ins, keys, aqeelOS's data or other agents' folders. The box's root startup (scripts/agent-users.sh, started
//    from the AI box's compose in Dokploy) makes those users for the names aqeelOS lists.
// The owner's own accounts (Slack, Notion, Google and so on) are never handed out by these defaults; each agent can
// connect apps with its own sign-in. Applied at every start (an engine update can reset settings) and to new agents.
import {readFile,writeFile,mkdir,stat,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {homedir,userInfo} from 'node:os';
import {execFile} from 'node:child_process';
import {setKey,readConfig,pick,agentNames,HERMES_HOME} from './agentops.mjs';
import {UNSAFE_TOOLSETS} from './users.mjs';
import {preferIpv4} from './net-prefer.mjs';

const PLATFORMS=['whatsapp','telegram','slack','discord','signal','api_server'];
// the engine's API-server bundle leaves out clarify, computer_use and tts; the app chat gets them back so it matches every other channel
const API_EXTRA=['clarify','computer_use','tts'];
const bundle=p=>p==='api_server'?'hermes-api-server':'hermes-'+p;
// language-server memory caps for every agent (OPS-17): settings key and value
export const LSP_CAPS=[['lsp.idle_timeout','300'],
 ['lsp.servers.typescript',{env:{NODE_OPTIONS:'--max-old-space-size=1536'},initialization_options:{maxTsServerMemory:1536}}],
 ['lsp.servers.pyright',{env:{NODE_OPTIONS:'--max-old-space-size=1024'}}]];
const run=(c,a)=>new Promise((res,rej)=>execFile(c,a,{timeout:30000},(e,o,er)=>e?rej(Error(String(er||e.message).trim())):res(String(o))));

// the Chrome on an isolated agent's own screen: scripts/agent-users.sh gives each one port 9600+i (behind the wake proxy,
// Chrome itself listens 10000 above it)
export const ownScreenCdp=u=>{const m=/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/.exec(String(u||'').trim());const p=m?+m[1]:0;return p>=9600&&p<10000||p>=19600&&p<20000};

// isTest: a throwaway agent of a check (deploy checks make and delete them on the shared engine). It still gets the
// defaults, but they never count toward an engine restart: 6-7 Nov 2026 each check's agent restarted every agent.
export function createAgentDefaults({DATA,giveSkills,trimSkills=async()=>0,locked=async()=>false,isTest=async()=>false,resumeSecs=()=>7200,log=m=>console.log(m)}){
 const TRUST=path.join(DATA,'agent-trust.json'),SEEN=path.join(DATA,'agents-seen.json');
 const REQ=path.join(homedir(),'.aqeelos-agent-users'),KEY=path.join(HERMES_HOME,'agent-ssh','id_ed25519');
 const userOf=a=>('ag-'+a).slice(0,32);
 // only the main agent keeps the box's main user; agent-trust.json may name others, but by default it names none
 async function trusted(){try{return new Set(['default',...(JSON.parse(await readFile(TRUST,'utf8')).trusted||[])])}catch{
  await writeFile(TRUST,JSON.stringify({trusted:[]},null,1)).catch(()=>{});return new Set(['default'])}}
 // Agents › Edit agent › Trusted (admins, agents of admins only): written here, then the agent's defaults run again so it
 // moves to the main user (or back to its own) at once
 async function setTrusted(a,on){if(a==='default')return;const t=await trusted();t.delete('default');if(on)t.add(a);else t.delete(a);
  await mkdir(DATA,{recursive:true});await writeFile(TRUST+'.tmp',JSON.stringify({trusted:[...t].sort()},null,1));await rename(TRUST+'.tmp',TRUST)}
 async function ensureKey(){if(await stat(KEY).catch(()=>null))return;await mkdir(path.dirname(KEY),{recursive:true,mode:0o700});await run('ssh-keygen',['-q','-t','ed25519','-N','','-f',KEY,'-C','aqeelos-agents'])}
 // the box itself as a known SSH host (the agents' commands go to 127.0.0.1)
 async function knownHost(){const f=path.join(homedir(),'.ssh','known_hosts');const cur=await readFile(f,'utf8').catch(()=>'');if(/^127\.0\.0\.1 /m.test(cur))return;
  const k=await run('ssh-keyscan',['-T','5','-t','ed25519','127.0.0.1']).catch(()=>'');if(k.trim()){await mkdir(path.dirname(f),{recursive:true,mode:0o700});await writeFile(f,cur+(cur&&!cur.endsWith('\n')?'\n':'')+k)}}
 // the root script makes a user for each name listed here (one per line) and writes the users it made to <file>.done
 async function requestUsers(names){const want=[...names].sort().join('\n')+'\n';if((await readFile(REQ,'utf8').catch(()=>''))!==want){await writeFile(REQ+'.tmp',want);await rename(REQ+'.tmp',REQ)}}
 const ready=async a=>(await readFile(REQ+'.done','utf8').catch(()=>'')).split('\n').includes(userOf(a));
 // the Chrome on the agent's own screen (the root script keeps one per isolated agent; its port is in ~/.aqeelos-agent-ports)
 const chromePort=async a=>{const l=(await readFile(path.join(homedir(),'.aqeelos-agent-ports'),'utf8').catch(()=>'')).split('\n').find(x=>x.startsWith(a+' '));return l?l.trim().split(' ')[2]:null};
 // no withAgent around this: setKey takes the agent's lock itself (holding it here waited on itself forever)
 // one run per agent at a time (a new agent is seen by the setup hook and the tick together): a second caller joins it
 const inflight=new Map();
 function ensure(a){if(!inflight.has(a))inflight.set(a,ensureOnce(a).finally(()=>inflight.delete(a)));return inflight.get(a)}
 // one Python for every agent's own user, with what its skills need (Google's libraries), outside the main user's
 // private folders (~/workspaces lets agents pass through, not look around); each agent's shell finds it first, and
 // `python` works too (the agents' users have no shell profile of their own otherwise)
 const PY=path.join(homedir(),'workspaces','.aqeelos-python'),PY_PKGS=['google-api-python-client','google-auth-oauthlib','google-auth-httplib2'];
 let pyReady=null;
 const sharedPython=()=>pyReady||=(async()=>{const mark=path.join(PY,'.pkgs');if((await readFile(mark,'utf8').catch(()=>''))===PY_PKGS.join(' '))return;
  if(!await stat(path.join(PY,'bin','python')).catch(()=>null))await run('/usr/bin/python3',['-m','venv',PY]);
  await new Promise((res,rej)=>execFile(path.join(PY,'bin','pip'),['install','-q','--disable-pip-version-check',...PY_PKGS],{timeout:600000},e=>e?rej(e):res()));
  await run('chmod',['-R','a+rX',PY]);await writeFile(mark,PY_PKGS.join(' '));log('agents\' shared Python ready: '+PY_PKGS.join(', '))})().catch(e=>{pyReady=null;throw e});
 async function agentShell(ws){await sharedPython();const env=path.join(ws,'.aqeelos-env'),line='[ -f ~/.aqeelos-env ] && . ~/.aqeelos-env';
  const want='# written by aqeelOS: the shared Python (python, python3, pip) with the skills\' libraries\nexport PATH="'+path.join(PY,'bin')+':$HOME/.local/bin:$PATH"\n';
  if((await readFile(env,'utf8').catch(()=>''))!==want)await writeFile(env,want);
  for(const f of ['.bashrc','.profile']){const p=path.join(ws,f),cur=await readFile(p,'utf8').catch(()=>'');if(!cur.includes(line))await writeFile(p,cur+(cur&&!cur.endsWith('\n')?'\n':'')+line+'\n')}}
 async function ensureOnce(a){const c=await readConfig(a).catch(()=>null);if(!c)return 0;const changes=[];
  const own=!(await trusted()).has(a),ws=path.join(homedir(),'workspaces',a),isolated=own&&await ready(a);
  // the full bundles include the terminal: an agent meant to have its own user gets them only once that user exists
  const pts=pick(c,'platform_toolsets')||{};
  // Customer-controlled webhook payloads must never acquire settings, secrets, code or self-run administration.
  // Resolve the full bundle, then subtract these servers (not a connector allowlist, so future apps still work).
  const webhookOff=[].concat(pick(c,'platform_toolset_excludes.webhook')||[]).map(String);
  const adminServers=['aqeelos-notify','aqeelos-self','aqeelos-code'];
  if(adminServers.some(n=>!webhookOff.includes(n)))changes.push(['platform_toolset_excludes.webhook',[...new Set([...webhookOff,...adminServers])]]);

  // progress notes (the model's text between tool calls) are off by default: they carried junk words to Telegram
  // ("cane", "거듭", 6 Nov 2026). Set once per agent; turning them back on for an agent later stays on.
  // the once-marker lives in aqeelOS's data: the engine drops keys it does not know (7 Nov 2026: an aqeelos.* marker in
  // config.yaml was never saved, so this re-applied and restarted the agents every few minutes)
  const onceF=path.join(DATA,'agent-defaults-once.json');const once=JSON.parse(await readFile(onceF,'utf8').catch(()=>'{}')||'{}');
  if(!once[a]?.interim){if(pick(c,'display.interim_assistant_messages')!==false&&String(pick(c,'display.interim_assistant_messages'))!=='false')changes.push(['display.interim_assistant_messages','false']);
   once[a]={...(once[a]||{}),interim:Date.now()};await writeFile(onceF,JSON.stringify(once))}
  if(!own||isolated)for(const p of PLATFORMS){const cur=[].concat(pts[p]||[]),add=[bundle(p),...(p==='api_server'?API_EXTRA:[])].filter(x=>!cur.includes(x));if(add.length)changes.push(['platform_toolsets.'+p,cur.includes(bundle(p))?[...cur,...add]:[...add,...cur]])}
  if(!isolated&&pick(c,'bot_desktop.auto_start')!==true)changes.push(['bot_desktop.auto_start','true']);
  if(isolated){const want={'terminal.backend':'ssh','terminal.ssh_host':'127.0.0.1','terminal.ssh_user':userOf(a),'terminal.ssh_port':'22','terminal.ssh_key':KEY,'terminal.cwd':ws};
   // its browser is the Chrome on its own screen, which runs as its user; the engine then starts no screen of its own for it
   const port=await chromePort(a);if(port){want['browser.cdp_url']='http://127.0.0.1:'+port;want['bot_desktop.auto_start']='false'}
   for(const [k,v] of Object.entries(want))if(String(pick(c,k)??'')!==v)changes.push([k,v]);
   // walled off in its own user, it gets every tool group: tool groups switched off for it earlier come back on
   // except an agent locked to safe tools (its owner lacks "unsafe", or an admin locked it): terminal, files and code stay off
   const off=[].concat(pick(c,'agent.disabled_toolsets')||[]).flatMap(x=>String(x).split(',')).map(x=>x.trim()).filter(Boolean),wantOff=await locked(a.split('--')[0]).catch(()=>true)?UNSAFE_TOOLSETS:[];
   if(off.length!==wantOff.length||wantOff.some(x=>!off.includes(x)))changes.push(['agent.disabled_toolsets',wantOff]);
   // its Google sign-ins (its own and the ones shared with it) are copied to its own user like the engine's other
   // credential files; the Google skill alone only names the default one
   const home=path.join(HERMES_HOME,'profiles',a);
   const creds=(await readdir(home).catch(()=>[])).filter(f=>/^google_(token|client_secret)(_[\w.-]+)?\.json$/.test(f)).sort();
   if(JSON.stringify([].concat(pick(c,'terminal.credential_files')||[]).slice().sort())!==JSON.stringify(creds))changes.push(['terminal.credential_files',creds]);
   await agentShell(ws).catch(e=>log('agent shell '+a+': '+e.message))}
  else if(!own){if(pick(c,'terminal.backend')==='ssh')changes.push(['terminal.backend','local']);
   // trusted later, it browses with the engine's own screen again: a leftover link to the Chrome its own user had
   // (ports 9600 and up, handed to the next agent made) would drive another agent's browser (11 Nov 2026: pepclub-social
   // on aq-livetest's Chrome). AdsPower's bridge (:9333) and other choices stay.
   if(ownScreenCdp(pick(c,'browser.cdp_url')))changes.push(['browser.cdp_url',''])}
  // voice notes: the language is detected each time, so every agent adapts to whoever speaks (the engine's own default
  // forces English when an agent sets none), with the same speech model as the main agent
  // aqeelOS's own tools for the agent (lock box, my_settings, browser choice, bottlenecks) are never cut down to a few
  if(pick(c,'mcp_servers.aqeelos-notify.tools.include')!==undefined)changes.push(['mcp_servers.aqeelos-notify.tools',{}]);
  if(pick(c,'stt.language')===undefined)changes.push(['stt.language','']);
  // IPv6 that does not work (Elkiya's Telegram, 11 Nov 2026): the engine is told to use IPv4 only, found out here, not set by hand (app/net-prefer.mjs)
  if(String(pick(c,'network.force_ipv4'))!=='true'&&await preferIpv4().catch(()=>false))changes.push(['network.force_ipv4','true']);
  // a Telegram / WhatsApp chat that a restart cut off carries on by itself, like a "try again" nobody presses (owner, 12 Nov
  // 2026): the engine's own restart recovery says "session restored, what next?" unless this is on (engine patch
  // engine/patches/2026-11-12-channel-resume-continue.patch; an engine without it keeps the key and ignores it). An owner's
  // explicit false stays. The engine only resumes marks younger than its freshness window: the install's resumeMaxHours.
  if(!['true','false'].includes(String(pick(c,'agent.gateway_resume_continue'))))changes.push(['agent.gateway_resume_continue','true']);
  {const want=Math.round(resumeSecs());if(want>0&&Number(pick(c,'agent.gateway_auto_continue_freshness'))!==want)changes.push(['agent.gateway_auto_continue_freshness',String(want)])}
  // the engine's code checkers (language servers it starts after file edits) held ~2.7 GB on Elkiya (OPS-17, 11 Nov
  // 2026), a box with a 28 GB limit: TypeScript's at most 1.5 GB of heap, Python's 1 GB, and each stops after 5 idle
  // minutes (the engine's own default is 10). Set once; values a person set stay.
  for(const [k,v] of LSP_CAPS)if(pick(c,k)===undefined)changes.push([k,v]);
  if(a!=='default'&&pick(c,'stt.local.model')===undefined){const m=pick(await readConfig('default').catch(()=>null),'stt.local.model');if(m)changes.push(['stt.local.model',String(m)])}
  // only settings really written count: a refused write (e.g. a deleted profile) must not restart the agents every pass
  const done=[];for(const [k,v] of changes){const r=await setKey(a,k,v).catch(e=>({ok:false,out:String(e?.message||e)}));if(r?.ok!==false)done.push(k);else log('agent defaults '+a+' '+k+': '+String(r.out||'').trim().slice(0,160))}
  if(done.length)log('agent defaults for '+a+': '+done.join(', '));return done.length}
 // every agent has the skills the main agent has, except the few that are for specific agents (skills-policy.mjs,
 // decided 24 Oct 2026): missing ones are copied (not ones a person removed from it: giveSkills keeps a list), the agent's own copies and extra skills of its own stay, and skills an
 // agent must not have are moved out to its skills-removed folder. Only the owner's signed-in accounts are never handed out
 async function skills(names){let n=0;for(const a of names){if(a!=='default')n+=await giveSkills(a).catch(()=>0)||0;n+=await trimSkills(a).catch(()=>0)||0}return n}
 // about every minute: agents made any way (aqeelOS, the engine's command line, another agent) get the defaults once
 // when first seen (the list survives restarts), and every agent gets the main agent's skills it lacks
 // an agent first seen less than 5 minutes ago is still being set up by whoever made it (this aqeelOS, or the test copy
 // that shares the engine): settings and plugins written at the same moment collide (AdmissionRefused), so it waits
 const FIRST=path.join(DATA,'agents-first-seen.json');let first=null;
 async function settled(names){if(!first){try{first=JSON.parse(await readFile(FIRST,'utf8'))}catch{first={};for(const a of names)first[a]=0}}
  let ch=false;for(const a of names)if(!(a in first)){first[a]=Date.now();ch=true}if(ch)await writeFile(FIRST,JSON.stringify(first)).catch(()=>{});
  return names.filter(a=>a==='default'||Date.now()-first[a]>=300000)}
 async function tick(){const names=await settled(await agentNames());await skills(names);let seen;try{seen=new Set(JSON.parse(await readFile(SEEN,'utf8')))}catch{seen=null}
  if(!seen){await writeFile(SEEN,JSON.stringify(names));return 0}let n=0;
  for(const a of names)if(!seen.has(a)){log('new agent '+a+': giving it the defaults');const k=await added(a).catch(e=>{log('agent defaults '+a+': '+e.message);return 0});if(!await isTest(a).catch(()=>false))n+=k;seen.add(a);await writeFile(SEEN,JSON.stringify([...seen]))}
  return n}
 async function all(){await ensureKey().catch(e=>log('agent key: '+e.message));await knownHost().catch(()=>{});const names=await agentNames(),tr=await trusted();
  await requestUsers(names.filter(a=>!tr.has(a)));await skills(names);
  let n=0;for(const a of await settled(names)){const k=await ensure(a).catch(e=>{log('agent defaults '+a+': '+e.message);return 0});if(!await isTest(a).catch(()=>false))n+=k}return n}
 // a new agent: its user (when it is not trusted), then the defaults
 async function added(a){const names=await agentNames(),tr=await trusted();await requestUsers(names.filter(x=>!tr.has(x)));
  if(!tr.has(a))for(let i=0;i<8&&!await ready(a);i++)await new Promise(r=>setTimeout(r,2000));return ensure(a)}
 /* ---------- Code projects on the box, worked on by the engine ("aqeelOS models" in Code) ----------
    An agent with its own Linux user reaches a Code project folder (~/code-projects/<name>) only through access-list
    entries: passage (--x) through the projects folder, read/write on the project, and the same for files made later
    (default entries). The mask is reset each time: files written with mode 644 cap every named entry at read-only.
    Other projects stay closed to it ("others" get nothing on them). After the turn the files the agent made (owned by
    its user, so only it may change their list) get the same reset over its own SSH login, so Code can edit them. */
 const ME=(()=>{try{return userInfo().username}catch{return process.env.USER||'claude'}})();
 // the agent's own user ('' for the main agent and trusted ones, which run as this user), or null when not made yet
 async function codeUser(a){if((await trusted()).has(a))return '';return await ready(a)?userOf(a):null}
 // terminal or file tools switched off for the agent (a locked agent): it cannot work on code
 async function codeLocked(a){const c=await readConfig(a).catch(()=>null);const off=[].concat(pick(c||{},'agent.disabled_toolsets')||[]).flatMap(x=>String(x).split(',')).map(x=>x.trim());return off.includes('terminal')||off.includes('file')}
 const facl=(u,me)=>'u:'+u+':rwX,u:'+me+':rwX,m::rwX,d:u:'+u+':rwX,d:u:'+me+':rwX,d:m::rwX';
 const quiet=(c,a,t=180000)=>new Promise(res=>execFile(c,a,{timeout:t,maxBuffer:4e6},(e,o,er)=>res({ok:!e,err:String(er||e?.message||'')})));
 // folders whose files Code, git or Claude Code / Codex run as this user (hooks, core.fsmonitor, settings): read-only to the agent
 const CONFIG=['.git','.claude','.codex'];
 // turns now going per agent and folder: the entries are taken away when the last one ends
 const inUse=new Map(),use=(k,d)=>{const n=(inUse.get(k)||0)+d;if(n>0)inUse.set(k,n);else inUse.delete(k);return n};
 // read: Plan only (25 Oct 2026): the agent may read the folder but not change it (r-X entries, no write)
 async function codeAccess(a,dir,area,{read=false}={}){const u=await codeUser(a);if(u===null)throw Error('This agent’s own user on the box is not ready yet. Try again in a minute.');if(!u)return;
  if(!(await quiet('setfacl',['--version'],10000)).ok)throw Error('The box has no setfacl, so the agent cannot be given the project folder.');
  await quiet('chmod',['o-rwx',area]);for(const e of await readdir(area,{withFileTypes:true}).catch(()=>[]))if(e.isDirectory())await quiet('chmod',['o-rwx',path.join(area,e.name)]);
  use(u+'|'+area,1);use(u+'|'+dir,1);await quiet('setfacl',['-m','u:'+u+':--x',area]);
  // .claude and .codex made here first (ours), so the agent cannot make its own; with .git they are read-only to it
  for(const c of CONFIG.slice(1))await mkdir(path.join(dir,c),{recursive:true,mode:0o700}).catch(()=>{});
  // files the agent made in an earlier turn are its own: the list on them is not ours to change (fixed after each turn)
  await quiet('setfacl',['-R','-m',read?'u:'+u+':rX,u:'+ME+':rwX,m::rwX,d:u:'+u+':rX,d:u:'+ME+':rwX,d:m::rwX':facl(u,ME),dir]);
  for(const c of CONFIG){const f=path.join(dir,c);if(await stat(f).catch(()=>null))await quiet('setfacl',['-R','-m','u:'+u+':rX,d:u:'+u+':rX',f])}}
 async function codeAccessAfter(a,dir,area){const u=await codeUser(a);if(!u)return;const q="'"+String(dir).replace(/'/g,"'\\''")+"'";
  const r=await quiet('ssh',['-i',KEY,'-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-p','22',u+'@127.0.0.1','setfacl -R -m '+facl(u,ME)+' -- '+q+' 2>/dev/null; true'],120000);
  if(!r.ok)log('code access after a turn ('+a+'): '+r.err.slice(0,200));
  // the turn is over: the agent's entries go (on the project, and passage through the projects folder once no turn needs it)
  if(!use(u+'|'+dir,-1))await quiet('setfacl',['-R','-x','u:'+u+',d:u:'+u,dir]);
  if(area&&!use(u+'|'+area,-1))await quiet('setfacl',['-x','u:'+u,area])}
 // a folder an agent saves files into for a Code run that asked it (its own workspace's code-outbox/<id>): write for
 // its user, if it has one; aqeelOS reads the files and removes the folder afterwards
 async function outboxAccess(a,dir){const u=await codeUser(a);if(u)await quiet('setfacl',['-m','u:'+u+':rwx,m::rwx',dir],20000)}
 return {all,tick,ensure,added,trusted,setTrusted,userOf,codeUser,codeLocked,codeAccess,codeAccessAfter,outboxAccess}}
