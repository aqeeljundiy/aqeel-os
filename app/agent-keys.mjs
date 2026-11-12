// Keys aqeelOS uses FOR an agent, kept where the agent cannot read them (audit 12 Nov 2026, H3).
// The Kirimdev, Tripay and Xendit keys sat in each support agent's own folder (workspaces/<agent>/.secrets), the same keys for both
// brands. Any command such an agent ran (a team chat, a self-run, a health self-fix) could message either brand's customers or make
// charges, past the mode, the testers, the pause, the exit guard and the brand rule. Now these keys live in DATA/agent-keys/<agent>/<NAME>
// (folder 700, files 600, the app's own user; agents' Linux users cannot enter DATA). The app makes the calls itself:
// payments in payment-providers.mjs, the member app and the store in protocol-pdf.mjs and customer-tools.mjs, and what an agent's own
// scripts still need goes through the signed local route in agent-ops.mjs, with the guards applied.
// Until scripts/migrate-agent-keys.mjs has moved a key, it is still read from the workspace (and said so once in the log), so a deploy
// of this code changes nothing by itself.
import {readFile,writeFile,rename,mkdir,readdir,stat} from 'node:fs/promises';
import path from 'node:path';

export const KEY_NAME=/^[A-Z][A-Z0-9_]{2,60}$/,AGENT_NAME=/^[a-z0-9][a-z0-9_-]{0,63}$/;
// the keys that reach customers or money: these are the ones the migration moves
export const MOVED=['KIRIMDEV_API_KEY','TRIPAY_API_KEY','TRIPAY_PRIVATE_KEY','XENDIT_SECRET_KEY','XENDIT_CALLBACK_TOKEN'];
export function createAgentKeys({DATA,WORK,log=m=>console.log(m)}){const DIR=path.join(DATA,'agent-keys'),said=new Set();
 const ok=(agent,name)=>AGENT_NAME.test(String(agent||''))&&KEY_NAME.test(String(name||''));
 const read=async f=>(await readFile(f,'utf8').catch(()=>'')).trim();
 // where a key is: 'app' (out of the agent's reach), 'workspace' (still in its folder), or null
 async function where(agent,name){if(!ok(agent,name))return null;if(await read(path.join(DIR,agent,name)))return 'app';return await read(path.join(WORK,agent,'.secrets',name))?'workspace':null}
 async function get(agent,name){if(!ok(agent,name))return '';const a=String(agent).split('--')[0];const v=await read(path.join(DIR,a,name));if(v)return v;
  const w=await read(path.join(WORK,a,'.secrets',name));if(w&&MOVED.includes(name)&&!said.has(a+'|'+name)){said.add(a+'|'+name);log('agent keys: '+name+' of '+a+' is still in its workspace, where the agent can read it (run scripts/migrate-agent-keys.mjs)')}return w}
 async function set(agent,name,value){if(!ok(agent,name))throw Error('A key needs an agent and a NAME in capitals.');const v=String(value||'').trim();if(!v)throw Error('The key is empty.');
  const d=path.join(DIR,agent);await mkdir(d,{recursive:true,mode:0o700});const t=path.join(d,'.'+name+'.'+process.pid+'.tmp');await writeFile(t,v+'\n',{mode:0o600});await rename(t,path.join(d,name));return true}
 async function list(agent){return (await readdir(path.join(DIR,String(agent))).catch(()=>[])).filter(n=>KEY_NAME.test(n)).sort()}
 // for System › Health: the moved keys an agent can still read in its own folder
 async function exposed(agents){const out=[];for(const a of agents||[])for(const n of MOVED)if(await stat(path.join(WORK,a,'.secrets',n)).catch(()=>null))out.push({agent:a,name:n});return out}
 return {get,set,where,list,exposed,dir:DIR}}
