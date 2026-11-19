// Terminal self-check (SV-1, EN-16, 19 Nov 2026). An agent that runs as its own Linux user reaches its terminal over SSH (ag-<agent>@127.0.0.1,
// the engine's ssh backend). On 19 Nov the box container restarted and the root script (scripts/agent-users.sh) read /root as the box
// user's home, so every ag-* user was gone: for over two hours every terminal call, schedule script and order entry failed with
// "Permission denied (publickey)", the agents filed a dozen reports each and nobody was told it was one fault with one fix.
// Now, every 5 minutes, aqeelOS itself logs in to each such agent's terminal (`true`, nothing else) with the agent's own key:
//  - all fine: an agent that failed before has its Health item cleared, and any open report of the agent's own saying its terminal
//    is refused is closed (also the ones left from before this check ran);
//  - a first failure: the root script is asked to make the users and keys again (the users list is touched: its watcher runs once()
//    when the file changes), at most once in 30 minutes, and the next round checks again;
//  - still failing on the next round, or the root script is not running (its .alive beat is over 3 minutes old): one Health item per
//    agent with what failed and the one step that fixes it.
// The parts that decide are exported and tested in scripts/terminal-check.test.mjs; the SSH login is passed in (probe).
import {readFile,stat,utimes} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';

const EVERY=5*60e3,REPAIR_GAP=30*60e3,ALIVE_MAX=3*60e3;
// an agent's own report about its terminal not logging in (closed once the check logs in): "publickey", or ssh/terminal near refused/denied/fails
export const REFUSED=/publickey|\b(ssh|terminal)\b[^.\n]{0,80}\b(permission denied|refused|rejected|fails?|failed|down)\b/i;
// the ssh terminal of an agent from its config.yaml text: {user, host, port, key}, or null when its terminal is not ssh
export function sshTerminal(yaml){const m=/^terminal:[ \t]*\n((?:[ \t]+[^\n]*\n?)*)/m.exec(String(yaml||''));if(!m)return null;
 const v=k=>{const x=new RegExp('^[ \\t]+'+k+':[ \\t]*["\']?([^"\'\\n#]*?)["\']?[ \\t]*(#[^\\n]*)?$','m').exec(m[1]);return x?x[1].trim():''};
 if(v('backend')!=='ssh'||!v('ssh_user'))return null;return {user:v('ssh_user'),host:v('ssh_host')||'127.0.0.1',port:Number(v('ssh_port'))||22,key:v('ssh_key')}}
// one round: fails Map(agent -> error), oks [agent], prev {agent:{n,since}} from the last rounds. Returns the new state and what to do.
export function decide(prev,fails,oks,{rootAlive=true,now=Date.now(),lastRepair=0}={}){const next={},report=[],clear=oks.filter(a=>prev[a]);
 for(const [a,err] of fails){const p=prev[a]||{n:0,since:now};next[a]={n:p.n+1,since:p.since,err:String(err||'').slice(0,300)}}
 const repair=rootAlive&&fails.size>0&&now-lastRepair>=REPAIR_GAP;
 for(const [a,x] of Object.entries(next))if(x.n>=2||!rootAlive)report.push({agent:a,
  text:'Its terminal does not log in ('+(rootAlive?'still failing after aqeelOS asked for its Linux user again':'the agent-users root script is not running')+')',
  fix:'Since '+new Date(x.since).toISOString().slice(0,16).replace('T',' ')+' UTC its commands, schedule scripts and order entries fail: '+x.err+'. '
   +(rootAlive?'The root script was asked to make the agent users and keys again and they still fail: check /etc/ssh/agent-keys and the root script\'s log on the box.'
    :'Start it again as root on the box, with the box user\'s home: AQEELOS_HOME=<box user home> scripts/agent-users.sh watch (see OPERATIONS.md). aqeelOS checks again every 5 minutes.')});
 return {next,repair,report,clear}}

// home(agent): the agent's engine folder (homeOf in agentops.mjs, passed in so the tests use their own)
export function createTerminalCheck({HOME,home,listAgents,problem=async()=>{},ok=async()=>{},closeReports=async()=>0,log=m=>console.log(m),
 probe=null,now=()=>Date.now(),every=EVERY}){
 const REQ=path.join(HOME,'.aqeelos-agent-users');
 let prev={},lastRepair=0,lastRun=0,running=null;
 const login=probe||(s=>new Promise(res=>execFile('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=5','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-o','LogLevel=ERROR',
  '-p',String(s.port),...(s.key?['-i',s.key]:[]),s.user+'@'+s.host,'true'],{timeout:15000},(e,o,er)=>res(e?{ok:false,err:String(er||e.message).trim().split('\n').pop()||'no answer'}:{ok:true}))));
 async function rootAlive(){const s=Number((await readFile(REQ+'.alive','utf8').catch(()=>'')).trim())||0;return s>0&&now()-s*1000<=ALIVE_MAX}
 async function once(){const fails=new Map(),oks=[];
  for(const a of (await listAgents().catch(()=>[])).filter(a=>!String(a).includes('--'))){const s=sshTerminal(await readFile(path.join(home(a),'config.yaml'),'utf8').catch(()=>''));if(!s)continue;
   const r=await login(s).catch(e=>({ok:false,err:e.message}));if(r.ok)oks.push(a);else fails.set(a,r.err)}
  const alive=await rootAlive(),d=decide(prev,fails,oks,{rootAlive:alive,now:now(),lastRepair});prev=d.next;
  if(d.repair){const t=new Date();await utimes(REQ,t,t).then(()=>{lastRepair=now();log('terminal check: '+fails.size+' agent terminal(s) refused ('+[...fails.keys()].join(', ')+'); asked the root script for the users and keys again')},e=>log('terminal check: could not ask the root script: '+e.message))}
  for(const x of d.report)await problem(x.agent,'terminal',x.text,x.fix).catch(()=>{});
  for(const a of d.clear)await ok(a,'terminal').catch(()=>{});
  for(const a of oks){const n=await closeReports(a,REFUSED).catch(()=>0);if(n||d.clear.includes(a))log('terminal check: '+a+'\'s terminal logs in'+(n?'; closed '+n+' report(s) saying it was refused':''))}
  return {fails:[...fails.keys()],oks,repair:d.repair,reported:d.report.map(x=>x.agent)}}
 // called by Health's 5-minute tick (server.mjs): no timer of its own
 async function tick(){if(running)return running;if(now()-lastRun<every-30e3)return null;lastRun=now();running=once().finally(()=>{running=null});return running}
 return {once,tick}}
