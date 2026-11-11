// billion-context (https://github.com/ranxianglei/billion-context, MIT + credit term, by ranxianglei) in every agent's
// home, so long chats send fewer tokens (owner, 11 Nov 2026: "ship to all"). The package is pinned and installed into
// aqeelOS's own folder on the server; its engine plugin (hermes-plugin/) is copied into each home's plugins folder with
// the bili.json the plugin reads, and switched on once. A plugin switched off on the Plugins page stays off.
// The proxy's own self-update and advisory force-installs are turned off: the pin below is the only version that runs.
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export const BILI_VERSION='0.1.213';
export const BILI_NAME='billion-context';
const RETRY_MS=60*60e3;

export function createBillionContext({HERMES_HOME,readConfig,setKey,pick,home0=homedir(),log=m=>console.log(m),
 npm=null,run=null,now=()=>Date.now(),nodePath=process.execPath,version=BILI_VERSION}){
 const home=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
 const dir=path.join(home0,'.local','share','aqeelos','billion-context');
 const pkg=path.join(dir,'node_modules',BILI_NAME);
 const confFile=path.join(home0,'.config','billion-context','billion-context.json');
 let lastFail=-Infinity,busy=null;
 const nextToNode=path.join(path.dirname(nodePath),'npm');
 const npmBin=npm||(process.platform==='win32'?'npm.cmd':existsSync(nextToNode)?nextToNode:'npm');
 const exec=run||((cmd,args,opts)=>new Promise((res,rej)=>execFile(cmd,args,opts,(e,o,er)=>e?rej(new Error(String(er||e.message).trim().split('\n').slice(-3).join(' '))):res(o))));
 async function homes(){const out=['default'];for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
  if(d.isDirectory()&&!d.name.startsWith('.')&&/^[a-z0-9][a-z0-9_-]{0,80}$/.test(d.name)&&await stat(path.join(HERMES_HOME,'profiles',d.name,'config.yaml')).then(()=>true,()=>false))out.push(d.name);return out}
 const installed=async()=>JSON.parse(await readFile(path.join(pkg,'package.json'),'utf8').catch(()=>'{}')).version||null;
 // the pinned package in aqeelOS's own folder; a failed download waits an hour before the next try
 async function ensure(){if(await installed()===version)return true;if(now()-lastFail<RETRY_MS)return false;
  if(busy)return busy;
  busy=(async()=>{try{await mkdir(dir,{recursive:true});
    await exec(npmBin,['install','--prefix',dir,'--no-audit','--no-fund','--ignore-scripts','--omit=dev',BILI_NAME+'@'+version],{timeout:10*60e3,maxBuffer:8e6,env:{...process.env,npm_config_update_notifier:'false'}});
    if(await installed()!==version)throw new Error('installed '+(await installed())+', wanted '+version);
    log('billion-context: '+version+' installed in '+dir);return true}
   catch(e){lastFail=now();log('billion-context: install failed, next try in an hour: '+e.message);return false}finally{busy=null}})();
  return busy}
 // the proxy keeps to the pinned version: no self-update, no advisory force-install
 async function config(){let c={};try{c=JSON.parse(await readFile(confFile,'utf8'))}catch{}
  if(c.autoUpdate===false&&c.advisoryCheck===false)return false;
  c.autoUpdate=false;c.advisoryCheck=false;await mkdir(path.dirname(confFile),{recursive:true});await writeFile(confFile,JSON.stringify(c,null,2)+'\n');return true}
 // copy the plugin into every home and switch it on once; returns the homes that changed (the engine reloads for them)
 // emergency off for this install: the file HERMES_HOME/.aqeelos-billion-context-off takes it out of every agent
 async function install(){if(await stat(path.join(HERMES_HOME,'.aqeelos-billion-context-off')).then(()=>true,()=>false))return offAll();
  if(!await ensure())return [];await config().catch(e=>log('billion-context: config: '+e.message));
  const src=path.join(pkg,'hermes-plugin');const files=(await readdir(src).catch(()=>[])).filter(f=>/^(plugin\.yaml|__init__\.py)$/.test(f));
  if(files.length<2){log('billion-context: hermes-plugin missing in '+src);return []}
  const sidecar=JSON.stringify({proxyScript:path.join(pkg,'dist','index.js'),nodePath},null,2)+'\n';
  const changed=[];
  for(const a of await homes()){let did=false;
   try{const dst=path.join(home(a),'plugins',BILI_NAME);await mkdir(dst,{recursive:true});
    for(const [f,want] of [...await Promise.all(files.map(async f=>[f,await readFile(path.join(src,f),'utf8')])),['bili.json',sidecar]]){
     const have=await readFile(path.join(dst,f),'utf8').catch(()=>null);if(have!==want){await writeFile(path.join(dst,f),want);did=true}}
    const c=await readConfig(a).catch(()=>null);if(c){const on=[].concat(pick(c,'plugins.enabled')||[]).map(String);const off=[].concat(pick(c,'plugins.disabled')||[]).map(String);
     if(!off.includes(BILI_NAME)){if(!on.includes(BILI_NAME)){await setKey(a,'plugins.enabled',[...on,BILI_NAME]);did=true}
      // its tools (compress, decompress, acp_status) reach the model only on channels that list the plugin, as the
      // engine's own `plugins enable` does
      const pt=pick(c,'platform_toolsets');if(pt&&typeof pt==='object')for(const [p,list] of Object.entries(pt)){const l=[].concat(list||[]).map(String);
       if(Array.isArray(list)&&!l.includes(BILI_NAME)){await setKey(a,'platform_toolsets.'+p,[...l,BILI_NAME]);did=true}}}}
    if(did)changed.push(a)}catch(e){log('billion-context: install for '+a+': '+e.message)}}
  if(changed.length)log('billion-context: plugin installed or updated for '+changed.join(', '));return changed}
 async function offAll(){const changed=[];
  for(const a of await homes()){try{const c=await readConfig(a).catch(()=>null);if(!c)continue;const on=[].concat(pick(c,'plugins.enabled')||[]).map(String);
   if(on.includes(BILI_NAME)){await setKey(a,'plugins.enabled',on.filter(n=>n!==BILI_NAME));changed.push(a)}}catch(e){log('billion-context: off for '+a+': '+e.message)}}
  if(changed.length)log('billion-context: switched off for '+changed.join(', '));return changed}
 return {ensure,config,install,homes,dir,pkg,confFile}}
