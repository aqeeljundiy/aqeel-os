// AdsPower inside every agent (1 Nov 2026): each agent runs its own AdsPower app on its own screen, as its own Linux
// user, with its own data (HOME = its folder ~/workspaces/<agent>, so ~/.config/adspower_global is its own) and its own
// sign-in. The owner signs in himself on each agent's screen; nothing here ever types or reads a password.
//  - each agent keeps one Local API port for good (50400 and up, kept in DATA, never handed to another agent);
//  - an agent with its own Linux user starts it over SSH as that user, on its own screen (the box's root startup keeps
//    that screen on); the main agent and trusted agents run as this user, on their engine screen, which is
//    started when needed and kept on (not stopped as idle) while AdsPower runs;
//  - a restart loop keeps it running, and a check every minute starts it again when the loop is gone (a box restart);
//  - its AdsPower tool (mcp_servers.AdsPower) points at its own port; the main agent's extra numbers use its copy.
// Own port (1 Nov 2026): with its window open AdsPower ignores --api-port and takes 50325 (or the next free one up to
// 50425), so each copy runs with a small LD_PRELOAD shim (scripts/adspower-port-shim.c, built here with cc) that moves
// its 50325 to its own port. What a copy really listens on is still looked up (its user's listening sockets in
// /proc/net/tcp*, the one that answers /status), so a copy started without the shim keeps working on whatever it took.
// The old copy on the shared :99 screen is started by the box's own startup (outside aqeelOS) and is left alone.
import {execFile} from 'node:child_process';
import {readFile,writeFile,readdir,readlink,stat,rename,mkdir,rm,utimes} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export const BASE_PORT=50400,ADS_PORT=50325,ADS_LAST=50425;   // AdsPower's own port and the last one it falls back to
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const baseOf=a=>String(a).split('--')[0];   // "default--whatsapp-2" is the main agent: it uses its copy

// the port of each agent: kept for good, a new agent gets the next one never used (the main agent first)
export function assignPorts(db,names){const ports={...(db.ports||{})};let next=Math.max(db.next||0,...Object.values(ports).map(p=>p-BASE_PORT+1),0),changed=false;
 const order=[...new Set(names.map(baseOf))].sort((a,b)=>a==='default'?-1:b==='default'?1:a<b?-1:a>b?1:0);
 for(const a of order)if(!ports[a]){ports[a]=BASE_PORT+next++;changed=true}
 return {db:{...db,ports,next},changed}}

// The shell line that starts the keep-alive loop. Every value in it is a checked agent name, a port number or a fixed
// path, so nothing needs quoting. The loop reads the screen's DISPLAY/XAUTHORITY afresh each time (a restarted screen
// gets a new key), waits while the screen is off, and keeps the log small. $0 of the loop is its marker. The port is
// written as $P, never spelled out next to "--api-port=" or the marker, so the stop patterns never match this line itself.
export function launchLine({bin,home,envFile,port,shim=''}){if(![bin,home,envFile,...shim?[shim]:[]].every(x=>/^\/[\w./-]+$/.test(String(x)))||!(port>0&&port<65536&&Number.isInteger(port)))throw Error('bad AdsPower launch values');
 // the screen's env sets XDG_* to the screen's own folder (the main agent's: ~/.hermes/bot-desktop/xdg, left out of backups and
 // reset with the screen), so AdsPower's data would land there; unset, it stays in the agent's folder (1 Nov 2026)
 const loop=`P=${port}; cd ${home}; mkdir -p .adspower; while :; do L=.adspower/adspower.log; [ -f $L ] && [ $(stat -c%s $L) -gt 5000000 ] && mv -f $L $L.old; unset DISPLAY XAUTHORITY; set -a; . ${envFile} 2>/dev/null; set +a; unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME; if [ -n "$DISPLAY" ]; then ${shim?`LD_PRELOAD=${shim} AQ_ADSPOWER_PORT=$P `:''}HOME=${home} ${bin} --no-sandbox --disable-dev-shm-usage --api-port=$P >> $L 2>&1; fi; sleep 5; done`;
 return `P=${port}; ${stopLine({home,port})}; setsid nohup bash -c '${loop}' aqeelos-adspower-$P >/dev/null 2>&1 </dev/null &`}
export const marker=port=>'aqeelos-adspower-'+port;
// pkill patterns written so they never match the shell that runs them ("5040[0]" matches 50400, the line itself does not)
const pat=s=>s.slice(0,-1)+'['+s.slice(-1)+']';
// the loop first, then the app and the browsers it opened; whatever is still there after 3 seconds is killed outright
export function stopLine({home,port}){const k=sig=>`pkill -${sig} -u "$(id -u)" -f '${pat(marker(port))}'; pkill -${sig} -u "$(id -u)" -f -- '${pat('--api-port='+port)}'; pkill -${sig} -u "$(id -u)" -f '${pat(home+'/.config/adspower_global')}'`;
 return `${k('TERM')}; for i in 1 2 3; do pgrep -u "$(id -u)" -f -- '${pat('--api-port='+port)}' >/dev/null || break; sleep 1; done; ${k('KILL')}; true`}

// listening sockets from /proc/net/tcp or tcp6: [{port,uid,inode}]
export const parseListen=t=>String(t).split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(f=>f[3]==='0A'&&f[1]).map(f=>({port:parseInt(f[1].split(':').pop(),16),uid:+f[7],inode:+f[9]}));
// the ports a copy may have its Local API on, its own first: the user's sockets on its own port or in AdsPower's range
// (mine(row) says a socket is this copy's, for agents that share a user); /status then tells which one it is
export const apiCandidates=(rows,{uid,own,mine=()=>true})=>[...new Set(rows.filter(r=>r.uid===uid&&(r.port===own||r.port>=ADS_PORT&&r.port<=ADS_LAST)&&mine(r)).map(r=>r.port))].sort((a,b)=>(b===own)-(a===own)||a-b);

export function createAgentAdspower({DATA,HERMES_HOME,screens,codeUser,agentNames,readConfig,pick,withAgent,mcp,nameOf=a=>a,skip=async()=>false,help=a=>false,wanted=async()=>true,live=false,log=m=>console.log(m),portsFile=null}){
 const HOME=homedir(),FILE=path.join(DATA,'agent-adspower.json'),PORTS=portsFile||path.join(HOME,'.aqeelos-adspower-ports');
 const SRC=path.join(HOME,'apps','adspower','opt','adspower-global'),BIN_DIR=path.join(HOME,'workspaces','.aqeelos-adspower'),BIN=path.join(BIN_DIR,'adspower_global');
 const KEY=path.join(HERMES_HOME,'agent-ssh','id_ed25519'),MCP_SCRIPT=new URL('../scripts/adspower-mcp.sh',import.meta.url).pathname;
 const SHIM_SRC=new URL('../scripts/adspower-port-shim.c',import.meta.url).pathname,SHIM=path.join(HOME,'workspaces','.aqeelos-adspower-port.so');
 const run=(c,a,t=60000)=>new Promise(res=>execFile(c,a,{timeout:t,maxBuffer:4e6},(e,o,er)=>res({ok:!e,out:String(o||''),err:String(er||e?.message||'')})));
 const wsOf=a=>path.join(HOME,'workspaces',a);
 let db=null;const load=async()=>db||=await readFile(FILE,'utf8').then(JSON.parse).catch(()=>({ports:{},next:0,off:{}}));
 let realPort={};   // agent → the port its copy really listens on, when not its own (found by tick and tools)
 // the CDP bridge (scripts/adspower-bridge.mjs) reads this to find an agent's own copy
 const writePorts=()=>writeFile(PORTS,Object.entries(db.ports).map(([a,p])=>a+' '+(realPort[a]||p)).join('\n')+'\n').catch(()=>{});
 // one save at a time, each with its own tmp file: parallel status reads (the list on a fresh install) all saved through
 // one FILE.tmp, so the second rename failed (ENOENT) and /ui/adspower never answered
 let saving=Promise.resolve();
 const save=()=>saving=saving.catch(()=>{}).then(async()=>{const tmp=FILE+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp';
  await mkdir(path.dirname(FILE),{recursive:true});await writeFile(tmp,JSON.stringify(db,null,1));await rename(tmp,FILE);await writePorts()});
 // every agent switched on for it (Edit agent › Abilities, agent-optins.mjs), but never Help or test agents; the main
 // agent's extra numbers are the main agent. Agents switched off get no copy, screen, tool or skill (7 Nov 2026).
 const agents=async()=>{const out=[];for(const a of await agentNames())if(NAME.test(a)&&!a.includes('--')&&!await skip(a)&&await wanted(a))out.push(a);return out};
 // switched off: its copy stops (its folder and sign-in stay, so switching it on again is quick) and its tool goes
 async function retire(a){a=baseOf(a);await load();const port=db.ports[a];let stopped=false;
  if(port){const p=(await running()).get(port)||{};if(p.loop||p.app){await as(a,stopLine({home:wsOf(a),port})).catch(e=>log('AdsPower stop '+a+': '+e.message));stopped=true;log('AdsPower stopped for '+a+' (switched off)')}}
  for(const c of await agentNames({copies:true})){if(baseOf(c)!==a)continue;if(!pick(await readConfig(c).catch(()=>null)||{},'mcp_servers.AdsPower'))continue;
   await withAgent(c,()=>mcp(c,'DELETE','/AdsPower')).then(()=>log('AdsPower tool removed from '+c+' (switched off)'),e=>log('AdsPower tool '+c+': '+e.message))}
  const sk=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'skills','web','own-adspower');await rm(sk,{recursive:true,force:true}).catch(()=>{});
  return {stopped}}
 async function ports(){await load();const r=assignPorts(db,await agents());if(r.changed||!db.next){db={off:{},...r.db};await save()}return db.ports}
 const portOf=async a=>(await ports())[baseOf(a)]||null;

 // the app itself, readable by every agent's user: a copy in ~/workspaces (agents pass through it, the rest of the home is
 // closed to them), made again when AdsPower on the box was updated and no copy is running
 // AdsPower on this server at all (the app in ~/apps/adspower, or the agents' copy already made): a fresh install has
 // neither, and then nothing starts, no screen turns on and no agent gets an AdsPower tool (7 Nov 2026, clean-install test)
 const installed=async()=>!!(await stat(path.join(SRC,'resources','app.asar')).catch(()=>null)||await stat(BIN).catch(()=>null));
 async function binReady(){const s=await stat(path.join(SRC,'resources','app.asar')).catch(()=>null);if(!s)return !!await stat(BIN).catch(()=>null);
  const want=s.size+':'+Math.round(s.mtimeMs),have=await readFile(path.join(BIN_DIR,'.version'),'utf8').catch(()=>'');if(have===want)return true;
  if(await stat(BIN).catch(()=>null)&&(await running()).size)return true;   // updated later, when nothing uses it
  const tmp=BIN_DIR+'.tmp';await rm(tmp,{recursive:true,force:true});const c=await run('cp',['-a',SRC,tmp],600000);if(!c.ok)throw Error('Could not copy AdsPower: '+c.err.slice(0,200));
  await run('chmod',['-R','a+rX',tmp]);await writeFile(path.join(tmp,'.version'),want);await rm(BIN_DIR,{recursive:true,force:true});await rename(tmp,BIN_DIR);log('AdsPower copied for the agents ('+want+')');return true}
 // the port shim, built again when its source changed; '' (start without it) when there is no cc or it does not build
 let shimErr='';async function shimReady(){const src=await readFile(SHIM_SRC,'utf8').catch(()=>'');if(!src)return '';const want=String(src.length)+':'+[...src].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
  if(await stat(SHIM).catch(()=>null)&&await readFile(SHIM+'.version','utf8').catch(()=>'')===want)return SHIM;
  const tmp=SHIM+'.tmp',c=await run('cc',['-shared','-fPIC','-O2','-o',tmp,SHIM_SRC,'-ldl'],60000);
  if(!c.ok){const e='AdsPower port shim did not build, copies start without it: '+c.err.trim().split('\n').pop();if(e!==shimErr)log(e);shimErr=e;return await stat(SHIM).catch(()=>null)?SHIM:''}
  await run('chmod',['a+rx',tmp]);await rename(tmp,SHIM);await writeFile(SHIM+'.version',want);shimErr='';log('AdsPower port shim built');return SHIM}

 // ports whose keep-alive loop runs (any user's: /proc shows every command line), and whether the app itself runs
 async function running(){const out=new Map();
  for(const pid of await readdir('/proc').catch(()=>[])){if(!/^\d+$/.test(pid))continue;const c=await readFile('/proc/'+pid+'/cmdline','utf8').catch(()=>'');if(!c.includes('aqeelos-adspower-')&&!c.includes('--api-port='))continue;
   const args=c.split('\0');let m;
   if(args[0]==='bash'&&(m=/^aqeelos-adspower-(\d+)$/.exec(args[args.length-2]||args[args.length-1]||'')))out.set(+m[1],{...out.get(+m[1]),loop:+pid});
   else if(/adspower_global$/.test(args[0])&&!args.some(x=>x.startsWith('--type='))&&(m=/^--api-port=(\d+)$/.exec(args.find(x=>x.startsWith('--api-port='))||'')))out.set(+m[1],{...out.get(+m[1]),app:+pid})}
  return out}

 // signed in: AdsPower opens its Local API only then. Its own answer on /status tells it from the other ports it opens (its start page answers "Forbidden")
 const isApi=port=>fetch('http://127.0.0.1:'+port+'/status',{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).then(j=>j?.code===0,()=>false);
 const uidOf=async u=>{if(!u)return process.getuid();const l=(await readFile('/etc/passwd','utf8').catch(()=>'')).split('\n').find(x=>x.startsWith(u+':'));return l?+l.split(':')[2]:null};
 // the port the agent's copy really has its Local API on, or null (not signed in, or off). Agents with their own user:
 // that user's sockets. The main agent and trusted agents share this user, so a socket counts only when the process holding it
 // has the agent's home or port in its env (this user can read its own processes)
 async function livePort(a){a=baseOf(a);const own=await portOf(a);if(!own)return null;const u=await codeUser(a).catch(()=>null);if(u===null)return null;const uid=await uidOf(u);if(uid==null)return null;
  const rows=[];for(const f of ['/proc/net/tcp','/proc/net/tcp6'])rows.push(...parseListen(await readFile(f,'utf8').catch(()=>'')));
  let mine=()=>true;if(!u){const inodes=new Map(),home=wsOf(a);
   for(const pid of await readdir('/proc').catch(()=>[])){if(!/^\d+$/.test(pid))continue;const env=await readFile('/proc/'+pid+'/environ','utf8').catch(()=>'');if(!env.includes('HOME='+home+'\0')&&!env.includes('AQ_ADSPOWER_PORT='+own+'\0'))continue;
    for(const fd of await readdir('/proc/'+pid+'/fd').catch(()=>[])){const m=/^socket:\[(\d+)\]$/.exec(await readlink('/proc/'+pid+'/fd/'+fd).catch(()=>''));if(m)inodes.set(+m[1],1)}}
   mine=r=>inodes.has(r.inode)}
  for(const p of apiCandidates(rows,{uid,own,mine}))if(await isApi(p))return p;return null}

 // as the agent's own user over SSH, or as this user for the main agent and trusted agents; null = its user is not made yet
 async function as(a,line){const u=await codeUser(a);if(u===null)throw Error(nameOf(a)+'’s own user on the box is not ready yet. Try again in a minute.');
  const r=u?await run('ssh',['-i',KEY,'-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','-p','22',u+'@127.0.0.1',line],60000):await run('bash',['-c',line],60000);
  if(!r.ok)throw Error('Could not reach '+nameOf(a)+'’s user: '+r.err.trim().split('\n').pop());return u}
 // where its screen's DISPLAY lives: the own-user screen's file (in its folder) or the engine screen's
 const envFileOf=async a=>(await codeUser(a))?path.join(wsOf(a),'.screen','env'):path.join(screens.homeOf(a),'bot-desktop','env');

 async function start(a,{why='started'}={}){a=baseOf(a);if(!NAME.test(a))throw Error('Unknown agent');if(!await installed())throw Error('AdsPower is not installed on this server. Install AdsPower for Linux in ~/apps/adspower first.');await binReady();const port=await portOf(a);if(!port)throw Error('This agent gets no AdsPower.');
  // The main agent's screen (and a trusted agent's) is the engine's, started on demand: turned on here first
  if(!await codeUser(a)&&!(await screens.status(a)).running)await screens.start(a);
  const home=wsOf(a);await mkdir(home,{recursive:true}).catch(()=>{});
  await as(a,launchLine({bin:BIN,home,envFile:await envFileOf(a),port,shim:await shimReady()}));
  await load();if(db.off[a]){delete db.off[a];await save()}log('AdsPower '+why+' for '+a+' on port '+port);return status(a)}
 async function stop(a){a=baseOf(a);const port=await portOf(a);if(!port)throw Error('This agent gets no AdsPower.');await load();db.off[a]=true;await save();
  await as(a,stopLine({home:wsOf(a),port}));log('AdsPower stopped for '+a);return status(a)}
 // Running (signed in), Not signed in, Off; for one agent or all
 async function status(a,run_=null){a=baseOf(a);const port=await portOf(a);if(!port)return {agent:a,state:'none'};await load();const p=(run_||await running()).get(port)||{};
  const lp=!p.loop&&!p.app?null:await livePort(a);
  // not on this server at all (neither the app in ~/apps/adspower nor the agents' copy): say so instead of offering Start
  const missing=!p.loop&&!p.app&&!await installed();
  const state=missing?'missing':!p.loop&&!p.app?'off':lp?'running':p.app?'signed-out':'starting';
  return {agent:a,name:nameOf(a),port:lp||port,own:port,state,kept:!db.off[a],user:(await codeUser(a).catch(()=>null))||'this box user'}}
 async function list(){const r=await running();return Promise.all((await agents()).map(a=>status(a,r)))}
 // kept on while it runs: the agent's engine screen is not stopped as idle (screens.mjs asks this, and the activity file is touched)
 let keepSet=new Set(),keepKnown=false;const keepOn=a=>keepSet.has(baseOf(a));

 // the AdsPower tool of every agent (and the main agent's extra numbers) talks to its own copy; through the engine's MCP route
 // (DELETE then POST, one agent at a time) so the running engine picks it up
 async function tools(){if(!await installed())return;const p=await ports(),seen={};
  // its tool talks to the port its copy really listens on (its own one, once the copy runs with the shim)
  for(const a of await agents())if(p[a]){const lp=await livePort(a).catch(()=>null);if(lp&&lp!==p[a])realPort[a]=lp;else delete realPort[a];seen[a]=lp||p[a]}
  await writePorts();
  for(const a of await agentNames({copies:true})){if(!NAME.test(a)||help(baseOf(a)))continue;
   // switched off (a test agent too: 7 Nov 2026, a real agent listed as a test agent kept its copy): its tool goes
   if(!await wanted(baseOf(a))){if(pick(await readConfig(a).catch(()=>null)||{},'mcp_servers.AdsPower'))await withAgent(a,()=>mcp(a,'DELETE','/AdsPower')).then(()=>log('AdsPower tool removed from '+a+' (switched off)'),e=>log('AdsPower tool '+a+': '+e.message));continue}
   if(await skip(a)||!p[baseOf(a)])continue;
   const want={ADSPOWER_PORT:String(seen[baseOf(a)]||p[baseOf(a)]),ADSPOWER_AGENT:baseOf(a),ADSPOWER_NAME:nameOf(baseOf(a))};
   const ok=c=>{const s=pick(c||{},'mcp_servers.AdsPower');return s&&s.command===MCP_SCRIPT&&Object.entries(want).every(([k,v])=>String(s.env?.[k]??'')===v)};
   if(ok(await readConfig(a).catch(()=>null)))continue;
   try{await withAgent(a,async()=>{if(ok(await readConfig(a).catch(()=>null)))return;await mcp(a,'DELETE','/AdsPower');await mcp(a,'POST','',{name:'AdsPower',command:MCP_SCRIPT,env:want})});log('AdsPower tool for '+a+' → port '+want.ADSPOWER_PORT)}
   catch(e){log('AdsPower tool '+a+': '+e.message)}}}

 // the skill: every agent knows it has its own AdsPower on its own screen (written into each agent's skills; the main
 // agent's copy also reaches new agents through the usual skill sharing)
 const SKILL=`---
name: own-adspower
description: "Use for AdsPower: you have your own AdsPower on your own screen; open its profiles with your AdsPower tool."
version: 1.0.0
author: aqeelOS
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [AdsPower, Browser, Profiles, Screen]
---
# Your own AdsPower

You have your own AdsPower app. It runs on your own screen in aqeelOS (the person sees it there as your screen), with
its own data and its own sign-in. No other agent uses it.

- Use your **AdsPower tool** to list, open and close AdsPower profiles. Each profile opens as a browser window on your
  screen, where the person can watch and press **Take over**.
- If the tool says AdsPower **is not signed in yet**, ask the person to open your screen in aqeelOS and sign in to
  AdsPower there themselves. Never ask for the AdsPower email or password in chat, and never type it yourself.
- If the tool says the API key is wrong or missing, ask the person to copy the API key from AdsPower (Automation, then
  API) on your screen and send it to you with the lock button, saved as ADSPOWER_API_KEY.
- Do not start or stop the AdsPower app yourself; aqeelOS keeps it running.
`;
 async function skill(){for(const a of await agentNames()){if(!NAME.test(a)||await skip(a)||!await wanted(a))continue;const d=path.join(a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a),'skills','web','own-adspower'),f=path.join(d,'SKILL.md');
  if((await readFile(f,'utf8').catch(()=>''))===SKILL)continue;await mkdir(d,{recursive:true}).catch(()=>{});await writeFile(f,SKILL).catch(e=>log('AdsPower skill '+a+': '+e.message))}}

 // every minute: each agent's AdsPower runs unless an admin stopped it; the main agent's screen stays on while its AdsPower runs
 let ticking=false;const errs=new Map();   // a failure is logged once, not every minute
 async function tick(){if(ticking)return;if(!await installed())return;ticking=true;try{const r=await running(),keep=new Set();let moved=false;
  for(const a of await agents()){await load();const port=(await ports())[a];if(!port||db.off[a])continue;const p=r.get(port)||{};
   if(!p.loop){const e=await start(a,{why:p.app?'loop started again':'started'}).then(()=>'',e=>e.message);if(e&&errs.get(a)!==e)log('AdsPower '+a+': '+e);errs.set(a,e)}
   // signed in on another port than its tool knows (just signed in, or restarted with the shim): the tools follow
   // (or back to its own port once its copy no longer listens elsewhere)
   const lp=p.app?await livePort(a).catch(()=>null):null;if((lp||port)!==(realPort[a]||port)){if(lp&&lp!==port)realPort[a]=lp;else delete realPort[a];moved=true}
   if(!await codeUser(a).catch(()=>null)){keep.add(a);const t=new Date();await utimes(path.join(screens.homeOf(a),'bot-desktop','activity'),t,t).catch(()=>{})}}
  // a copy still running for an agent switched off (or after the switch was turned off): stopped
  const on=new Set(await agents());for(const [a,port] of Object.entries(db.ports||{})){if(on.has(a)||!NAME.test(a)||help(a))continue;const p=r.get(port)||{};if(p.loop||p.app)await retire(a).catch(()=>{})}
  keepSet=keep;keepKnown=true;if(moved)tools().catch(()=>{})}finally{ticking=false}}
 if(live){setTimeout(()=>{tick().catch(e=>log('AdsPower tick: '+e.message));tools().catch(()=>{});skill().catch(()=>{})},45000).unref?.();
  setInterval(()=>tick().catch(()=>{}),60000).unref();setInterval(()=>{tools().catch(()=>{});skill().catch(()=>{})},600000).unref()}

 // /ui/adspower (all, admins) and /ui/screens/<agent>/adspower[/start|/stop]
 async function handle(req,res,p,send,{admin=false,agent=null}={}){
  if(p==='/ui/adspower'&&req.method==='GET'){if(!admin)return send(res,200,{items:[]});return send(res,200,{items:await list()})}
  const m=/^\/ui\/screens\/([^/]+)\/adspower(?:\/(start|stop))?$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
  const a=baseOf(agent||decodeURIComponent(m[1]));if(!(await agents()).includes(a))return send(res,404,{error:'This agent has no AdsPower.'});
  if(!m[2])return req.method==='GET'?send(res,200,await status(a)):send(res,405,{error:'GET only'});
  if(req.method!=='POST')return send(res,405,{error:'POST only'});if(!admin)return send(res,403,{error:'Only admins can start or stop AdsPower.'});
  try{return send(res,200,m[2]==='start'?await start(a):await stop(a))}catch(e){return send(res,409,{error:e.message})}}
 return {handle,status,list,start,stop,tick,tools,skill,ports,keepOn,keepKnown:()=>keepKnown,retire}}
