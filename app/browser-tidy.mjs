// Browser tidy (audit, 5 Nov 2026): the box ran at a load of about 20 on 12 cores with 149 Chrome processes; tabs agents
// opened days ago kept running (one of Sela's had been open 12 days at 1.3 GB). Every hour, each agent's own screen
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

// Too many tabs (7 Nov 2026): cove-threads works all day, so it was never 3 hours idle, and its schedules opened a new
// Threads tab on every run without closing it: 126 tabs, 128 Chrome processes, ~30 GB, the box at its memory limit and
// "memory pressure is elevated" in the engine. So extra tabs are closed whatever the agent does: a second copy of the
// same page (address without ?query/#hash) and the oldest beyond a cap. Chrome lists the most recently opened or used
// tab first (checked on the box), so the newest stay. An agent quiet for QUIET minutes keeps MAX_TABS; one at work keeps
// up to BUSY_MAX and its newest BUSY_KEEP are never touched (a run works in the tab it just opened). Sign-ins stay.
export const MAX_TABS=8,QUIET=10*60e3,BUSY_MAX=20,BUSY_KEEP=12;
const pageKey=u=>String(u||'').split('#')[0].split('?')[0].replace(/\/+$/,'');
export function planExcess(targets,{max=MAX_TABS,keepNewest=1}={}){const pages=(targets||[]).filter(t=>t&&t.type==='page');const seen=new Set(),keep=[],close=[];
 pages.forEach((t,i)=>{const k=pageKey(t.url);if(seen.has(k)&&i>=keepNewest)close.push(t.id);else{seen.add(k);keep.push(t)}});
 const cap=Math.max(1,max,keepNewest);for(const t of keep.slice(cap))close.push(t.id);
 return {close}}

export function createBrowserTidy({lastActive,busy=async()=>false,log=m=>console.log(m),fetchImpl=fetch,now=()=>Date.now(),portsFile=path.join(homedir(),'.aqeelos-agent-ports')}){
 const cdp=(port,p,method='GET')=>fetchImpl('http://127.0.0.1:'+port+p,{method,signal:AbortSignal.timeout(8000)}).then(r=>r.ok?r.json().catch(()=>({})):null).catch(()=>null);
 async function tick(){const lines=(await readFile(portsFile,'utf8').catch(()=>'')).split('\n').map(l=>l.trim().split(' ')).filter(x=>x.length>=3&&/^\d+$/.test(x[2]));
  let total=0;
  for(const [agent,,port] of lines){
   if(await busy(agent).catch(()=>true))continue;
   const at=await lastActive(agent).catch(()=>null);if(at==null)continue;   // unknown is not idle
   const list=await cdp(port,'/json/list');if(!Array.isArray(list))continue;
   if(now()-at<IDLE){const x=planExcess(list,now()-at<QUIET?{max:BUSY_MAX,keepNewest:BUSY_KEEP}:{});let k=0;for(const id of x.close)if(await cdp(port,'/json/close/'+encodeURIComponent(id)))k++;
    if(k){total+=k;log('browser tidy: closed '+k+' extra tab(s) of '+agent+' (repeats and old ones; '+(list.filter(t=>t?.type==='page').length-k)+' left)')}continue}
   const p=plan(list);if(!p.close.length)continue;
   if(p.open&&!await cdp(port,'/json/new?about:blank','PUT'))continue;
   let n=0;for(const id of p.close)if(await cdp(port,'/json/close/'+encodeURIComponent(id)))n++;
   if(n){total+=n;log('browser tidy: closed '+n+' tab(s) '+agent+' left open (idle '+Math.round((now()-at)/3600e3)+' h)')}}
  return total}
 return {tick}}
