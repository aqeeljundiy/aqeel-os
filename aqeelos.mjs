// The link to aqeelOS. This app runs on the person's own computer and is shown inside aqeelOS (the Code section).
// Pairing: aqeelOS hands this app its own key through the page (no password typed here). The key lets the app's
// runs reach the person's aqeelOS agents with all their abilities (aqeelos-mcp.mjs), and lets the app update itself.
// Only the aqeelOS address this copy came from (aqeelos.json, written by the download) may show the app in a frame.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export function createAqeelos({root}){
 const FILE=path.join(root,'data','aqeelos.json');let link=null,install=null;
 const load=async()=>{if(!link?.token){try{link=JSON.parse(await readFile(FILE,'utf8'))}catch{link={}}}
  if(!install){try{install=JSON.parse(await readFile(path.join(root,'aqeelos.json'),'utf8')).aqeelos||{}}catch{install={}}}return link};
 const clean=u=>{try{return new URL(u).origin}catch{return ''}};
 // the aqeelOS addresses allowed to show and drive this app
 async function origins(){await load();return [...new Set([...(install.origins||[]),install.base,link.base,...String(process.env.AQEELOS_ORIGINS||'https://ai.elkiya.com').split(',')].map(clean).filter(Boolean))]}
 async function state(){await load();return {paired:!!link.token,base:link.base||install.base||'',user:link.user||'',origins:await origins(),version:install.version||''}}
 async function pair(base,token){const o=clean(base);if(!(await origins()).includes(o))throw Error('That aqeelOS address is not allowed for this copy.');
  const r=await fetch(o+'/ui/code/whoami',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'aqeelOS did not accept the key.');
  link={base:o,token,user:j.name||'',pairedAt:Date.now()};await mkdir(path.dirname(FILE),{recursive:true});await writeFile(FILE,JSON.stringify(link,null,1),{mode:0o600});return state()}
 // the person's aqeelOS agents this computer may ask (what Code's picker lists)
 let agentsAt=0,agentsList=[];
 async function agents(){await load();if(!link.token)return [];if(Date.now()-agentsAt<60000)return agentsList;
  try{const r=await fetch(link.base+'/ui/code/agents',{headers:{authorization:'Bearer '+link.token},signal:AbortSignal.timeout(15000)});const j=await r.json().catch(()=>({}));if(r.ok){agentsList=(j.agents||[]).map(a=>({id:String(a.id),name:String(a.name||a.id),apps:a.apps||[],google:a.google||0}));agentsAt=Date.now()}}catch{}return agentsList}
 async function unpair(){link={};await writeFile(FILE,'{}').catch(()=>{});return state()}
 // every run gets the aqeelOS tools when this computer is paired
 async function mcp(run){await load();if(!link.token)return null;return {name:'aqeelos',command:process.execPath,args:[path.join(root,'aqeelos-mcp.mjs')],env:{AQ_BASE:link.base,AQ_TOKEN:link.token,AQ_PROJECT:String(run?.projectId||''),AQ_AGENT:String(run?.agent||'')}}}
 // ask aqeelOS for work for this computer's projects (agents' code_work), every ~25 s while paired
 let serving=false;function serve({projects,work}){if(serving||process.env.NODE_TEST_CONTEXT)return;serving=true;const wait=ms=>new Promise(r=>setTimeout(r,ms).unref?.());
  (async()=>{for(;;){await load();if(!link.token){await wait(10000);continue}
   try{const r=await fetch(link.base+'/ui/code/poll',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({projects:await projects()}),signal:AbortSignal.timeout(40000)});
    if(r.status===401){await wait(60000);continue}const j=await r.json().catch(()=>({}));if(!r.ok){await wait(15000);continue}
    if(j.job){const job=j.job;void (async()=>{let out;try{out=await work(job)}catch(e){out={state:'failed',text:e.message}}
     await fetch(link.base+'/ui/code/done',{method:'POST',headers:{authorization:'Bearer '+link.token,'content-type':'application/json'},body:JSON.stringify({id:job.id,...out})}).catch(()=>{})})()}}
   catch{await wait(15000)}}})()}
 return {origins,state,pair,unpair,mcp,agents,serve}}
