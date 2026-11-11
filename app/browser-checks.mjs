// The night's browser page checks (12 Nov 2026, owner: deploys were heavy on boxes that are CPU-bound). The four checks that every
// deploy used to run on a test copy next to the agents (pages, fast switching, buttons and tabs, My browser) now run here, once a night
// in the maintenance window after the update (maintenance.mjs browserChecksDue), by scripts/box-check.sh with BROWSER_ONLY=1 against
// the version that is live (<app>/.deployed.tgz). Result in DATA/browser-checks.json; a failure is ONE Health item (topic
// browser-checks), a pass takes it away. Never undoes a deploy. Only on a Docker box (~/services.sh and .deployed.tgz); install.json
// "nightlyBrowserChecks": false switches it off.
import {readFile,writeFile,rename,mkdir,copyFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import path from 'node:path';
import {windowOf,browserChecksDue} from './maintenance.mjs';

export const TOPIC='browser-checks';
// the failed checks from box-check.sh's own output: its "✗" lines, and a stop at its limit
export function failuresIn(out){const t=String(out||'');return t.split('\n').filter(l=>/^✗/.test(l)).map(l=>l.replace(/^✗\s*/,'').slice(0,300)).slice(0,6)}

export function createBrowserChecks({DATA,APP,HOME=homedir(),settings=()=>({}),bottlenecks=null,now=()=>Date.now(),log=m=>console.log(m),
 exec=(file,args,opts)=>new Promise(res=>execFile(file,args,opts,(e,out,err)=>res({code:e?(typeof e.code==='number'?e.code:1):0,out:String(out||'')+String(err||''),timedOut:!!e?.killed}))),
 live=async()=>({box:true,sha:''}),timeoutMs=80*60e3}){
 const FILE=path.join(DATA,'browser-checks.json');let running=false;
 const read=async()=>{try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {}}};
 const write=async d=>{await mkdir(DATA,{recursive:true});await writeFile(FILE+'.tmp',JSON.stringify(d,null,1));await rename(FILE+'.tmp',FILE)};
 const exists=f=>stat(f).then(()=>true,()=>false);
 // is an update running now (scripts/auto-update.mjs writes state.running and removes it when done; one left behind for 90 minutes is stale)
 async function updating(){try{const a=JSON.parse(await readFile(path.join(DATA,'auto-update.json'),'utf8'));return !!a.running&&now()-a.running.at<90*60e3}catch{return false}}
 async function due(){const s=settings();if(s.nightlyBrowserChecks===false)return {due:false,why:'switched off'};
  const l=await live();if(!l.box||!await exists(path.join(APP,'scripts','box-check.sh'))||!await exists(path.join(APP,'.deployed.tgz')))return {due:false,why:'not a box with a deployed copy'};
  return browserChecksDue({now:new Date(now()),w:windowOf(s),last:(await read()).last||null,sha:l.sha,updating:await updating(),running})}
 async function run({sha=''}={}){if(running)return null;running=true;const t0=now();
  try{const tgz='/tmp/hui-nightly-'+process.pid+'-'+t0+'.tgz';await copyFile(path.join(APP,'.deployed.tgz'),tgz);
   const r=await exec('bash',[path.join(APP,'scripts','box-check.sh')],{timeout:timeoutMs,maxBuffer:8e6,env:{HOME,PATH:process.env.PATH,LANG:process.env.LANG||'C.UTF-8',BROWSER_ONLY:'1',MB:'1',TGZ:tgz}});
   const failed=failuresIn(r.out);if(r.timedOut)failed.push('it did not finish within '+Math.round(timeoutMs/60e3)+' minutes');
   const ok=r.code===0&&!failed.length,rec={at:t0,sha,ok,took:Math.round((now()-t0)/1000),failed,tail:r.out.split('\n').filter(Boolean).slice(-8).join('\n').slice(-1200)};
   const d=await read();d.last=rec;d.history=[rec,...(d.history||[])].slice(0,30);await write(d);
   if(bottlenecks){if(ok)await bottlenecks.resolve(TOPIC).catch(()=>{});
    else await bottlenecks.event('update','The night’s page checks found a problem',failed.join(' ')||'The checks stopped before they finished. The version that is live was not changed.',{topic:TOPIC}).catch(()=>{})}
   log('browser checks: '+(ok?'passed':'failed: '+failed.join(' | ').slice(0,200))+' ('+rec.took+' s)');return rec}
  finally{running=false}}
 async function tick(){const d=await due();if(!d.due)return d;const l=await live();await run({sha:l.sha});return d}
 return {due,run,tick,last:async()=>(await read()).last||null}}
