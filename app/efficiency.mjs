// Efficient by default (owner, 11 Nov 2026: "if we do something in the future, it is already efficient"). Elkiya used
// four Claude Max 5-hour windows in one day: long chats grew to ~1M tokens before the engine shortened them (its
// trigger is 50% of the window, and the agents run 1M windows), and chats a person types into rewrote their whole
// cache after every 5-minute pause. Every agent's home, new ones included, gets the engine's own settings for both:
//  - compression.threshold_tokens: shorten at this many tokens, whatever the window (subagents follow it too)
//  - prompt_caching.cache_ttl "auto": 1 hour for chats a person types into, 5 minutes for schedules and subagents
//    (the engine's own rule; machine-paced runs do not collect the longer retention)
// A value someone set by hand is kept: only a missing value, or one this module set before, is written. Every write is
// remembered in DATA/efficiency.json, so a later change of the default reaches the homes it set and nothing else.
// Model-agnostic: both keys are engine settings; a model without prompt caching simply ignores the second.
import {readFile,writeFile,readdir,stat,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';

export const DEFAULTS=Object.freeze({'compression.threshold_tokens':200000,'prompt_caching.cache_ttl':'auto'});
// what the engine ships, treated like a missing value (nobody chose it)
const ENGINE_DEFAULT={'compression.threshold_tokens':[null,undefined],'prompt_caching.cache_ttl':[null,undefined,'5m']};

export function createEfficiency({HERMES_HOME,DATA,readConfig,setKey,pick,log=m=>console.log(m),defaults=DEFAULTS}){
 const FILE=path.join(DATA,'efficiency.json');
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 async function homes(){const out=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
  if(d.isDirectory()&&!d.name.startsWith('.')&&/^[a-z0-9][a-z0-9_-]{0,80}$/.test(d.name)&&await stat(path.join(home(d.name),'config.yaml')).then(()=>true,()=>false))out.push(d.name);return out}
 const load=async()=>{try{return JSON.parse(await readFile(FILE,'utf8'))}catch{return {set:{}}}};
 const save=async d=>{await mkdir(DATA,{recursive:true});const tmp=FILE+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(d,null,1));await rename(tmp,FILE)};
 // returns the homes whose settings changed (the engine reads them when it reloads)
 async function apply(){const d=await load();d.set||={};const changed=[];
  for(const a of await homes()){const c=await readConfig(a).catch(()=>null);if(!c)continue;let did=false;
   for(const [k,want] of Object.entries(defaults)){const have=pick(c,k),mine=d.set[a]?.[k];
    const free=(ENGINE_DEFAULT[k]||[null,undefined]).includes(have)||(mine!==undefined&&have===mine);
    if(!free||have===want)continue;
    try{await setKey(a,k,want);(d.set[a]||={})[k]=want;did=true}catch(e){log('efficiency: '+a+' '+k+': '+e.message)}}
   if(did)changed.push(a)}
  if(changed.length){await save(d);log('efficiency: shorter chats and longer cache set for '+changed.join(', '))}
  return changed}
 // for Health: which homes run the defaults and which keep a value of their own
 async function status(){const out=[];for(const a of await homes()){const c=await readConfig(a).catch(()=>null);if(!c)continue;
  const v={};for(const k of Object.keys(defaults))v[k]=pick(c,k)??null;out.push({agent:a,...v,own:Object.entries(defaults).some(([k,w])=>v[k]!==null&&v[k]!==w)})}return out}
 return {apply,status,homes}}
