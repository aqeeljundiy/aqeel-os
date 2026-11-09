import {readFileSync} from 'node:fs';
// The install's own settings in the app (System › Settings › This install), so nothing needs an env file:
// Your address (checked against this very install), the time zone, the Code and app hosts, whether this copy is live,
// the per-agent Linux users and the Claude sign-in (Models). The values themselves live in install.mjs.
import {spawn} from 'node:child_process';
import {cp,mkdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import * as I from './install.mjs';
export * from './install.mjs';

const json=async(req,readBody,n=8192)=>{try{return JSON.parse(await readBody(req,n))}catch{return {}}};
const run=(cmd,args,opt={})=>new Promise(res=>{let out='';let p;try{p=spawn(cmd,args,{...opt,stdio:['ignore','pipe','pipe']})}catch(e){return res({ok:false,out:e.message})}
 const t=setTimeout(()=>p.kill('SIGKILL'),opt.timeout||600000);p.stdout.on('data',d=>out=(out+d).slice(-4000));p.stderr.on('data',d=>out=(out+d).slice(-4000));
 p.on('error',e=>{clearTimeout(t);res({ok:false,out:e.message})});p.on('close',c=>{clearTimeout(t);res({ok:c===0,out})})});

// listAgents: every agent; setKey(agent,key,value) through the engine's config queue; onTz(zone) after a change;
// hermes(agent,args) the engine CLI (plugins enable); isAdmin(u)
export function createInstallRoutes({recentLookups=async()=>[],send,readBody,isAdmin,listAgents=async()=>[],readConfig=async()=>null,setKey,wait=4000,hermes,claudeOn=async()=>false,engineProbe=async()=>'ok',onTz=()=>{},log=m=>console.log(m),fetchImpl=fetch,runImpl=run,
 claudeBin=process.env.CLAUDE_BIN||path.join(homedir(),'.local','bin','claude'),hermesHome=(process.env.HERMES_HOME||path.join(homedir(),'.hermes')).replace(/^~(?=\/|$)/,homedir())}){
 let claudeJob={state:'idle',steps:[],error:''};
 let tzJob=null;

 async function state(req,u){const s=I.settings(),admin=isAdmin(u),url=I.publicUrl(),from=I.publicUrlFrom();
  const out={address:{url,from,local:I.localAddress(url)},timezone:{zone:I.installTz()||'',box:process.env.TZ||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}};
  if(!admin)return out;
  out.address.suggest=I.originOf(req);out.address.checkedAt=s.publicUrlChecked||0;
  // the first sign-in asks once (the dialog prefilled with the browser's address); Later stops it asking
  // only the live copy asks: test copies (deploy checks) must never get a dialog over the pages they check
  out.address.ask=from==='default'&&!s.addressAsked&&I.isLive();
  out.live={on:I.isLive(),from:I.liveFrom()};
  let au={};try{au=JSON.parse(readFileSync(path.join(I.DATA_DIR,'auto-update.json'),'utf8'))}catch{}
  out.autoUpdate={on:s.autoUpdate!==false,last:au.last||null};
  if(admin)out.supervision={on:s.supervision===true,recent:await recentLookups(10).catch(()=>[])};
  // ok | auth (the engine refuses aqeelOS's keys: it has not restarted since they were written) | down
  out.engine={state:await engineProbe().catch(()=>'down')};
  out.hosts=Object.fromEntries(Object.keys(I.HOSTS).map(k=>[k,{value:I.hostSetting(k),from:I.hostFrom(k),env:I.HOSTS[k][0]}]));
  out.agentUsers=I.agentUsersState();
  out.claude={...I.claudeState({bin:claudeBin,hermesHome}),on:await claudeOn().catch(()=>false),job:claudeJob};
  return out}

 // every agent's engine runs its schedules in its own config's zone: each one gets the install's zone. The app follows at
 // once; the agents' configs are written behind it (an engine write takes seconds each), and the tick fills in new agents.
 async function toAgents(zone,{onlyEmpty=false}={}){const agents=await listAgents().catch(()=>[]);const failed=[];let n=0;
  for(const a of agents){if(onlyEmpty){const c=await readConfig(a).catch(()=>null);if(!c||c.timezone)continue}
   n++;const r=await setKey(a,'timezone',zone).catch(e=>({ok:false,err:e.message}));if(r&&r.ok===false)failed.push(a)}
  if(n)log('time zone: '+zone+' for '+n+' agent(s)'+(failed.length?' (not set for '+failed.join(', ')+')':''));return {agents:n,failed}}
 function setZone(zone){I.saveSettings({timezone:zone});I.applyTz(zone);onTz(zone);
  tzJob=(tzJob||Promise.resolve()).then(()=>toAgents(zone)).catch(()=>{});return tzJob}
 // a new agent starts without a zone of its own: it gets the install's (agents may still change their own later)
 const tick=()=>{const z=I.installTz();if(!z)return Promise.resolve();return tzJob=(tzJob||Promise.resolve()).then(()=>toAgents(z,{onlyEmpty:true})).catch(()=>{})};

 async function installClaude(){claudeJob={state:'running',steps:[],error:'',at:Date.now()};const step=t=>claudeJob.steps.push(t);
  try{
   if(!await stat(claudeBin).catch(()=>null)){step('Installing the Claude app on the server');
    // the official installer puts claude in ~/.local/bin (where aqeelOS and the plugin look for it)
    const r=await runImpl('bash',['-c','curl -fsSL https://claude.ai/install.sh | bash'],{timeout:600000,env:{...process.env,HOME:homedir()}});
    if(!r.ok||!await stat(claudeBin).catch(()=>null))throw Error('The Claude app did not install. '+String(r.out||'').trim().split('\n').slice(-2).join(' '))}
   const dest=path.join(hermesHome,'plugins',I.CLAUDE_PLUGIN);
   if(!await stat(path.join(dest,'plugin.yaml')).catch(()=>null)){step('Adding the Claude sign-in to the engine');
    await mkdir(path.dirname(dest),{recursive:true});await cp(I.shippedPlugin(),dest,{recursive:true})}
   step('Turning it on for the main agent');
   const r=await hermes('default',['plugins','enable',I.CLAUDE_PLUGIN],{timeout:150000,retries:2});
   if(r&&r.ok===false&&!/already/i.test(r.err||r.out||''))throw Error('The engine did not turn the Claude sign-in on: '+String(r.err||r.out||'').slice(0,200));
   claudeJob.state='done';step('Ready. Add a Claude account below.')}
  catch(e){claudeJob.state='failed';claudeJob.error=e.message;log('claude install: '+e.message)}}

 // true when the request was answered
 async function handle(req,res,u,url){const p=url.pathname,M=req.method;
  if(p==='/ui/install'&&M==='GET')return send(res,200,await state(req,u)),true;
  if(!p.startsWith('/ui/install/'))return false;
  if(!isAdmin(u))return send(res,403,{error:'Only admins can change this install.'}),true;
  const b=M==='POST'?await json(req,readBody):{};
  if(p==='/ui/install/check'&&M==='POST')return send(res,200,await I.checkAddress(b.url,{fetchImpl})),true;
  if(p==='/ui/install/address'&&M==='POST'){
   if(I.publicUrlFrom()==='env')return send(res,409,{error:'This install’s address is set in its environment (PUBLIC_URL), so it can’t be changed here.'}),true;
   if(b.later){I.saveSettings({addressAsked:true});return send(res,200,{ok:true}),true}
   let url0;try{url0=I.cleanUrl(b.url)}catch(e){return send(res,400,{error:e.message}),true}
   const c=await I.checkAddress(url0,{fetchImpl});if(!c.ok&&!b.anyway)return send(res,200,{saved:false,check:c}),true;
   I.saveSettings({publicUrl:url0,publicUrlChecked:c.ok?Date.now():'',addressAsked:true});log('your address: '+url0+(c.ok?'':' (saved without a check: '+c.why+')'));
   return send(res,200,{saved:true,url:url0,check:c}),true}
  if(p==='/ui/install/timezone'&&M==='POST'){const z=String(b.zone||'').trim();if(!I.validTz(z))return send(res,400,{error:'Pick a time zone from the list.'}),true;
   const job=setZone(z);const n=(await listAgents().catch(()=>[])).length;
   // a quick engine answers inside the wait; otherwise the agents follow within a minute or two
   const r=await Promise.race([job,new Promise(x=>setTimeout(x,wait,null))]);return send(res,200,{ok:true,zone:z,agents:n,failed:r?.failed||[],pending:!r}),true}
  if(p==='/ui/install/supervision'&&M==='POST'){I.saveSettings({supervision:!!b.on});return send(res,200,{on:!!b.on}),true}
  if(p==='/ui/install/auto-update'&&M==='POST'){I.saveSettings({autoUpdate:!!b.on});return send(res,200,{on:!!b.on}),true}
  if(p==='/ui/install/hosts'&&M==='POST'){const patch={};
   try{for(const k of Object.keys(I.HOSTS))if(k in b){if(I.hostFrom(k)==='env')throw Error(I.HOSTS[k][0]+' is set in this install’s environment, so it can’t be changed here.');patch[k]=I.cleanHost(b[k])}}catch(e){return send(res,400,{error:e.message}),true}
   I.saveSettings(patch);return send(res,200,{ok:true,restart:true}),true}
  if(p==='/ui/install/claude'&&M==='POST'){if(claudeJob.state!=='running')installClaude();return send(res,200,claudeJob),true}
  if(p==='/ui/install/claude'&&M==='GET')return send(res,200,{...I.claudeState({bin:claudeBin,hermesHome}),on:await claudeOn().catch(()=>false),job:claudeJob}),true;
  return send(res,404,{error:'Unknown install setting.'}),true}

 // public, before sign-in: the address check asks this to make sure it reached this very install
 const ping=(req,res)=>send(res,200,{id:I.installId()},{'access-control-allow-origin':'*'});
 return {handle,ping,state,setZone,tick,claudeJob:()=>claudeJob}}
