// One screen per agent. Each Hermes agent (profile) gets its own "Bot Desktop": a virtual display that
// Hermes starts the first time the agent opens a browser and stops again after it sits idle.
// Agents that browse through AdsPower (browser.cdp_url → the bridge on :9333) stay on the shared :99 screen.
// This module reports each agent's screen, starts/stops it on request, keeps every agent's settings right,
// and bridges the viewer's WebSocket to the right screen (websockify on its private Unix socket).
import {spawn,execFile} from 'node:child_process';
import {readFile,readdir,mkdir,stat,utimes} from 'node:fs/promises';
import {connect} from 'node:net';
import {homedir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {setKey,agentNames,LIVE_APP} from './agentops.mjs';

const HOME=homedir();
const HERMES_HOME=process.env.HERMES_HOME||path.join(HOME,'.hermes');
const AGENT_SRC=path.join(HERMES_HOME,'hermes-agent');
const WORKSPACES=path.join(HOME,'workspaces');
const SHARED={port:6080};                 // noVNC for the :99 screen (AdsPower)
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const run=(cmd,args,env={},timeout=60000)=>new Promise(res=>execFile(cmd,args,{env:{...process.env,...env},timeout,maxBuffer:4e6,cwd:HOME},(err,stdout,stderr)=>res({ok:!err,out:String(stdout||''),err:String(stderr||err?.message||'')})));

export function createScreens({keepOn=()=>false}={}){   // keepOn(agent): something runs on its screen (its own AdsPower), so it is never stopped as idle
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const sockOf=a=>path.join(homeOf(a),'bot-desktop','rfb.sock');
 const agents=async()=>(await agentNames()).filter(n=>NAME.test(n));
 async function valid(a){if(!NAME.test(a||''))return false;try{return (await stat(homeOf(a))).isDirectory()}catch{return false}}
 const config=a=>readFile(path.join(homeOf(a),'config.yaml'),'utf8').catch(()=>'');
 const shared=async a=>/cdp_url:\s*['"]?http:\/\/127\.0\.0\.1:9333/.test(await config(a));
 // an agent with its own Linux user: the box's root startup keeps its screen running (aqeelOS only watches it)
 const ownUser=async a=>/ssh_user:\s*['"]?ag-/.test(await config(a));
 // Running = the launcher process is alive and the socket exists. Never probe the socket itself: Xvnc counts
 // every connect-and-close as a failed login and soon blacklists the screen for all viewers.
 // an agent with its own Linux user runs its screen as that user: asking about its process then says "not yours" (EPERM), which still means it runs
 async function alive(a){try{const pid=parseInt(await readFile(path.join(homeOf(a),'bot-desktop','launcher.pid'),'utf8'));if(!pid)return false;try{process.kill(pid,0)}catch(e){if(e.code!=='EPERM')return false}await stat(sockOf(a));return true}catch{return false}}

 // Hermes' own Python (the gateway's venv), found from the running gateway so a Hermes update keeps working.
 let py=null;
 async function python(){
  if(py)return py;
  try{for(const pid of await readdir('/proc')){if(!/^\d+$/.test(pid))continue;const maps=await readFile(`/proc/${pid}/maps`,'utf8').catch(()=>'');const m=/\/\S+\/venv\/lib\/python[\d.]+\/site-packages/.exec(maps);if(m&&m[0].startsWith(HERMES_HOME)){py=m[0].replace(/\/lib\/python[\d.]+\/site-packages$/,'/bin/python');return py}}}catch{}
  return null}
 async function runtime(a,call){
  const bin=await python();if(!bin)throw new Error('The aqeelOS engine is not running on the box.');
  const code=`import sys,json,dataclasses;sys.path.insert(0,${JSON.stringify(AGENT_SRC)})\nfrom tools.bot_desktop import runtime\nr=runtime.${call}\nprint(json.dumps(dataclasses.asdict(r) if dataclasses.is_dataclass(r) else r))`;
  const r=await run(bin,['-c',code],{HERMES_HOME:homeOf(a)},60000);
  const last=r.out.trim().split('\n').pop();try{return JSON.parse(last)}catch{throw new Error((r.err.trim().split('\n').pop())||'The screen did not respond.')}}

 // Until the desktop packages are on the box (Xvnc + Xfce), every agent stays on the shared screen.
 let pk={t:0,ok:false};
 async function desktopsReady(){if(Date.now()-pk.t<60000)return pk.ok;const r=await run('sh',['-c','command -v Xvnc && command -v xfwm4 && command -v xfdesktop'],{},5000);pk={t:Date.now(),ok:r.ok};return pk.ok}
 async function status(a){
  if(await shared(a))return {agent:a,kind:'shared',running:true,note:'Browses through AdsPower on the shared screen.'};
  if(!await desktopsReady())return {agent:a,kind:'shared',running:true,note:'Own screens need the desktop packages on the box.'};
  const running=await alive(a);let idle=null;
  try{idle=Math.round((Date.now()-(await stat(path.join(homeOf(a),'bot-desktop','activity'))).mtimeMs)/60000)}catch{}
  return {agent:a,kind:'desktop',running,idle_minutes:running?idle:null,...(await ownUser(a)?{managed:true,note:'Always on: it runs as this agent’s own user.'}:{})}}

 // Every agent: its screen starts itself when it browses and stops after 15 idle minutes, and its
 // terminal starts in its own folder (~/workspaces/<agent>). Only fills in what is not set yet.
 const busy=new Map();
 const ensure=a=>{if(!busy.has(a))busy.set(a,ensureNow(a).finally(()=>busy.delete(a)));return busy.get(a)};
 async function ensureNow(a){
  const c=await config(a);if(!c)return;const set=async(k,v)=>{const r=await setKey(a,k,String(v));if(!r.ok)throw new Error(k+': '+r.err)};
  if(!/^bot_desktop:/m.test(c)){await set('bot_desktop.auto_start','true');await set('bot_desktop.idle_stop_minutes','15')}
  const dir=path.join(WORKSPACES,a);await mkdir(dir,{recursive:true}).catch(()=>{});
  const cwd=(/^terminal:[\s\S]*?\n\s+cwd:\s*['"]?([^'"\n#]+)/m.exec(c)||[])[1]?.trim();
  if(!cwd||cwd==='.'||(cwd.startsWith(WORKSPACES+'/')&&cwd!==dir))await set('terminal.cwd',dir)}  // a clone keeps the source's folder otherwise
 const ensureAll=async()=>{for(const a of await agents())await ensure(a).catch(()=>{})};

 /* ---------- viewer bridge: one websockify per agent screen, stopped when nobody watches ---------- */
 const bridges=new Map();
 // a port nothing listens on (an old viewer left by an earlier app run could still hold one and show the wrong screen)
 const freePort=()=>new Promise((res,rej)=>{const srv=createServer();srv.once('error',rej);srv.listen(0,'127.0.0.1',()=>{const {port}=srv.address();srv.close(()=>res(port))})});
 const killAll=()=>{for(const b of bridges.values())try{b.proc.kill()}catch{}};
 for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{killAll();process.exit(0)});process.once('exit',killAll);   // a hang-up kills without this; the next start stops what it left
 async function bridge(a){
  let b=bridges.get(a);if(b&&b.proc.exitCode===null)return b;
  const port=await freePort();
  const proc=spawn('websockify',[`127.0.0.1:${port}`,`--unix-target=${sockOf(a)}`],{stdio:'ignore'});proc.on('error',()=>{});
  b={port,proc,viewers:0,timer:null};bridges.set(a,b);proc.on('exit',()=>{if(bridges.get(a)===b)bridges.delete(a)});
  for(let i=0;i<30;i++){if(proc.exitCode!==null)break;if(await new Promise(res=>{const c=connect(port,'127.0.0.1');c.once('connect',()=>{c.destroy();res(true)});c.once('error',()=>res(false))}))break;await new Promise(r=>setTimeout(r,100))}
  if(proc.exitCode!==null)throw new Error('The screen viewer could not start.');
  return b}
 // Pipes an upgraded viewer socket to the right screen. Watching counts as using the screen, so it
 // is not stopped as idle while someone has it open.
 async function upgrade(req,sock,headBuf,agent,isAdmin=false){
  let port=SHARED.port,b=null;
  if(agent&&await valid(agent)&&!await shared(agent)&&await desktopsReady()){if(!await alive(agent)){sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return}b=await bridge(agent);port=b.port;b.viewers++;clearTimeout(b.timer)}
  // the shared screen (AdsPower, and agents that use it) is for admins only, whichever agent was asked for
  if(port===SHARED.port&&!isAdmin){sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');return}
  const act=path.join(homeOf(agent||'default'),'bot-desktop','activity');
  const touch=b?setInterval(()=>{const t=new Date();utimes(act,t,t).catch(()=>{})},60000):null;
  const up=connect(port,'127.0.0.1',()=>{
   const lines=['GET /websockify HTTP/1.1',`Host: 127.0.0.1:${port}`];for(const [k,v] of Object.entries(req.headers))if(!['host','cookie','origin'].includes(k))lines.push(`${k}: ${v}`);
   up.write(lines.join('\r\n')+'\r\n\r\n');if(headBuf?.length)up.write(headBuf);sock.pipe(up);up.pipe(sock)});
  let done=false;const end=()=>{if(done)return;done=true;sock.destroy();up.destroy();clearInterval(touch);
   if(b){b.viewers--;if(b.viewers<=0)b.timer=setTimeout(()=>{if(b.viewers<=0)b.proc.kill()},60000)}};
  up.on('error',end);sock.on('error',end);up.on('close',end);sock.on('close',end)}

 // DISPLAY etc. of a running agent screen, so a spare browser window can open on it.
 async function displayEnv(a){const t=await readFile(path.join(homeOf(a),'bot-desktop','env'),'utf8').catch(()=>'');const e={};for(const l of t.split('\n')){const m=/^(?:export\s+)?([A-Z_]+)=['"]?(.*?)['"]?$/.exec(l.trim());if(m)e[m[1]]=m[2]}return e}

 // A secret goes only into a sign-in field: a password, user name, email or code box on a page. Never a search box,
 // the address bar or any other field (21 Oct 2026: a password typed while a Google search box had focus became a search).
 // Agents with their own Chrome are checked through it; otherwise the window's title is the (weaker) check.
 const SIGNIN=/pass|user|login|log-in|sign.?in|email|e-mail|account|otp|one.?time|code|pin|phone|auth|2fa|verif|token|secret/i;
 async function focusedField(a){const port=(/cdp_url:\s*['"]?http:\/\/127\.0\.0\.1:(\d+)/.exec(await config(a))||[])[1];if(!port||port==='9333')return null;
  const pages=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).catch(()=>null);if(!Array.isArray(pages))return null;
  const probe=`(()=>{if(!document.hasFocus())return null;let e=document.activeElement;while(e&&e.shadowRoot&&e.shadowRoot.activeElement)e=e.shadowRoot.activeElement;
   if(!e||e===document.body||e===document.documentElement)return {kind:'none',url:location.host};const at=k=>String(e.getAttribute&&e.getAttribute(k)||'');
   return {kind:e.tagName.toLowerCase(),type:String(e.type||'').toLowerCase(),role:at('role').toLowerCase(),words:[e.name,e.id,at('autocomplete'),at('placeholder'),at('aria-label'),at('inputmode')].join(' '),url:location.host}})()`;
  for(const p of pages.filter(p=>p.type==='page'&&p.webSocketDebuggerUrl)){const r=await new Promise(res=>{let ws;const done=v=>{try{ws.close()}catch{}res(v)};const t=setTimeout(()=>done(null),3000);
    try{ws=new WebSocket(p.webSocketDebuggerUrl);ws.onerror=()=>{clearTimeout(t);done(null)};ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:probe,returnByValue:true}}));
     ws.onmessage=m=>{const j=JSON.parse(m.data);if(j.id===1){clearTimeout(t);done(j.result?.result?.value??null)}}}catch{clearTimeout(t);done(null)}});
   if(r)return r}
  return {kind:'none'}}
 async function secretFieldOk(a,env){const f=await focusedField(a);
  if(f){if(f.kind==='none')throw new Error('No sign-in field has focus on the screen (the address bar, another window or nothing is focused). Click the password or user name box on the sign-in page, then try again. Nothing was typed.');
   const search=f.type==='search'||/search|combobox/.test(f.role)||/(^|\s)(q|query|search)(\s|$)/i.test(f.words);
   const ok=f.kind==='input'&&!search&&(f.type==='password'||['email','tel','number','text',''].includes(f.type)&&SIGNIN.test(f.words));
   if(!ok)throw new Error('The focused box on '+(f.url||'the page')+' is not a sign-in field'+(search?' (it is a search box)':'')+'. Click the password or user name box, then try again. Nothing was typed.');return}
  const w=await run('xdotool',['getactivewindow','getwindowname'],env,5000);const name=String(w.out||'').trim();
  if(/search|google search|bing|duckduckgo|new tab|youtube/i.test(name)&&!/sign.?in|log.?in|account/i.test(name))throw new Error('The window in front ("'+name.slice(0,60)+'") looks like a search page, not a sign-in page. Open the sign-in page and click its password box, then try again. Nothing was typed.')}
 // Typing into a screen: text from the person goes straight to the focused field there. Never logged.
 async function typeInto(a,text,{enter=false,ads=false,secret=false}={}){
  const onShared=ads||await shared(a)||!await desktopsReady();const env=onShared?{DISPLAY:':99'}:await displayEnv(a);
  if(secret)await secretFieldOk(a,env);
  if(!onShared&&!await alive(a))throw new Error('This agent’s screen is not running. Open it (or let the agent open its browser) first.');
  if(!env.DISPLAY)throw new Error('The screen is not running.');
  const r=await run('xdotool',['type','--clearmodifiers','--delay','12','--',String(text)],env,90000);if(!r.ok)throw new Error('Could not type into the screen.');
  if(enter)await run('xdotool',['key','--clearmodifiers','Return'],env,10000);
  if(!onShared){const t=new Date();await utimes(path.join(homeOf(a),'bot-desktop','activity'),t,t).catch(()=>{})}
  return true}
 const readJson=req=>new Promise(ok=>{let d='';req.on('data',c=>{d+=c;if(d.length>40000)req.destroy()});req.on('end',()=>{try{ok(JSON.parse(d||'{}'))}catch{ok({})}});req.on('error',()=>ok({}))});
 async function handle(req,res,p,send){
  if(p==='/ui/screens'&&req.method==='GET'){await ensureAll();return send(res,200,{screens:await Promise.all((await agents()).map(status))})}
  const m=/^\/ui\/screens\/([^/]+)(?:\/(start|stop|type))?$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
  const a=decodeURIComponent(m[1]);if(!await valid(a))return send(res,404,{error:'Unknown agent'});
  ensure(a).catch(()=>{});
  if(!m[2]&&req.method==='GET')return send(res,200,await status(a));
  if(m[2]==='type'){if(req.method!=='POST')return send(res,405,{error:'POST only'});const b=await readJson(req);const text=String(b.text||'');if(!text||text.length>8000)return send(res,400,{error:'Nothing to type.'});
   try{await typeInto(a,text,{enter:!!b.enter,ads:new URL(req.url,'http://x').searchParams.get('screen')==='ads'});return send(res,200,{ok:true,chars:text.length})}catch(e){return send(res,409,{error:e.message})}}
  if(req.method!=='POST'||await shared(a))return send(res,400,{error:'This agent uses the shared screen.'});
  if(await ownUser(a))return send(res,200,await status(a));
  try{const r=await runtime(a,m[2]==='start'?'start()':'stop()');
   if(m[2]==='start'&&r&&r.running===false)return send(res,409,{error:r.blocker||('Missing on the box: '+(r.missing||[]).join(', '))});
   return send(res,200,await status(a))}catch(e){return send(res,500,{error:e.message})}}

 // Idle stop. Hermes' own watcher only runs inside its desktop app's backend, which this box doesn't run,
 // so aqeelOS does it: a screen nobody used (agent browsing or a viewer watching) for
 // bot_desktop.idle_stop_minutes is turned off. Hermes turns it back on the next time the agent browses.
 async function reap(){
  for(const a of await agents()){
   if(!await alive(a)||await shared(a)||await ownUser(a)||(bridges.get(a)?.viewers>0)||keepOn(a))continue;
   const mins=Number((/^bot_desktop:[\s\S]*?\n\s+idle_stop_minutes:\s*([\d.]+)/m.exec(await config(a))||[])[1]??15);if(!(mins>0))continue;
   let last=0;for(const f of ['activity','env'])try{last=Math.max(last,(await stat(path.join(homeOf(a),'bot-desktop',f))).mtimeMs)}catch{}
   if(last&&Date.now()-last>mins*60000)await runtime(a,'stop_if_idle()').catch(()=>{})}}
 if(LIVE_APP){setInterval(()=>reap().catch(()=>{}),60000).unref();setTimeout(()=>ensureAll().catch(()=>{}),5000)}
 // viewers left running by an earlier run of the app (their parent is gone) are stopped
 if(LIVE_APP)run('bash',['-c',"ps -eo pid=,ppid=,args= | awk '$2==1 && /websockify 127.0.0.1:61[0-9][0-9] --unix-target=/ {print $1}' | xargs -r kill"],{},10000).catch(()=>{});
 // turns an engine screen on (an agent's own AdsPower needs it); an own-user agent's screen is kept on by the box itself
 async function start(a){if(await shared(a)||await ownUser(a)||await alive(a))return status(a);const r=await runtime(a,'start()');if(r&&r.running===false)throw new Error(r.blocker||('Missing on the box: '+(r.missing||[]).join(', ')));return status(a)}
 return {handle,upgrade,status,displayEnv,homeOf,valid,shared,ensure,typeInto,start,alive};
}
