#!/usr/bin/env node
// The standard no-model check a schedule's aqeelos-check-<job id>.sh calls (app/run-checks.mjs). Prints one JSON line:
// {"anythingToDo": false|true, ...}. Always exits 0; whatever goes wrong, the answer is true (the run goes ahead).
// Usage: node run-check.mjs --agent continue-threads --home ~/.hermes/profiles/continue-threads [--data DIR] [--work DIR]
//   --dms [--dm-mode both|title|inbox] [--port N]   unread DMs in the agent's own Chrome (port from its config.yaml)
//   --comments [--account ID] [--platform threads]  unanswered comments in Tebar (key: TEBAR_API_KEY, or the agent's .env)
//   --posting                                       the posting limits must allow a post now (needs --data)
// Work checks (--dms, --comments): anything above zero is something to do. --posting is a permission, not work.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {cdpPortOf,unreadDms,unansweredComments,postingAllowed,combine} from '../app/run-checks.mjs';

const args=process.argv.slice(2),flag=n=>args.includes('--'+n),opt=n=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:undefined};
const out=o=>console.log(JSON.stringify(o));
try{
 const agent=opt('agent')||'default',home=opt('home')||(agent==='default'?path.join(homedir(),'.hermes'):path.join(homedir(),'.hermes','profiles',agent));
 const DATA=opt('data')||process.env.AQEELOS_DATA||'',WORK=opt('work')||path.join(homedir(),'workspaces');
 const work=[],need=[];
 if(flag('dms'))work.push(await unreadDms({port:+opt('port')||cdpPortOf(await readFile(path.join(home,'config.yaml'),'utf8').catch(()=>'')),mode:opt('dm-mode')||'both'}));
 if(flag('comments')){let key=process.env.TEBAR_API_KEY;if(!key){const m=/^TEBAR_API_KEY=['"]?([^'"\r\n]+)/m.exec(await readFile(path.join(home,'.env'),'utf8').catch(()=>''));key=m?.[1]}
  work.push(await unansweredComments({key,accountId:opt('account'),platform:opt('platform')}))}
 if(flag('posting')&&DATA)need.push(await postingAllowed({DATA,WORK,agent}));
 out({...combine({work,need}),checkedAt:new Date().toISOString()})
}catch(e){out({anythingToDo:true,reason:'the check failed ('+e.message+'), so the run goes ahead'})}
