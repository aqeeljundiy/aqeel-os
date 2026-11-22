// The engine dashboard's watch, one loop (moved out of server.mjs 23 Nov 2026). The dashboard (settings, channels, sign-ins, dictation, and
// the job delivery every message to the owner goes through) can be killed when the box runs out of memory: when it does not answer twice in
// a row it is started again in its managed session. And every 10 minutes (AU-47, 23 Nov 2026: a dashboard left by a rolled-back engine
// update broke every message to the owner for two days) an engine process on another environment than the one installed is found: a
// dashboard is started again cleanly, a gateway is said on Health (its restarts keep their own windows). stopped: a restore stopped the
// engine on purpose, so nothing is started meanwhile.
import {engineProcs,staleProcs,currentEnv} from './engine-procs.mjs';

export function createDashWatch({DASH,HERMES_HOME,shx,event=async()=>{},log=console,now=()=>Date.now(),procs=engineProcs,kill=(pid,sig)=>process.kill(pid,sig),wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let missing=0,restarted=0,tries=0,ticks=0,gwNoted=0;const w={stopped:false};
 const restart=async why=>{restarted=now();log.warn('dashboard watch: '+why);await shx('tmux kill-session -t dashboard 2>/dev/null; ~/services.sh >/dev/null 2>&1')};
 async function envCheck(){const cur=await currentEnv(HERMES_HOME);const stale=staleProcs(await procs(),cur);if(!stale.length)return;
  const dash=stale.filter(p=>p.kind==='dashboard');
  if(dash.length){for(const p of dash){try{kill(p.pid,'SIGTERM')}catch{}}await wait(5000);
   await restart('the dashboard ran an old environment ('+dash.map(p=>p.pid+' on '+p.env.slice(0,8)).join(', ')+', installed '+String(cur).slice(0,8)+'); starting it again');
   await event('The engine dashboard was on an old version and was started again','It was left running from an engine update or rollback ('+dash[0].env.slice(0,8)+' instead of '+String(cur).slice(0,8)+'). Messages to you go through it.',{info:true,topic:'engine-env-dashboard'}).catch(()=>{})}
  const gw=stale.filter(p=>p.kind==='gateway');
  if(gw.length&&now()-gwNoted>6*3600e3){gwNoted=now();log.warn('engine processes: the gateway runs an old environment',gw.map(p=>p.pid).join(', '));
   await event('The engine runs an older version than the one installed','The gateway still runs '+gw[0].env.slice(0,8)+' (installed: '+String(cur).slice(0,8)+'). The next engine restart in the quiet hours fixes it.',{topic:'engine-env-gateway'}).catch(()=>{})}}
 // one minute's look: answering at all, and every tenth minute the environments
 w.tick=async()=>{if(w.stopped)return;
  const ok=await fetch(DASH.origin+'/api/status',{signal:AbortSignal.timeout(8000)}).then(r=>r.status<500,()=>false);
  if(!ok){if(now()-restarted<Math.min(60,5*2**tries)*60e3)return;if(++missing<2)return;missing=0;tries++;return restart('the dashboard stopped answering; starting it again')}
  missing=0;tries=0;if(++ticks%10)return;try{await envCheck()}catch(e){log.warn('engine processes',e.message)}};
 w.envCheck=envCheck;return w}
