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

const HOME=homedir();
const HERMES=process.env.HERMES_BIN||path.join(HOME,'.local','bin','hermes');
const HERMES_HOME=process.env.HERMES_HOME||path.join(HOME,'.hermes');
const AGENT_SRC=path.join(HERMES_HOME,'hermes-agent');
const WORKSPACES=path.join(HOME,'workspaces');
const SHARED={port:6080};                 // noVNC for the :99 screen (AdsPower)
const NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const run=(cmd,args,env={},timeout=60000)=>new Promise(res=>execFile(cmd,args,{env:{...process.env,...env},timeout,maxBuffer:4e6,cwd:HOME},(err,stdout,stderr)=>res({ok:!err,out:String(stdout||''),err:String(stderr||err?.message||'')})));

export function createScreens(){
 const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const sockOf=a=>path.join(homeOf(a),'bot-desktop','rfb.sock');
 async function agents(){const l=['default'];try{for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}))if(d.isDirectory()&&NAME.test(d.name))l.push(d.name)}catch{}return l}
 async function valid(a){if(!NAME.test(a||''))return false;try{return (await stat(homeOf(a))).isDirectory()}catch{return false}}
 const config=a=>readFile(path.join(homeOf(a),'config.yaml'),'utf8').catch(()=>'');
 const shared=async a=>/cdp_url:\s*['"]?http:\/\/127\.0\.0\.1:9333/.test(await config(a));
 // Running = the launcher process is alive and the socket exists. Never probe the socket itself: Xvnc counts
 // every connect-and-close as a failed login and soon blacklists the screen for all viewers.
 async function alive(a){try{const pid=parseInt(await readFile(path.join(homeOf(a),'bot-desktop','launcher.pid'),'utf8'));if(!pid)return false;process.kill(pid,0);await stat(sockOf(a));return true}catch{return false}}

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
  return {agent:a,kind:'desktop',running,idle_minutes:running?idle:null}}

 // Every agent: its screen starts itself when it browses and stops after 15 idle minutes, and its
 // terminal starts in its own folder (~/workspaces/<agent>). Only fills in what is not set yet.
 const busy=new Map();
 const ensure=a=>{if(!busy.has(a))busy.set(a,ensureNow(a).finally(()=>busy.delete(a)));return busy.get(a)};
 async function ensureNow(a){
  const c=await config(a);const set=(k,v)=>run(HERMES,['-p',a,'config','set',k,String(v)]);
  if(!/^bot_desktop:/m.test(c)){await set('bot_desktop.auto_start','true');await set('bot_desktop.idle_stop_minutes','15')}
  const dir=path.join(WORKSPACES,a);await mkdir(dir,{recursive:true}).catch(()=>{});
  const cwd=(/^terminal:[\s\S]*?\n\s+cwd:\s*['"]?([^'"\n#]+)/m.exec(c)||[])[1]?.trim();
  if(!cwd||cwd==='.'||(cwd.startsWith(WORKSPACES+'/')&&cwd!==dir))await set('terminal.cwd',dir)}  // a clone keeps the source's folder otherwise
 const ensureAll=async()=>{for(const a of await agents())await ensure(a).catch(()=>{})};

 /* ---------- viewer bridge: one websockify per agent screen, stopped when nobody watches ---------- */
 const bridges=new Map();let nextPort=6101;
 async function bridge(a){
  let b=bridges.get(a);if(b&&b.proc.exitCode===null)return b;
  const port=nextPort++;if(nextPort>6199)nextPort=6101;
  const proc=spawn('websockify',[`127.0.0.1:${port}`,`--unix-target=${sockOf(a)}`],{stdio:'ignore'});proc.on('error',()=>{});
  b={port,proc,viewers:0,timer:null};bridges.set(a,b);proc.on('exit',()=>{if(bridges.get(a)===b)bridges.delete(a)});
  for(let i=0;i<30;i++){if(await new Promise(res=>{const c=connect(port,'127.0.0.1');c.once('connect',()=>{c.destroy();res(true)});c.once('error',()=>res(false))}))break;await new Promise(r=>setTimeout(r,100))}
  return b}
 // Pipes an upgraded viewer socket to the right screen. Watching counts as using the screen, so it
 // is not stopped as idle while someone has it open.
 async function upgrade(req,sock,headBuf,agent){
  let port=SHARED.port,b=null;
  if(agent&&await valid(agent)&&!await shared(agent)&&await desktopsReady()){if(!await alive(agent)){sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return}b=await bridge(agent);port=b.port;b.viewers++;clearTimeout(b.timer)}
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

 async function handle(req,res,p,send){
  if(p==='/ui/screens'&&req.method==='GET'){await ensureAll();return send(res,200,{screens:await Promise.all((await agents()).map(status))})}
  const m=/^\/ui\/screens\/([^/]+)(?:\/(start|stop))?$/.exec(p);if(!m)return send(res,404,{error:'Not found'});
  const a=decodeURIComponent(m[1]);if(!await valid(a))return send(res,404,{error:'Unknown agent'});
  ensure(a).catch(()=>{});
  if(!m[2]&&req.method==='GET')return send(res,200,await status(a));
  if(req.method!=='POST'||await shared(a))return send(res,400,{error:'This agent uses the shared screen.'});
  try{const r=await runtime(a,m[2]==='start'?'start()':'stop()');
   if(m[2]==='start'&&r&&r.running===false)return send(res,409,{error:r.blocker||('Missing on the box: '+(r.missing||[]).join(', '))});
   return send(res,200,await status(a))}catch(e){return send(res,500,{error:e.message})}}

 // Idle stop. Hermes' own watcher only runs inside its desktop app's backend, which this box doesn't run,
 // so aqeelOS does it: a screen nobody used (agent browsing or a viewer watching) for
 // bot_desktop.idle_stop_minutes is turned off. Hermes turns it back on the next time the agent browses.
 async function reap(){
  for(const a of await agents()){
   if(!await alive(a)||await shared(a)||(bridges.get(a)?.viewers>0))continue;
   const mins=Number((/^bot_desktop:[\s\S]*?\n\s+idle_stop_minutes:\s*([\d.]+)/m.exec(await config(a))||[])[1]??15);if(!(mins>0))continue;
   let last=0;for(const f of ['activity','env'])try{last=Math.max(last,(await stat(path.join(homeOf(a),'bot-desktop',f))).mtimeMs)}catch{}
   if(last&&Date.now()-last>mins*60000)await runtime(a,'stop_if_idle()').catch(()=>{})}}
 setInterval(()=>reap().catch(()=>{}),60000).unref();
 setTimeout(()=>ensureAll().catch(()=>{}),5000);
 return {handle,upgrade,status,displayEnv,homeOf,valid,shared};
}
