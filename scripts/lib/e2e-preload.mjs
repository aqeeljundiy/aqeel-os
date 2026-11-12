// Preload for the end-to-end resume test (scripts/resume-e2e.test.mjs): `node --import <this file> app/server.mjs`.
// It runs INSIDE the app process and does four things, so the real app can be started, killed and started again on one machine with
// nothing outside it touched:
//  1. a faster clock: Date.now() and every timer run E2E_WARP times quicker than real time (the app waits minutes in places: a 20 s first
//     look, 45 s to see whether the engine is still working, a 60 s backoff). The test uses the same clock (fake-engine.mjs vnow()).
//  2. only this machine can be reached: a connection to any other host is refused.
//  3. every child process is refused (exit 127), except: node itself; the "engine's Python" (see 4); and the fixer's launch, which is
//     recorded in E2E_LOG and replaced by a harmless process, so a fixer run is never really started.
//  4. the engine's Python is emulated in JavaScript: the app reads the engine's records (an agent's state.db and cron/executions.db) by
//     starting the engine's own Python with a small script. Here the same questions are answered from JSON files that the fake engine
//     writes under the same names (state.db, cron/executions.db). The questions are the ones in app/resume-engine.mjs, ported line by line.
import net from 'node:net';import cp from 'node:child_process';import util from 'node:util';import path from 'node:path';
import {appendFileSync,readFileSync,existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const K=Number(process.env.E2E_WARP)||1,R0=Number(process.env.E2E_R0)||Date.now(),LOG=process.env.E2E_LOG,FAKE_PY=process.env.E2E_FAKE_PY;
const log=o=>{try{appendFileSync(LOG,JSON.stringify({...o,at:Date.now()})+'\n')}catch{}};
/* 1 the clock */
const realNow=Date.now.bind(Date);Date.now=()=>R0+(realNow()-R0)*K;
const st=globalThis.setTimeout,si=globalThis.setInterval;
globalThis.setTimeout=(f,ms,...a)=>st(f,Math.max(1,(Number(ms)||0)/K),...a);
globalThis.setInterval=(f,ms,...a)=>si(f,Math.max(1,(Number(ms)||0)/K),...a);
/* 2 only this machine */
const local=h=>!h||/^(localhost|127\.|::1$|::ffff:127\.|0\.0\.0\.0$)/i.test(String(h).replace(/^\[|\]$/g,''));
const oc=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...a){const o=a[0];const host=o&&typeof o==='object'?(o.path?'':o.host):(typeof o==='number'&&typeof a[1]==='string'?a[1]:'');
 if(!local(host)){log({k:'blocked-connect',host});process.nextTick(()=>this.destroy(Object.assign(new Error('blocked by the resume test: '+host),{code:'ECONNREFUSED'})));return this}return oc.apply(this,a)};
/* 4 the engine's Python, in JavaScript */
const rj=f=>{try{return JSON.parse(readFileSync(f,'utf8'))}catch{return undefined}};
const alive=p=>{try{process.kill(Number(p),0);return true}catch{return false}};
const iso=v=>typeof v==='string'?Date.parse(v):0;
const jobsOf=home=>{const d=rj(path.join(home,'cron','jobs.json'));return d?(Array.isArray(d)?d:d.jobs||[]):[]};
function chat([db,sid,since,note]){const d=rj(db);if(!d)return null;const s=d.sessions?.[sid];if(!s)return {missing:true};
 const o={stored:false,answered:false,personAfter:false,tools:[],openCall:false,posted:false,partial:false,lastAt:0},calls=new Set();let seen=false;
 for(const m of (s.messages||[]).filter(m=>m.timestamp>=Number(since))){o.lastAt=Math.max(o.lastAt,Math.floor(m.timestamp*1000));const text=typeof m.content==='string'?m.content:'';
  if(m.role==='user'){if(text.startsWith(note)){seen=true;o.stored=true;o.answered=false;continue}if(seen)o.personAfter=true;seen=true;o.stored=true;o.answered=false;continue}
  if(!seen)continue;
  if(m.role==='assistant'){const names=[];let tc=[];try{tc=JSON.parse(m.tool_calls||'[]')||[]}catch{}
   for(const x of tc){const n=(x.function||{}).name||x.name||'';names.push(n);if(x.id)calls.add(x.id)}
   o.tools.push(...names);if(names.join(' ').includes('record_post')||String(m.tool_calls||'').includes('record_post'))o.posted=true;
   o.answered=!!text.trim()&&!names.length;if(text.trim()&&names.length)o.partial=true}
  else if(m.role==='tool'){calls.delete(m.tool_call_id);o.answered=false}}
 o.openCall=calls.size>0;o.tools=[...new Set(o.tools)].sort().slice(0,40);return o}
function runs(args){const out=[];for(const a of args){const i=a.indexOf('='),name=a.slice(0,i),home=a.slice(i+1),db=path.join(home,'cron','executions.db');if(!existsSync(db))continue;
  const names={};for(const j of jobsOf(home))names[j.id]=j.name;const d=rj(db);if(!d)return null;
  for(const r of d.executions||[])if(r.status==='claimed'||r.status==='running')out.push({kind:'schedule',agent:name,exec:r.id,job:r.job_id,name:names[r.job_id]||r.job_id,since:r.claimed_at,ownerLive:r.pid==null?true:alive(r.pid)})}return out}
function run([home,eid,job]){const o={missing:true,jobKnown:false,enabled:null};
 for(const j of jobsOf(home))if(j.id===job){o.jobKnown=true;o.enabled=j.enabled!==false&&j.state!=='paused'}
 const d=rj(path.join(home,'cron','executions.db'));if(!d)return null;const r=(d.executions||[]).find(x=>x.id===eid);
 if(r){o.missing=false;o.status=r.status;o.error=r.error||'';o.delivered=['delivered','sent','ok','success'].includes(String(r.delivery_outcome||'').toLowerCase());o.ownerLive=alive(r.pid);
  o.newer=(d.executions||[]).some(x=>x.job_id===job&&String(x.claimed_at)>String(r.claimed_at))}return o}
const routing=home=>{const d=rj(path.join(home,'state.db'));return d?d.routing||[]:undefined};
const marked=(j,u)=>{if(j.last_resume_marked_at){const t=iso(j.last_resume_marked_at);if(t)return t}return Math.floor((u||0)*1000)};
const SKIP=['local','api_server','webhook','cron','acp','cli','tui'],REASONS=['restart_timeout','shutdown_timeout','restart_interrupted'];
function channels(args){const out=[];for(const a of args){const i=a.indexOf('='),name=a.slice(0,i),home=a.slice(i+1);
  for(const r of routing(home)||[]){let j;try{j=JSON.parse(r.entry_json)}catch{continue}const o=j.origin||{};
   if(j.resume_pending&&!j.suspended&&o&&!SKIP.includes(o.platform||j.platform)&&REASONS.includes(j.resume_reason))out.push({agent:name,key:r.session_key,platform:o.platform||j.platform,session:j.session_id||'',markedAt:marked(j,r.updated_at)})}}return out}
function channel([home,key]){const r=routing(home);if(r===undefined)return null;const o={missing:true,pending:false,markedAt:0};
 for(const x of r){if(x.session_key!==key)continue;let j;try{j=JSON.parse(x.entry_json)}catch{continue}o.missing=false;if(j.resume_pending&&!j.suspended){o.pending=true;o.markedAt=marked(j,x.updated_at)}}return o}
function emulate(args){const code=String(args[1]||''),rest=args.slice(2);
 if(/^import ruamel\.yaml/.test(code))return '';
 if(code.includes('YAML(typ="safe")')){const d=rj(rest[0]);return d===undefined?{__fail:true}:d}
 if(code.includes('from messages where session_id'))return chat(rest);
 if(code.includes("status in ('claimed','running')"))return runs(rest);
 if(code.includes('select status,pid,claimed_at,error'))return run(rest);
 if(code.includes('home,key=sys.argv[1],sys.argv[2]')&&code.includes('resume_pending'))return channel(rest);
 if(code.includes('resume_pending'))return channels(rest);
 if(code.includes('async_delegations')&&code.includes('delegation_id!=?'))return {missing:true};
 if(code.includes('async_delegations'))return [];
 return {__fail:true}}
/* 3 children */
const NODE=process.execPath,DEAD=['-e','process.exit(127)'];
const split=a=>{let cb;if(typeof a.at(-1)==='function')cb=a.pop();let opts;if(a.length&&a.at(-1)&&typeof a.at(-1)==='object'&&!Array.isArray(a.at(-1)))opts=a.pop();return {args:Array.isArray(a[0])?a[0]:[],opts:{...(opts||{}),shell:false},cb}};
const oSpawn=cp.spawn,oSpawnSync=cp.spawnSync,oExecFile=cp.execFile,oExecFileSync=cp.execFileSync;
cp.spawn=function(f,...a){if(f===NODE)return oSpawn.call(this,f,...a);const {args,opts}=split(a);
 if(args.includes('aqeelos-fixer')||args.includes('aqeelos-sort')){const which=args.includes('aqeelos-fixer')?'fixer':'sort',p=oSpawn.call(this,NODE,['-e','setTimeout(()=>{},3e5)'],{detached:true,stdio:'ignore'});log({k:'launch',which,agent:args[4],dir:args[5],pid:p.pid});return p}
 log({k:'refused',call:'spawn',f:String(f)});return oSpawn.call(this,NODE,DEAD,opts)};
cp.spawnSync=function(f,...a){if(f===NODE)return oSpawnSync.call(this,f,...a);log({k:'refused',call:'spawnSync',f:String(f)});return oSpawnSync.call(this,NODE,DEAD,split(a).opts)};
cp.execFile=function(f,...a){if(f===NODE)return oExecFile.call(this,f,...a);const {args,opts,cb}=split(a);
 if(f===FAKE_PY){const r=emulate(args);if(r&&r.__fail){log({k:'python-unknown',code:String(args[1]).slice(0,60)});process.nextTick(()=>cb&&cb(Object.assign(new Error('not emulated'),{code:1}),'',''));return {pid:0,kill(){},on(){}}}
  process.nextTick(()=>cb&&cb(null,typeof r==='string'?r:JSON.stringify(r),''));return {pid:0,kill(){},on(){}}}
 log({k:'refused',call:'execFile',f:String(f)});return oExecFile.call(this,NODE,DEAD,opts,cb)};
cp.execFileSync=function(f,...a){if(f===NODE)return oExecFileSync.call(this,f,...a);log({k:'refused',call:'execFileSync',f:String(f)});return oExecFileSync.call(this,NODE,DEAD,split(a).opts)};
cp.exec=function(c,...a){log({k:'refused',call:'exec',f:String(c).slice(0,60)});const {opts,cb}=split(a);return oExecFile.call(cp,NODE,DEAD,opts,cb)};
cp.execSync=function(c,...a){log({k:'refused',call:'execSync',f:String(c).slice(0,60)});return oExecFileSync.call(cp,NODE,DEAD,split(a).opts)};
cp.execFile[util.promisify.custom]=(...a)=>new Promise((res,rej)=>cp.execFile(...a,(e,stdout,stderr)=>e?rej(Object.assign(e,{stdout,stderr})):res({stdout,stderr})));
cp.exec[util.promisify.custom]=(...a)=>new Promise((res,rej)=>cp.exec(...a,(e,stdout,stderr)=>e?rej(Object.assign(e,{stdout,stderr})):res({stdout,stderr})));
cp.fork=function(){log({k:'refused',call:'fork'});return oSpawn.call(this,NODE,DEAD)};
syncBuiltinESMExports();
