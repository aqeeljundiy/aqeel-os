// Dev server manager: detects a project's dev command, installs dependencies, runs the server on a free
// port, captures logs and the local URL, and stops everything when the app exits.
import {spawn} from 'node:child_process';
import {readFile,access} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {killTree,packageCommand} from './platform.mjs';

const exists=async p=>{try{await access(p);return true}catch{return false}};
const RESERVED=new Set([4320,4321,4322]);

export async function detect(folder){
 let pkg=null;try{pkg=JSON.parse(await readFile(path.join(folder,'package.json'),'utf8'))}catch{return {kind:'static'}}
 const manager=await exists(path.join(folder,'pnpm-lock.yaml'))?'pnpm':await exists(path.join(folder,'yarn.lock'))?'yarn':await exists(path.join(folder,'bun.lockb'))?'bun':'npm';
 const scripts=pkg.scripts||{},script=['dev','start','preview','serve'].find(s=>scripts[s]);
 const deps={...pkg.dependencies,...pkg.devDependencies};
 const framework=deps.astro?'Astro':deps.next?'Next.js':deps.vite?'Vite':deps['@sveltejs/kit']?'SvelteKit':deps.nuxt?'Nuxt':deps['react-scripts']?'Create React App':deps.parcel?'Parcel':null;
 return {kind:'node',manager,script,command:script?scripts[script]:null,framework,installed:await exists(path.join(folder,'node_modules')),name:pkg.name||null};
}

// Port flag per framework; PORT env covers the rest.
function portArgs(info,port){if(!info.framework||info.framework==='Create React App')return [];return info.framework==='Next.js'?['-p',String(port)]:['--port',String(port),'--host','127.0.0.1']}

export function freePort(start=5173){return new Promise(resolve=>{const tryPort=p=>{if(RESERVED.has(p))return tryPort(p+1);const s=net.createServer();s.once('error',()=>tryPort(p+1));s.once('listening',()=>s.close(()=>resolve(p)));s.listen(p,'127.0.0.1')};tryPort(start)})}

const URL_RE=/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})[^\s'"]*/i;
const strip=s=>s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'');

export class DevServers{
 constructor(env){this.env=env;this.servers=new Map();for(const sig of ['exit','SIGINT','SIGTERM'])process.on(sig,()=>{for(const s of this.servers.values())killTree(s.child);if(sig!=='exit')process.exit(0)})}
 view(id){const s=this.servers.get(id);return s?{state:s.state,task:s.task,url:s.url,port:s.port,command:s.label,startedAt:s.startedAt,exitCode:s.exitCode??null,log:s.log.slice(-20000)}:{state:'stopped',log:''}}
 run(id,folder,{exe,args,options},task,label,env={}){
  const old=this.servers.get(id);if(old&&['starting','running','installing'].includes(old.state))throw Error('A process is already running for this project. Stop it first.');
  const s={state:task==='install'?'installing':'starting',task,label,log:'> '+label+'\n',url:null,port:env.PORT?Number(env.PORT):null,startedAt:Date.now()};this.servers.set(id,s);
  const child=spawn(exe,args,{cwd:folder,env:{...this.env,...env,FORCE_COLOR:'0',BROWSER:'none'},...options});s.child=child;
  const onData=d=>{const text=strip(String(d));s.log=(s.log+text).slice(-60000);const m=text.match(URL_RE);if(m&&task==='dev'&&!s.url){s.url=m[0].replace('0.0.0.0','127.0.0.1').replace(/\/$/,'');s.state='running'}};
  child.stdout?.on('data',onData);child.stderr?.on('data',onData);
  child.on('error',e=>{s.state='failed';s.log+='\n'+e.message})
  child.on('close',code=>{s.exitCode=code;s.log+=`\n[${task==='install'?'Install':'Server'} exited with code ${code}]\n`;s.state=s.stopped?'stopped':task==='install'?(code===0?'installed':'failed'):'stopped';if(task==='dev'&&code&&!s.stopped)s.state='crashed'});
  // some servers never print a URL: fall back to the port we asked for once it answers
  if(task==='dev'&&s.port){const probe=setInterval(()=>{if(s.state!=='starting'){clearInterval(probe);return}const c=net.connect(s.port,'127.0.0.1',()=>{c.destroy();if(s.state==='starting'){s.url='http://127.0.0.1:'+s.port;s.state='running'}clearInterval(probe)});c.on('error',()=>c.destroy())},1000);setTimeout(()=>clearInterval(probe),120000)}
  return this.view(id);
 }
 async install(id,folder){const info=await detect(folder);if(info.kind!=='node')throw Error('This project has no package.json, so there is nothing to install.');
  return this.run(id,folder,packageCommand(info.manager,['install']),'install',info.manager+' install')}
 async start(id,folder){const info=await detect(folder);if(info.kind!=='node'||!info.script)throw Error('No dev script found in package.json. Static sites use the built-in preview.');
  if(!info.installed)throw Error('Install dependencies first.');const port=await freePort();
  const runArgs=info.manager==='npm'?['run',info.script,'--',...portArgs(info,port)]:info.manager==='yarn'?[info.script,...portArgs(info,port)]:['run',info.script,...portArgs(info,port)];
  return this.run(id,folder,packageCommand(info.manager,runArgs),'dev',info.manager+' '+runArgs.join(' '),{PORT:String(port)})}
 stop(id){const s=this.servers.get(id);if(!s)return this.view(id);s.stopped=true;killTree(s.child);s.state='stopped';return this.view(id)}
}
