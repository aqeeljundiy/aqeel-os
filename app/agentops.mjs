// One place for changing an agent's settings. The engine's own config lock only works inside one process, and
// "hermes config set" rewrites the whole config.yaml, so two writers at once can undo each other (or make a
// plugin enable refuse with "configuration changed"). Every aqeelOS writer for one agent goes through this
// queue, one at a time, and each command's result is checked instead of assumed.
import {execFile,spawn} from 'node:child_process';
import {readFile,writeFile,rename,readdir,stat,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

const HOME=homedir();
const HERMES=process.env.HERMES_BIN||path.join(HOME,'.local','bin','hermes');
export const HERMES_HOME=process.env.HERMES_HOME||path.join(HOME,'.hermes');
export const homeOf=a=>a==='default'?HERMES_HOME:path.join(HERMES_HOME,'profiles',a);
// only the live app (port 4400) runs background jobs that change agents; a test copy on another port must not
export const LIVE_APP=(Number(process.env.UI_PORT)||4400)===4400;

const queues=new Map();
export function withAgent(agent,fn){const prev=queues.get(agent)||Promise.resolve();
 const run=prev.then(fn,fn);const tail=run.then(()=>{},()=>{});queues.set(agent,tail);
 tail.then(()=>{if(queues.get(agent)===tail)queues.delete(agent)});return run}
export const busy=()=>queues.size;   // agents with a settings change in progress

// The CLI prints "Error: …" and still exits 0 for many refusals, so the output is checked too.
const BAD=/^\s*(?:Error|ERROR)\b[:\s]|Traceback \(most recent call last\)/m;
const RETRY=/changed while|inputs changed|configuration changed|conflict|already in progress|locked/i;
const exec=(args,timeout)=>new Promise(res=>execFile(HERMES,args,{timeout,maxBuffer:4e6,cwd:HOME},(e,o,er)=>{
 const out=String(o||'')+String(er||'');const bad=BAD.test(out);
 res({ok:!e&&!bad,out,err:(e||bad)?(out.trim().split('\n').filter(l=>/error|refus|fail|denied|not /i.test(l)).pop()||out.trim().split('\n').pop()||e?.message||'failed').slice(0,300):''})}));
// one engine command for one agent, queued; tried again when another writer got in between
// After an engine update its first command finishes setting itself up (dependencies, the computer-use driver), which
// can outlast the time limit: that is not a failure, so the command runs again with room to finish.
const SETTING_UP=/completing source-update|Installing Python dependencies|Preparing pinned|Syncing bundled skills|Update complete/i;
export async function hermes(agent,args,{timeout=60000,retries=2}={}){
 for(let i=0,t=timeout;;i++){const r=await withAgent(agent,()=>exec(['-p',agent,...args],t));
  if(!r.ok&&SETTING_UP.test(r.out)&&i<=retries){t=Math.max(t,300000);continue}
  if(r.ok||i>=retries||!RETRY.test(r.out))return r;await new Promise(z=>setTimeout(z,3000*(i+1)))}}
export const setKey=(agent,key,value)=>hermes(agent,['config','set',key,typeof value==='string'?value:JSON.stringify(value),...(value&&typeof value==='object'?['--force']:[])]);

// the agent's settings as data (the engine's own Python reads the YAML)
let py=null;
export async function python(){if(py&&await stat(py).then(()=>true,()=>false))return py;py=null;const base=path.join(HERMES_HOME,'installs');const found=[];
 for(const i of await readdir(base).catch(()=>[]))for(const e of await readdir(path.join(base,i,'environments')).catch(()=>[])){const p=path.join(base,i,'environments',e,'venv','bin','python');const s=await stat(p).catch(()=>null);if(s)found.push([s.mtimeMs,p])}
 for(const [,p] of found.sort((a,b)=>b[0]-a[0])){const ok=await new Promise(r=>execFile(p,['-c','import ruamel.yaml'],{timeout:10000},e=>r(!e)));if(ok){py=p;return py}}return null}
export async function readConfig(agent){const p=await python();if(!p)return null;
 return new Promise(res=>execFile(p,['-c','import sys,json;from ruamel.yaml import YAML;print(json.dumps(YAML(typ="safe").load(open(sys.argv[1])) or {},default=str))',path.join(homeOf(agent),'config.yaml')],{timeout:20000,maxBuffer:8e6},(e,o)=>{try{res(e?null:JSON.parse(String(o)))}catch{res(null)}}))}
export const pick=(o,k)=>k.split('.').reduce((x,y)=>x&&typeof x==='object'?x[y]:undefined,o);

// a real agent folder: the engine leaves a bare logs/ folder behind when a command runs during a delete
export async function isAgent(name){return name==='default'||!!await stat(path.join(homeOf(name),'config.yaml')).catch(()=>null)}
export async function agentNames({copies=false}={}){const n=['default'];
 for(const d of await readdir(path.join(HERMES_HOME,'profiles'),{withFileTypes:true}).catch(()=>[]))
  if(d.isDirectory()&&!d.name.startsWith('.')&&(copies||!d.name.includes('--'))&&await isAgent(d.name))n.push(d.name);
 return n}

// .env edits hold the engine's own lock (flock on .env.lock), so a WhatsApp pairing writing at the same time is not lost
export function editEnv(envF,compute){return new Promise((res,rej)=>{
 const p=spawn('flock',['-w','20',envF+'.lock','-c','echo locked; read _'],{stdio:['pipe','pipe','ignore']});let got=false;
 p.on('error',rej);p.on('exit',c=>{if(!got)rej(new Error(c?'The settings file is busy; try again.':'lock ended early'))});
 p.stdout.once('data',async()=>{got=true;try{const cur=await readFile(envF,'utf8').catch(()=>'');const next=compute(cur);
   if(typeof next==='string'&&next!==cur){await writeFile(envF+'.tmp',next,{mode:0o600});await rename(envF+'.tmp',envF)}res(typeof next==='string'&&next!==cur)}
  catch(e){rej(e)}finally{p.stdin.end()}})})}

// each agent's setup result (last run, what failed), shown on the Agents page and retried by the health check
let STATUS=null,stChain=Promise.resolve();
export function initStatus(DATA){STATUS=path.join(DATA,'agent-setup.json')}
export async function getStatus(){if(!STATUS)return {};try{return JSON.parse(await readFile(STATUS,'utf8'))}catch{return {}}}
export function setStatus(name,patch){if(!STATUS)return Promise.resolve();stChain=stChain.then(async()=>{const s=await getStatus();
 if(patch===null)delete s[name];else s[name]={...(s[name]||{}),...patch};await mkdir(path.dirname(STATUS),{recursive:true});await writeFile(STATUS+'.tmp',JSON.stringify(s,null,1));await rename(STATUS+'.tmp',STATUS)}).catch(()=>{});return stChain}
