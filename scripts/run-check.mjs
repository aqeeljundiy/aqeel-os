#!/usr/bin/env node
// The standard no-model check a schedule's aqeelos-check-<job id>.sh calls (app/run-checks.mjs). Prints one JSON line:
// {"anythingToDo": false|true, ...}. Always exits 0; whatever goes wrong, the answer is true (the run goes ahead).
// Usage: node run-check.mjs --agent continue-threads --home ~/.hermes/profiles/continue-threads [--data DIR] [--work DIR] [--job ID]
//   --dms [--dm-mode both|title|inbox] [--port N]   unread DMs in the agent's own Chrome (port from its config.yaml)
//   --comments [--account ID] [--platform threads]  unanswered comments in Tebar (key: TEBAR_API_KEY, or the agent's .env)
//   --new-since file:<path> [--new-since file:<path2>] [--retries 3]
//                                                   anything new since the last run: the file changed since the fingerprint kept
//                                                   at the last go (state in <data>/run-checks/<job>.json); after a change it says
//                                                   go for --retries more calls, so a run that failed is tried again
//   --cmd "<command>" [--cmd-once]                 a command run here (as this user) that prints when there is work; nothing printed = no work; --cmd-once: the same
//                                                   output as at the last go is not work again (a blocker already reported)
//   --agent-cmd "<command>" [--cmd-once]           the same, run as the agent's own user inside its folder (ssh, like a script-only schedule)
//   --max-idle MIN                                  a safety run when no check said go for MIN minutes (needs --data and --job)
//   --posting                                       the posting limits must allow a post now (needs --data)
// Work checks (--dms, --comments, --new-since): anything above zero is something to do. --posting is a permission, not work.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {cdpPortOf,unreadDms,unansweredComments,postingAllowed,newSince,idleSafety,loadState,saveState,combine,commandWork} from '../app/run-checks.mjs';

const args=process.argv.slice(2),flag=n=>args.includes('--'+n),opt=n=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:undefined};
const all=n=>args.flatMap((a,i)=>a==='--'+n&&args[i+1]?[args[i+1]]:[]);
const out=o=>process.stdout.write(JSON.stringify(o)+'\n',()=>process.exit(0));
try{
 const agent=opt('agent')||'default',home=opt('home')||(agent==='default'?path.join(homedir(),'.hermes'):path.join(homedir(),'.hermes','profiles',agent));
 const DATA=opt('data')||process.env.AQEELOS_DATA||'',WORK=opt('work')||path.join(homedir(),'workspaces'),key=opt('job')||agent+'-'+args.filter(a=>a.startsWith('--')).join('').replace(/[^\w-]/g,'');
 const work=[],need=[],maxIdle=+opt('max-idle')||0;let state=DATA?await loadState(DATA,key):{};
 if(flag('dms'))work.push(await unreadDms({port:+opt('port')||cdpPortOf(await readFile(path.join(home,'config.yaml'),'utf8').catch(()=>'')),mode:opt('dm-mode')||'both'}));
 if(flag('comments')){let key=process.env.TEBAR_API_KEY;if(!key){const m=/^TEBAR_API_KEY=['"]?([^'"\r\n]+)/m.exec(await readFile(path.join(home,'.env'),'utf8').catch(()=>''));key=m?.[1]}
  work.push(await unansweredComments({key,accountId:opt('account'),platform:opt('platform')}))}
 {const once=flag('cmd-once'),HH=path.basename(path.dirname(home))==='profiles'?path.dirname(path.dirname(home)):home;let st=state.cmd?state:{...state};
  for(const [kind,list] of [['cmd',all('cmd')],['agent-cmd',all('agent-cmd')]])for(const cmd of list){
   let as=null;if(kind==='agent-cmd'){const u=/^\s*ssh_user:\s*['"]?(ag-[\w-]+)/m.exec(await readFile(path.join(home,'config.yaml'),'utf8').catch(()=>''))?.[1];as={user:u,key:path.join(HH,'agent-ssh','id_ed25519'),dir:path.join(WORK,agent.split('--')[0])}}
   const w=await commandWork({label:kind+':'+cmd,cmd,as,once,state:st,timeoutSec:+opt('cmd-timeout')||20});work.push(w);st={...st,cmd:w.next};state=st}}
 const sources=all('new-since');let ns=null;
 if(sources.length){ns=await newSince({sources,state:state.ns||{},retries:opt('retries')==null?3:+opt('retries'),maxIdleMin:maxIdle});work.push(ns)}
 if(flag('posting')&&DATA)need.push(await postingAllowed({DATA,WORK,agent}));
 let res={...combine({work,need}),checkedAt:new Date().toISOString()};
 const s=idleSafety(res,{state,maxIdleMin:ns||need.some(n=>n.known&&n.allow===false)?0:maxIdle});res=s.result;state={...s.next,...(ns?{ns:ns.next}:{})};
 if(DATA)await saveState(DATA,key,state).catch(()=>{});
 out(res)
}catch(e){out({anythingToDo:true,reason:'the check failed ('+e.message+'), so the run goes ahead'})}
