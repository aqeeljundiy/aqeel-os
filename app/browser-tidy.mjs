// Browser tidy (audit, 5 Nov 2026): the box ran at a load of about 20 on 12 cores with 149 Chrome processes; tabs agents
// opened days ago kept running (one of Sesa's had been open 12 days at 1.3 GB). Every hour, each agent's own screen
// Chrome (the one scripts/agent-users.sh keeps per agent) is tidied when that agent has done nothing for 3 hours: its
// open tabs are closed and one empty tab stays. Its sign-ins stay (they live in its browser profile on disk), and an
// agent at work, or one that worked within the 3 hours, is never touched. AdsPower browsers are left to the memory guard.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

export const IDLE=3*3600e3;
// which tabs to close: every page but one empty tab (a new one is opened first when there is none)
export function plan(targets){const pages=(targets||[]).filter(t=>t&&t.type==='page');
 const blank=pages.find(t=>/^(about:blank|chrome:\/\/newtab\/?)$/.test(String(t.url||'')));
 return {open:!blank&&pages.length>0,close:pages.filter(t=>t!==blank).map(t=>t.id)}}

export function createBrowserTidy({lastActive,busy=async()=>false,log=m=>console.log(m),fetchImpl=fetch,now=()=>Date.now(),portsFile=path.join(homedir(),'.aqeelos-agent-ports')}){
 const cdp=(port,p,method='GET')=>fetchImpl('http://127.0.0.1:'+port+p,{method,signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.json().catch(()=>({})):null).catch(()=>null);
 async function tick(){const lines=(await readFile(portsFile,'utf8').catch(()=>'')).split('\n').map(l=>l.trim().split(' ')).filter(x=>x.length>=3&&/^\d+$/.test(x[2]));
  let total=0;
  for(const [agent,,port] of lines){
   if(await busy(agent).catch(()=>true))continue;
   const at=await lastActive(agent).catch(()=>null);if(at==null||now()-at<IDLE)continue;   // unknown is not idle
   const list=await cdp(port,'/json/list');if(!Array.isArray(list))continue;
   const p=plan(list);if(!p.close.length)continue;
   if(p.open&&!await cdp(port,'/json/new?about:blank','PUT'))continue;
   let n=0;for(const id of p.close)if(await cdp(port,'/json/close/'+encodeURIComponent(id)))n++;
   if(n){total+=n;log('browser tidy: closed '+n+' tab(s) '+agent+' left open (idle '+Math.round((now()-at)/3600e3)+' h)')}}
  return total}
 return {tick}}
