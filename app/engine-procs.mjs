// Engine processes on an old environment (AU-47, 23 Nov 2026). Elkiya's engine update to v0.23.3 started a dashboard at 16:33, failed,
// and rolled back to v0.22.5; that dashboard kept running, orphaned, on the v0.23.3 environment against the rolled-back code. aqeelOS
// sends to the owner through the dashboard's job delivery, so for two days every alert failed ("No module named gateway.outbound.send").
// This reads which environment each engine process loaded (its memory map names installs/<id>/environments/<env>) and compares it with
// the one the engine is set to now (installs/<id>/facts.json). Linux only; elsewhere it finds nothing.
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';

const ENV_RE=/installs\/[0-9a-f]+\/environments\/([0-9a-f]{16,64})/;
// what an engine process is, from its command line: the dashboard or the gateway (null: not one we watch)
export function kindOf(cmd){const c=String(cmd||'');if(!/hermes/.test(c))return null;if(/\bdashboard\b/.test(c))return 'dashboard';if(/\bgateway run\b/.test(c))return 'gateway';return null}
// the processes that run another environment than the current one: [{pid, kind, env}]
export function staleProcs(procs,current){if(!current)return [];return (procs||[]).filter(p=>p.kind&&p.env&&p.env!==current)}
// the environment the engine is set to now
export async function currentEnv(HERMES_HOME){for(const d of await readdir(path.join(HERMES_HOME,'installs')).catch(()=>[])){
  try{const f=JSON.parse(await readFile(path.join(HERMES_HOME,'installs',d,'facts.json'),'utf8'));const e=String(f?.packages?.venv?.environment||'');const m=/environments\/([0-9a-f]{16,64})/.exec(e);if(m)return m[1]}catch{}}
 return null}
// the engine's dashboard and gateway processes with the environment each loaded
export async function engineProcs({proc='/proc'}={}){const out=[];
 for(const pid of await readdir(proc).catch(()=>[])){if(!/^\d+$/.test(pid))continue;
  const cmd=(await readFile(path.join(proc,pid,'cmdline'),'latin1').catch(()=>'')).split('\0').join(' ');const kind=kindOf(cmd);if(!kind)continue;
  const maps=await readFile(path.join(proc,pid,'maps'),'latin1').catch(()=>'');const env=(ENV_RE.exec(maps)||[])[1]||null;if(!env)continue;   // the bash wrapper loads none
  out.push({pid:Number(pid),kind,env})}
 return out}
