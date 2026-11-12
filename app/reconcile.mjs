// Background work that follows changes (12 Nov 2026, audit of timers): the "apply this to every agent" jobs used to run
// every 10 minutes whether or not anything had changed (about 17 loops, each walking every agent's home). They are now
// tasks of one reconciler: a task runs at start, when something it reads changed (a cheap stat fingerprint, checked once a
// minute for all tasks together), when an event asks for it (trigger: an agent made, settings saved), and as one slow safety
// sweep (SWEEP, default 4 hours) that runs everything whether or not a fingerprint moved, so a change the fingerprint
// cannot see still heals. Every loop in the app can also be counted (track) for System > Health > Efficiency.
import {stat,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// "mtime:size" of each path, "-" when it is missing; two equal strings mean nothing was written in between
export async function statSig(paths){return (await Promise.all(paths.map(p=>stat(p).then(s=>Math.round(s.mtimeMs)+':'+s.size,()=>'-')))).join('|')}
// a folder's own time and the time of what is directly in it, `depth` levels down (a skill or plugin added, removed or rewritten
// at its top moves its folder's time); never reads file contents
export async function treeSig(dir,depth=1){const parts=[];
 async function walk(d,n){const s=await stat(d).catch(()=>null);parts.push(s?Math.round(s.mtimeMs)+':'+s.size:'-');if(!s||!s.isDirectory()||n<=0)return;
  const l=(await readdir(d,{withFileTypes:true}).catch(()=>[])).filter(e=>!e.name.startsWith('.')).sort((a,b)=>a.name<b.name?-1:1);
  for(const e of l){parts.push(e.name);if(e.isDirectory())await walk(path.join(d,e.name),n-1);else{const f=await stat(path.join(d,e.name)).catch(()=>null);parts.push(f?Math.round(f.mtimeMs)+':'+f.size:'-')}}}
 await walk(dir,depth);return parts.join(',')}
// a home's schedules as the apply tasks see them: what a job is and does, not when it last ran (the engine rewrites jobs.json at every run,
// so its time says nothing). Parsed again only when the file's time or size moved.
const jobsMemo=new Map();
export async function jobsSig(home){const f=path.join(home,'cron','jobs.json'),s=await stat(f).catch(()=>null);if(!s)return '-';const k=Math.round(s.mtimeMs)+':'+s.size,m=jobsMemo.get(f);if(m&&m.k===k)return m.v;
 let v='?';try{const j=JSON.parse(await readFile(f,'utf8')),l=Array.isArray(j)?j:j.jobs||[];v=createHash('sha1').update(JSON.stringify(l.map(x=>[x.id,x.name,x.schedule,x.enabled,x.state==='paused',x.script,x.deliver,x.prompt,x.model,x.skills])).slice(0,2e6)).digest('hex').slice(0,12)}catch{}
 jobsMemo.set(f,{k,v});return v}
// what the apply tasks read inside one agent's home: its settings, its plugins, its skills (two levels: category, skill)
// top: the home folder's own time (a file made or removed in it: a sign-in file, a plugin folder); left out for the main agent, whose home is the engine's busy one
// parts: only the ones some task reads are worked out. skillfiles goes one level deeper (a SKILL.md edited in place)
export const PARTS=['cfg','plugins','skills','skillfiles','top','jobs','tokens'];
export async function homeSig(home,{top=false,parts=PARTS}={}){const w=new Set(parts),o={};
 await Promise.all([w.has('cfg')&&statSig([path.join(home,'config.yaml')]).then(v=>o.cfg=v),w.has('plugins')&&treeSig(path.join(home,'plugins'),1).then(v=>o.plugins=v),w.has('skills')&&treeSig(path.join(home,'skills'),2).then(v=>o.skills=v),
  w.has('skillfiles')&&treeSig(path.join(home,'skills'),3).then(v=>o.skillfiles=v),w.has('top')&&(top?statSig([home]):Promise.resolve('')).then(v=>o.top=v),w.has('jobs')&&jobsSig(home).then(v=>o.jobs=v),w.has('tokens')&&treeSig(path.join(home,'mcp-tokens'),1).then(v=>o.tokens=v)].filter(Boolean));return o}
// skips an agent whose inputs are the same as when it was last done: prepare(names) reads them, skip(a) asks, commit(a) records them after the work (a failed agent is never committed, so it is tried again)
export function createAgentGate({homeOf,reads=['cfg'],extra=async()=>''}){const memo=new Map();let cur=new Map();
 const one=async(a,x)=>{const s=await homeSig(homeOf(a),{top:a!=='default'}).catch(()=>null);return s?x+'#'+reads.map(k=>s[k]).join('#'):null};
 return {async prepare(names,{force=false}={}){const x=await extra();cur=new Map(await Promise.all(names.map(async a=>[a,await one(a,x)])));if(force)memo.clear()},
  skip:a=>{const s=cur.get(a);return s!=null&&memo.get(a)===s},async commit(a){const s=await one(a,await extra());if(s!=null)memo.set(a,s)},forget:a=>{memo.delete(a)},size:()=>memo.size}}
// the engine's ledger of runs, per agent (a run starting or ending writes it; the write-ahead log moves first)
export const ledgerSig=homes=>statSig(homes.flatMap(h=>['executions.db','executions.db-wal'].map(f=>path.join(h,'cron',f))));

const fmtMs=ms=>ms<1000?Math.round(ms)+' ms':ms<60e3?(ms/1000).toFixed(1)+' s':Math.round(ms/6e3)/10+' min';
export const SWEEP=4*3600e3,CHECK=60e3;

// stats are kept for every loop: runs (the work was done), skipped (looked, nothing to do), ms spent on the work, errors
export function createLoops({now=()=>Date.now()}={}){
 const S=new Map();const row=n=>{let r=S.get(n);if(!r)S.set(n,r={name:n,every:0,runs:0,skipped:0,errors:0,ms:0,last:0,lastMs:0,why:''});return r};
 const note=(n,{ran=true,ms=0,every,why,err=false}={})=>{const r=row(n);if(every!=null)r.every=every;if(why)r.why=why;if(err)r.errors++;if(ran){r.runs++;r.ms+=ms;r.lastMs=ms;r.last=now()}else r.skipped++;return r};
 // wrap a loop's function: counted as work, or as skipped when it returns {skipped:true}; the function's own result passes through
 const track=(name,fn,{every,why}={})=>{row(name);if(every!=null)row(name).every=every;if(why)row(name).why=why;
  return async(...a)=>{const t=now();try{const v=await fn(...a);if(v&&v.skipped===true)note(name,{ran:false});else note(name,{ms:now()-t});return v}catch(e){note(name,{ms:now()-t,err:true});throw e}}};
 const stats=()=>[...S.values()].map(r=>({...r,ms:Math.round(r.ms),avg:r.runs?Math.round(r.ms/r.runs):0,text:fmtMs(r.ms)})).sort((a,b)=>b.ms-a.ms||b.runs-a.runs);
 return {track,note,stats,row}}

export function createReconciler({loops=createLoops(),now=()=>Date.now(),log=m=>console.log(m),sweep=SWEEP,check=CHECK,first=60e3,gap=1500,homes=async()=>[],homeOf=a=>a,fixedSig=async()=>'',taskMs=15*60e3,setTimer=setTimeout,setTick=setInterval,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const tasks=new Map();let timer=null,running=null,again=false,dirty=new Set(),allDirty=false,started=false;
 // add(name,{run, reads:['cfg'|'plugins'|'skills'], files:[paths], why, every}): run() is the old loop body, untouched
 function add(name,t){const every=t.every||sweep;tasks.set(name,{name,run:t.run,reads:t.reads||['cfg'],files:t.files||[],every,fp:null,at:0,retry:0});Object.assign(loops.row(name),{every,why:t.why||''});return api}
 // the fingerprints this pass needs, each read once and shared by every task
 async function world(){const hs=await homes().catch(()=>[]),parts=[...new Set([...tasks.values()].flatMap(t=>t.reads))];
  const per=await Promise.all(hs.map(a=>homeSig(homeOf(a),{top:a!=='default',parts}).then(s=>[a,s]).catch(()=>[a,Object.fromEntries(parts.map(k=>[k,'?']))])));
  const w={list:hs.join(','),fixed:await fixedSig().catch(()=>'')};for(const k of parts)w[k]='';for(const [a,s] of per)for(const k of parts)w[k]+=a+'='+s[k]+';';return w}
 const sigOf=async(t,w)=>[w.list,w.fixed,...t.reads.map(k=>w[k]),await statSig(t.files)].join('#');
 // each task has a time limit (audit M24): one that hangs (a child process with no limit of its own) is treated like one that threw, and the
 // pass goes on; before, go() handed the same never-ending pass to every later call and no task ran again until the app restarted
 async function exec(t,w,why){const t0=now();let timer;try{await Promise.race([t.run({why}),new Promise((_,rej)=>{timer=setTimeout(()=>rej(Error('still running after '+Math.round(taskMs/60e3)+' minutes; left behind')),taskMs)})]);loops.note(t.name,{ms:now()-t0});t.at=now();t.retry=0;t.fp=await sigOf(t,await world())}   // the fingerprint after the work: its own writes do not start it again
  catch(e){loops.note(t.name,{ms:now()-t0,err:true});t.fp=null;t.retry=now()+10*60e3;log('reconcile '+t.name+': '+e.message)}finally{clearTimeout(timer)}}
 // one pass: tasks whose inputs moved (or that were asked for, or whose safety sweep is due) run, one after the other
 async function pass(){const ask=dirty,askAll=allDirty;dirty=new Set();allDirty=false;   // taken now: a trigger during the pass is kept for the next one
  const w=await world(),ranAny=[];
  for(const t of tasks.values()){let why=null;
   if(askAll||ask.has(t.name))why='asked';
   else if(t.retry&&now()<t.retry){loops.note(t.name,{ran:false});continue}
   else if(!t.at)why='start';
   else if(now()-t.at>=t.every)why='safety sweep';
   else{const s=await sigOf(t,w).catch(()=>null);if(s===null||s!==t.fp)why='changed'}
   if(!why){loops.note(t.name,{ran:false});continue}
   if(ranAny.length)await sleep(gap);ranAny.push(t.name);await exec(t,w,why)}
  return ranAny}
 // never two passes at once; a trigger during a pass is answered by one more pass right after it
 function go(){if(running){again=true;return running}running=(async()=>{try{do{again=false;await pass()}while(again)}catch(e){log('reconcile: '+e.message)}finally{running=null}})();return running}
 // an event: something changed that the tasks read. name = one task, none = all. Runs within a second, not at the next minute
 function trigger(name){if(name&&tasks.has(name))dirty.add(name);else allDirty=true;if(started)setTimer(()=>go(),1000).unref?.();return api}
 function start(){if(started)return api;started=true;setTimer(()=>go(),first).unref?.();timer=setTick(()=>go(),check);timer.unref?.();return api}
 const api={add,trigger,start,pass:go,stats:loops.stats,loops,tasks:()=>[...tasks.keys()]};return api}
