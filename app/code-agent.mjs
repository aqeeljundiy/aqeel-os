// The plain Code agent (owner, 15 Nov 2026: "i selected no agent and it auto picks Donna" ... "A plain Code agent"). A Code turn on
// aqeelOS models always runs as an engine agent; with none picked it used to be the person's main agent, with that agent's memory,
// skills, connected apps, schedules and logs, so the work was shaped by someone else's setup. Now it runs as this one: an engine
// profile of its own, made from nothing (no clone of the main agent, no skills), with only the tool groups building needs
// (CODE_KEEP), no connected apps but aqeelOS's code bridge (how the engine reaches a project on the person's computer,
// app/code-bridge.mjs), one plain line of instructions and the main agent's model as its default (Code names the model of each turn).
// Like Help (help.mjs) it is made by the live app, checked again at every start, and kept out of every agent list (agentops.mjs).
import {readFile,writeFile,mkdir,cp,access} from 'node:fs/promises';
import path from 'node:path';
import {CODE_AGENT,isAgent,setKey,homeOf,hermes as engineCmd} from './agentops.mjs';

const CODE_NAME='Code';
// what building and checking a project needs; everything else (memory, skills, past chats, connected apps, schedules, messaging,
// computer use, other agents) stays off
export const CODE_KEEP=['web','browser','terminal','file','code_execution','vision','image_gen','todo','clarify'];
export const CODE_SOUL='You are Code, the agent aqeelOS uses for a Code project when the person picks no agent. You have no memory, skills or connected apps of anyone. Do what the person asks, in their project, the way they ask.';
// the model sign-ins it needs: every plugin the main agent has on whose manifest says kind: model-provider (the Claude sign-in,
// Antigravity for Gemini). Made from nothing, it had none: every turn stopped at "Could not find the
// 'claude-subscription-directsdk-experimental' CLI command" before a model was asked, whichever model Code named (15 Nov 2026).
export const providerPlugins=(enabled,manifest)=>(Array.isArray(enabled)?enabled:[]).filter(p=>/^[a-z0-9][a-z0-9_-]{0,80}$/.test(String(p))&&/^kind:\s*model-provider\s*$/m.test(manifest(p)||''));
// which tool groups to switch off: every one the engine lists that is not kept
export const codeOff=list=>list.map(x=>x?.name||x).filter(n=>n&&!CODE_KEEP.includes(n));

export function createCodeAgent({DASH,DASH_TOKEN,API_KEY,live=true,codeBridge,readConfig,pick,hermes=engineCmd,restart=null,log=m=>console.log(m)}){
 const dash=(p,opt={})=>fetch(DASH+'/api'+p,{...opt,headers:{'x-hermes-session-token':DASH_TOKEN,...(opt.body?{'content-type':'application/json'}:{}),...(opt.headers||{})},signal:opt.signal||AbortSignal.timeout(30000)});
 const json=async r=>{try{return await r.json()}catch{return {}}};
 const mcp=(a,m,p,b)=>dash('/mcp/servers'+p+'?profile='+encodeURIComponent(a),{method:m,body:b?JSON.stringify(b):undefined}).then(r=>{if(!r.ok&&r.status!==404)throw Error('MCP '+m+' '+r.status)});
 let ok=false,ensuring=null;
 const ready=async()=>ok||(ok=await isAgent(CODE_AGENT));
 function ensure(){if(!live)return Promise.resolve(false);return ensuring||=(async()=>{
  if(!await isAgent(CODE_AGENT)){const r=await dash('/profiles',{method:'POST',body:JSON.stringify({name:CODE_AGENT,description:'Code for aqeelOS (no agent picked)',clone_from_default:false,no_skills:true}),signal:AbortSignal.timeout(120000)});
   if(!r.ok)throw Error('the engine did not make its profile ('+r.status+')');log('code agent: made its engine profile '+CODE_AGENT)}
  // the gateway serves a profile only with the key aqeelOS uses for it (as every agent's .env has)
  const envF=path.join(homeOf(CODE_AGENT),'.env'),e=await readFile(envF,'utf8').catch(()=>'');
  if(API_KEY&&!/^API_SERVER_KEY=/m.test(e))await writeFile(envF,(e&&!e.endsWith('\n')?e+'\n':e)+'API_SERVER_KEY='+API_KEY+'\n',{mode:0o600});
  const t=await dash('/tools/toolsets?profile='+CODE_AGENT).then(json).catch(()=>[]);const all=Array.isArray(t)?t:t.toolsets||[];
  const off=codeOff(all),on=all.filter(x=>x.enabled).map(x=>x.name);if(off.some(n=>on.includes(n))){const r=await setKey(CODE_AGENT,'agent.disabled_toolsets',off);if(!r.ok)throw Error('could not set its tools: '+r.err)}
  // no connected apps: only the code bridge
  const cfg=()=>readFile(path.join(homeOf(CODE_AGENT),'config.yaml'),'utf8').catch(()=>'');
  const m=await dash('/mcp/servers?profile='+CODE_AGENT).then(json).catch(()=>({}));for(const s of (Array.isArray(m)?m:m.servers||[]))if(s.name!=='aqeelos-code')await mcp(CODE_AGENT,'DELETE','/'+encodeURIComponent(s.name)).catch(()=>{});
  if(codeBridge)await codeBridge.ensure(CODE_AGENT,await cfg(),mcp);
  const cur=await dash('/profiles/'+CODE_AGENT+'/soul').then(json).catch(()=>({}));
  if(cur.content!==CODE_SOUL){const r=await dash('/profiles/'+CODE_AGENT+'/soul',{method:'PUT',body:JSON.stringify({content:CODE_SOUL})});if(!r.ok)throw Error('could not write its instructions ('+r.status+')')}
  // the main agent's model sign-ins (copied as accounts.mjs does for a new agent, then switched on in this profile)
  const main0=await readConfig('default').catch(()=>null),mainDir=homeOf('default'),dir=homeOf(CODE_AGENT);const manifests={};
  for(const p of pick(main0||{},'plugins.enabled')||[])manifests[p]=await readFile(path.join(mainDir,'plugins',String(p),'plugin.yaml'),'utf8').catch(()=>'');
  const have=pick(await readConfig(CODE_AGENT).catch(()=>null)||{},'plugins.enabled')||[];let switched=0;
  for(const p of providerPlugins(pick(main0||{},'plugins.enabled'),n=>manifests[n])){const to=path.join(dir,'plugins',p);
   if(!await access(path.join(to,'plugin.yaml')).then(()=>1,()=>0)){await mkdir(path.join(dir,'plugins'),{recursive:true});await cp(path.join(mainDir,'plugins',p),to,{recursive:true});await cp(path.join(mainDir,'plugins','.install-metadata.json'),path.join(dir,'plugins','.install-metadata.json')).catch(()=>{})}
   if(!have.includes(p)){const r=await hermes(CODE_AGENT,['plugins','enable',p],{timeout:150000,retries:3});if(!r.ok)throw Error('could not switch on '+p+': '+String(r.err||r.out||'').slice(-160));log('code agent: '+p+' switched on');switched++}}
  // a plugin switched on applies when the agents restart (as for any agent, access.mjs); the restart waits until nobody is mid-reply
  if(switched&&restart)await restart('code agent: its model sign-ins switched on');
  // a default model, the main agent's, so "Default" in Code works; Code names the model of each turn anyway
  const mine=await readConfig(CODE_AGENT).catch(()=>null),main=await readConfig('default').catch(()=>null);
  if(!pick(mine||{},'model.default')&&pick(main||{},'model.default')){await setKey(CODE_AGENT,'model.default',pick(main,'model.default'));if(pick(main,'model.provider'))await setKey(CODE_AGENT,'model.provider',pick(main,'model.provider'))}
  ok=true;return true})().catch(err=>{log('code agent: '+err.message);return false}).finally(()=>{ensuring=null})}
 return {ensure,ready,id:CODE_AGENT,name:CODE_NAME}}
