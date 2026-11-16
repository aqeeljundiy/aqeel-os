// One agent, not the whole engine (owner, 16 Nov 2026: "restarting the whole OS for one agent is stupid ... why not restart the specific
// agent?"). Every agent is served by one engine process, so aqeelOS restarted all of them, cutting every channel for minutes, for a plugin
// switched on for one agent or a channel changed on one. The engine has verbs for a single agent (scripts/engine-agent.py): reload its
// plugins (an enable through the CLI already does this), or unserve and serve it again (its runtime and channels rebuilt in seconds, the
// other agents untouched; proved on aq-livetest: 7.9 s, same engine process). The main agent IS the engine process: for it, and whenever
// the engine does not answer a verb, the old way stays (a full restart, or one queued for the maintenance window).
import {execFile} from 'node:child_process';
import path from 'node:path';

export const isMain=a=>!a||a==='default';
// the CLI's own words after `hermes plugins enable`: the running engine loaded it, no restart needed
export const enableReloaded=out=>/Gateway reloaded plugins/i.test(String(out||''));

export function createAgentReload({python,root,engine,HERMES_HOME,homeOf,restartGateway,restartLater,log=m=>console.log(m),run=null}){
 const call=run||(async args=>{const py=await python();if(!py)return {ok:false,error:'no engine python'};
  return new Promise(res=>execFile(py,[path.join(root,'scripts','engine-agent.py'),engine,...args],{timeout:90000,maxBuffer:1e6,env:{...process.env,HERMES_HOME}},(e,o)=>{
   try{res(JSON.parse(String(o||'').trim().split('\n').pop()))}catch{res({ok:false,error:(e?.message||'no answer').slice(0,200)})}}))});
 // a plugin switched on, updated or shared for these agents: each reloads its own; one that cannot waits for the maintenance window
 async function plugins(agents,why){const left=[],list=[...new Set(agents)];for(const a of list){const r=await call(['reload-plugins',HERMES_HOME,homeOf(a)]).catch(()=>({ok:false}));
   if(r?.ok)log('agent reload: '+a+' reloaded its plugins ('+why+')');else left.push(a)}
  if(left.length)await restartLater?.(why+' (the engine could not reload '+left.join(', ')+' by itself)');return {reloaded:list.filter(a=>!left.includes(a)),left}}
 // one agent's channels or settings changed, or someone asked to restart it: that agent alone; the main agent (the engine itself) restarts all
 // a whole restart is started, not waited for (it waits for replies in progress, up to an hour): the caller answers at once
 async function agent(a,why,{full=false}={}){if(isMain(a)||full){Promise.resolve(restartGateway(why)).catch(()=>{});return {whole:true}}
  const r=await call(['cycle',HERMES_HOME,a]).catch(()=>({ok:false}));
  if(r?.ok){log('agent reload: '+a+' restarted on its own ('+why+')');return {whole:false,agent:a}}
  log('agent reload: '+a+' could not be restarted on its own ('+String(r?.error||'no answer').slice(0,120)+'); restarting the engine');Promise.resolve(restartGateway(why)).catch(()=>{});return {whole:true}}
 return {plugins,agent}}
